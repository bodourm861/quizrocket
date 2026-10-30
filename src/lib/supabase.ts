'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** False until .env.local (or the hosting provider's env vars) are filled in. */
export const supabaseConfigured = URL.startsWith('http') && KEY.length > 20;

let teacher: SupabaseClient | undefined;
let student: SupabaseClient | undefined;

/** Teacher sessions (email + password). */
export function teacherDb(): SupabaseClient {
  if (!teacher) {
    teacher = createClient(URL, KEY, {
      auth: { storageKey: 'qr-teacher-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 30 } },
    });
  }
  return teacher;
}

/**
 * Student sessions use a separate, anonymous Supabase identity stored under a different key,
 * so a teacher can open the student link in another tab without mixing up the two roles.
 */
export function studentDb(): SupabaseClient {
  if (!student) {
    student = createClient(URL, KEY, {
      auth: { storageKey: 'qr-student-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 30 } },
    });
  }
  return student;
}

export const MEDIA_BUCKET = 'quiz-media';
