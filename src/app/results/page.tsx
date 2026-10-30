'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Download, FileSpreadsheet, Gamepad2, X } from 'lucide-react';
import { TeacherShell } from '@/components/TeacherShell';
import { ansStyle } from '@/components/game';
import { Badge, Button, ErrorBox, Modal, Spinner } from '@/components/ui';
import { teacherDb } from '@/lib/supabase';
import { buildReport, LETTERS, optionLabel, type StudentRow } from '@/lib/report';
import { exportWorkbook } from '@/lib/spreadsheet';
import type { Answer, GameSession, Participant, SessionQuestion } from '@/lib/types';
import { fmtSeconds, friendly } from '@/lib/util';

export default function ResultsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <TeacherShell>{() => <Results />}</TeacherShell>
    </Suspense>
  );
}

function Results() {
  const router = useRouter();
  const sessionId = useSearchParams().get('session');
  const [session, setSession] = useState<GameSession | null>(null);
  const [questions, setQuestions] = useState<SessionQuestion[]>([]);
  const [players, setPlayers] = useState<Participant[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'students' | 'questions'>('students');
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const db = teacherDb();
    Promise.all([
      db.from('game_sessions').select('*').eq('id', sessionId).single(),
      db.from('session_questions').select('*').eq('session_id', sessionId).order('idx'),
      db.from('participants').select('*').eq('session_id', sessionId),
      db.from('answers').select('*').eq('session_id', sessionId),
    ]).then(([s, q, p, a]) => {
      const err = s.error ?? q.error ?? p.error ?? a.error;
      if (err) { setError(friendly(err)); return; }
      setSession(s.data as GameSession); setQuestions(q.data as SessionQuestion[]);
      setPlayers(p.data as Participant[]); setAnswers(a.data as Answer[]);
    });
  }, [sessionId]);

  const report = useMemo(() => (session ? buildReport(questions, players, answers, session.current_index) : null), [session, questions, players, answers]);

  async function doExport(format: 'xlsx' | 'csv') {
    if (!session || !report) return;
    setExporting(format);
    const qs = report.questions;
    const studentsSheet = [
      ['Rank', 'Student', 'Score', 'Correct', 'Answered', 'Questions', 'Accuracy %', 'Avg time (s)', ...qs.map((q) => `Q${q.question.idx + 1}`)],
      ...report.students.map((s) => [
        s.rank, s.participant.nickname, s.score, s.correct, s.answered, report.questionsPlayed, s.accuracy,
        s.avgMs != null ? +(s.avgMs / 1000).toFixed(1) : null,
        ...qs.map((q) => { const a = s.byQuestion[q.question.idx]; return a ? `${q.question.type === 'true_false' ? q.question.options[a.option_index]?.text : LETTERS[a.option_index]}${a.is_correct ? ' ✓' : ' ✗'}` : '—'; }),
      ]),
    ];
    const questionsSheet = [
      ['#', 'Question', 'Correct answer', 'Answered', 'Correct', 'Accuracy %', 'Avg time (s)', 'A / True', 'B / False', 'C', 'D'],
      ...qs.map((q) => [
        q.question.idx + 1, q.question.prompt, q.correctIdx.map((i) => optionLabel(q.question, i)).join(', '),
        q.answered, q.correct, q.accuracy, q.avgMs != null ? +(q.avgMs / 1000).toFixed(1) : null,
        ...[0, 1, 2, 3].map((i) => (i < q.counts.length ? q.counts[i] : null)),
      ]),
    ];
    const byId = new Map(players.map((p) => [p.id, p]));
    const allSheet = [
      ['Student', 'Question #', 'Question', 'Answer', 'Correct?', 'Points', 'Time (s)', 'Submitted at'],
      ...answers.filter((a) => byId.get(a.participant_id)?.status === 'active').sort((a, b) => a.question_index - b.question_index || a.response_ms - b.response_ms).map((a) => {
        const q = questions.find((x) => x.idx === a.question_index);
        return [byId.get(a.participant_id)?.nickname ?? '', a.question_index + 1, q?.prompt ?? '', q ? optionLabel(q, a.option_index) : a.option_index,
          a.is_correct ? 'Yes' : 'No', a.points, +(a.response_ms / 1000).toFixed(1), new Date(a.created_at).toLocaleString()];
      }),
    ];
    const summary = [
      ['Quiz', session.quiz_title], ['Played', new Date(session.created_at).toLocaleString()],
      ['Mode', session.mode === 'timed' ? 'Timed live' : 'Teacher-paced'], ['Players', report.players],
      ['Questions played', report.questionsPlayed], ['Class accuracy %', report.accuracy], ['Average score', report.avgScore],
      ['Top student', report.students[0] ? `${report.students[0].participant.nickname} (${report.students[0].score})` : '—'],
    ];
    try {
      await exportWorkbook(`${session.quiz_title} results ${new Date(session.created_at).toISOString().slice(0, 10)}`, [
        { name: 'Students', rows: studentsSheet }, { name: 'Questions', rows: questionsSheet },
        { name: 'All answers', rows: allSheet }, { name: 'Summary', rows: summary },
      ], format);
    } catch (e) { setError(friendly(e)); }
    setExporting(null);
  }

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!session || !report) return <Spinner />;
  const top = report.students[0];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => router.push('/dashboard/')}>Dashboard</Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {session.status !== 'ended' && <Link href={`/host/?session=${session.id}`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-orange-50 px-4 font-extrabold text-rocket-dark"><Gamepad2 className="size-4" /> Back to live game</Link>}
          <Button variant="secondary" icon={<Download className="size-4" />} loading={exporting === 'csv'} onClick={() => doExport('csv')}>CSV</Button>
          <Button icon={<FileSpreadsheet className="size-4" />} loading={exporting === 'xlsx'} onClick={() => doExport('xlsx')}>Export to Excel</Button>
        </div>
      </div>

      <header className="mb-6">
        <h1 className="text-4xl font-extrabold">{session.quiz_title}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-ink-soft">
          <span>{new Date(session.created_at).toLocaleString()}</span>
          <Badge>{session.mode === 'timed' ? 'Timed live' : 'Teacher-paced'}</Badge>
          {session.status === 'ended' ? <Badge tone="green">Finished</Badge> : <Badge tone="orange">Still live (PIN {session.pin})</Badge>}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card label="Students joined" value={report.players} />
        <Card label="Questions played" value={`${report.questionsPlayed}/${session.question_count}`} />
        <Card label="Class accuracy" value={`${report.accuracy}%`} />
        <Card label="Average score" value={report.avgScore.toLocaleString()} />
        <Card label="Top student" value={top ? `${top.participant.avatar} ${top.participant.nickname}` : '—'} small />
      </div>

      <div className="my-6 inline-flex rounded-2xl bg-white p-1 shadow-sm ring-1 ring-brand-100" role="tablist">
        {(['students', 'questions'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 font-extrabold ${tab === t ? 'bg-brand-600 text-white' : 'text-ink-soft hover:bg-brand-50'}`}>
            {t === 'students' ? 'Students' : 'Question by question'}
          </button>
        ))}
      </div>

      {tab === 'students' && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="border-b border-brand-100 text-sm text-ink-soft">
              <tr>
                <th className="p-3">Rank</th><th className="p-3">Student</th><th className="p-3">Score</th><th className="p-3">Correct</th>
                <th className="p-3">Accuracy</th><th className="p-3">Avg time</th>
                {report.questions.map((q) => <th key={q.question.idx} className="p-2 text-center">Q{q.question.idx + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {report.students.map((s) => (
                <tr key={s.participant.id} className="cursor-pointer border-b border-brand-50 last:border-0 hover:bg-brand-50/60" onClick={() => setStudent(s)}>
                  <td className="p-3 font-display text-xl font-extrabold">{s.rank <= 3 ? ['🥇', '🥈', '🥉'][s.rank - 1] : s.rank}</td>
                  <td className="p-3 font-extrabold"><button className="text-left hover:underline">{s.participant.avatar} {s.participant.nickname}</button></td>
                  <td className="p-3 font-extrabold tabular-nums">{s.score.toLocaleString()}</td>
                  <td className="p-3 tabular-nums">{s.correct}/{report.questionsPlayed}</td>
                  <td className="p-3"><Meter value={s.accuracy} /></td>
                  <td className="p-3 tabular-nums">{fmtSeconds(s.avgMs)}</td>
                  {report.questions.map((q) => {
                    const a = s.byQuestion[q.question.idx];
                    return (
                      <td key={q.question.idx} className="p-2 text-center">
                        {!a ? <span className="text-slate-300" title="No answer">–</span> : a.is_correct
                          ? <Check className="mx-auto size-5 text-emerald-600" strokeWidth={3.5} aria-label="correct" />
                          : <X className="mx-auto size-5 text-ans-a" strokeWidth={3.5} aria-label="incorrect" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {report.students.length === 0 && <tr><td className="p-6 text-center font-bold text-ink-soft" colSpan={6}>No students joined this game.</td></tr>}
            </tbody>
          </table>
          <p className="px-3 pb-3 text-xs text-ink-soft">Click a student to see every answer they gave.</p>
        </div>
      )}

      {tab === 'questions' && (
        <ol className="space-y-4">
          {report.questions.map((q) => (
            <li key={q.question.idx} className="card p-5">
              <div className="flex flex-wrap items-start gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-brand-600 font-display font-extrabold text-white">{q.question.idx + 1}</span>
                <h2 className="flex-1 text-xl font-extrabold">{q.question.prompt}</h2>
                <Badge tone={q.accuracy >= 70 ? 'green' : q.accuracy >= 40 ? 'orange' : 'red'}>{q.accuracy}% correct</Badge>
              </div>
              <p className="mt-1 text-sm font-semibold text-ink-soft">
                {q.answered} of {report.players} answered · {q.correct} correct · {q.answered - q.correct} incorrect · avg {fmtSeconds(q.avgMs)}
                {q.accuracy < 50 && q.answered > 0 ? ' · 💡 worth re-teaching' : ''}
              </p>
              <div className="mt-4 space-y-2">
                {q.question.options.map((o, i) => {
                  const s = ansStyle(q.question.type, i);
                  const share = q.answered ? Math.round((q.counts[i] / q.answered) * 100) : 0;
                  const isC = q.correctIdx.includes(i);
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${s.bg} ${s.text}`}><s.Icon className="size-4" fill={q.question.type === 'true_false' ? 'none' : 'currentColor'} aria-hidden /></span>
                      <div className="relative h-9 flex-1 overflow-hidden rounded-lg bg-brand-50">
                        <div className={`absolute inset-y-0 left-0 ${isC ? 'bg-emerald-200' : 'bg-brand-100'}`} style={{ width: `${share}%` }} />
                        <span className="relative flex h-full items-center px-3 text-sm font-extrabold">{o.text || '(image)'}{isC && ' ✓'}</span>
                      </div>
                      <span className="w-24 text-right text-sm font-extrabold tabular-nums">{q.counts[i]} · {share}%</span>
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
          {report.questions.length === 0 && <p className="card p-6 text-center font-bold text-ink-soft">No questions were played yet.</p>}
        </ol>
      )}

      <Modal open={!!student} onClose={() => setStudent(null)} title={student ? `${student.participant.avatar} ${student.participant.nickname}` : ''} wide>
        {student && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card label="Rank" value={`#${student.rank}`} />
              <Card label="Score" value={student.score.toLocaleString()} />
              <Card label="Correct" value={`${student.correct}/${report.questionsPlayed}`} />
              <Card label="Avg time" value={fmtSeconds(student.avgMs)} />
            </div>
            <table className="mt-5 w-full text-left text-sm">
              <thead className="border-b border-brand-100 text-ink-soft"><tr><th className="p-2">#</th><th className="p-2">Question</th><th className="p-2">Their answer</th><th className="p-2">Result</th><th className="p-2">Time</th></tr></thead>
              <tbody>
                {report.questions.map((q) => {
                  const a = student.byQuestion[q.question.idx];
                  return (
                    <tr key={q.question.idx} className="border-b border-brand-50 align-top last:border-0">
                      <td className="p-2 font-extrabold">{q.question.idx + 1}</td>
                      <td className="p-2">{q.question.prompt}<div className="text-xs text-emerald-700">Correct: {q.correctIdx.map((i) => optionLabel(q.question, i)).join(', ')}</div></td>
                      <td className="p-2 font-bold">{a ? optionLabel(q.question, a.option_index) : <span className="text-slate-400">No answer</span>}</td>
                      <td className="p-2 font-extrabold">{a ? (a.is_correct ? <span className="text-emerald-600">✓ +{a.points}</span> : <span className="text-ans-a">✗ 0</span>) : '–'}</td>
                      <td className="p-2 tabular-nums">{a ? fmtSeconds(a.response_ms) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </Modal>
    </div>
  );
}

function Card({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="card p-4">
      <div className={`truncate font-display font-extrabold tabular-nums ${small ? 'text-xl' : 'text-3xl'}`}>{value}</div>
      <div className="text-sm font-bold text-ink-soft">{label}</div>
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 w-20 overflow-hidden rounded-full bg-brand-50">
        <div className={`h-full rounded-full ${value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-400' : 'bg-ans-a'}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-sm font-extrabold tabular-nums">{value}%</span>
    </div>
  );
}
