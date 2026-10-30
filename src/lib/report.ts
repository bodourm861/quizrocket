import type { Answer, Participant, SessionQuestion } from './types';
import { pct } from './util';

export interface StudentRow {
  participant: Participant;
  rank: number;
  score: number;
  answered: number;
  correct: number;
  accuracy: number;
  avgMs: number | null;
  byQuestion: Record<number, Answer | undefined>;
}

export interface QuestionRow {
  question: SessionQuestion;
  answered: number;
  correct: number;
  accuracy: number;
  counts: number[];
  avgMs: number | null;
  correctIdx: number[];
}

export interface Report {
  players: number;
  questionsPlayed: number;
  totalAnswers: number;
  accuracy: number;
  avgScore: number;
  students: StudentRow[];
  questions: QuestionRow[];
}

/** All analytics are derived from the real answers stored by the server. */
export function buildReport(questions: SessionQuestion[], participants: Participant[], answers: Answer[], playedThrough: number): Report {
  const active = participants.filter((p) => p.status === 'active');
  const activeIds = new Set(active.map((p) => p.id));
  const valid = answers.filter((a) => activeIds.has(a.participant_id));
  const played = questions.filter((q) => q.idx <= playedThrough);

  const qRows: QuestionRow[] = played.map((q) => {
    const qa = valid.filter((a) => a.question_index === q.idx);
    const counts = q.options.map((_, i) => qa.filter((a) => a.option_index === i).length);
    const correct = qa.filter((a) => a.is_correct).length;
    return {
      question: q,
      answered: qa.length,
      correct,
      accuracy: pct(correct, qa.length),
      counts,
      avgMs: qa.length ? qa.reduce((s, a) => s + a.response_ms, 0) / qa.length : null,
      correctIdx: q.options.map((o, i) => (o.is_correct ? i : -1)).filter((i) => i >= 0),
    };
  });

  const sorted = [...active].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
  const students: StudentRow[] = sorted.map((p) => {
    const mine = valid.filter((a) => a.participant_id === p.id);
    const correct = mine.filter((a) => a.is_correct).length;
    const byQuestion: Record<number, Answer> = {};
    mine.forEach((a) => { byQuestion[a.question_index] = a; });
    return {
      participant: p,
      rank: 1 + sorted.filter((o) => o.score > p.score).length,
      score: p.score,
      answered: mine.length,
      correct,
      accuracy: pct(correct, played.length),
      avgMs: mine.length ? mine.reduce((s, a) => s + a.response_ms, 0) / mine.length : null,
      byQuestion,
    };
  });

  const totalCorrect = valid.filter((a) => a.is_correct && a.question_index <= playedThrough).length;
  const possible = played.length * active.length;
  return {
    players: active.length,
    questionsPlayed: played.length,
    totalAnswers: valid.length,
    accuracy: pct(totalCorrect, possible),
    avgScore: active.length ? Math.round(active.reduce((s, p) => s + p.score, 0) / active.length) : 0,
    students,
    questions: qRows,
  };
}

export const LETTERS = ['A', 'B', 'C', 'D'];

export function optionLabel(q: SessionQuestion, i: number): string {
  const o = q.options[i];
  if (!o) return '–';
  return q.type === 'true_false' ? o.text : `${LETTERS[i]}: ${o.text || '(image)'}`;
}
