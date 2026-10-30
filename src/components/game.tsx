'use client';
import { Check, Cloud, Crown, Heart, Moon, Star, X, type LucideIcon } from 'lucide-react';
import type { LeaderboardEntry, QuestionType } from '@/lib/types';

// ---------------------------------------------------------------------------------------
// Answer tiles: every answer has a colour AND a shape AND a letter, so colour-blind
// students (and those reading a shared Teams screen) can always tell them apart.
// ---------------------------------------------------------------------------------------
export interface AnsStyle { bg: string; text: string; Icon: LucideIcon; name: string; letter: string }
const MC: AnsStyle[] = [
  { bg: 'bg-ans-a', text: 'text-white', Icon: Star, name: 'Star', letter: 'A' },
  { bg: 'bg-ans-b', text: 'text-white', Icon: Heart, name: 'Heart', letter: 'B' },
  { bg: 'bg-ans-c', text: 'text-ink', Icon: Moon, name: 'Moon', letter: 'C' },
  { bg: 'bg-ans-d', text: 'text-white', Icon: Cloud, name: 'Cloud', letter: 'D' },
];
const TF: AnsStyle[] = [
  { bg: 'bg-ans-b', text: 'text-white', Icon: Check, name: 'True', letter: 'T' },
  { bg: 'bg-ans-a', text: 'text-white', Icon: X, name: 'False', letter: 'F' },
];
export function ansStyle(type: QuestionType, i: number): AnsStyle {
  return (type === 'true_false' ? TF : MC)[i] ?? MC[i % 4];
}

export type TileState = 'idle' | 'selected' | 'correct' | 'incorrect' | 'dim';

export function AnswerTile({
  type, index, text, imageUrl, state = 'idle', onClick, disabled, size = 'lg', count, showCount,
}: {
  type: QuestionType; index: number; text: string; imageUrl?: string | null; state?: TileState;
  onClick?: () => void; disabled?: boolean; size?: 'md' | 'lg' | 'xl'; count?: number; showCount?: boolean;
}) {
  const s = ansStyle(type, index);
  const interactive = !!onClick && !disabled;
  const ring =
    state === 'selected' ? 'ring-[6px] ring-white scale-[1.02]' :
    state === 'correct' ? 'ring-[6px] ring-emerald-300' : '';
  const fade = state === 'dim' || state === 'incorrect' ? 'opacity-40 saturate-50' : '';
  const minH = size === 'xl' ? 'min-h-28 sm:min-h-36' : size === 'lg' ? 'min-h-20 sm:min-h-24' : 'min-h-14';
  const textSize = size === 'xl' ? 'text-2xl sm:text-3xl' : size === 'lg' ? 'text-xl sm:text-2xl' : 'text-lg';
  const cls = `relative flex w-full items-center gap-3 rounded-2xl p-3 text-left font-extrabold shadow-lg transition sm:p-4 ${s.bg} ${s.text} ${minH} ${ring} ${fade} ${
    interactive ? 'chunky cursor-pointer hover:brightness-110' : ''
  }`;
  const inner = (
    <>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-black/15 sm:size-12" aria-hidden>
        <s.Icon className="size-7 sm:size-8" strokeWidth={2.6} fill={type === 'true_false' ? 'none' : 'currentColor'} />
      </span>
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-16 w-20 shrink-0 rounded-lg bg-white object-contain sm:h-20 sm:w-28" />
      )}
      <span className={`flex-1 leading-tight break-words ${textSize}`}>{text}</span>
      {showCount && <span className="rounded-lg bg-black/20 px-2.5 py-1 text-lg tabular-nums">{count ?? 0}</span>}
      {state === 'correct' && <span className="grid size-9 place-items-center rounded-full bg-white text-emerald-600" aria-label="Correct answer"><Check className="size-6" strokeWidth={3.5} /></span>}
      {state === 'incorrect' && <span className="grid size-9 place-items-center rounded-full bg-white/90 text-ans-a" aria-hidden><X className="size-6" strokeWidth={3.5} /></span>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={cls} aria-label={`Answer ${s.letter}: ${text || s.name}`}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

// ---------------------------------------------------------------------------------------
export function TimerRing({ seconds, total, paused = false, size = 96 }: { seconds: number | null; total: number; paused?: boolean; size?: number }) {
  if (seconds == null) return null;
  const r = 42; const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.max(0, Math.min(1, seconds / total)) : 0;
  const urgent = seconds <= 5 && !paused;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="timer" aria-label={`${Math.ceil(seconds)} seconds left`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="white" stroke="rgba(0,0,0,.08)" strokeWidth="10" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={urgent ? '#d92d55' : '#5a32f0'} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: 'stroke-dashoffset .25s linear' }} />
      </svg>
      <span className={`absolute inset-0 grid place-items-center font-display font-extrabold tabular-nums ${urgent ? 'text-ans-a animate-pulse-soft' : 'text-ink'}`}
        style={{ fontSize: size * 0.34 }}>
        {paused ? '❚❚' : Math.ceil(seconds)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
export function ResultBars({ type, options, counts, correct, compact = false }: {
  type: QuestionType; options: { text: string }[]; counts: number[]; correct?: number[]; compact?: boolean;
}) {
  const max = Math.max(1, ...counts);
  return (
    <div className={`flex items-end justify-center gap-3 sm:gap-6 ${compact ? 'h-36' : 'h-52 sm:h-64'}`}>
      {options.map((o, i) => {
        const s = ansStyle(type, i);
        const isCorrect = correct?.includes(i);
        const h = Math.max(6, (counts[i] / max) * 100);
        return (
          <div key={i} className="flex h-full w-16 flex-col items-center justify-end gap-1.5 sm:w-24">
            <span className="font-display text-2xl font-extrabold tabular-nums text-inherit">{counts[i] ?? 0}</span>
            <div className={`w-full rounded-t-xl ${s.bg} ${correct && !isCorrect ? 'opacity-35' : ''} transition-all duration-700`} style={{ height: `${h}%` }} />
            <div className={`flex w-full items-center justify-center gap-1 rounded-lg py-1 ${s.bg} ${s.text} ${correct && !isCorrect ? 'opacity-35' : ''}`}>
              <s.Icon className="size-4" fill={type === 'true_false' ? 'none' : 'currentColor'} aria-hidden />
              {isCorrect && <Check className="size-4" strokeWidth={4} aria-label="correct" />}
            </div>
            <span className="sr-only">{o.text}: {counts[i]} answers{isCorrect ? ' (correct)' : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
export function LeaderboardList({ entries, highlightId, limit = 10, dark = false }: { entries: LeaderboardEntry[]; highlightId?: string; limit?: number; dark?: boolean }) {
  const shown = entries.slice(0, limit);
  const mine = highlightId ? entries.find((e) => e.participant_id === highlightId) : undefined;
  const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`);
  return (
    <ol className="space-y-2.5">
      {shown.map((e, i) => (
        <li key={e.participant_id}
          className={`flex items-center gap-3 rounded-2xl px-4 py-3 shadow-md animate-rise ${
            e.participant_id === highlightId ? 'bg-rocket text-white ring-4 ring-white' : dark ? 'bg-white/95 text-ink' : 'bg-white text-ink'
          }`}
          style={{ animationDelay: `${i * 70}ms` }}>
          <span className="w-9 text-center font-display text-2xl font-extrabold">{medal(e.rank)}</span>
          <span className="text-3xl" aria-hidden>{e.avatar}</span>
          <span className="flex-1 truncate text-xl font-extrabold">{e.nickname}</span>
          {e.streak >= 3 && <span className="text-sm font-extrabold" title={`${e.streak} correct in a row`}>🔥{e.streak}</span>}
          <span className="font-display text-2xl font-extrabold tabular-nums">{e.score.toLocaleString()}</span>
        </li>
      ))}
      {mine && !shown.includes(mine) && (
        <li className="flex items-center gap-3 rounded-2xl bg-rocket px-4 py-3 text-white ring-4 ring-white">
          <span className="w-9 text-center font-display text-2xl font-extrabold">{mine.rank}</span>
          <span className="text-3xl" aria-hidden>{mine.avatar}</span>
          <span className="flex-1 truncate text-xl font-extrabold">{mine.nickname} (you)</span>
          <span className="font-display text-2xl font-extrabold tabular-nums">{mine.score.toLocaleString()}</span>
        </li>
      )}
      {entries.length === 0 && <li className="rounded-2xl bg-white/90 p-4 text-center font-bold text-ink-soft">No players yet</li>}
    </ol>
  );
}

export function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  const top = [entries[1], entries[0], entries[2]];
  const heights = ['h-28 sm:h-36', 'h-40 sm:h-52', 'h-20 sm:h-28'];
  const colors = ['bg-slate-200', 'bg-amber-300', 'bg-orange-300'];
  const places = [2, 1, 3];
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-4" aria-label="Top three players">
      {top.map((e, i) => (
        <div key={i} className="flex w-28 flex-col items-center sm:w-40">
          {e ? (
            <div className="mb-2 flex flex-col items-center text-center text-white animate-pop" style={{ animationDelay: `${(2 - i) * 350 + 200}ms` }}>
              {places[i] === 1 && <Crown className="size-8 text-amber-300 animate-float" fill="currentColor" aria-hidden />}
              <span className="text-5xl sm:text-6xl" aria-hidden>{e.avatar}</span>
              <span className="mt-1 max-w-full truncate text-lg font-extrabold sm:text-xl">{e.nickname}</span>
              <span className="font-display text-xl font-extrabold tabular-nums text-amber-200">{e.score.toLocaleString()}</span>
            </div>
          ) : <div className="h-20" />}
          <div className={`w-full rounded-t-2xl ${colors[i]} ${heights[i]} grid place-items-start justify-center pt-2 font-display text-4xl font-extrabold text-ink/70 shadow-inner`}>
            {places[i]}
          </div>
        </div>
      ))}
    </div>
  );
}
