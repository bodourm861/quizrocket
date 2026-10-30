'use client';
// Tiny synthesized sound effects (no audio files to host). Respects a saved mute setting.

let ctx: AudioContext | null = null;
const KEY = 'qr-muted';

export function isMuted(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setMuted(m: boolean) {
  try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* ignore */ }
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.15) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(); const g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, a.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start); o.stop(a.currentTime + start + dur + 0.05);
}

export type Sfx = 'join' | 'tap' | 'correct' | 'wrong' | 'tick' | 'start' | 'fanfare';

export function play(s: Sfx) {
  if (isMuted()) return;
  switch (s) {
    case 'join': tone(660, 0, 0.12, 'triangle'); tone(990, 0.08, 0.16, 'triangle'); break;
    case 'tap': tone(520, 0, 0.08, 'triangle', 0.1); break;
    case 'tick': tone(1200, 0, 0.05, 'square', 0.04); break;
    case 'start': [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.18, 'triangle')); break;
    case 'correct': tone(659, 0, 0.12, 'triangle'); tone(880, 0.1, 0.12, 'triangle'); tone(1318, 0.2, 0.25, 'triangle'); break;
    case 'wrong': tone(300, 0, 0.18, 'sawtooth', 0.07); tone(220, 0.16, 0.3, 'sawtooth', 0.07); break;
    case 'fanfare': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.22, 'triangle', 0.12)); break;
  }
}
