-- End-to-end test of the game engine: 1 teacher, 3 students, 5 questions,
-- plus attempts by students/other teachers to cheat or take control.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create table if not exists public.test_ctx (k text primary key, v text);
grant all on public.test_ctx to authenticated;
truncate public.test_ctx;

create or replace function public.t_as(u uuid, is_anon boolean) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', false);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'is_anonymous', is_anon)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create or replace function public.t_admin() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', false); perform set_config('request.jwt.claims', '', false); end $$;
create or replace function public.t_get(key text) returns text language sql as $$ select v from public.test_ctx where k = key $$;
create or replace function public.t_put(key text, val text) returns void language sql as
  $$ insert into public.test_ctx values (key, val) on conflict (k) do update set v = excluded.v $$;
create or replace function public.t_check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'TEST FAILED: %', msg; end if; raise notice 'ok  %', msg; end $$;
-- expects the SQL to raise an error containing `expected`
create or replace function public.t_expect_error(sql text, expected text, msg text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if position(expected in sqlerrm) > 0 then raise notice 'ok  % (blocked: %)', msg, sqlerrm; return; end if;
    raise exception 'TEST FAILED: % — wrong error: %', msg, sqlerrm;
  end;
  raise exception 'TEST FAILED: % — no error raised', msg;
end $$;
grant execute on all functions in schema public to authenticated;
set client_min_messages = notice;

-- users ------------------------------------------------------------------
select t_admin();
delete from auth.users;
insert into auth.users values
 ('a0000000-0000-0000-0000-000000000001'),  -- teacher
 ('a0000000-0000-0000-0000-000000000002'),  -- another teacher
 ('b0000000-0000-0000-0000-000000000001'),  -- Lina
 ('b0000000-0000-0000-0000-000000000002'),  -- Omar
 ('b0000000-0000-0000-0000-000000000003'),  -- Sara
 ('b0000000-0000-0000-0000-000000000004');  -- outsider (never joins)

-- 1. Teacher creates a 5-question quiz ---------------------------------------
do $$ declare qz uuid; begin
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  insert into quizzes (title, grade, subject, topic) values ('Prefix Quiz Show', 'Grade 4', 'English', 'Prefixes') returning id into qz;
  insert into questions (quiz_id, position, type, prompt, time_limit, points, options) values
   (qz, 0, 'multiple_choice', 'What does mid– mean?', 20, 1000, '[{"text":"after"},{"text":"middle","is_correct":true},{"text":"before"}]'),
   (qz, 1, 'multiple_choice', 'Which word means "to pay before"?', 20, 1000, '[{"text":"postpay"},{"text":"midpay"},{"text":"prepay","is_correct":true}]'),
   (qz, 2, 'true_false', 'Poster has a real prefix.', 10, 1000, '[{"text":"True"},{"text":"False","is_correct":true}]'),
   (qz, 3, 'multiple_choice', 'fore– has the same meaning as…', 20, 2000, '[{"text":"pre–","is_correct":true},{"text":"post–"},{"text":"mid–"}]'),
   (qz, 4, 'multiple_choice', '____town = the centre of a city', 20, 1000, '[{"text":"pre"},{"text":"fore"},{"text":"mid","is_correct":true},{"text":"post"}]');
  perform t_put('quiz', qz::text);
  perform t_check((select count(*) from questions where quiz_id = qz) = 5, 'teacher created quiz with 5 questions');
end $$;

-- Other teacher and students cannot see or edit it
do $$ begin
  perform t_as('a0000000-0000-0000-0000-000000000002', false);
  perform t_check((select count(*) from quizzes) = 0, 'another teacher cannot see the quiz');
  perform t_check((select count(*) from questions) = 0, 'another teacher cannot see the answer key');
  perform t_as('b0000000-0000-0000-0000-000000000001', true);
  perform t_check((select count(*) from questions) = 0, 'student cannot read questions/answer key');
  perform t_expect_error(format('select host_game(%L, %L)', t_get('quiz'), 'timed'), 'not_authorized', 'student cannot host a game');
end $$;

-- 2. Teacher hosts the game ------------------------------------------------
do $$ declare s game_sessions; begin
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  s := host_game(t_get('quiz')::uuid, 'teacher_paced');
  perform t_check(s.pin ~ '^\d{6}$', 'session has a 6-digit PIN: ' || s.pin);
  perform t_check(s.status = 'lobby' and s.question_count = 5, 'session waits in lobby with 5 questions');
  perform t_put('sid', s.id::text); perform t_put('pin', s.pin);
end $$;

-- 3. Three students join ---------------------------------------------------
do $$ declare r jsonb; begin
  perform t_as('b0000000-0000-0000-0000-000000000001', true);
  perform t_expect_error(format('select join_game(%L, %L)', '000000', 'Lina'), 'game_not_found', 'wrong PIN rejected');
  perform t_expect_error(format('select join_game(%L, %L)', t_get('pin'), '   '), 'invalid_nickname', 'empty nickname rejected');
  r := join_game(t_get('pin'), 'Lina', '🦊');  perform t_put('p1', r->>'participant_id');
  perform t_check((r->>'rejoined')::boolean = false, 'Lina joined');
  r := join_game(t_get('pin'), 'Lina again');
  perform t_check((r->>'rejoined')::boolean and r->>'nickname' = 'Lina', 'Lina refreshing her page rejoins as the same player');
  perform t_check((select status from game_sessions where id = t_get('sid')::uuid) = 'lobby', 'student joining does NOT start the game');

  perform t_as('b0000000-0000-0000-0000-000000000002', true);
  perform t_expect_error(format('select join_game(%L, %L)', t_get('pin'), 'LINA'), 'nickname_taken', 'duplicate nickname rejected');
  r := join_game(t_get('pin'), 'Omar', '🐼');  perform t_put('p2', r->>'participant_id');

  perform t_as('b0000000-0000-0000-0000-000000000003', true);
  r := join_game(t_get('pin'), 'Sara', '🦄');  perform t_put('p3', r->>'participant_id');
  perform t_check((select count(*) from participants) = 1, 'a student only sees their own participant row');
  perform t_check((select count(*) from game_sessions) = 1, 'a student can read the public game state');
  perform t_expect_error(format('select host_control(%L, %L)', t_get('sid'), 'start'), 'not_authorized', 'student cannot start the game');
  perform t_expect_error(format('update game_sessions set status = %L', 'ended'), 'permission denied', 'student cannot write game state directly');
  perform t_expect_error(format('update participants set score = 99999'), 'permission denied', 'student cannot change scores');
  perform t_expect_error(format('insert into answers (session_id, participant_id, question_index, option_index, is_correct, points) values (%L,%L,0,0,true,5000)', t_get('sid'), t_get('p3')), 'permission denied', 'student cannot insert a fake answer');

  perform t_as('b0000000-0000-0000-0000-000000000004', true);
  perform t_check((select count(*) from game_sessions) = 0, 'outsider cannot read the game');

  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  perform t_check((select count(*) from participants where session_id = t_get('sid')::uuid) = 3, 'teacher sees all 3 students in the lobby');
end $$;

-- Another teacher cannot control it
do $$ begin
  perform t_as('a0000000-0000-0000-0000-000000000002', false);
  perform t_expect_error(format('select host_control(%L, %L)', t_get('sid'), 'start'), 'not_authorized', 'another teacher cannot control this game');
  perform t_check((select count(*) from participants) = 0, 'another teacher cannot see the players');
end $$;

-- 4. Teacher starts; question 1 released ------------------------------------
do $$ declare s game_sessions; begin
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  perform t_expect_error(format('select host_control(%L, %L)', t_get('sid'), 'next'), 'not_started', 'cannot release a question before Start');
  s := host_control(t_get('sid')::uuid, 'start');
  perform t_check(s.status = 'ready' and s.current_index = -1, 'Start: game is ready, no question shown yet');
  s := host_control(t_get('sid')::uuid, 'next');
  perform t_check(s.status = 'question' and s.current_index = 0, 'Next: question 1 released');
  perform t_check(s.current_question::text not like '%is_correct%', 'public question copy contains no answer key');
  perform t_check(s.reveal is null, 'correct answer not revealed yet');
end $$;

-- 5. Students answer Q1 (Lina right, Omar wrong, Sara right) -----------------
do $$ declare r jsonb; st jsonb; begin
  perform t_as('b0000000-0000-0000-0000-000000000001', true);
  perform t_check((select current_question->>'prompt' from game_sessions) = 'What does mid– mean?', 'Lina sees question 1');
  r := submit_answer(t_get('sid')::uuid, 1, 0);
  perform t_check(r->>'reason' = 'answers_closed', 'answering a question that is not live is rejected');
  r := submit_answer(t_get('sid')::uuid, 0, 7);
  perform t_check(r->>'reason' = 'invalid_option', 'invalid option rejected');
  r := submit_answer(t_get('sid')::uuid, 0, 1);
  perform t_check((r->>'ok')::boolean and not (r ? 'is_correct'), 'Lina answer accepted, correctness hidden');
  r := submit_answer(t_get('sid')::uuid, 0, 0);
  perform t_check(r->>'reason' = 'already_answered', 'Lina cannot change/duplicate her answer');
  st := get_my_status(t_get('sid')::uuid);
  perform t_check((st->>'answered')::boolean and st->'is_correct' = 'null'::jsonb and (st->>'score')::int = 0, 'status before reveal: answered, no correctness, score 0');

  perform t_as('b0000000-0000-0000-0000-000000000002', true);
  r := submit_answer(t_get('sid')::uuid, 0, 2);
  perform t_as('b0000000-0000-0000-0000-000000000003', true);
  r := submit_answer(t_get('sid')::uuid, 0, 1);
  perform t_as('b0000000-0000-0000-0000-000000000004', true);
  r := submit_answer(t_get('sid')::uuid, 0, 1);
  perform t_check(r->>'reason' = 'not_in_game', 'outsider cannot answer');
end $$;

-- 6. Teacher sees real answers, then reveals ---------------------------------
do $$ declare s game_sessions; begin
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  perform t_check((select count(*) from answers where session_id = t_get('sid')::uuid and question_index = 0) = 3, 'teacher sees 3 real answers');
  perform t_check((select count(*) from answers where question_index = 0 and is_correct) = 2, 'teacher sees 2 correct, 1 incorrect');
  perform t_check((select sum(score) from participants) = 0, 'scores not added before reveal');
  s := host_control(t_get('sid')::uuid, 'close');
  perform t_check(s.status = 'closed', 'Close answers');
end $$;
do $$ declare r jsonb; begin
  perform t_as('b0000000-0000-0000-0000-000000000002', true);
  r := submit_answer(t_get('sid')::uuid, 0, 1);
  perform t_check(r->>'reason' = 'answers_closed', 'no answers accepted after Close');
end $$;
do $$ declare s game_sessions; begin
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  s := host_control(t_get('sid')::uuid, 'reveal');
  perform t_check(s.status = 'revealed' and s.reveal->'correct' = '[1]'::jsonb, 'Reveal shows option B as correct');
  perform t_check((select score from participants where nickname = 'Lina') = 1000 and (select score from participants where nickname = 'Omar') = 0, 'paced mode: correct = 1000 pts, wrong = 0');
  s := host_control(t_get('sid')::uuid, 'reveal');
  perform t_check((select score from participants where nickname = 'Lina') = 1000, 'pressing Reveal twice does not double-score');
  s := host_control(t_get('sid')::uuid, 'results');
  perform t_check((s.results->>'answered')::int = 3 and (s.results->>'correct')::int = 2 and s.results->'counts' = '[0,2,1]'::jsonb, 'Results: 3 answered, 2 correct, distribution [0,2,1]');
end $$;
do $$ declare st jsonb; begin
  perform t_as('b0000000-0000-0000-0000-000000000002', true);
  st := get_my_status(t_get('sid')::uuid);
  perform t_check((st->>'is_correct')::boolean = false and (st->>'points')::int = 0 and (st->>'rank')::int = 3, 'Omar sees he was wrong, rank 3');
  perform t_as('b0000000-0000-0000-0000-000000000001', true);
  st := get_my_status(t_get('sid')::uuid);
  perform t_check((st->>'is_correct')::boolean and (st->>'score')::int = 1000 and (st->>'rank')::int = 1, 'Lina sees +1000, rank 1 (tied)');
end $$;

-- 7. Q2 .. Q5 ---------------------------------------------------------------------
do $$ declare s game_sessions; begin
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  s := host_control(t_get('sid')::uuid, 'next');
  perform t_check(s.current_index = 1 and s.reveal is null and s.results is null, 'Q2 released, previous reveal/results cleared');
  -- pause / resume
  s := host_control(t_get('sid')::uuid, 'pause');
  perform t_check(s.paused, 'Pause');
end $$;
do $$ declare r jsonb; begin
  perform t_as('b0000000-0000-0000-0000-000000000003', true);
  r := submit_answer(t_get('sid')::uuid, 1, 2);
  perform t_check(r->>'reason' = 'paused', 'no answers while paused');
end $$;
do $$ declare s game_sessions; r jsonb; begin
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  s := host_control(t_get('sid')::uuid, 'resume');
  perform t_check(not s.paused, 'Resume');
  perform t_as('b0000000-0000-0000-0000-000000000001', true); r := submit_answer(t_get('sid')::uuid, 1, 2);  -- right
  perform t_as('b0000000-0000-0000-0000-000000000002', true); r := submit_answer(t_get('sid')::uuid, 1, 2);  -- right
  perform t_as('b0000000-0000-0000-0000-000000000003', true); r := submit_answer(t_get('sid')::uuid, 1, 0);  -- wrong
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  s := host_control(t_get('sid')::uuid, 'reveal');
  s := host_control(t_get('sid')::uuid, 'leaderboard');
  perform t_check(s.leaderboard->0->>'nickname' = 'Lina' and (s.leaderboard->0->>'score')::int = 2000, 'Leaderboard: Lina leads with 2000');
  -- Q3 (true/false), skip reveal: Next should still score it
  s := host_control(t_get('sid')::uuid, 'next');
  perform t_as('b0000000-0000-0000-0000-000000000003', true); r := submit_answer(t_get('sid')::uuid, 2, 1);  -- right
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  s := host_control(t_get('sid')::uuid, 'next');   -- Q4 (2000 pts)
  perform t_check((select score from participants where nickname = 'Sara') = 2000, 'skipping Reveal still scores the question once');
  perform t_as('b0000000-0000-0000-0000-000000000002', true); r := submit_answer(t_get('sid')::uuid, 3, 0);  -- right, 2000
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  s := host_control(t_get('sid')::uuid, 'results');
  s := host_control(t_get('sid')::uuid, 'next');   -- Q5
  perform t_as('b0000000-0000-0000-0000-000000000002', true); r := submit_answer(t_get('sid')::uuid, 4, 2);  -- right
  perform t_as('b0000000-0000-0000-0000-000000000001', true); r := submit_answer(t_get('sid')::uuid, 4, 3);  -- wrong
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  perform t_expect_error(format('select host_control(%L, %L)', t_get('sid'), 'next'), 'no_more_questions', 'cannot go past the last question');
  s := host_control(t_get('sid')::uuid, 'end');
  perform t_check(s.status = 'ended' and s.reveal->'correct' = '[2]'::jsonb, 'End game (final question scored and revealed)');
  perform t_check(s.leaderboard->0->>'nickname' = 'Omar' and (s.leaderboard->0->>'score')::int = 4000, 'Final winner: Omar with 4000');
  perform t_check((select string_agg(nickname || '=' || score, ',' order by score desc, nickname) from participants) = 'Omar=4000,Lina=2000,Sara=2000', 'Final scores Omar 4000, Lina 2000, Sara 2000');
  perform t_expect_error(format('select host_control(%L, %L)', t_get('sid'), 'next'), 'game_ended', 'ended game cannot continue');
end $$;
do $$ declare st jsonb; begin
  perform t_as('b0000000-0000-0000-0000-000000000001', true);
  perform t_expect_error(format('select join_game(%L, %L)', t_get('pin'), 'Late'), 'game_not_found', 'cannot join an ended game');
  st := get_my_status(t_get('sid')::uuid);
  perform t_check((st->>'rank')::int = 2 and (st->>'score')::int = 2000, 'Lina final: 2000 pts, rank 2 (tied)');
end $$;

-- 8. Restart, remove/block, lock, timed mode ---------------------------------
do $$ declare s game_sessions; r jsonb; begin
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  s := restart_game(t_get('sid')::uuid);
  perform t_check(s.status = 'lobby' and s.id <> t_get('sid')::uuid, 'Restart creates a new lobby');
  perform t_check((select next_pin from game_sessions where id = t_get('sid')::uuid) = s.pin, 'old game points students to the new PIN');
  perform t_put('sid2', s.id::text); perform t_put('pin2', s.pin);
  -- timed game for timing / deadline checks
  s := host_game(t_get('quiz')::uuid, 'timed');
  perform t_put('sid3', s.id::text); perform t_put('pin3', s.pin);
end $$;
do $$ declare r jsonb; begin
  perform t_as('b0000000-0000-0000-0000-000000000001', true);
  r := join_game(t_get('pin2'), 'B0ad name'); perform t_put('bad', r->>'participant_id');
end $$;
do $$ begin
  perform t_as('b0000000-0000-0000-0000-000000000002', true);
  perform t_expect_error(format('select remove_participant(%L)', t_get('bad')), 'not_authorized', 'student cannot remove other students');
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  perform remove_participant(t_get('bad')::uuid, false);
end $$;
do $$ declare r jsonb; st jsonb; begin
  perform t_as('b0000000-0000-0000-0000-000000000001', true);
  st := get_my_status(t_get('sid2')::uuid);
  perform t_check(st->>'status' = 'removed', 'removed student sees they were removed');
  r := join_game(t_get('pin2'), 'Lina');
  perform t_check(r->>'nickname' = 'Lina', 'removed student can rejoin with an appropriate name');
end $$;
do $$ begin
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  perform remove_participant(t_get('bad')::uuid, true);
  perform host_control(t_get('sid2')::uuid, 'lock');
end $$;
do $$ begin
  perform t_as('b0000000-0000-0000-0000-000000000001', true);
  perform t_expect_error(format('select join_game(%L, %L)', t_get('pin2'), 'Lina2'), 'blocked', 'blocked student cannot rejoin');
  perform t_as('b0000000-0000-0000-0000-000000000003', true);
  perform t_expect_error(format('select join_game(%L, %L)', t_get('pin2'), 'Sara'), 'game_locked', 'locked game rejects new players');
end $$;

do $$ declare s game_sessions; r jsonb; p int; begin
  perform t_as('b0000000-0000-0000-0000-000000000002', true); r := join_game(t_get('pin3'), 'Omar');
  perform t_as('b0000000-0000-0000-0000-000000000003', true); r := join_game(t_get('pin3'), 'Sara');
  perform t_as('a0000000-0000-0000-0000-000000000001', false);
  s := host_control(t_get('sid3')::uuid, 'start'); s := host_control(t_get('sid3')::uuid, 'next');
  perform t_check(s.question_deadline is not null and s.question_deadline > s.question_started_at, 'timed mode sets a server deadline');
  perform pg_sleep(0.3);
  perform t_as('b0000000-0000-0000-0000-000000000002', true); r := submit_answer(t_get('sid3')::uuid, 0, 1);
  perform t_admin();
  p := (select points from answers where session_id = t_get('sid3')::uuid);
  perform t_check(p between 980 and 999, 'timed mode: fast correct answer earns speed points (' || p || ')');
  update game_sessions set question_deadline = clock_timestamp() - interval '3 seconds' where id = t_get('sid3')::uuid;
  perform t_as('b0000000-0000-0000-0000-000000000003', true); r := submit_answer(t_get('sid3')::uuid, 0, 1);
  perform t_check(r->>'reason' = 'time_up', 'late answer after the deadline is rejected by the server');
end $$;

do $$ begin
  perform t_as('a0000000-0000-0000-0000-000000000002', false);
  perform t_expect_error(format('select restart_game(%L)', t_get('sid')), 'not_authorized', 'another teacher cannot restart my game');
  perform t_check((select count(*) from game_sessions) = 0, 'another teacher sees none of my reports');
  perform t_admin();
  raise notice '=== ALL GAME ENGINE TESTS PASSED ===';
end $$;
