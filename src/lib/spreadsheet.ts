'use client';
// CSV / Excel import of questions and export of results (SheetJS, loaded only when needed).
import type { DraftQuestion } from './quiz';
import { newQuestion, TIME_CHOICES } from './quiz';

type Row = Record<string, unknown>;

const TEMPLATE_HEADER = ['Type', 'Question', 'Answer A', 'Answer B', 'Answer C', 'Answer D', 'Correct', 'Time (sec)', 'Points', 'Image URL'];
const TEMPLATE_ROWS = [
  ['multiple_choice', 'What does mid– mean?', 'after', 'middle', 'before', '', 'B', 20, 1000, ''],
  ['true_false', '"Poster" has a real prefix.', '', '', '', '', 'False', 10, 1000, ''],
  ['multiple_choice', 'Which TWO prefixes mean "before"? (pick one)', 'fore–', 'post–', 'pre–', 'mid–', 'A,C', 30, 2000, ''],
];

function norm(k: string) { return k.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function pick(row: Row, ...names: string[]): string {
  for (const [k, v] of Object.entries(row)) {
    if (names.includes(norm(k))) return String(v ?? '').trim();
  }
  return '';
}

function nearestTime(n: number) {
  return TIME_CHOICES.reduce((best, t) => (Math.abs(t - n) < Math.abs(best - n) ? t : best), 20);
}

export interface ImportResult { questions: DraftQuestion[]; errors: string[] }

export async function importQuestions(file: File): Promise<ImportResult> {
  const XLSX = await import('xlsx');
  // CSV files are read as UTF-8 text so dashes, accents and Arabic text survive intact.
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  const wb = isCsv
    ? XLSX.read((await file.text()).replace(/^\uFEFF/, ''), { type: 'string' })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '' });
  const questions: DraftQuestion[] = [];
  const errors: string[] = [];

  rows.forEach((row, i) => {
    const line = i + 2; // + header row, 1-based
    const prompt = pick(row, 'question', 'prompt', 'questiontext');
    if (!prompt) { if (Object.values(row).some((v) => String(v).trim())) errors.push(`Row ${line}: missing question text`); return; }

    const typeRaw = pick(row, 'type', 'questiontype').toLowerCase();
    const correctRaw = pick(row, 'correct', 'correctanswer', 'answer', 'correctanswers');
    const isTF = typeRaw.startsWith('t') || typeRaw.includes('false') || (!pick(row, 'answera', 'option1', 'answer1', 'a') && /^(true|false|t|f)$/i.test(correctRaw));

    const q = newQuestion(isTF ? 'true_false' : 'multiple_choice');
    q.prompt = prompt.slice(0, 500);
    const img = pick(row, 'imageurl', 'image');
    if (/^https?:\/\//i.test(img)) q.image_url = img;
    const time = Number(pick(row, 'timesec', 'time', 'timelimit', 'seconds'));
    if (time > 0) q.time_limit = nearestTime(time);
    const pts = Number(pick(row, 'points', 'score'));
    if (Number.isFinite(pts) && pick(row, 'points', 'score') !== '') q.points = Math.max(0, Math.min(10000, Math.round(pts)));

    if (isTF) {
      const truthy = /^(true|t|yes|a|1)$/i.test(correctRaw);
      if (!/^(true|false|t|f|yes|no|a|b|1|2)$/i.test(correctRaw)) { errors.push(`Row ${line}: True/False needs Correct = True or False`); return; }
      q.options = [{ text: 'True', is_correct: truthy }, { text: 'False', is_correct: !truthy }];
    } else {
      const texts = [
        pick(row, 'answera', 'optiona', 'answer1', 'option1', 'a'),
        pick(row, 'answerb', 'optionb', 'answer2', 'option2', 'b'),
        pick(row, 'answerc', 'optionc', 'answer3', 'option3', 'c'),
        pick(row, 'answerd', 'optiond', 'answer4', 'option4', 'd'),
      ];
      const marks = correctRaw.toUpperCase().split(/[\s,;/&]+/).filter(Boolean)
        .map((c) => (/^[1-4]$/.test(c) ? Number(c) - 1 : 'ABCD'.indexOf(c)));
      const opts = texts.map((text, idx) => ({ text, image_url: null, is_correct: marks.includes(idx) }))
        .filter((o) => o.text !== '');
      if (opts.length < 2) { errors.push(`Row ${line}: needs at least 2 answers`); return; }
      if (!opts.some((o) => o.is_correct)) { errors.push(`Row ${line}: "Correct" must be A, B, C or D (or several, e.g. A,C)`); return; }
      q.options = opts;
    }
    questions.push(q);
  });

  if (rows.length === 0) errors.push('The file has no rows. Use the template to see the expected columns.');
  return { questions, errors };
}

export async function downloadTemplate(format: 'xlsx' | 'csv') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADER, ...TEMPLATE_ROWS]);
  ws['!cols'] = [{ wch: 16 }, { wch: 44 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 9 }, { wch: 10 }, { wch: 8 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  XLSX.writeFile(wb, `quiz-questions-template.${format}`, { bookType: format });
}

export interface SheetSpec { name: string; rows: (string | number | null)[][] }

export async function exportWorkbook(fileBase: string, sheets: SheetSpec[], format: 'xlsx' | 'csv') {
  const XLSX = await import('xlsx');
  const safe = fileBase.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'results';
  if (format === 'csv') {
    // CSV holds one table: export the first sheet (the per-student results)
    const ws = XLSX.utils.aoa_to_sheet(sheets[0].rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheets[0].name.slice(0, 31));
    XLSX.writeFile(wb, `${safe}.csv`, { bookType: 'csv' });
    return;
  }
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    ws['!cols'] = (s.rows[0] ?? []).map((_, i) => ({ wch: Math.min(48, Math.max(10, ...s.rows.map((r) => String(r[i] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${safe}.xlsx`, { bookType: 'xlsx' });
}
