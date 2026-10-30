'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import {
  ArrowDown, ArrowLeft, ArrowUp, Check, CircleCheck, CopyPlus, Eye, FileSpreadsheet, ListChecks, MonitorPlay, Plus, Save, ToggleLeft, Trash2, Upload, X,
} from 'lucide-react';
import { TeacherShell } from '@/components/TeacherShell';
import { HostDialog } from '@/components/HostDialog';
import { ImageUpload } from '@/components/ImageUpload';
import { ansStyle } from '@/components/game';
import { Button, ErrorBox, Field, inputCls, Modal, Spinner, Toast } from '@/components/ui';
import { teacherDb } from '@/lib/supabase';
import { cleanOptions, newQuestion, POINT_CHOICES, questionProblem, TIME_CHOICES, toDraft, type DraftQuestion } from '@/lib/quiz';
import { downloadTemplate, importQuestions } from '@/lib/spreadsheet';
import type { Question, QuestionType, Quiz } from '@/lib/types';
import { friendly, uid } from '@/lib/util';

interface Meta { title: string; description: string; grade: string; subject: string; lesson: string; topic: string; cover_image: string | null }
const EMPTY_META: Meta = { title: '', description: '', grade: '', subject: '', lesson: '', topic: '', cover_image: null };
const GRADES = ['Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];
const SUBJECTS = ['English', 'Math', 'Science', 'Social Studies', 'Arabic', 'Islamic Studies', 'Art', 'Music', 'PE', 'Computer Science'];

export default function EditPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <TeacherShell>{(user) => <Editor user={user} />}</TeacherShell>
    </Suspense>
  );
}

function Editor({ user }: { user: User }) {
  const router = useRouter();
  const params = useSearchParams();
  const idParam = params.get('id');
  const [quizId, setQuizId] = useState<string | null>(idParam);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [loading, setLoading] = useState(!!idParam);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const savedIds = useRef<string[]>([]);

  useEffect(() => {
    if (!idParam) { setQuestions([newQuestion()]); return; }
    (async () => {
      const db = teacherDb();
      const [{ data: quiz, error: e1 }, { data: qs, error: e2 }] = await Promise.all([
        db.from('quizzes').select('*').eq('id', idParam).single(),
        db.from('questions').select('*').eq('quiz_id', idParam).order('position'),
      ]);
      if (e1 || e2) { setError(friendly(e1 ?? e2)); setLoading(false); return; }
      const q = quiz as Quiz;
      setMeta({ title: q.title, description: q.description ?? '', grade: q.grade ?? '', subject: q.subject ?? '', lesson: q.lesson ?? '', topic: q.topic ?? '', cover_image: q.cover_image });
      const drafts = (qs as Question[]).map(toDraft);
      savedIds.current = drafts.map((d) => d.id!);
      setQuestions(drafts.length ? drafts : [newQuestion()]);
      setLoading(false);
    })();
  }, [idParam]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const touch = () => setDirty(true);
  const setM = (patch: Partial<Meta>) => { setMeta((m) => ({ ...m, ...patch })); touch(); };
  const updateQ = useCallback((key: string, patch: Partial<DraftQuestion>) => {
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q))); setDirty(true);
  }, []);
  const move = (i: number, d: number) => {
    setQuestions((qs) => { const a = [...qs]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; }); touch();
  };
  const dup = (i: number) => {
    setQuestions((qs) => { const a = [...qs]; a.splice(i + 1, 0, { ...structuredClone(qs[i]), key: uid(), id: undefined }); return a; }); touch();
  };
  const del = (i: number) => { setQuestions((qs) => qs.filter((_, j) => j !== i)); touch(); };
  const add = (type: QuestionType) => {
    setQuestions((qs) => [...qs, newQuestion(type)]); touch();
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
  };

  async function save(): Promise<string | null> {
    setError(null);
    if (!meta.title.trim()) { setError('Give your quiz a title.'); window.scrollTo({ top: 0, behavior: 'smooth' }); return null; }
    const probs: Record<string, string> = {};
    questions.forEach((q) => { const p = questionProblem(q); if (p) probs[q.key] = p; });
    setProblems(probs);
    if (Object.keys(probs).length) {
      setError(`Please fix ${Object.keys(probs).length} question${Object.keys(probs).length > 1 ? 's' : ''} marked in red.`);
      document.getElementById(`q-${Object.keys(probs)[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return null;
    }
    setSaving(true);
    const db = teacherDb();
    try {
      const row = {
        title: meta.title.trim().slice(0, 150), description: meta.description.trim() || null, grade: meta.grade.trim() || null,
        subject: meta.subject.trim() || null, lesson: meta.lesson.trim() || null, topic: meta.topic.trim() || null, cover_image: meta.cover_image,
      };
      let id = quizId;
      if (id) {
        const { error } = await db.from('quizzes').update(row).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await db.from('quizzes').insert(row).select().single();
        if (error) throw error;
        id = (data as Quiz).id;
      }
      const withIds = questions.map((q) => ({ ...q, id: q.id ?? uid() }));
      if (withIds.length) {
        const { error } = await db.from('questions').upsert(withIds.map((q, position) => ({
          id: q.id, quiz_id: id, position, type: q.type, prompt: q.prompt.trim(), image_url: q.image_url,
          time_limit: q.time_limit, points: q.points, options: cleanOptions(q),
        })));
        if (error) throw error;
      }
      const keep = new Set(withIds.map((q) => q.id));
      const removed = savedIds.current.filter((x) => !keep.has(x));
      if (removed.length) {
        const { error } = await db.from('questions').delete().in('id', removed);
        if (error) throw error;
      }
      savedIds.current = withIds.map((q) => q.id);
      setQuestions(withIds.map((q) => ({ ...q, key: q.key })));
      setDirty(false);
      setToast('Saved ✓');
      if (!quizId) { setQuizId(id); router.replace(`/quiz/edit/?id=${id}`); }
      return id;
    } catch (e) {
      setError(friendly(e));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveThen(next: (id: string) => void) {
    const id = dirty || !quizId ? await save() : quizId;
    if (id) next(id);
  }

  if (loading) return <Spinner />;

  return (
    <div className="pb-28">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => router.push('/dashboard/')}>Dashboard</Button>
        <span className="text-sm font-bold text-ink-soft" aria-live="polite">{dirty ? '● Unsaved changes' : quizId ? '✓ All changes saved' : ''}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Eye className="size-4" />} onClick={() => saveThen((id) => router.push(`/quiz/preview/?id=${id}`))}>Preview</Button>
          <Button icon={<Save className="size-4" />} loading={saving} onClick={save}>Save</Button>
          <Button variant="rocket" icon={<MonitorPlay className="size-4" />} onClick={() => saveThen(() => setHostOpen(true))}>Host live</Button>
        </div>
      </div>

      <ErrorBox>{error}</ErrorBox>

      <section className="card mt-4 grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_260px]" aria-label="Quiz details">
        <div className="grid gap-4">
          <Field label="Quiz title">
            <input className={`${inputCls} text-xl`} placeholder="e.g. Prefix Quiz Show" value={meta.title} maxLength={150} onChange={(e) => setM({ title: e.target.value })} />
          </Field>
          <Field label="Description (optional)">
            <input className={inputCls} placeholder="What is this quiz about?" value={meta.description} onChange={(e) => setM({ description: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Grade"><input list="grades" className={inputCls} value={meta.grade} onChange={(e) => setM({ grade: e.target.value })} placeholder="Grade 4" /></Field>
            <Field label="Subject"><input list="subjects" className={inputCls} value={meta.subject} onChange={(e) => setM({ subject: e.target.value })} placeholder="English" /></Field>
            <Field label="Lesson"><input className={inputCls} value={meta.lesson} onChange={(e) => setM({ lesson: e.target.value })} placeholder="Unit 2 · Lesson 3" /></Field>
            <Field label="Topic"><input className={inputCls} value={meta.topic} onChange={(e) => setM({ topic: e.target.value })} placeholder="Prefixes" /></Field>
          </div>
          <datalist id="grades">{GRADES.map((g) => <option key={g} value={g} />)}</datalist>
          <datalist id="subjects">{SUBJECTS.map((g) => <option key={g} value={g} />)}</datalist>
        </div>
        <Field label="Cover image (optional)">
          <ImageUpload value={meta.cover_image} onChange={(url) => setM({ cover_image: url })} userId={user.id} label="Add cover" />
        </Field>
      </section>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-extrabold">Questions <span className="text-ink-soft">({questions.length})</span></h2>
        <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => setImportOpen(true)}>Import from CSV / Excel</Button>
      </div>

      <ol className="mt-4 space-y-5">
        {questions.map((q, i) => (
          <QuestionCard key={q.key} q={q} index={i} total={questions.length} userId={user.id} problem={problems[q.key]}
            onChange={(patch) => updateQ(q.key, patch)} onMove={(d) => move(i, d)} onDuplicate={() => dup(i)} onDelete={() => del(i)} />
        ))}
      </ol>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button onClick={() => add('multiple_choice')} className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-white p-5 font-extrabold text-brand-600 hover:bg-brand-50">
          <ListChecks className="size-5" /> Add multiple choice
        </button>
        <button onClick={() => add('true_false')} className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-white p-5 font-extrabold text-brand-600 hover:bg-brand-50">
          <ToggleLeft className="size-5" /> Add true / false
        </button>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-brand-100 bg-white/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-end gap-3">
            <span className="text-sm font-bold text-ink-soft">You have unsaved changes</span>
            <Button icon={<Save className="size-4" />} loading={saving} onClick={save}>Save quiz</Button>
          </div>
        </div>
      )}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)}
        onImport={(qs) => {
          setQuestions((cur) => [...cur.filter((c) => c.prompt.trim() || c.id), ...qs]); touch();
          setToast(`Imported ${qs.length} question${qs.length === 1 ? '' : 's'} — remember to save`);
        }} />
      {quizId && hostOpen && <HostDialog open quizId={quizId} quizTitle={meta.title} onClose={() => setHostOpen(false)} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function QuestionCard({ q, index, total, userId, problem, onChange, onMove, onDuplicate, onDelete }: {
  q: DraftQuestion; index: number; total: number; userId: string; problem?: string;
  onChange: (p: Partial<DraftQuestion>) => void; onMove: (d: number) => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const setOpt = (i: number, patch: Partial<DraftQuestion['options'][number]>) =>
    onChange({ options: q.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const toggleCorrect = (i: number) =>
    onChange({ options: q.options.map((o, j) => (q.type === 'true_false' ? { ...o, is_correct: j === i } : j === i ? { ...o, is_correct: !o.is_correct } : o)) });
  const switchType = (type: QuestionType) => {
    if (type === q.type) return;
    const fresh = newQuestion(type);
    onChange({ type, options: type === 'true_false' ? fresh.options : fresh.options });
  };

  return (
    <li id={`q-${q.key}`} className={`card p-4 sm:p-5 ${problem ? 'ring-2 ring-red-300' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-brand-600 font-display text-lg font-extrabold text-white">{index + 1}</span>
        <div className="inline-flex rounded-xl bg-brand-50 p-1" role="radiogroup" aria-label="Question type">
          {(['multiple_choice', 'true_false'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={q.type === t} onClick={() => switchType(t)}
              className={`rounded-lg px-3 py-1 text-sm font-extrabold ${q.type === t ? 'bg-white text-brand-700 shadow' : 'text-ink-soft'}`}>
              {t === 'multiple_choice' ? 'Multiple choice' : 'True / False'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <select aria-label="Time limit" className="h-9 rounded-lg border-2 border-brand-100 bg-white px-2 text-sm font-bold" value={q.time_limit}
            onChange={(e) => onChange({ time_limit: Number(e.target.value) })}>
            {TIME_CHOICES.map((t) => <option key={t} value={t}>⏱ {t < 60 ? `${t} sec` : `${t / 60} min`}</option>)}
          </select>
          <select aria-label="Points" className="h-9 rounded-lg border-2 border-brand-100 bg-white px-2 text-sm font-bold" value={q.points}
            onChange={(e) => onChange({ points: Number(e.target.value) })}>
            {POINT_CHOICES.some((p) => p.value === q.points) ? null : <option value={q.points}>{q.points} pts</option>}
            {POINT_CHOICES.map((p) => <option key={p.value} value={p.value}>★ {p.label}</option>)}
          </select>
          <SmallBtn label="Move up" onClick={() => onMove(-1)} disabled={index === 0}><ArrowUp className="size-4" /></SmallBtn>
          <SmallBtn label="Move down" onClick={() => onMove(1)} disabled={index === total - 1}><ArrowDown className="size-4" /></SmallBtn>
          <SmallBtn label="Duplicate question" onClick={onDuplicate}><CopyPlus className="size-4" /></SmallBtn>
          <SmallBtn label="Delete question" onClick={onDelete} danger><Trash2 className="size-4" /></SmallBtn>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px]">
        <Field label="Question">
          <textarea rows={3} className={`${inputCls} resize-y text-lg`} placeholder="Type your question…" value={q.prompt} maxLength={500}
            onChange={(e) => onChange({ prompt: e.target.value })} />
        </Field>
        <Field label="Question image">
          <ImageUpload value={q.image_url} onChange={(url) => onChange({ image_url: url })} userId={userId} />
        </Field>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-extrabold">Answers <span className="font-semibold text-ink-soft">— tick the correct one{q.type === 'multiple_choice' ? '(s)' : ''}</span></legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {q.options.map((o, i) => {
            const s = ansStyle(q.type, i);
            return (
              <div key={i} className={`flex items-center gap-2 rounded-2xl border-2 p-2 ${o.is_correct ? 'border-emerald-400 bg-emerald-50' : 'border-brand-100 bg-white'}`}>
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${s.bg} ${s.text}`} aria-hidden>
                  <s.Icon className="size-5" fill={q.type === 'true_false' ? 'none' : 'currentColor'} />
                </span>
                {q.type === 'true_false' ? (
                  <span className="flex-1 px-1 text-lg font-extrabold">{o.text}</span>
                ) : (
                  <input className="min-w-0 flex-1 rounded-lg px-2 py-2 font-bold focus:bg-white focus:outline-none" placeholder={`Answer ${s.letter}${i >= 2 ? ' (optional)' : ''}`}
                    value={o.text} maxLength={120} onChange={(e) => setOpt(i, { text: e.target.value })} aria-label={`Answer ${s.letter}`} />
                )}
                {q.type === 'multiple_choice' && (
                  <ImageUpload compact value={o.image_url ?? null} onChange={(url) => setOpt(i, { image_url: url })} userId={userId} label={`Image for answer ${s.letter}`} />
                )}
                <button type="button" onClick={() => toggleCorrect(i)} aria-pressed={!!o.is_correct} aria-label={`Mark answer ${s.letter} correct`}
                  className={`grid size-10 shrink-0 place-items-center rounded-full border-2 transition ${o.is_correct ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-slate-300 hover:border-emerald-400 hover:text-emerald-400'}`}>
                  <Check className="size-5" strokeWidth={3.5} />
                </button>
                {q.type === 'multiple_choice' && q.options.length > 2 && (
                  <button type="button" onClick={() => onChange({ options: q.options.filter((_, j) => j !== i) })} aria-label={`Remove answer ${s.letter}`}
                    className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-ans-a"><X className="size-4" /></button>
                )}
              </div>
            );
          })}
        </div>
        {q.type === 'multiple_choice' && q.options.length < 4 && (
          <button type="button" onClick={() => onChange({ options: [...q.options, { text: '', is_correct: false }] })}
            className="mt-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-extrabold text-brand-600 hover:bg-brand-50">
            <Plus className="size-4" /> Add answer
          </button>
        )}
      </fieldset>
      {problem && <p className="mt-3 text-sm font-extrabold text-red-600" role="alert">⚠ {problem}</p>}
    </li>
  );
}

function SmallBtn({ label, onClick, children, disabled, danger }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className={`grid size-9 place-items-center rounded-lg disabled:opacity-30 ${danger ? 'text-ans-a hover:bg-red-50' : 'text-ink-soft hover:bg-brand-50'}`}>
      {children}
    </button>
  );
}

function ImportDialog({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (qs: DraftQuestion[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ questions: DraftQuestion[]; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function pick(file: File) {
    setBusy(true); setError(null); setResult(null);
    try { setResult(await importQuestions(file)); } catch (e) { setError(`Could not read that file: ${friendly(e)}`); }
    setBusy(false);
    if (input.current) input.current.value = '';
  }
  const close = () => { setResult(null); setError(null); onClose(); };

  return (
    <Modal open={open} onClose={close} title="Import questions" wide>
      <p className="text-ink-soft">Upload a <b>.csv</b> or <b>.xlsx</b> file with one question per row. Columns:</p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-brand-100">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-brand-50"><tr>{['Type', 'Question', 'Answer A', 'Answer B', 'Answer C', 'Answer D', 'Correct', 'Time (sec)', 'Points', 'Image URL'].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
          <tbody>
            <tr className="border-t border-brand-50"><td className="px-2 py-1.5">multiple_choice</td><td className="px-2">What does mid– mean?</td><td className="px-2">after</td><td className="px-2">middle</td><td className="px-2">before</td><td className="px-2"></td><td className="px-2">B</td><td className="px-2">20</td><td className="px-2">1000</td><td className="px-2"></td></tr>
            <tr className="border-t border-brand-50"><td className="px-2 py-1.5">true_false</td><td className="px-2">Poster has a real prefix.</td><td className="px-2" colSpan={4}></td><td className="px-2">False</td><td className="px-2">10</td><td className="px-2">1000</td><td className="px-2"></td></tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-soft">“Correct” is A–D (several allowed, e.g. A,C) or True/False. Time, Points and Image URL are optional.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input ref={input} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
          onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        <Button icon={<Upload className="size-4" />} loading={busy} onClick={() => input.current?.click()}>Choose file…</Button>
        <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => downloadTemplate('xlsx')}>Excel template</Button>
        <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => downloadTemplate('csv')}>CSV template</Button>
      </div>
      <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>
      {result && (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-2 font-extrabold text-emerald-700"><CircleCheck className="size-5" /> {result.questions.length} question{result.questions.length === 1 ? '' : 's'} ready to add</p>
          {result.errors.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-extrabold">Skipped rows:</p>
              <ul className="mt-1 list-disc pl-5">{result.errors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}</ul>
              {result.errors.length > 12 && <p>…and {result.errors.length - 12} more</p>}
            </div>
          )}
          <ol className="max-h-56 list-decimal overflow-y-auto rounded-xl border border-brand-100 py-2 pl-8 pr-3 text-sm">
            {result.questions.map((q) => <li key={q.key} className="py-0.5"><b>{q.prompt}</b> <span className="text-ink-soft">— {q.options.map((o) => `${o.is_correct ? '✓' : ''}${o.text}`).join(' · ')}</span></li>)}
          </ol>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="rocket" disabled={!result.questions.length} onClick={() => { onImport(result.questions); close(); }}>Add {result.questions.length} questions</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
