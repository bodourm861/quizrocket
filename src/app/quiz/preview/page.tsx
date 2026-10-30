'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, MonitorPlay, Pencil, RotateCcw } from 'lucide-react';
import { TeacherShell } from '@/components/TeacherShell';
import { HostDialog } from '@/components/HostDialog';
import { AnswerTile, TimerRing, type TileState } from '@/components/game';
import { Button, ErrorBox, Spinner } from '@/components/ui';
import { teacherDb } from '@/lib/supabase';
import type { Question, Quiz } from '@/lib/types';
import { friendly, useNow } from '@/lib/util';
import { play } from '@/lib/sound';

export default function PreviewPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <TeacherShell wide>{() => <Preview />}</TeacherShell>
    </Suspense>
  );
}

function Preview() {
  const router = useRouter();
  const id = useSearchParams().get('id');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [qs, setQs] = useState<Question[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [hostOpen, setHostOpen] = useState(false);
  const now = useNow(250, picked === null);

  useEffect(() => {
    if (!id) return;
    const db = teacherDb();
    Promise.all([
      db.from('quizzes').select('*').eq('id', id).single(),
      db.from('questions').select('*').eq('quiz_id', id).order('position'),
    ]).then(([a, b]) => {
      if (a.error || b.error) setError(friendly(a.error ?? b.error));
      else { setQuiz(a.data as Quiz); setQs(b.data as Question[]); }
    });
  }, [id]);

  const go = (n: number) => { setI(n); setPicked(null); setShowKey(false); setStartedAt(Date.now()); };

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!quiz) return <Spinner />;
  const q = qs[i];
  const left = q ? Math.max(0, q.time_limit - (now - startedAt) / 1000) : 0;
  const revealed = picked !== null || showKey || left <= 0;

  const stateFor = (k: number): TileState => {
    if (!revealed) return 'idle';
    if (q.options[k].is_correct) return 'correct';
    return k === picked ? 'incorrect' : 'dim';
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => router.push('/dashboard/')}>Dashboard</Button>
        <h1 className="text-2xl font-extrabold">Preview: {quiz.title}</h1>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => router.push(`/quiz/edit/?id=${quiz.id}`)}>Edit</Button>
          <Button variant="rocket" icon={<MonitorPlay className="size-4" />} disabled={!qs.length} onClick={() => setHostOpen(true)}>Host live game</Button>
        </div>
      </div>
      <p className="mb-4 text-sm font-semibold text-ink-soft">This is exactly what students will see. Tap an answer to try it — nothing is saved.</p>

      {!q ? <div className="card p-10 text-center font-bold">This quiz has no questions yet.</div> : (
        <div className="game-bg overflow-hidden rounded-3xl p-4 sm:p-8">
          <div className="mx-auto max-w-5xl">
            <div className="flex items-center justify-between text-white">
              <span className="rounded-full bg-white/15 px-3 py-1 font-extrabold">Question {i + 1} of {qs.length}</span>
              <span className="rounded-full bg-white/15 px-3 py-1 font-extrabold">{q.points ? `${q.points} pts` : 'Practice'}</span>
            </div>
            <div className="mt-4 flex items-start gap-4 rounded-3xl bg-white p-5 shadow-xl sm:p-7">
              <h2 className="flex-1 text-2xl font-extrabold leading-snug sm:text-4xl">{q.prompt}</h2>
              <TimerRing seconds={left} total={q.time_limit} size={84} />
            </div>
            {q.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={q.image_url} alt="" className="mx-auto mt-4 max-h-64 rounded-2xl bg-white object-contain p-2 shadow-lg" />
            )}
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {q.options.map((o, k) => (
                <AnswerTile key={k} type={q.type} index={k} text={o.text} imageUrl={o.image_url} size="xl" state={stateFor(k)}
                  onClick={picked === null && left > 0 ? () => { setPicked(k); play(o.is_correct ? 'correct' : 'wrong'); } : undefined} />
              ))}
            </div>
            {revealed && picked !== null && (
              <p className={`mt-5 text-center font-display text-3xl font-extrabold animate-pop ${q.options[picked].is_correct ? 'text-emerald-300' : 'text-rose-200'}`}>
                {q.options[picked].is_correct ? '🎉 Correct!' : '💪 Not quite — keep going!'}
              </p>
            )}
          </div>
        </div>
      )}

      {q && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button variant="secondary" icon={<ChevronLeft className="size-4" />} disabled={i === 0} onClick={() => go(i - 1)}>Previous</Button>
          <Button variant="secondary" icon={<Eye className="size-4" />} onClick={() => setShowKey(true)} disabled={revealed}>Show answer</Button>
          <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => go(i)}>Retry</Button>
          <Button icon={<ChevronRight className="size-4" />} disabled={i >= qs.length - 1} onClick={() => go(i + 1)}>Next</Button>
        </div>
      )}
      {hostOpen && <HostDialog open quizId={quiz.id} quizTitle={quiz.title} onClose={() => setHostOpen(false)} />}
    </div>
  );
}
