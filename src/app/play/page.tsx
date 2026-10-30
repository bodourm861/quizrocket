'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import confetti from 'canvas-confetti';
import { LoaderCircle, Pause, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { ConfigNotice, Logo } from '@/components/brand';
import { AnswerTile, LeaderboardList, Podium, ResultBars, TimerRing, type TileState } from '@/components/game';
import { Button, ErrorBox } from '@/components/ui';
import { studentDb, supabaseConfigured } from '@/lib/supabase';
import { newer, useGameChannel } from '@/lib/realtime';
import type { GameSession, MyStatus, Participant } from '@/lib/types';
import { AVATARS, friendly, nicknameProblem, secondsLeft, useNow, useServerClock } from '@/lib/util';
import { isMuted, play, setMuted } from '@/lib/sound';

const store = {
  get(pin: string): { nickname: string; avatar: string } | null {
    try { return JSON.parse(localStorage.getItem(`qr-player:${pin}`) || 'null'); } catch { return null; }
  },
  set(pin: string, v: { nickname: string; avatar: string }) { try { localStorage.setItem(`qr-player:${pin}`, JSON.stringify(v)); } catch { /* ignore */ } },
  clear(pin: string) { try { localStorage.removeItem(`qr-player:${pin}`); } catch { /* ignore */ } },
  lastName(): { nickname: string; avatar: string } | null {
    try { return JSON.parse(localStorage.getItem('qr-player:last') || 'null'); } catch { return null; }
  },
  setLast(v: { nickname: string; avatar: string }) { try { localStorage.setItem('qr-player:last', JSON.stringify(v)); } catch { /* ignore */ } },
};

export default function PlayPage() {
  if (!supabaseConfigured) return <div className="game-bg min-h-dvh p-4"><ConfigNotice /></div>;
  return (
    <Suspense fallback={<Shell><Centered><LoaderCircle className="size-10 animate-spin" /></Centered></Shell>}>
      <Player />
    </Suspense>
  );
}

interface Joined { sessionId: string; participantId: string; nickname: string; avatar: string }

function Player() {
  const router = useRouter();
  const pinParam = (useSearchParams().get('pin') ?? '').replace(/\D/g, '').slice(0, 6);
  const db = studentDb();
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [autoJoining, setAutoJoining] = useState(false);

  // 1. Invisible anonymous sign-in (no account needed), then try to rejoin automatically.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await db.auth.getSession();
      if (!data.session) {
        const { error } = await db.auth.signInAnonymously();
        if (error) { if (alive) setAuthError(friendly(error)); return; }
      }
      if (!alive) return;
      setReady(true);
      const saved = pinParam ? store.get(pinParam) : null;
      if (saved) {
        setAutoJoining(true);
        const { data: r, error } = await db.rpc('join_game', { p_pin: pinParam, p_nickname: saved.nickname, p_avatar: saved.avatar });
        if (alive && !error && r) setJoined({ sessionId: r.session_id, participantId: r.participant_id, nickname: r.nickname, avatar: r.avatar });
        if (alive) setAutoJoining(false);
      }
    })();
    return () => { alive = false; };
  }, [db, pinParam]);

  if (authError) return <Shell><Centered><div className="card max-w-sm p-6 text-ink"><ErrorBox>{authError}</ErrorBox></div></Centered></Shell>;
  if (!ready || autoJoining) return <Shell><Centered><LoaderCircle className="size-10 animate-spin" /><p className="mt-3 font-bold">Connecting…</p></Centered></Shell>;
  if (!joined) {
    return (
      <JoinForm initialPin={pinParam} onJoined={(j, pin) => {
        store.set(pin, { nickname: j.nickname, avatar: j.avatar }); store.setLast({ nickname: j.nickname, avatar: j.avatar });
        if (pin !== pinParam) router.replace(`/play/?pin=${pin}`);
        setJoined(j);
      }} />
    );
  }
  return <Game key={joined.sessionId} joined={joined} pin={pinParam}
    onLeft={async () => {
      // A different student on this device: forget this identity and start fresh.
      store.clear(pinParam);
      await db.auth.signOut();
      window.location.reload();
    }}
    onNextGame={(pin) => {
      store.set(pin, { nickname: joined.nickname, avatar: joined.avatar });
      window.location.href = `/play/?pin=${pin}`;
    }} />;
}

// ---------------------------------------------------------------------------------------
function JoinForm({ initialPin, onJoined, notice }: { initialPin: string; onJoined: (j: Joined, pin: string) => void; notice?: string }) {
  const db = studentDb();
  const last = typeof window !== 'undefined' ? store.lastName() : null;
  const [pin, setPin] = useState(initialPin);
  const [nickname, setNickname] = useState(last?.nickname ?? '');
  const [avatar, setAvatar] = useState(last?.avatar ?? AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = pin.length === 6 ? 'name' : 'pin';

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const problem = nicknameProblem(nickname);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    const { data, error } = await db.rpc('join_game', { p_pin: pin, p_nickname: nickname.trim(), p_avatar: avatar });
    setBusy(false);
    if (error) {
      setError(friendly(error));
      if (error.message.includes('game_not_found')) setPin('');
      return;
    }
    play('join');
    onJoined({ sessionId: data.session_id, participantId: data.participant_id, nickname: data.nickname, avatar: data.avatar }, pin);
  }

  return (
    <Shell>
      <Centered>
        <div className="mb-6"><Logo light /></div>
        <form onSubmit={join} className="card w-full max-w-md p-6 text-ink animate-rise">
          {notice && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{notice}</p>}
          {step === 'pin' ? (
            <>
              <h1 className="text-center text-3xl font-extrabold">Enter Game PIN</h1>
              <input aria-label="Game PIN" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123 456" className="mt-4 w-full rounded-2xl border-4 border-brand-100 py-4 text-center font-display text-4xl font-extrabold tracking-[0.25em] focus:border-brand-500 focus:outline-none" />
              <p className="mt-3 text-center text-sm font-semibold text-ink-soft">Your teacher shows the PIN on their screen.</p>
            </>
          ) : (
            <>
              <p className="text-center text-sm font-extrabold text-ink-soft">Game PIN {pin} ✓ <button type="button" className="ml-1 text-brand-600 underline" onClick={() => setPin('')}>change</button></p>
              <h1 className="mt-1 text-center text-3xl font-extrabold">What’s your name?</h1>
              <input aria-label="Your nickname" autoFocus maxLength={20} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Your first name"
                className="mt-4 w-full rounded-2xl border-4 border-brand-100 px-4 py-3 text-center font-display text-3xl font-extrabold focus:border-brand-500 focus:outline-none" />
              <p className="mt-4 text-center text-sm font-extrabold">Pick your buddy</p>
              <div className="mt-2 grid grid-cols-5 gap-2" role="radiogroup" aria-label="Choose an avatar">
                {AVATARS.map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={avatar === a} onClick={() => setAvatar(a)}
                    className={`grid aspect-square place-items-center rounded-xl text-3xl transition ${avatar === a ? 'scale-110 bg-brand-100 ring-4 ring-brand-500' : 'bg-brand-50 hover:bg-brand-100'}`}>
                    {a}
                  </button>
                ))}
              </div>
              <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>
              <Button type="submit" variant="rocket" size="lg" className="mt-4 w-full text-xl" loading={busy}>Let’s go! 🚀</Button>
            </>
          )}
          {step === 'pin' && error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
        </form>
      </Centered>
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------
function Game({ joined, pin, onLeft, onNextGame }: { joined: Joined; pin: string; onLeft: () => void | Promise<void>; onNextGame: (pin: string) => void }) {
  const db = studentDb();
  const [session, setSession] = useState<GameSession | null>(null);
  const [me, setMe] = useState<MyStatus | null>(null);
  const [picked, setPicked] = useState<{ index: number; option: number } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [muted, setMutedState] = useState(false);
  const offset = useServerClock(db);
  const lastFeedback = useRef<number>(-2);
  const sessionRef = useRef<GameSession | null>(null);
  sessionRef.current = session;

  useEffect(() => setMutedState(isMuted()), []);

  const refreshMe = useCallback(async () => {
    const { data } = await db.rpc('get_my_status', { p_session: joined.sessionId });
    if (data) setMe(data as MyStatus);
  }, [db, joined.sessionId]);

  const resync = useCallback(async () => {
    const { data } = await db.from('game_sessions').select('*').eq('id', joined.sessionId).maybeSingle();
    if (data) setSession((prev) => newer(prev, data as GameSession));
    refreshMe();
  }, [db, joined.sessionId, refreshMe]);

  const link = useGameChannel(db, joined.sessionId, { presenceKey: joined.participantId, role: 'player', participantId: joined.participantId }, {
    onResync: resync,
    onSession: (row) => {
      const prev = sessionRef.current;
      setSession((p) => newer(p, row));
      if (!prev || prev.version !== row.version) refreshMe();
    },
    onParticipant: (row: Participant) => setMe((m) => (m ? { ...m, status: row.status, score: row.score, streak: row.streak, nickname: row.nickname } : m)),
  });

  // Reset the local selection whenever a new question appears
  const qIndex = session?.current_index ?? -1;
  useEffect(() => { setPicked(null); setSubmitError(null); }, [qIndex]);

  // Keep the local selection in sync with the server (e.g. after a refresh)
  useEffect(() => {
    if (me?.answered && me.question_index === qIndex && me.my_option != null && !picked) setPicked({ index: qIndex, option: me.my_option });
  }, [me, qIndex, picked]);

  // Sounds + confetti when the teacher reveals
  useEffect(() => {
    if (!session || !me) return;
    const revealed = ['revealed', 'results', 'leaderboard'].includes(session.status) && session.reveal?.index === session.current_index;
    if (revealed && lastFeedback.current !== session.current_index && me.question_index === session.current_index) {
      lastFeedback.current = session.current_index;
      if (me.is_correct) { play('correct'); confetti({ particleCount: 70, spread: 70, origin: { y: 0.7 } }); }
      else play('wrong');
    }
    if (session.status === 'ended' && lastFeedback.current !== 999) {
      lastFeedback.current = 999;
      play('fanfare');
      if ((me.rank ?? 99) <= 3) confetti({ particleCount: 180, spread: 100, origin: { y: 0.6 } });
    }
  }, [session, me]);

  const now = useNow(200, session?.status === 'question' && !session.paused);
  const left = session?.status === 'question'
    ? session.paused ? (session.paused_remaining_ms != null ? session.paused_remaining_ms / 1000 : null) : secondsLeft(session.question_deadline, offset, now)
    : null;

  async function answer(option: number) {
    if (!session || picked || sending) return;
    const index = session.current_index;
    setPicked({ index, option });
    setSubmitError(null);
    setSending(true);
    play('tap');
    if (navigator.vibrate) navigator.vibrate(30);
    // Retries are safe: the server accepts only one answer per question.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await db.rpc('submit_answer', { p_session: session.id, p_question_index: index, p_option_index: option });
      if (!error) {
        const r = data as { ok: boolean; reason?: string };
        if (!r.ok && r.reason !== 'already_answered') { setPicked(null); setSubmitError(friendly(r.reason ?? 'answers_closed')); }
        setSending(false);
        refreshMe();
        return;
      }
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
    }
    setSending(false);
    setPicked(null);
    setSubmitError('Could not send your answer — check your connection and tap again.');
  }

  // Keyboard: 1–4 to answer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      const opts = session?.current_question?.options.length ?? 0;
      if (session?.status === 'question' && !session.paused && n >= 1 && n <= opts) answer(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Removed / blocked by the teacher
  if (me?.status === 'removed') {
    return <JoinForm initialPin={pin} notice="Your teacher asked you to choose a different nickname. Pick a new one to rejoin!"
      onJoined={(j) => { store.set(pin, { nickname: j.nickname, avatar: j.avatar }); store.setLast({ nickname: j.nickname, avatar: j.avatar }); window.location.reload(); }} />;
  }
  if (me?.status === 'blocked') {
    return <Shell><Centered><div className="text-6xl">🚪</div><h1 className="mt-3 text-3xl font-extrabold">You’ve been removed from this game</h1><p className="mt-2 font-semibold text-white/80">Talk to your teacher if you think this is a mistake.</p></Centered></Shell>;
  }
  if (!session) return <Shell><Centered><LoaderCircle className="size-10 animate-spin" /></Centered></Shell>;

  const q = session.current_question;
  const score = me?.score ?? 0;
  const myPicked = picked && picked.index === session.current_index ? picked.option : null;
  const answered = myPicked !== null || (me?.answered && me.question_index === session.current_index);
  const revealedNow = session.reveal && session.reveal.index === session.current_index;

  return (
    <Shell>
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 pt-3 sm:px-5">
        <span className="flex min-w-0 items-center gap-2 rounded-2xl bg-white/15 py-1.5 pl-2 pr-3 font-extrabold">
          <span className="text-2xl" aria-hidden>{me?.avatar ?? joined.avatar}</span>
          <span className="truncate">{me?.nickname ?? joined.nickname}</span>
        </span>
        {link !== 'live' && <span className="inline-flex items-center gap-1 rounded-xl bg-amber-400 px-2 py-1 text-sm font-extrabold text-ink" role="status"><WifiOff className="size-4" /> Reconnecting…</span>}
        <span className="ml-auto rounded-2xl bg-white px-3 py-1.5 font-display text-xl font-extrabold tabular-nums text-ink" aria-label={`Your score ${score}`}>{score.toLocaleString()}</span>
        <button className="rounded-lg p-2 hover:bg-white/10" onClick={() => { setMuted(!muted); setMutedState(!muted); }} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
      </div>

      <div className="flex flex-1 flex-col px-3 py-4 sm:px-5">
        {session.status === 'lobby' && (
          <Centered>
            <div className="text-8xl animate-float" aria-hidden>{me?.avatar ?? joined.avatar}</div>
            <h1 className="mt-4 text-4xl font-extrabold">You’re in, {me?.nickname ?? joined.nickname}!</h1>
            <p className="mt-2 text-lg font-bold text-white/85">See your name on your teacher’s screen?</p>
            <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 font-extrabold"><LoaderCircle className="size-4 animate-spin" /> Waiting for your teacher to start…</p>
          </Centered>
        )}

        {session.status === 'ready' && (
          <Centered>
            <div className="text-7xl animate-wiggle" aria-hidden>🚀</div>
            <h1 className="mt-4 text-4xl font-extrabold">Get ready!</h1>
            <p className="mt-2 text-lg font-bold text-white/85">The first question is coming…</p>
          </Centered>
        )}

        {q && session.status === 'question' && !answered && (
          <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col animate-rise">
            <div className="flex items-start gap-3 rounded-3xl bg-white p-4 text-ink shadow-xl sm:p-6">
              <div className="flex-1">
                <p className="text-sm font-extrabold text-ink-soft">Question {q.index + 1} of {q.total}</p>
                <h1 className="mt-1 text-2xl font-extrabold leading-snug sm:text-3xl">{q.prompt}</h1>
              </div>
              {left !== null && <TimerRing seconds={left} total={q.time_limit} paused={session.paused} size={72} />}
            </div>
            {q.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={q.image_url} alt="" className="mx-auto mt-3 max-h-48 rounded-2xl bg-white object-contain p-1.5 shadow-lg sm:max-h-64" />
            )}
            <div className={`mt-4 grid flex-1 gap-3 ${q.options.length > 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2'} content-start`}>
              {q.options.map((o, i) => (
                <AnswerTile key={i} type={q.type} index={i} text={o.text} imageUrl={o.image_url} size="xl"
                  onClick={() => answer(i)} disabled={session.paused || (left !== null && left <= 0)} />
              ))}
            </div>
            {submitError && <p className="mt-3 rounded-xl bg-white p-3 text-center font-extrabold text-ans-a" role="alert">{submitError}</p>}
          </div>
        )}

        {q && session.status === 'question' && answered && (
          <Centered>
            <div className="w-full max-w-sm">
              {myPicked !== null && <AnswerTile type={q.type} index={myPicked} text={q.options[myPicked]?.text ?? ''} state="selected" size="lg" />}
            </div>
            <h1 className="mt-6 text-3xl font-extrabold">{sending ? 'Sending…' : 'Answer locked in! 🔒'}</h1>
            <p className="mt-2 font-bold text-white/85">Waiting for your teacher to reveal the answer…</p>
          </Centered>
        )}

        {q && session.status === 'closed' && (
          <Centered>
            <div className="text-7xl" aria-hidden>{answered ? '🔒' : '⏰'}</div>
            <h1 className="mt-3 text-3xl font-extrabold">{answered ? 'Answer locked in!' : 'Time’s up!'}</h1>
            <p className="mt-2 font-bold text-white/85">{answered ? 'Your teacher will reveal the answer soon.' : 'No answer this time — get ready for the next one!'}</p>
          </Centered>
        )}

        {q && revealedNow && (session.status === 'revealed' || session.status === 'results') && (
          <Feedback session={session} me={me} myPick={myPicked ?? me?.my_option ?? null} />
        )}

        {session.status === 'leaderboard' && (
          <div className="mx-auto w-full max-w-xl animate-rise">
            <h1 className="mb-1 text-center text-4xl font-extrabold">🏆 Leaderboard</h1>
            {me?.rank && <p className="mb-4 text-center text-lg font-extrabold text-white/90">You’re #{me.rank} of {me.players}</p>}
            <LeaderboardList entries={session.leaderboard ?? []} highlightId={joined.participantId} limit={5} dark />
          </div>
        )}

        {session.status === 'ended' && (
          <div className="mx-auto w-full max-w-2xl text-center animate-rise">
            <h1 className="text-4xl font-extrabold">Game over! 🎉</h1>
            <div className="mx-auto mt-4 w-fit rounded-3xl bg-white px-8 py-5 text-ink shadow-xl">
              <p className="font-extrabold text-ink-soft">Your final score</p>
              <p className="font-display text-6xl font-extrabold tabular-nums">{score.toLocaleString()}</p>
              <p className="text-lg font-extrabold">{me?.rank ? `#${me.rank} of ${me.players}` : ''} · {me?.correct_count ?? 0} correct</p>
            </div>
            <div className="mt-8"><Podium entries={session.leaderboard ?? []} /></div>
            <p className="mt-6 text-lg font-bold text-white/90">
              {(me?.rank ?? 99) <= 3 ? 'Amazing work — you made the podium! 🌟' : 'Great effort! Every question makes your brain stronger 💪'}
            </p>
            {session.next_pin ? (
              <Button variant="rocket" size="lg" className="mt-6 text-xl" onClick={() => onNextGame(session.next_pin!)}>Join the next game 🚀</Button>
            ) : (
              <p className="mt-6 text-sm font-semibold text-white/70">If your teacher starts another round, a “Join the next game” button will appear here.</p>
            )}
          </div>
        )}
      </div>

      {session.paused && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-brand-900/80 p-6 text-center backdrop-blur-sm" role="alertdialog" aria-label="Game paused">
          <div>
            <span className="mx-auto grid size-24 place-items-center rounded-full bg-white text-brand-700"><Pause className="size-12" fill="currentColor" /></span>
            <h2 className="mt-4 text-4xl font-extrabold">Paused</h2>
            <p className="mt-1 font-bold text-white/85">Your teacher paused the game. Hang tight!</p>
          </div>
        </div>
      )}
      <button onClick={() => { if (confirm('Leave this game on this device?')) void onLeft(); }} className="mx-auto mb-3 text-xs font-bold text-white/50 hover:text-white/80">Not you? Leave this game</button>
    </Shell>
  );
}

function Feedback({ session, me, myPick }: { session: GameSession; me: MyStatus | null; myPick: number | null }) {
  const q = session.current_question!;
  const correct = session.reveal?.correct ?? [];
  const synced = me?.question_index === session.current_index;
  const isCorrect = synced ? me?.is_correct === true : myPick !== null && correct.includes(myPick);
  const noAnswer = myPick === null && !(synced && me?.answered);
  const tileState = (i: number): TileState => (correct.includes(i) ? 'correct' : i === myPick ? 'incorrect' : 'dim');
  return (
    <div className="mx-auto w-full max-w-3xl text-center animate-rise">
      <div className={`mx-auto w-fit rounded-3xl px-8 py-5 shadow-2xl animate-pop ${isCorrect ? 'bg-emerald-500' : noAnswer ? 'bg-slate-500' : 'bg-ans-a'}`}>
        <div className="text-6xl" aria-hidden>{isCorrect ? '🎉' : noAnswer ? '⏰' : '💪'}</div>
        <h1 className="mt-1 text-4xl font-extrabold">{isCorrect ? 'Correct!' : noAnswer ? 'No answer' : 'Not this time'}</h1>
        {isCorrect && synced && <p className="mt-1 font-display text-3xl font-extrabold">+{(me?.points ?? 0).toLocaleString()}</p>}
        {isCorrect && (me?.streak ?? 0) >= 2 && <p className="mt-1 font-extrabold">🔥 {me?.streak} in a row!</p>}
        {!isCorrect && <p className="mt-1 font-bold">{noAnswer ? 'Be quick next time!' : 'You’ll get the next one!'}</p>}
      </div>
      {me?.rank && <p className="mt-4 text-lg font-extrabold">You’re #{me.rank} of {me.players}</p>}
      <div className="mt-5 grid gap-2.5 text-left sm:grid-cols-2">
        {q.options.map((o, i) => <AnswerTile key={i} type={q.type} index={i} text={o.text} imageUrl={o.image_url} size="md" state={tileState(i)} />)}
      </div>
      {session.status === 'results' && session.results && (
        <div className="mt-6 rounded-3xl bg-white/10 p-4 ring-1 ring-white/20">
          <p className="mb-2 font-extrabold">How the class answered</p>
          <ResultBars type={q.type} options={q.options} counts={session.results.counts} correct={correct} compact />
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="game-bg flex min-h-dvh flex-col text-white">
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">{children}</div>;
}

