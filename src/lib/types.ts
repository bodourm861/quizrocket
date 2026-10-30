export type QuestionType = 'multiple_choice' | 'true_false';
export type GameMode = 'teacher_paced' | 'timed';
export type GameStatus = 'lobby' | 'ready' | 'question' | 'closed' | 'revealed' | 'results' | 'leaderboard' | 'ended';

export interface QuestionOption {
  text: string;
  image_url?: string | null;
  is_correct?: boolean;
}

export interface Quiz {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  grade: string | null;
  subject: string | null;
  lesson: string | null;
  topic: string | null;
  cover_image: string | null;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  quiz_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  image_url: string | null;
  time_limit: number;
  points: number;
  options: QuestionOption[];
}

/** What students receive: no answer key. */
export interface PublicQuestion {
  index: number;
  total: number;
  type: QuestionType;
  prompt: string;
  image_url: string | null;
  time_limit: number;
  points: number;
  options: { text: string; image_url: string | null }[];
}

export interface Reveal { index: number; correct: number[] }

export interface QuestionResults {
  index: number;
  players: number;
  answered: number;
  correct: number;
  avg_ms: number;
  counts: number[];
}

export interface LeaderboardEntry {
  participant_id: string;
  nickname: string;
  avatar: string;
  score: number;
  correct: number;
  streak: number;
  rank: number;
}

export interface GameSession {
  id: string;
  quiz_id: string | null;
  host_id: string;
  quiz_title: string;
  pin: string;
  mode: GameMode;
  status: GameStatus;
  locked: boolean;
  paused: boolean;
  paused_at: string | null;
  paused_remaining_ms: number | null;
  current_index: number;
  question_count: number;
  question_started_at: string | null;
  question_deadline: string | null;
  scored_through: number;
  current_question: PublicQuestion | null;
  reveal: Reveal | null;
  results: QuestionResults | null;
  leaderboard: LeaderboardEntry[] | null;
  next_pin: string | null;
  version: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface SessionQuestion {
  session_id: string;
  idx: number;
  question_id: string | null;
  type: QuestionType;
  prompt: string;
  image_url: string | null;
  time_limit: number;
  points: number;
  options: QuestionOption[];
}

export interface Participant {
  id: string;
  session_id: string;
  user_id: string;
  nickname: string;
  avatar: string;
  score: number;
  correct_count: number;
  streak: number;
  status: 'active' | 'removed' | 'blocked';
  joined_at: string;
}

export interface Answer {
  id: string;
  session_id: string;
  participant_id: string;
  question_index: number;
  option_index: number;
  is_correct: boolean;
  points: number;
  response_ms: number;
  created_at: string;
}

export interface MyStatus {
  joined: boolean;
  participant_id?: string;
  nickname?: string;
  avatar?: string;
  status?: 'active' | 'removed' | 'blocked';
  score?: number;
  correct_count?: number;
  streak?: number;
  rank?: number;
  players?: number;
  question_index?: number;
  answered?: boolean;
  my_option?: number | null;
  is_correct?: boolean | null;
  points?: number | null;
}
