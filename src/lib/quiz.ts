import type { Question, QuestionOption, QuestionType } from './types';
import { uid } from './util';

export interface DraftQuestion {
  key: string;            // stable key for React; equals id once saved
  id?: string;
  type: QuestionType;
  prompt: string;
  image_url: string | null;
  time_limit: number;
  points: number;
  options: QuestionOption[];
}

export const TIME_CHOICES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
export const POINT_CHOICES = [
  { value: 0, label: 'No points (practice)' },
  { value: 500, label: '500 — half points' },
  { value: 1000, label: '1000 — standard' },
  { value: 2000, label: '2000 — double points' },
];

export function newQuestion(type: QuestionType = 'multiple_choice'): DraftQuestion {
  return {
    key: uid(),
    type,
    prompt: '',
    image_url: null,
    time_limit: 20,
    points: 1000,
    options: type === 'true_false'
      ? [{ text: 'True', is_correct: true }, { text: 'False', is_correct: false }]
      : [{ text: '', is_correct: true }, { text: '', is_correct: false }, { text: '', is_correct: false }, { text: '', is_correct: false }],
  };
}

export function toDraft(q: Question): DraftQuestion {
  return {
    key: q.id, id: q.id, type: q.type, prompt: q.prompt, image_url: q.image_url,
    time_limit: q.time_limit, points: q.points,
    options: q.options.map((o) => ({ text: o.text ?? '', image_url: o.image_url ?? null, is_correct: !!o.is_correct })),
  };
}

/** Options that will actually be saved (empty trailing answers are dropped). */
export function cleanOptions(q: DraftQuestion): QuestionOption[] {
  return q.options
    .filter((o) => q.type === 'true_false' || o.text.trim() !== '' || !!o.image_url)
    .map((o) => ({ text: o.text.trim(), image_url: o.image_url || null, is_correct: !!o.is_correct }));
}

export function questionProblem(q: DraftQuestion): string | null {
  if (!q.prompt.trim() && !q.image_url) return 'Write the question (or add an image).';
  const opts = cleanOptions(q);
  if (opts.length < 2) return 'Add at least 2 answers.';
  if (opts.length > 4) return 'Use at most 4 answers.';
  if (!opts.some((o) => o.is_correct)) return 'Mark at least one correct answer.';
  return null;
}
