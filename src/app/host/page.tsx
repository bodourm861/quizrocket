'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import {
  ChartColumn, Ban, CircleCheck, ChevronRight, Copy, Eye, EyeOff, Flag, Lock, LogOut, MessageSquareShare, Pause, Play,
  RotateCcw, Square, Trophy, LockOpen, UserX, Users, Volume2, VolumeX, Wifi, WifiOff, X,
} from 'lucide-react';
import { useTeacher } from '@/components/TeacherShell';
import { ConfigNotice } from '@/components/brand';
import { AnswerTile, LeaderboardList, Podium, ResultBars, TimerRing, type TileState } from '@/components/game';
import { Button, ErrorBox, Modal, Spinner, Toast } from '@/components/ui';
import { supabaseConfigured, teacherDb } from '@/lib/supabase';
import { newer, useGameChannel } from '@/lib/realtime';
import { buildReport } from '@/lib/report';
import type { Answer, GameSession, Participant, SessionQuestion } from '@/lib/types';
import { copyText, fmtSeconds, formatPin, friendly, joinUrl, pct, secondsLeft, useNow, useServerClock } from '@/lib/util';
import { isMuted, play, setMuted } from '@/lib/sound';

type Action = 'start' | 'next' | 'close' | 'reveal' | 'results' | 'leaderboard' | 'pause' | 'resume' | 'end' | 'lock' | 'unlock';

export default function HostPage() {
  if (!supabaseConfigured) return <ConfigNotice />;
  return <Suspense fallback={<div className="game-bg min-h-dvh"><Spinner light /></div>}><HostLoader /></Suspense>;
}

function HostLoader() {
  const user = useTeacher();
  const sessionId = useSearchParams().get('session');
  if (!user) return <div className="game-bg min-h-dvh"><Spinner light label="Signing in…" /></div>;
  if (!sessionId) return <div className="p-10"><ErrorBox>No game selected. Go back to the dashboard and click “Host live game”.</ErrorBox></div>;
  return <Host sessionId={sessionId} />;
}

function Host({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const db = teacherDb();
  const [session, setSession] = useState<GameSession | null>(null);
  const [questions, setQuestions] = useState<SessionQuestion[]>([]);
  const [players, setPlayers] = useState<Participant[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | 'restart' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showLive, setShowLive] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [kick, setKick] = useState<Participant | null>(null);
  const offset = useServerClock(db);
  const autoClosedFor = useRef<number>(-1);

  useEffect(() => setMutedState(isMuted()), []);

  const resync = useCallback(async () => {
    const [s, q, p, a] = await Promise.all([
      db.from('game_sessions').select('*').eq('id', sessionId).single(),
      db.from('session_questions').select('*').eq('session_id', sessionId).order('idx'),
      db.from('participants').select('*').eq('session_id', sessionId).order('joined_at'),
      db.from('answers').select('*').eq('session_id', sessionId),
    ]);
    if (s.error) { setLoadError(friendly(s.error)); return; }
    setSession((prev) => newer(prev, s.data as GameSession));
    if (!q.error) setQuestions(q.data as SessionQuestion[]);
    if (!p.error) setPlayers(p.data as Participant[]);
    if (!a.error) setAnswers(a.data as Answer[]);
  }, [db, sessionId]);

  const link = useGameChannel(db, sessionId, { presenceKey: 'host', role: 'host' }, {
    onResync: resync,
    onSession: (row) => setSession((prev) => newer(prev, row)),
    onParticipant: (row) => setPlayers((prev) => {
      const i = prev.findIndex((x) => x.id === row.id);
      if (i < 0) { if (row.status === 'active') play('join'); return [...prev, row]; }
      const copy = [...prev]; copy[i] = row; return copy;
    }),
    onAnswer: (row) => setAnswers((prev) => (prev.some((x) => x.id === row.id) ? prev : [...prev, row])),
    onPresence: (keys) => setOnline(new Set(keys)),
  });

  const active = useMemo(() => players.filter((p) => p.status === 'active'), [players]);
  const q = session && session.current_index >= 0 ? questions.find((x) => x.idx === session.current_index) : undefined;
  const qAnswers = useMemo(() => {
    if (!session) return [];
    const ids = new Set(active.map((p) => p.id));
    return answers.filter((a) => a.question_index === session.current_index && ids.has(a.participant_id));
  }, [answers, session, active]);
  const counts = q ? q.options.map((_, i) => qAnswers.filter((a) => a.option_index === i).length) : [];
  const correctIdx = q ? q.options.map((o, i) => (o.is_correct ? i : -1)).filter((i) => i >= 0) : [];
  const answeredIds = new Set(qAnswers.map((a) => a.participant_id));

  const live = session?.status === 'question' && !session.paused;
  const now = useNow(200, !!live);
  const left = session?.status === 'question'
    ? session.paused ? (session.paused_remaining_ms != null ? session.paused_remaining_ms / 1000 : null) : secondsLeft(session.question_deadline, offset, now)
    : null;

  const control = useCallback(async (action: Action) => {
    setBusy(action);
    const { data, error } = await db.rpc('host_control', { p_session: sessionId, p_action: action });
    setBusy(null);
    if (error) { setToast(friendly(error)); return; }
    setSession((prev) => newer(prev, data as GameSession));
    if (action === 'next' || action === 'start') play('start');
    if (action === 'end') { play('fanfare'); setTimeout(() => confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 } }), 900); }
    if (['reveal', 'results', 'leaderboard', 'end'].includes(action)) resync();
  }, [db, sessionId, resync]);

  // Timed mode: close answers automatically when the countdown ends or everybody has answered.
  useEffect(() => {
    if (!session || session.mode !== 'timed' || session.status !== 'question' || session.paused) return;
    if (autoClosedFor.current === session.current_index) return;
    const everyone = active.length > 0 && active.every((p) => answeredIds.has(p.id));
    if ((left !== null && left <= 0) || everyone) {
      autoClosedFor.current = session.current_index;
      void control('close');
    }
  });

  useEffect(() => { if (session?.status === 'question') setShowKey(false); }, [session?.current_index, session?.status]);

  // Keyboard shortcuts for quick control during a lesson
  const can = useMemo(() => abilities(session), [session]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey || busy) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && can.next) control('next');
      else if (k === 's' && can.start) control('start');
      else if (k === 'c' && can.close) control('close');
      else if (k === 'r' && can.reveal) control('reveal');
      else if (k === 'v' && can.results) control('results');
      else if (k === 'l' && can.leaderboard) control('leaderboard');
      else if (k === 'p' && (can.pause || can.resume)) control(session?.paused ? 'resume' : 'pause');
      else if (k === 'k') setShowKey((x) => !x);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [can, control, busy, session?.paused]);

  async function restart() {
    if (session?.status !== 'ended' && !confirm('End this game and start a new one with the same quiz?')) return;
    setBusy('restart');
    const { data, error } = await db.rpc('restart_game', { p_session: sessionId });
    setBusy(null);
    if (error) { setToast(friendly(error)); return; }
    router.replace(`/host/?session=${(data as GameSession).id}`);
  }

  async function removePlayer(p: Participant, block: boolean) {
    const { error } = await db.rpc('remove_participant', { p_participant: p.id, p_block: block });
    setKick(null);
    if (error) setToast(friendly(error)); else setToast(block ? `${p.nickname} was blocked` : `${p.nickname} was removed — they can rejoin with a new name`);
  }

  if (loadError) return <div className="p-10"><ErrorBox>{loadError}</ErrorBox><Link className="mt-4 inline-block font-bold text-brand-600" href="/dashboard/">← Dashboard</Link></div>;
  if (!session) return <div className="game-bg min-h-dvh"><Spinner light label="Opening your game…" /></div>;

  const url = joinUrl(session.pin);
  const teamsMessage = `🚀 Quiz time! Join our live game "${session.quiz_title}":\n${url}\nGame PIN: ${session.pin}`;
  const isLast = session.current_index + 1 >= session.question_count;
  const nextLabel = session.status === 'ready' ? 'Show question 1' : isLast ? 'Last question done' : `Next: question ${session.current_index + 2}`;
  const tileState = (i: number): TileState => {
    const revealed = session.reveal?.index === session.current_index || showKey;
    if (!revealed) return 'idle';
    return correctIdx.includes(i) ? 'correct' : 'dim';
  };

  return (
    <div className="game-bg flex min-h-dvh flex-col text-white">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-5">
        <Link href="/dashboard/" className="rounded-lg p-2 hover:bg-white/10" aria-label="Back to dashboard"><LogOut className="size-5 rotate-180" /></Link>
        <h1 className="mr-auto truncate font-display text-xl font-extrabold sm:text-2xl">{session.quiz_title}</h1>
        {session.status !== 'ended' && (
          <button onClick={async () => { await copyText(url); setToast('Join link copied'); }} className="rounded-xl bg-white px-3 py-1.5 font-display text-lg font-extrabold text-ink" title="Copy join link">
            PIN <span className="tracking-widest text-brand-700">{formatPin(session.pin)}</span>
          </button>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-1.5 text-sm font-extrabold"><Users className="size-4" /> {active.length}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-extrabold ${link === 'live' ? 'bg-emerald-500/25' : 'bg-amber-400/30'}`} role="status">
          {link === 'live' ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}{link === 'live' ? 'Live' : 'Reconnecting…'}
        </span>
        <button className="rounded-lg p-2 hover:bg-white/10" onClick={() => { setMuted(!muted); setMutedState(!muted); }} aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}>
          {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
      </header>

      {/* Stage */}
      <main className="flex-1 px-3 pb-44 sm:px-6">
        {session.status === 'lobby' && (
          <Lobby session={session} url={url} active={active} online={online} onKick={setKick}
            onCopyLink={async () => { await copyText(url); setToast('Join link copied — paste it in the Teams chat'); }}
            onCopyTeams={async () => { await copyText(teamsMessage); setToast('Message copied — paste it in the Teams chat'); }} />
        )}

        {session.status === 'ready' && (
          <div className="mx-auto mt-16 max-w-2xl text-center animate-rise">
            <div className="text-7xl animate-float" aria-hidden>🚀</div>
            <h2 className="mt-4 text-5xl font-extrabold">Get ready!</h2>
            <p className="mt-2 text-xl font-bold text-white/85">{active.length} player{active.length === 1 ? ' is' : 's are'} in. Press <b>{nextLabel}</b> when the class is ready.</p>
          </div>
        )}

        {q && ['question', 'closed', 'revealed'].includes(session.status) && (
          <section className="mx-auto max-w-6xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/15 px-3 py-1 font-extrabold">Question {session.current_index + 1} of {session.question_count}</span>
              <span className="rounded-full bg-white/15 px-3 py-1 font-extrabold">{q.points ? `${q.points} pts` : 'Practice'}</span>
              {session.status === 'closed' && <span className="rounded-full bg-amber-400 px-3 py-1 font-extrabold text-ink">Answers closed</span>}
              {session.paused && <span className="rounded-full bg-amber-400 px-3 py-1 font-extrabold text-ink animate-pulse-soft">Paused</span>}
              <span className="ml-auto rounded-full bg-white px-4 py-1 font-display text-xl font-extrabold text-ink" aria-live="polite">
                {qAnswers.length} / {active.length} answered
              </span>
            </div>
            <div className="flex items-start gap-4 rounded-3xl bg-white p-5 text-ink shadow-2xl sm:p-7">
              <h2 className="flex-1 text-2xl font-extrabold leading-snug sm:text-4xl">{q.prompt}</h2>
              {session.mode === 'timed' && session.status === 'question'
                ? <TimerRing seconds={left} total={q.time_limit} paused={session.paused} size={100} />
                : <div className="grid size-[100px] shrink-0 place-items-center rounded-full bg-brand-50 text-center font-display text-3xl font-extrabold text-brand-700">{qAnswers.length}<span className="-mt-3 block text-xs">answers</span></div>}
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
              <div className="grid content-start gap-3 sm:grid-cols-2">
                {q.options.map((o, i) => (
                  <AnswerTile key={i} type={q.type} index={i} text={o.text} imageUrl={o.image_url} size="xl" state={tileState(i)}
                    showCount={showLive || session.status === 'revealed'} count={counts[i]} />
                ))}
              </div>
              {q.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={q.image_url} alt="" className="max-h-80 rounded-2xl bg-white object-contain p-2 shadow-xl lg:w-80" />
              )}
            </div>
            {session.status === 'revealed' && (
              <p className="mt-5 text-center font-display text-3xl font-extrabold animate-pop">
                {counts.filter((_, i) => correctIdx.includes(i)).reduce((a, b) => a + b, 0)} of {active.length} got it right 🎉
              </p>
            )}
            <PlayerStrip active={active} answered={answeredIds} online={online} />
          </section>
        )}

        {q && session.status === 'results' && session.results && (
          <section className="mx-auto max-w-5xl text-center animate-rise">
            <h2 className="text-3xl font-extrabold sm:text-4xl">{q.prompt}</h2>
            <div className="mt-6 rounded-3xl bg-white/10 p-6 ring-1 ring-white/20">
              <ResultBars type={q.type} options={q.options} counts={session.results.counts} correct={session.reveal?.correct} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Answered" value={`${session.results.answered}/${session.results.players}`} />
              <Stat label="Correct" value={`${pct(session.results.correct, session.results.answered)}%`} />
              <Stat label="Got it right" value={String(session.results.correct)} />
              <Stat label="Avg. time" value={fmtSeconds(session.results.avg_ms)} />
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {q.options.map((o, i) => (
                <span key={i} className={`rounded-xl px-3 py-1.5 font-extrabold ${correctIdx.includes(i) ? 'bg-emerald-400 text-ink' : 'bg-white/15'}`}>
                  {q.type === 'true_false' ? o.text : `${'ABCD'[i]}. ${o.text}`}{correctIdx.includes(i) ? ' ✓' : ''}
                </span>
              ))}
            </div>
          </section>
        )}

        {session.status === 'leaderboard' && (
          <section className="mx-auto max-w-2xl animate-rise">
            <h2 className="mb-5 flex items-center justify-center gap-3 text-center text-4xl font-extrabold"><Trophy className="size-9 text-amber-300" /> Leaderboard</h2>
            <LeaderboardList entries={session.leaderboard ?? []} limit={10} dark />
            <p className="mt-4 text-center font-bold text-white/75">After question {session.current_index + 1} of {session.question_count}</p>
          </section>
        )}

        {session.status === 'ended' && (
          <section className="mx-auto max-w-4xl text-center animate-rise">
            <h2 className="text-5xl font-extrabold">🏆 Final results</h2>
            <p className="mt-1 text-lg font-bold text-white/80">{session.quiz_title}</p>
            <div className="mt-8"><Podium entries={session.leaderboard ?? []} /></div>
            {(session.leaderboard?.length ?? 0) > 3 && (
              <div className="mx-auto mt-8 max-w-xl text-left"><LeaderboardList entries={(session.leaderboard ?? []).slice(3)} limit={7} dark /></div>
            )}
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button variant="rocket" size="lg" icon={<ChartColumn className="size-5" />} onClick={() => router.push(`/results/?session=${session.id}`)}>Full results & export</Button>
              <Button variant="light" size="lg" icon={<RotateCcw className="size-5" />} loading={busy === 'restart'} onClick={restart}>Play again (new PIN)</Button>
              <Button variant="light" size="lg" onClick={() => router.push('/dashboard/')}>Dashboard</Button>
            </div>
          </section>
        )}

        {/* Teacher-only answer details (hidden by default in case you are sharing your screen) */}
        {q && ['question', 'closed', 'revealed', 'results', 'leaderboard'].includes(session.status) && (
          <div className="mx-auto mt-6 max-w-6xl">
            <button onClick={() => setShowDetails((x) => !x)} className="text-sm font-extrabold text-white/80 underline-offset-4 hover:underline">
              {showDetails ? 'Hide' : 'Show'} each student’s answer (teacher only — hide before sharing your screen)
            </button>
            {showDetails && <AnswerDetails q={q} active={active} answers={qAnswers} showCorrect={session.reveal?.index === session.current_index || showKey} />}
          </div>
        )}
      </main>

      {/* Control panel */}
      {session.status !== 'ended' && (
        <nav aria-label="Game controls" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-brand-900/95 px-3 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-2">
            {session.status === 'lobby' ? (
              <>
                <Button variant="light" icon={session.locked ? <LockOpen className="size-4" /> : <Lock className="size-4" />} onClick={() => control(session.locked ? 'unlock' : 'lock')} loading={busy === 'lock' || busy === 'unlock'}>
                  {session.locked ? 'LockOpen joining' : 'Lock joining'}
                </Button>
                <Button variant="rocket" size="lg" className="min-w-56 text-xl" icon={<Play className="size-6" fill="currentColor" />} onClick={() => control('start')} loading={busy === 'start'}
                  disabled={active.length === 0} title={active.length === 0 ? 'Waiting for at least one player' : 'Shortcut: S'}>
                  Start game
                </Button>
                {active.length === 0 && <span className="w-full text-center text-sm font-bold text-white/70">The Start button unlocks when the first student joins.</span>}
              </>
            ) : (
              <>
                <Ctl label={nextLabel} k="N" Icon={ChevronRight} primary onClick={() => control('next')} enabled={can.next} busy={busy === 'next'} />
                <Ctl label="Close answers" k="C" Icon={Square} onClick={() => control('close')} enabled={can.close} busy={busy === 'close'} />
                <Ctl label="Reveal answer" k="R" Icon={CircleCheck} onClick={() => control('reveal')} enabled={can.reveal} busy={busy === 'reveal'} />
                <Ctl label="Show results" k="V" Icon={ChartColumn} onClick={() => control('results')} enabled={can.results} busy={busy === 'results'} />
                <Ctl label="Leaderboard" k="L" Icon={Trophy} onClick={() => control('leaderboard')} enabled={can.leaderboard} busy={busy === 'leaderboard'} />
                {session.paused
                  ? <Ctl label="Resume" k="P" Icon={Play} onClick={() => control('resume')} enabled={can.resume} busy={busy === 'resume'} />
                  : <Ctl label="Pause" k="P" Icon={Pause} onClick={() => control('pause')} enabled={can.pause} busy={busy === 'pause'} />}
                <span className="mx-1 hidden h-8 w-px bg-white/20 sm:block" />
                <button onClick={() => setShowKey((x) => !x)} aria-pressed={showKey} title="Shortcut: K"
                  className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-extrabold text-white/85 hover:bg-white/10">
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {showKey ? 'Hide' : 'Peek'} answer key
                </button>
                <button onClick={() => setShowLive((x) => !x)} aria-pressed={showLive}
                  className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-extrabold text-white/85 hover:bg-white/10">
                  <ChartColumn className="size-4" /> {showLive ? 'Hide' : 'Show'} live counts
                </button>
                <Ctl label="End game" Icon={Flag} danger onClick={() => (isLast && session.status !== 'question' ? control('end') : setConfirmEnd(true))} enabled={can.end} busy={busy === 'end'} />
              </>
            )}
          </div>
        </nav>
      )}

      <Modal open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End the game now?">
        <p className="text-ink-soft">The current question is scored and everyone sees the final results. You can play again afterwards with a new PIN.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Keep playing</Button>
          <Button variant="rocket" icon={<Flag className="size-4" />} onClick={() => { setConfirmEnd(false); control('end'); }}>End game</Button>
        </div>
      </Modal>
      <Modal open={!!kick} onClose={() => setKick(null)} title={`Remove ${kick?.avatar ?? ''} ${kick?.nickname ?? ''}?`}>
        <p className="text-ink-soft"><b>Remove</b> asks the student to rejoin with a different nickname. <b>Block</b> disconnects them from this game completely.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setKick(null)}>Cancel</Button>
          <Button variant="secondary" icon={<UserX className="size-4" />} onClick={() => kick && removePlayer(kick, false)}>Remove (can rejoin)</Button>
          <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => kick && removePlayer(kick, true)}>Block</Button>
        </div>
      </Modal>
      <Toast message={toast} onDone={() => setToast(null)} />
      <FinalSummary session={session} questions={questions} players={players} answers={answers} />
    </div>
  );
}

function abilities(s: GameSession | null) {
  const st = s?.status;
  const started = !!s && st !== 'lobby' && st !== 'ended';
  const hasQ = !!s && s.current_index >= 0;
  return {
    start: st === 'lobby',
    next: started && !!s && s.current_index + 1 < s.question_count,
    close: st === 'question',
    reveal: st === 'question' || st === 'closed',
    results: started && hasQ && st !== 'results',
    leaderboard: started && hasQ && st !== 'leaderboard',
    pause: st === 'question' && !s?.paused,
    resume: !!s?.paused,
    end: started,
  };
}

function Ctl({ label, Icon, onClick, enabled, busy, primary, danger, k }: {
  label: string; Icon: typeof Play; onClick: () => void; enabled: boolean; busy?: boolean; primary?: boolean; danger?: boolean; k?: string;
}) {
  return (
    <Button variant={primary ? 'rocket' : 'light'} size={primary ? 'lg' : 'md'} onClick={onClick} disabled={!enabled} loading={busy}
      icon={<Icon className="size-5" />} title={k ? `Shortcut: ${k}` : undefined}
      className={`${danger ? '!bg-rose-600/80 hover:!bg-rose-600' : ''} ${primary ? 'min-w-52' : ''}`}>
      {label}
    </Button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 text-ink shadow-lg">
      <div className="font-display text-3xl font-extrabold tabular-nums">{value}</div>
      <div className="text-sm font-bold text-ink-soft">{label}</div>
    </div>
  );
}

function Lobby({ session, url, active, online, onKick, onCopyLink, onCopyTeams }: {
  session: GameSession; url: string; active: Participant[]; online: Set<string>;
  onKick: (p: Participant) => void; onCopyLink: () => void; onCopyTeams: () => void;
}) {
  return (
    <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,430px)_1fr]">
      <section className="card p-5 text-center text-ink sm:p-6 animate-rise">
        <p className="font-extrabold text-ink-soft">Students join at</p>
        <p className="mt-1 break-all font-mono text-sm font-bold text-brand-700">{url}</p>
        <p className="mt-4 font-extrabold text-ink-soft">Game PIN</p>
        <p className="font-display text-6xl font-extrabold tracking-[0.12em] text-ink sm:text-7xl">{formatPin(session.pin)}</p>
        <div className="mx-auto mt-4 w-fit rounded-2xl bg-white p-3 ring-2 ring-brand-100">
          <QRCodeSVG value={url} size={156} level="M" />
        </div>
        <div className="mt-5 grid gap-2">
          <Button variant="rocket" icon={<MessageSquareShare className="size-5" />} onClick={onCopyTeams}>Copy message for Teams chat</Button>
          <Button variant="secondary" icon={<Copy className="size-4" />} onClick={onCopyLink}>Copy join link only</Button>
        </div>
        <p className="mt-3 text-xs font-semibold text-ink-soft">
          {session.mode === 'timed' ? 'Timed live mode' : 'Teacher-paced mode'} · {session.question_count} questions{session.locked ? ' · 🔒 joining locked' : ''}
        </p>
      </section>

      <section className="flex flex-col">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-3xl font-extrabold">Players <span className="text-white/70">({active.length})</span></h2>
          <span className="text-sm font-bold text-white/70">Waiting for you to press Start…</span>
        </div>
        {active.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-3xl border-4 border-dashed border-white/25 p-10 text-center">
            <div>
              <div className="text-6xl animate-float" aria-hidden>👀</div>
              <p className="mt-3 text-xl font-extrabold">Waiting for students to join…</p>
              <p className="font-semibold text-white/75">Paste the message in your Teams chat. Names appear here the moment students join.</p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-wrap content-start gap-2.5" aria-live="polite">
            {active.map((p) => (
              <li key={p.id} className="group flex items-center gap-2 rounded-2xl bg-white py-2 pl-3 pr-1.5 text-ink shadow-md animate-pop">
                <span className="text-2xl" aria-hidden>{p.avatar}</span>
                <span className="text-lg font-extrabold">{p.nickname}</span>
                <span className={`size-2.5 rounded-full ${online.has(p.id) ? 'bg-emerald-500' : 'bg-slate-300'}`} title={online.has(p.id) ? 'Connected' : 'Connection lost'} />
                <button onClick={() => onKick(p)} className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-ans-a" aria-label={`Remove ${p.nickname}`}><X className="size-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PlayerStrip({ active, answered, online }: { active: Participant[]; answered: Set<string>; online: Set<string> }) {
  if (!active.length) return null;
  return (
    <ul className="mt-5 flex flex-wrap justify-center gap-1.5" aria-label="Who has answered">
      {active.map((p) => (
        <li key={p.id} title={`${p.nickname}${answered.has(p.id) ? ' — answered' : ''}${online.has(p.id) ? '' : ' (connection lost)'}`}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-extrabold transition ${answered.has(p.id) ? 'bg-emerald-400 text-ink' : 'bg-white/15 text-white/80'} ${online.has(p.id) ? '' : 'opacity-50'}`}>
          <span aria-hidden>{p.avatar}</span>{p.nickname}{answered.has(p.id) && <CircleCheck className="size-3.5" aria-label="answered" />}
        </li>
      ))}
    </ul>
  );
}

function AnswerDetails({ q, active, answers, showCorrect }: { q: SessionQuestion; active: Participant[]; answers: Answer[]; showCorrect: boolean }) {
  const byP = new Map(answers.map((a) => [a.participant_id, a]));
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl bg-white text-ink">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="border-b border-brand-100 text-ink-soft"><tr><th className="p-2.5">Student</th><th className="p-2.5">Answer</th><th className="p-2.5">Time</th>{showCorrect && <th className="p-2.5">Result</th>}</tr></thead>
        <tbody>
          {active.map((p) => {
            const a = byP.get(p.id);
            return (
              <tr key={p.id} className="border-b border-brand-50 last:border-0">
                <td className="p-2.5 font-extrabold">{p.avatar} {p.nickname}</td>
                <td className="p-2.5">{a ? (q.type === 'true_false' ? q.options[a.option_index]?.text : `${'ABCD'[a.option_index]}. ${q.options[a.option_index]?.text ?? ''}`) : <span className="text-slate-400">—</span>}</td>
                <td className="p-2.5 tabular-nums">{a ? fmtSeconds(a.response_ms) : ''}</td>
                {showCorrect && <td className="p-2.5 font-extrabold">{a ? (a.is_correct ? <span className="text-emerald-600">✓ +{a.points}</span> : <span className="text-ans-a">✗</span>) : ''}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Quick class summary under the podium (full analytics live on the Results page). */
function FinalSummary({ session, questions, players, answers }: { session: GameSession; questions: SessionQuestion[]; players: Participant[]; answers: Answer[] }) {
  if (session.status !== 'ended') return null;
  const r = buildReport(questions, players, answers, session.current_index);
  return (
    <div className="mx-auto mb-16 grid w-full max-w-4xl grid-cols-2 gap-3 px-4 sm:grid-cols-4">
      <Stat label="Players" value={String(r.players)} />
      <Stat label="Questions played" value={String(r.questionsPlayed)} />
      <Stat label="Class accuracy" value={`${r.accuracy}%`} />
      <Stat label="Average score" value={r.avgScore.toLocaleString()} />
    </div>
  );
}
