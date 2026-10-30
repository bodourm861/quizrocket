'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hand, Timer } from 'lucide-react';
import { teacherDb } from '@/lib/supabase';
import type { GameMode, GameSession } from '@/lib/types';
import { friendly } from '@/lib/util';
import { Button, ErrorBox, Modal } from './ui';

export function HostDialog({ quizId, quizTitle, open, onClose }: { quizId: string; quizTitle: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<GameMode>('teacher_paced');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function host() {
    setBusy(true); setError(null);
    const { data, error } = await teacherDb().rpc('host_game', { p_quiz_id: quizId, p_mode: mode });
    if (error) { setError(friendly(error)); setBusy(false); return; }
    router.push(`/host/?session=${(data as GameSession).id}`);
  }

  const choices: { value: GameMode; title: string; text: string; Icon: typeof Hand }[] = [
    { value: 'teacher_paced', title: 'Teacher-paced', Icon: Hand,
      text: 'No countdown. Answers stay open until you click Close. Every correct answer earns full points.' },
    { value: 'timed', title: 'Timed live', Icon: Timer,
      text: 'Each question has its countdown. Answers close automatically at 0 (or when everyone has answered). Faster correct answers earn more points.' },
  ];

  return (
    <Modal open={open} onClose={onClose} title={`Host “${quizTitle}”`}>
      <p className="mb-4 text-ink-soft">Choose how the game runs. In both modes, <b>you</b> decide when to start, reveal answers and move on.</p>
      <div className="grid gap-3" role="radiogroup" aria-label="Game mode">
        {choices.map((c) => (
          <button key={c.value} role="radio" aria-checked={mode === c.value} onClick={() => setMode(c.value)}
            className={`flex gap-3 rounded-2xl border-2 p-4 text-left transition ${mode === c.value ? 'border-brand-500 bg-brand-50' : 'border-brand-100 hover:border-brand-200'}`}>
            <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${mode === c.value ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600'}`}>
              <c.Icon className="size-6" aria-hidden />
            </span>
            <span>
              <span className="block text-lg font-extrabold">{c.title}</span>
              <span className="block text-sm text-ink-soft">{c.text}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="rocket" size="lg" onClick={host} loading={busy}>Create game lobby</Button>
      </div>
    </Modal>
  );
}
