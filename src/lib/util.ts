'use client';
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'QuizRocket';

const MESSAGES: Record<string, string> = {
  game_not_found: "We couldn't find a game with that PIN. Check the number with your teacher.",
  invalid_nickname: 'Please type a nickname (1–20 characters).',
  nickname_taken: 'Someone already has that nickname. Try another one!',
  game_locked: 'This game is locked. Ask your teacher to unlock it.',
  blocked: 'Your teacher has removed you from this game.',
  not_signed_in: 'Connecting… please try again in a moment.',
  not_authorized: "You don't have permission to do that.",
  quiz_not_found: 'That quiz no longer exists.',
  quiz_has_no_questions: 'Add at least one question before hosting.',
  invalid_mode: 'Choose a game mode.',
  could_not_create_pin: 'Could not create a game PIN. Please try again.',
  not_started: 'Press Start first.',
  no_more_questions: 'That was the last question. End the game to see the final results.',
  invalid_state: "That control isn't available right now.",
  game_ended: 'This game has ended.',
  unknown_action: 'Unknown action.',
  answers_closed: 'Answers are closed for this question.',
  time_up: "Time's up!",
  paused: 'The game is paused.',
  already_answered: 'You already answered this question.',
  invalid_option: 'That answer is not valid.',
  not_in_game: 'You are not in this game.',
  'Anonymous sign-ins are disabled': 'Student joining is not switched on yet: enable "Anonymous sign-ins" in Supabase (see README).',
};

/** Turns database error codes into friendly sentences. */
export function friendly(err: unknown): string {
  const raw =
    typeof err === 'string' ? err
    : err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message)
    : 'Something went wrong.';
  for (const [code, msg] of Object.entries(MESSAGES)) if (raw.includes(code)) return msg;
  if (/fetch|network|Failed to fetch/i.test(raw)) return 'Connection problem. Check your internet and try again.';
  return raw;
}

/** Estimates (server time − device time) so countdowns match on every device. */
export function useServerClock(db: SupabaseClient | null): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!db) return;
    let alive = true;
    (async () => {
      let best = Infinity;
      let off = 0;
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        const { data, error } = await db.rpc('server_now');
        const t1 = Date.now();
        if (error || !data) continue;
        const rtt = t1 - t0;
        if (rtt < best) { best = rtt; off = new Date(data as string).getTime() - (t0 + rtt / 2); }
      }
      if (alive && Number.isFinite(best)) setOffset(off);
    })();
    return () => { alive = false; };
  }, [db]);
  return offset;
}

/** Re-renders every `ms` milliseconds while `active`. Returns Date.now(). */
export function useNow(ms = 200, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

export function secondsLeft(deadline: string | null, offset: number, now: number): number | null {
  if (!deadline) return null;
  return Math.max(0, (new Date(deadline).getTime() - (now + offset)) / 1000);
}

export function joinUrl(pin?: string): string {
  if (typeof window === 'undefined') return '';
  const base = `${window.location.origin}/play/`;
  return pin ? `${base}?pin=${pin}` : base;
}

export function formatPin(pin: string): string {
  return pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin;
}

export function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

export function fmtSeconds(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–';
  return `${(ms / 1000).toFixed(1)}s`;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

export const AVATARS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🐨', '🐰', '🐙', '🦄', '🐢', '🐧', '🦉', '🐳', '🐝', '🦖', '🐬', '🦒', '🐞', '🦋'];

/** Light, friendly filter for the most obvious bad words in nicknames (teacher can still remove anyone). */
const BLOCKLIST = ['fuck', 'shit', 'bitch', 'pussy', 'cunt', 'asshole', 'bastard', 'slut', 'whore', 'nigg', 'fag', 'porn'];
export function nicknameProblem(name: string): string | null {
  const n = name.trim();
  if (n.length < 1) return 'Please type a nickname.';
  if (n.length > 20) return 'Nicknames can be up to 20 characters.';
  const flat = n.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i').replace(/[^a-z]/g, '');
  if (BLOCKLIST.some((w) => flat.includes(w))) return 'Please choose a kind, classroom-friendly nickname.';
  return null;
}
