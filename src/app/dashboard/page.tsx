'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChartColumn, CopyPlus, Eye, Gamepad2, MonitorPlay, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { TeacherShell } from '@/components/TeacherShell';
import { HostDialog } from '@/components/HostDialog';
import { Badge, Button, ErrorBox, inputCls, Modal, Spinner, Toast } from '@/components/ui';
import { teacherDb } from '@/lib/supabase';
import type { GameSession, Question, Quiz } from '@/lib/types';
import { friendly } from '@/lib/util';

type QuizRow = Quiz & { questions: { count: number }[] };
type SessionRow = Pick<GameSession, 'id' | 'quiz_title' | 'pin' | 'mode' | 'status' | 'created_at' | 'ended_at' | 'question_count' | 'current_index'> & { participants: { count: number }[] };

export default function DashboardPage() {
  return <TeacherShell>{() => <Dashboard />}</TeacherShell>;
}

function Dashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<'quizzes' | 'reports'>('quizzes');
  const [quizzes, setQuizzes] = useState<QuizRow[] | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [hosting, setHosting] = useState<QuizRow | null>(null);
  const [deleting, setDeleting] = useState<QuizRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = teacherDb();
    const [q, s] = await Promise.all([
      db.from('quizzes').select('*, questions(count)').order('updated_at', { ascending: false }),
      db.from('game_sessions')
        .select('id, quiz_title, pin, mode, status, created_at, ended_at, question_count, current_index, participants(count)')
        .order('created_at', { ascending: false }).limit(200),
    ]);
    if (q.error) setError(friendly(q.error)); else setQuizzes(q.data as QuizRow[]);
    if (s.error) setError(friendly(s.error)); else setSessions(s.data as SessionRow[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const grades = useMemo(() => [...new Set((quizzes ?? []).map((q) => q.grade).filter(Boolean))].sort() as string[], [quizzes]);
  const subjects = useMemo(() => [...new Set((quizzes ?? []).map((q) => q.subject).filter(Boolean))].sort() as string[], [quizzes]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (quizzes ?? []).filter((q) =>
      (!grade || q.grade === grade) && (!subject || q.subject === subject) &&
      (!term || [q.title, q.lesson, q.topic, q.description].some((v) => v?.toLowerCase().includes(term))));
  }, [quizzes, search, grade, subject]);

  async function duplicate(q: QuizRow) {
    setBusyId(q.id);
    const db = teacherDb();
    try {
      const { data: qs, error: e1 } = await db.from('questions').select('*').eq('quiz_id', q.id).order('position');
      if (e1) throw e1;
      const { data: copy, error: e2 } = await db.from('quizzes').insert({
        title: `${q.title} (copy)`.slice(0, 150), description: q.description, grade: q.grade, subject: q.subject,
        lesson: q.lesson, topic: q.topic, cover_image: q.cover_image,
      }).select().single();
      if (e2) throw e2;
      if (qs?.length) {
        const { error: e3 } = await db.from('questions').insert((qs as Question[]).map((x) => ({
          quiz_id: copy.id, position: x.position, type: x.type, prompt: x.prompt, image_url: x.image_url,
          time_limit: x.time_limit, points: x.points, options: x.options,
        })));
        if (e3) throw e3;
      }
      setToast('Quiz duplicated');
      await load();
    } catch (e) { setError(friendly(e)); } finally { setBusyId(null); }
  }

  async function remove(q: QuizRow) {
    const { error } = await teacherDb().from('quizzes').delete().eq('id', q.id);
    setDeleting(null);
    if (error) setError(friendly(error)); else { setToast('Quiz deleted'); load(); }
  }

  async function removeSession(id: string) {
    if (!confirm('Delete this game report? Student results for this game will be removed.')) return;
    const { error } = await teacherDb().from('game_sessions').delete().eq('id', id);
    if (error) setError(friendly(error)); else load();
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold">Your classroom games</h1>
          <p className="text-ink-soft">Create a quiz, host it live, and share the link in your Teams chat.</p>
        </div>
        <Button variant="rocket" size="lg" icon={<Plus className="size-5" />} onClick={() => router.push('/quiz/edit/')}>New quiz</Button>
      </div>

      <div className="mb-5 inline-flex rounded-2xl bg-white p-1 shadow-sm ring-1 ring-brand-100" role="tablist">
        {(['quizzes', 'reports'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 font-extrabold transition ${tab === t ? 'bg-brand-600 text-white' : 'text-ink-soft hover:bg-brand-50'}`}>
            {t === 'quizzes' ? `My quizzes${quizzes ? ` (${quizzes.length})` : ''}` : `Game reports${sessions ? ` (${sessions.length})` : ''}`}
          </button>
        ))}
      </div>

      <ErrorBox>{error}</ErrorBox>

      {tab === 'quizzes' && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <label className="relative">
              <span className="sr-only">Search quizzes</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input className={`${inputCls} pl-9`} placeholder="Search title, lesson or topic…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <select aria-label="Filter by grade" className={inputCls} value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">All grades</option>{grades.map((g) => <option key={g}>{g}</option>)}
            </select>
            <select aria-label="Filter by subject" className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">All subjects</option>{subjects.map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>

          {!quizzes ? <Spinner /> : quizzes.length === 0 ? (
            <div className="card flex flex-col items-center p-10 text-center">
              <div className="text-6xl" aria-hidden>📝</div>
              <h2 className="mt-3 text-2xl font-extrabold">Make your first quiz</h2>
              <p className="mt-1 max-w-md text-ink-soft">Type questions in, or import them from a CSV/Excel file. Tip: the README includes a ready-made prefix quiz you can import.</p>
              <Button className="mt-5" variant="rocket" icon={<Plus className="size-5" />} onClick={() => router.push('/quiz/edit/')}>Create a quiz</Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((q) => {
                const n = q.questions?.[0]?.count ?? 0;
                return (
                  <article key={q.id} className="card flex flex-col overflow-hidden">
                    <div className="relative h-28 bg-gradient-to-br from-brand-500 to-brand-700">
                      {q.cover_image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={q.cover_image} alt="" className="size-full object-cover" />
                      )}
                      <span className="absolute bottom-2 left-3 rounded-lg bg-white/95 px-2 py-0.5 text-sm font-extrabold">{n} question{n === 1 ? '' : 's'}</span>
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <h2 className="line-clamp-2 text-xl font-extrabold leading-tight">{q.title}</h2>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {q.grade && <Badge>{q.grade}</Badge>}
                        {q.subject && <Badge tone="orange">{q.subject}</Badge>}
                        {q.lesson && <Badge tone="green">{q.lesson}</Badge>}
                        {q.topic && <Badge tone="gray">{q.topic}</Badge>}
                      </div>
                      <p className="mt-2 text-xs font-semibold text-slate-400">Edited {new Date(q.updated_at).toLocaleDateString()}</p>
                      <div className="mt-auto pt-4">
                        <Button variant="rocket" className="w-full" icon={<MonitorPlay className="size-5" />} disabled={n === 0}
                          title={n === 0 ? 'Add questions first' : undefined} onClick={() => setHosting(q)}>Host live game</Button>
                        <div className="mt-2 grid grid-cols-4 gap-1">
                          <IconBtn label="Edit" onClick={() => router.push(`/quiz/edit/?id=${q.id}`)}><Pencil className="size-4" /></IconBtn>
                          <IconBtn label="Preview" onClick={() => router.push(`/quiz/preview/?id=${q.id}`)}><Eye className="size-4" /></IconBtn>
                          <IconBtn label="Duplicate" onClick={() => duplicate(q)} disabled={busyId === q.id}><CopyPlus className="size-4" /></IconBtn>
                          <IconBtn label="Delete" onClick={() => setDeleting(q)} danger><Trash2 className="size-4" /></IconBtn>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              {filtered.length === 0 && <p className="col-span-full py-10 text-center font-bold text-ink-soft">No quizzes match those filters.</p>}
            </div>
          )}
        </>
      )}

      {tab === 'reports' && (!sessions ? <Spinner /> : sessions.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-6xl" aria-hidden>📊</div>
          <h2 className="mt-3 text-2xl font-extrabold">No games yet</h2>
          <p className="text-ink-soft">After you host a game, its full results appear here.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead className="border-b border-brand-100 text-sm text-ink-soft">
              <tr><th className="p-3">Game</th><th className="p-3">Date</th><th className="p-3">Mode</th><th className="p-3">Players</th><th className="p-3">Status</th><th className="p-3"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const live = s.status !== 'ended';
                return (
                  <tr key={s.id} className="border-b border-brand-50 last:border-0">
                    <td className="p-3 font-extrabold">{s.quiz_title}</td>
                    <td className="p-3 text-sm">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="p-3 text-sm">{s.mode === 'timed' ? 'Timed' : 'Teacher-paced'}</td>
                    <td className="p-3 font-bold">{s.participants?.[0]?.count ?? 0}</td>
                    <td className="p-3">{live ? <Badge tone="orange">Live · PIN {s.pin}</Badge> : <Badge tone="green">Finished</Badge>}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        {live && <Link className="rounded-lg px-2.5 py-1.5 text-sm font-extrabold text-rocket-dark hover:bg-orange-50" href={`/host/?session=${s.id}`}><Gamepad2 className="mr-1 inline size-4" />Return to game</Link>}
                        <Link className="rounded-lg px-2.5 py-1.5 text-sm font-extrabold text-brand-600 hover:bg-brand-50" href={`/results/?session=${s.id}`}><ChartColumn className="mr-1 inline size-4" />Results</Link>
                        <button className="rounded-lg p-1.5 text-ans-a hover:bg-red-50" aria-label="Delete report" onClick={() => removeSession(s.id)}><Trash2 className="size-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {hosting && <HostDialog open quizId={hosting.id} quizTitle={hosting.title} onClose={() => setHosting(null)} />}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete this quiz?">
        <p className="text-ink-soft">“{deleting?.title}” and its questions will be deleted. Reports of games you already played are kept.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => deleting && remove(deleting)} icon={<Trash2 className="size-4" />}>Delete quiz</Button>
        </div>
      </Modal>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function IconBtn({ label, onClick, children, danger, disabled }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className={`flex h-10 flex-col items-center justify-center rounded-lg text-[11px] font-extrabold disabled:opacity-40 ${danger ? 'text-ans-a hover:bg-red-50' : 'text-ink-soft hover:bg-brand-50 hover:text-ink'}`}>
      {children}<span>{label}</span>
    </button>
  );
}
