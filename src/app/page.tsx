'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GraduationCap } from 'lucide-react';
import { Logo } from '@/components/brand';
import { Button } from '@/components/ui';

export default function Home() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const clean = pin.replace(/\D/g, '').slice(0, 6);

  return (
    <div className="game-bg flex min-h-dvh flex-col">
      <header className="flex items-center justify-between p-4 sm:p-6">
        <Logo light />
        <Link href="/login/" className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-sm font-extrabold text-white ring-1 ring-white/25 hover:bg-white/25">
          <GraduationCap className="size-4" aria-hidden /> Teacher sign in
        </Link>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
        <div className="mb-6 text-7xl animate-float" aria-hidden>🚀</div>
        <form
          onSubmit={(e) => { e.preventDefault(); if (clean.length === 6) router.push(`/play/?pin=${clean}`); }}
          className="card w-full max-w-sm p-6 text-center animate-rise"
        >
          <h1 className="text-3xl font-extrabold">Join a game</h1>
          <p className="mt-1 text-ink-soft">Type the Game PIN your teacher shared.</p>
          <label htmlFor="pin" className="sr-only">Game PIN</label>
          <input
            id="pin" inputMode="numeric" autoComplete="off" placeholder="Game PIN" autoFocus
            value={clean} onChange={(e) => setPin(e.target.value)}
            className="mt-5 w-full rounded-2xl border-4 border-brand-100 py-4 text-center font-display text-4xl font-extrabold tracking-[0.25em] text-ink placeholder:text-2xl placeholder:tracking-normal placeholder:text-slate-300 focus:border-brand-500 focus:outline-none"
          />
          <Button type="submit" variant="rocket" size="lg" className="mt-4 w-full text-xl" disabled={clean.length !== 6}>
            Enter
          </Button>
        </form>
        <p className="mt-6 max-w-sm text-center text-sm font-semibold text-white/80">
          Got a link from your teacher in Teams? Just tap it — no account or app needed.
        </p>
      </main>
    </div>
  );
}
