-- =====================================================================
--  QuizRocket — database schema, security rules and game engine
--  Run this whole file once in Supabase:  Dashboard → SQL Editor → New query → Run
--  It is safe to re-run (it drops and recreates functions/policies, keeps data).
-- =====================================================================
--  Design
--  * Teachers sign in with email + password.
--  * Students get an invisible "anonymous" Supabase account when they open the
--    join link, so the database can tell each device apart without sign-up.
--  * ALL game state changes happen inside SECURITY DEFINER functions below.
--    Students can only call join_game, submit_answer and get_my_status.
--    Teachers (session hosts) can call host_control & friends for their own
--    sessions only. Scores are calculated here, never in the browser.
--  * Correct answers live in session_questions, which students can NOT read.
--    The public game_sessions row only ever contains student-safe data; the
--    correct answer is copied into it only when the teacher clicks Reveal.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.is_teacher() returns boolean
language sql stable as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.quizzes (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 150),
  description  text,
  grade        text,
  subject      text,
  lesson       text,
  topic        text,
  cover_image  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists quizzes_owner_idx on public.quizzes(owner_id);

create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  quiz_id     uuid not null references public.quizzes(id) on delete cascade,
  position    int  not null default 0,
  type        text not null default 'multiple_choice' check (type in ('multiple_choice','true_false')),
  prompt      text not null default '',
  image_url   text,
  time_limit  int  not null default 20 check (time_limit between 5 and 240),
  points      int  not null default 1000 check (points between 0 and 10000),
  -- [{ "text": "...", "image_url": null, "is_correct": true }, ...]  (2–4 items)
  options     jsonb not null,
  created_at  timestamptz not null default now(),
  constraint questions_options_count check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4)
);
create index if not exists questions_quiz_idx on public.questions(quiz_id, position);

create table if not exists public.game_sessions (
  id                  uuid primary key default gen_random_uuid(),
  quiz_id             uuid references public.quizzes(id) on delete set null,
  host_id             uuid not null references auth.users(id) on delete cascade,
  quiz_title          text not null,
  pin                 text not null,
  mode                text not null check (mode in ('teacher_paced','timed')),
  status              text not null default 'lobby'
                      check (status in ('lobby','ready','question','closed','revealed','results','leaderboard','ended')),
  locked              boolean not null default false,
  paused              boolean not null default false,
  paused_at           timestamptz,
  paused_remaining_ms int,
  current_index       int  not null default -1,
  question_count      int  not null default 0,
  question_started_at timestamptz,
  question_deadline   timestamptz,
  scored_through      int  not null default -1,
  current_question    jsonb,   -- student-safe copy of the live question (no answer key)
  reveal              jsonb,   -- { index, correct:[..] } set only on Reveal
  results             jsonb,   -- class statistics, set only on Show Results
  leaderboard         jsonb,   -- rankings, set only on Show Leaderboard / End
  next_pin            text,    -- set when the teacher restarts with the same quiz
  version             bigint not null default 0,  -- +1 on every change; clients ignore stale updates
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  ended_at            timestamptz
);
alter table public.game_sessions add column if not exists version bigint not null default 0;
create unique index if not exists game_sessions_live_pin on public.game_sessions(pin) where status <> 'ended';
create index if not exists game_sessions_host_idx on public.game_sessions(host_id, created_at desc);

-- Frozen copy of the quiz for one game (keeps reports correct even if the quiz is edited later)
create table if not exists public.session_questions (
  session_id  uuid not null references public.game_sessions(id) on delete cascade,
  idx         int  not null,
  question_id uuid,
  type        text not null,
  prompt      text not null,
  image_url   text,
  time_limit  int  not null,
  points      int  not null,
  options     jsonb not null,
  primary key (session_id, idx)
);

create table if not exists public.participants (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.game_sessions(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  nickname      text not null,
  avatar        text not null default '🦊',
  score         int  not null default 0,
  correct_count int  not null default 0,
  streak        int  not null default 0,
  status        text not null default 'active' check (status in ('active','removed','blocked')),
  joined_at     timestamptz not null default now(),
  unique (session_id, user_id)
);
create unique index if not exists participants_unique_nick on public.participants(session_id, lower(nickname)) where status = 'active';

create table if not exists public.answers (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.game_sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  question_index int  not null,
  option_index   int  not null,
  is_correct     boolean not null,
  points         int  not null default 0,
  response_ms    int  not null default 0,
  created_at     timestamptz not null default now(),
  unique (participant_id, question_index)          -- one answer per student per question
);
create index if not exists answers_session_idx on public.answers(session_id, question_index);

-- keep quizzes.updated_at fresh
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists quizzes_touch on public.quizzes;
create trigger quizzes_touch before update on public.quizzes for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
create or replace function public.is_session_host(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from game_sessions where id = p_session and host_id = auth.uid())
     and public.is_teacher()
$$;

create or replace function public.is_session_player(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from participants where session_id = p_session and user_id = auth.uid())
$$;

alter table public.quizzes           enable row level security;
alter table public.questions         enable row level security;
alter table public.game_sessions     enable row level security;
alter table public.session_questions enable row level security;
alter table public.participants      enable row level security;
alter table public.answers           enable row level security;

drop policy if exists quizzes_owner on public.quizzes;
create policy quizzes_owner on public.quizzes for all to authenticated
  using (owner_id = auth.uid() and public.is_teacher())
  with check (owner_id = auth.uid() and public.is_teacher());

drop policy if exists questions_owner on public.questions;
create policy questions_owner on public.questions for all to authenticated
  using (public.is_teacher() and exists (select 1 from public.quizzes z where z.id = quiz_id and z.owner_id = auth.uid()))
  with check (public.is_teacher() and exists (select 1 from public.quizzes z where z.id = quiz_id and z.owner_id = auth.uid()));

drop policy if exists sessions_read on public.game_sessions;
create policy sessions_read on public.game_sessions for select to authenticated
  using (host_id = auth.uid() or public.is_session_player(id));

drop policy if exists sessions_host_delete on public.game_sessions;
create policy sessions_host_delete on public.game_sessions for delete to authenticated
  using (host_id = auth.uid() and public.is_teacher());

drop policy if exists session_questions_host on public.session_questions;
create policy session_questions_host on public.session_questions for select to authenticated
  using (public.is_session_host(session_id));

drop policy if exists participants_read on public.participants;
create policy participants_read on public.participants for select to authenticated
  using (user_id = auth.uid() or public.is_session_host(session_id));

drop policy if exists answers_host on public.answers;
create policy answers_host on public.answers for select to authenticated
  using (public.is_session_host(session_id));

-- Belt and braces: nobody writes game tables directly; only the functions below do.
revoke insert, update, delete on public.game_sessions, public.session_questions, public.participants, public.answers from anon, authenticated;
grant delete on public.game_sessions to authenticated;
revoke all on public.quizzes, public.questions, public.game_sessions, public.session_questions, public.participants, public.answers from anon;

-- ---------------------------------------------------------------------
-- Internal helpers for the game engine (not callable by clients)
-- ---------------------------------------------------------------------
create or replace function public._public_question(q public.session_questions, total int) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'index', q.idx, 'total', total, 'type', q.type, 'prompt', q.prompt,
    'image_url', q.image_url, 'time_limit', q.time_limit, 'points', q.points,
    'options', (select jsonb_agg(jsonb_build_object('text', coalesce(o->>'text',''), 'image_url', o->>'image_url') order by ord)
                from jsonb_array_elements(q.options) with ordinality t(o, ord)))
$$;

-- Adds the points of one question to every student's total.
-- Only called by host_control, which holds the session row lock and makes sure it runs once per question.
create or replace function public._apply_scores(p_session uuid, p_idx int) returns void
language plpgsql security definer set search_path = public as $$
begin
  update participants p
     set score = p.score + a.points,
         correct_count = p.correct_count + (case when a.is_correct then 1 else 0 end),
         streak = case when a.is_correct then p.streak + 1 else 0 end
    from answers a
   where a.participant_id = p.id and a.session_id = p_session and a.question_index = p_idx;

  update participants p set streak = 0
   where p.session_id = p_session
     and not exists (select 1 from answers a where a.participant_id = p.id and a.question_index = p_idx);
end $$;

create or replace function public._reveal_json(p_session uuid, p_idx int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('index', q.idx,
           'correct', coalesce((select jsonb_agg(ord - 1 order by ord)
                                  from jsonb_array_elements(q.options) with ordinality t(o, ord)
                                 where coalesce((o->>'is_correct')::boolean, false)), '[]'::jsonb))
    from session_questions q where q.session_id = p_session and q.idx = p_idx
$$;

create or replace function public._results_json(p_session uuid, p_idx int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'index', p_idx,
    'players', (select count(*) from participants where session_id = p_session and status = 'active'),
    'answered', (select count(*) from answers a join participants p on p.id = a.participant_id
                  where a.session_id = p_session and a.question_index = p_idx and p.status = 'active'),
    'correct',  (select count(*) from answers a join participants p on p.id = a.participant_id
                  where a.session_id = p_session and a.question_index = p_idx and a.is_correct and p.status = 'active'),
    'avg_ms',   (select coalesce(round(avg(a.response_ms)), 0) from answers a where a.session_id = p_session and a.question_index = p_idx),
    'counts',   (select jsonb_agg((select count(*) from answers a join participants p on p.id = a.participant_id
                                    where a.session_id = p_session and a.question_index = p_idx
                                      and a.option_index = g.i and p.status = 'active') order by g.i)
                   from session_questions q, generate_series(0, jsonb_array_length(q.options) - 1) g(i)
                  where q.session_id = p_session and q.idx = p_idx))
$$;

create or replace function public._leaderboard_json(p_session uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('participant_id', id, 'nickname', nickname, 'avatar', avatar,
                                               'score', score, 'correct', correct_count, 'streak', streak, 'rank', rnk)
                            order by rnk, nickname), '[]'::jsonb)
    from (select *, rank() over (order by score desc) as rnk
            from participants where session_id = p_session and status = 'active'
           order by score desc, nickname limit 200) x
$$;

-- ---------------------------------------------------------------------
-- Public functions (RPC)
-- ---------------------------------------------------------------------
drop function if exists public.server_now();
create function public.server_now() returns timestamptz language sql stable as $$ select clock_timestamp() $$;

-- Teacher: create a live session for one of their quizzes
drop function if exists public.host_game(uuid, text);
create function public.host_game(p_quiz_id uuid, p_mode text default 'teacher_paced')
returns public.game_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_quiz quizzes; v_session game_sessions; v_count int; v_try int := 0;
begin
  if not is_teacher() then raise exception 'not_authorized'; end if;
  if p_mode not in ('teacher_paced','timed') then raise exception 'invalid_mode'; end if;
  select * into v_quiz from quizzes where id = p_quiz_id and owner_id = auth.uid();
  if not found then raise exception 'quiz_not_found'; end if;
  select count(*) into v_count from questions where quiz_id = p_quiz_id;
  if v_count = 0 then raise exception 'quiz_has_no_questions'; end if;

  loop
    begin
      insert into game_sessions (quiz_id, host_id, quiz_title, pin, mode, question_count)
      values (p_quiz_id, auth.uid(), v_quiz.title,
              (100000 + floor(random() * 900000))::int::text, p_mode, v_count)
      returning * into v_session;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 25 then raise exception 'could_not_create_pin'; end if;
    end;
  end loop;

  insert into session_questions (session_id, idx, question_id, type, prompt, image_url, time_limit, points, options)
  select v_session.id, (row_number() over (order by position, created_at, id))::int - 1,
         id, type, prompt, image_url, time_limit, points, options
    from questions where quiz_id = p_quiz_id;

  return v_session;
end $$;

-- Student: join (or re-join after a refresh / lost connection) with a PIN
drop function if exists public.join_game(text, text, text);
create function public.join_game(p_pin text, p_nickname text, p_avatar text default '🦊')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s game_sessions; v_p participants; v_has_p boolean;
  v_nick text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
  v_avatar text := left(coalesce(nullif(btrim(p_avatar), ''), '🦊'), 8);
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_s from game_sessions where pin = btrim(coalesce(p_pin, '')) and status <> 'ended';
  if not found then raise exception 'game_not_found'; end if;

  select * into v_p from participants where session_id = v_s.id and user_id = auth.uid();
  v_has_p := found;

  if v_has_p and v_p.status = 'blocked' then raise exception 'blocked'; end if;
  if v_has_p and v_p.status = 'active' then
    -- Same device coming back: keep their name and score.
    return jsonb_build_object('session_id', v_s.id, 'participant_id', v_p.id, 'nickname', v_p.nickname,
                              'avatar', v_p.avatar, 'rejoined', true);
  end if;

  if char_length(v_nick) < 1 or char_length(v_nick) > 20 then raise exception 'invalid_nickname'; end if;
  if v_s.locked then raise exception 'game_locked'; end if;
  if exists (select 1 from participants where session_id = v_s.id and status = 'active' and lower(nickname) = lower(v_nick)) then
    raise exception 'nickname_taken';
  end if;

  begin
    if v_has_p then   -- was removed by the teacher: may rejoin with a new name
      update participants set nickname = v_nick, avatar = v_avatar, status = 'active' where id = v_p.id returning * into v_p;
    else
      insert into participants (session_id, user_id, nickname, avatar)
      values (v_s.id, auth.uid(), v_nick, v_avatar) returning * into v_p;
    end if;
  exception when unique_violation then
    raise exception 'nickname_taken';
  end;

  return jsonb_build_object('session_id', v_s.id, 'participant_id', v_p.id, 'nickname', v_p.nickname,
                            'avatar', v_p.avatar, 'rejoined', false);
end $$;

-- Teacher: every game control button goes through here.
-- Each call locks the session row, works out the new state, and writes it in ONE update
-- (so every screen receives exactly one consistent change per click).
drop function if exists public.host_control(uuid, text);
create function public.host_control(p_session uuid, p_action text)
returns public.game_sessions
language plpgsql security definer set search_path = public as $$
declare
  s game_sessions; n game_sessions; q session_questions;
  v_now timestamptz := clock_timestamp();
  v_unscored boolean;
begin
  select * into s from game_sessions where id = p_session for update;
  if not found or s.host_id <> auth.uid() or not is_teacher() then raise exception 'not_authorized'; end if;
  if s.status = 'ended' and p_action not in ('lock','unlock') then raise exception 'game_ended'; end if;

  n := s;
  v_unscored := s.current_index >= 0 and s.scored_through < s.current_index;

  case p_action
  when 'start' then
    if s.status <> 'lobby' then raise exception 'invalid_state'; end if;
    n.status := 'ready'; n.started_at := v_now;

  when 'next' then
    if s.status = 'lobby' then raise exception 'not_started'; end if;
    if s.current_index + 1 >= s.question_count then raise exception 'no_more_questions'; end if;
    if v_unscored then perform _apply_scores(s.id, s.current_index); n.scored_through := s.current_index; end if;
    select * into q from session_questions where session_id = s.id and idx = s.current_index + 1;
    n.status := 'question'; n.current_index := q.idx;
    n.current_question := _public_question(q, s.question_count);
    n.question_started_at := v_now;
    n.question_deadline := case when s.mode = 'timed' then v_now + make_interval(secs => q.time_limit) end;
    n.paused := false; n.paused_at := null; n.paused_remaining_ms := null;
    n.reveal := null; n.results := null;

  when 'close' then
    if s.status <> 'question' then raise exception 'invalid_state'; end if;
    n.status := 'closed'; n.paused := false; n.paused_at := null; n.paused_remaining_ms := null;

  when 'reveal' then
    if s.current_index < 0 or s.status in ('lobby','ready') then raise exception 'invalid_state'; end if;
    if v_unscored then perform _apply_scores(s.id, s.current_index); n.scored_through := s.current_index; end if;
    n.status := 'revealed'; n.paused := false; n.paused_at := null; n.paused_remaining_ms := null;
    n.reveal := _reveal_json(s.id, s.current_index);

  when 'results' then
    if s.current_index < 0 or s.status in ('lobby','ready') then raise exception 'invalid_state'; end if;
    if v_unscored then perform _apply_scores(s.id, s.current_index); n.scored_through := s.current_index; end if;
    n.status := 'results'; n.paused := false; n.paused_at := null; n.paused_remaining_ms := null;
    n.reveal := _reveal_json(s.id, s.current_index);
    n.results := _results_json(s.id, s.current_index);

  when 'leaderboard' then
    if s.status = 'lobby' then raise exception 'not_started'; end if;
    if v_unscored then perform _apply_scores(s.id, s.current_index); n.scored_through := s.current_index; end if;
    if s.current_index >= 0 then n.reveal := coalesce(s.reveal, _reveal_json(s.id, s.current_index)); end if;
    n.status := 'leaderboard'; n.paused := false; n.paused_at := null; n.paused_remaining_ms := null;
    n.leaderboard := _leaderboard_json(s.id);

  when 'pause' then
    if s.status <> 'question' or s.paused then raise exception 'invalid_state'; end if;
    n.paused := true; n.paused_at := v_now;
    n.paused_remaining_ms := case when s.question_deadline is not null
                                  then greatest(0, (extract(epoch from (s.question_deadline - v_now)) * 1000)::int) end;

  when 'resume' then
    if not s.paused then raise exception 'invalid_state'; end if;
    n.paused := false;
    n.question_started_at := s.question_started_at + (v_now - s.paused_at);
    n.question_deadline := case when s.paused_remaining_ms is not null
                                then v_now + make_interval(secs => s.paused_remaining_ms / 1000.0) end;
    n.paused_at := null; n.paused_remaining_ms := null;

  when 'end' then
    if v_unscored then perform _apply_scores(s.id, s.current_index); n.scored_through := s.current_index; end if;
    if s.current_index >= 0 then n.reveal := coalesce(s.reveal, _reveal_json(s.id, s.current_index)); end if;
    n.status := 'ended'; n.ended_at := v_now; n.paused := false; n.paused_at := null; n.paused_remaining_ms := null;
    n.leaderboard := _leaderboard_json(s.id);

  when 'lock'   then n.locked := true;
  when 'unlock' then n.locked := false;

  else raise exception 'unknown_action';
  end case;

  update game_sessions set
    status = n.status, locked = n.locked, paused = n.paused, paused_at = n.paused_at,
    paused_remaining_ms = n.paused_remaining_ms, current_index = n.current_index,
    question_started_at = n.question_started_at, question_deadline = n.question_deadline,
    scored_through = n.scored_through, current_question = n.current_question, reveal = n.reveal,
    results = n.results, leaderboard = n.leaderboard, started_at = n.started_at, ended_at = n.ended_at,
    version = s.version + 1
  where id = s.id
  returning * into n;
  return n;
end $$;

-- Student: submit one answer. The server decides if it is on time, correct and how many points it earns.
drop function if exists public.submit_answer(uuid, int, int);
create function public.submit_answer(p_session uuid, p_question_index int, p_option_index int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s game_sessions; p participants; q session_questions;
  v_now timestamptz := clock_timestamp(); v_correct boolean; v_points int := 0; v_ms int; v_id uuid;
begin
  select * into p from participants where session_id = p_session and user_id = auth.uid();
  if not found or p.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_in_game'); end if;

  -- shared lock: many students can submit at once, but never in the middle of a teacher action
  select * into s from game_sessions where id = p_session for share;
  if s.status <> 'question' or s.current_index <> p_question_index then
    return jsonb_build_object('ok', false, 'reason', 'answers_closed');
  end if;
  if s.paused then return jsonb_build_object('ok', false, 'reason', 'paused'); end if;
  if s.question_deadline is not null and v_now > s.question_deadline + interval '1500 milliseconds' then
    return jsonb_build_object('ok', false, 'reason', 'time_up');
  end if;

  select * into q from session_questions where session_id = p_session and idx = p_question_index;
  if p_option_index is null or p_option_index < 0 or p_option_index >= jsonb_array_length(q.options) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_option');
  end if;

  v_correct := coalesce((q.options -> p_option_index ->> 'is_correct')::boolean, false);
  v_ms := greatest(0, (extract(epoch from (v_now - s.question_started_at)) * 1000)::int);
  if v_correct then
    if s.mode = 'timed' then
      -- full points for an instant answer, half points at the buzzer
      v_points := round(q.points * (1 - least(1.0, v_ms / (q.time_limit * 1000.0)) / 2.0));
    else
      v_points := q.points;
    end if;
  end if;

  insert into answers (session_id, participant_id, question_index, option_index, is_correct, points, response_ms)
  values (p_session, p.id, p_question_index, p_option_index, v_correct, v_points, v_ms)
  on conflict (participant_id, question_index) do nothing
  returning id into v_id;

  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'already_answered'); end if;
  return jsonb_build_object('ok', true);   -- correctness is NOT revealed here
end $$;

-- Student: my score / my answer (correctness only after the teacher reveals it)
drop function if exists public.get_my_status(uuid);
create function public.get_my_status(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s game_sessions; p participants; a answers; v_rank int; v_players int; v_revealed boolean;
begin
  select * into p from participants where session_id = p_session and user_id = auth.uid();
  if not found then return jsonb_build_object('joined', false); end if;
  select * into s from game_sessions where id = p_session;

  select count(*) + 1 into v_rank from participants
   where session_id = p_session and status = 'active' and score > p.score;
  select count(*) into v_players from participants where session_id = p_session and status = 'active';

  select * into a from answers where participant_id = p.id and question_index = s.current_index;
  v_revealed := s.scored_through >= s.current_index and s.status in ('revealed','results','leaderboard','ended');

  return jsonb_build_object(
    'joined', true, 'participant_id', p.id, 'nickname', p.nickname, 'avatar', p.avatar,
    'status', p.status, 'score', p.score, 'correct_count', p.correct_count, 'streak', p.streak,
    'rank', v_rank, 'players', v_players,
    'question_index', s.current_index,
    'answered', a.id is not null,
    'my_option', a.option_index,
    'is_correct', case when v_revealed and a.id is not null then a.is_correct end,
    'points', case when v_revealed and a.id is not null then a.points end);
end $$;

-- Teacher: remove (can rejoin with a new name) or block (cannot rejoin) a participant
drop function if exists public.remove_participant(uuid, boolean);
create function public.remove_participant(p_participant uuid, p_block boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_session uuid;
begin
  select session_id into v_session from participants where id = p_participant;
  if v_session is null or not is_session_host(v_session) then raise exception 'not_authorized'; end if;
  update participants set status = case when p_block then 'blocked' else 'removed' end where id = p_participant;
end $$;

-- Teacher: play the same quiz again (new PIN). Students on the final screen get a "Play again" button.
drop function if exists public.restart_game(uuid);
create function public.restart_game(p_session uuid) returns public.game_sessions
language plpgsql security definer set search_path = public as $$
declare s game_sessions; v_new game_sessions;
begin
  select * into s from game_sessions where id = p_session;
  if not found or s.host_id <> auth.uid() or not is_teacher() then raise exception 'not_authorized'; end if;
  if s.quiz_id is null then raise exception 'quiz_not_found'; end if;
  if s.status <> 'ended' then perform host_control(p_session, 'end'); end if;
  v_new := host_game(s.quiz_id, s.mode);
  update game_sessions set next_pin = v_new.pin, version = version + 1 where id = p_session;
  return v_new;
end $$;

-- ---------------------------------------------------------------------
-- Function permissions: only signed-in users (teachers or anonymous students)
-- ---------------------------------------------------------------------
revoke all on function public._public_question(public.session_questions, int) from public, anon, authenticated;
revoke all on function public._apply_scores(uuid, int)        from public, anon, authenticated;
revoke all on function public._reveal_json(uuid, int)         from public, anon, authenticated;
revoke all on function public._results_json(uuid, int)        from public, anon, authenticated;
revoke all on function public._leaderboard_json(uuid)         from public, anon, authenticated;

revoke all on function public.server_now()                          from public, anon;
revoke all on function public.host_game(uuid, text)                 from public, anon;
revoke all on function public.join_game(text, text, text)           from public, anon;
revoke all on function public.host_control(uuid, text)              from public, anon;
revoke all on function public.submit_answer(uuid, int, int)         from public, anon;
revoke all on function public.get_my_status(uuid)                   from public, anon;
revoke all on function public.remove_participant(uuid, boolean)     from public, anon;
revoke all on function public.restart_game(uuid)                    from public, anon;
grant execute on function public.server_now(), public.host_game(uuid, text), public.join_game(text, text, text),
  public.host_control(uuid, text), public.submit_answer(uuid, int, int), public.get_my_status(uuid),
  public.remove_participant(uuid, boolean), public.restart_game(uuid),
  public.is_teacher(), public.is_session_host(uuid), public.is_session_player(uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- Realtime: broadcast row changes (Realtime still applies the RLS rules above)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['game_sessions','participants','answers'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Image storage for questions & answers (public read, teachers upload into their own folder)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quiz-media', 'quiz-media', true, 5242880, array['image/png','image/jpeg','image/gif','image/webp','image/svg+xml'])
on conflict (id) do update set public = true;

drop policy if exists "quiz media upload" on storage.objects;
create policy "quiz media upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'quiz-media' and public.is_teacher() and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "quiz media manage" on storage.objects;
create policy "quiz media manage" on storage.objects for update to authenticated
  using (bucket_id = 'quiz-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "quiz media delete" on storage.objects;
create policy "quiz media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'quiz-media' and (storage.foldername(name))[1] = auth.uid()::text);
