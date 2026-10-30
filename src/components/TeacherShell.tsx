'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { LogOut } from 'lucide-react';
import { supabaseConfigured, teacherDb } from '@/lib/supabase';
import { ConfigNotice, Logo } from './brand';
import { Spinner } from './ui';

/** Returns the signed-in teacher, redirecting to /login when there is none. */
export function useTeacher(): User | null {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    if (!supabaseConfigured) return;
    const db = teacherDb();
    db.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      if (!u || u.is_anonymous) router.replace('/login/');
      else setUser(u);
    });
    const { data: sub } = db.auth.onAuthStateChange((_e, session) => {
      if (!session?.user) router.replace('/login/');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);
  return user;
}

export function TeacherShell({ children, actions, wide = false }: { children: (user: User) => ReactNode; actions?: ReactNode; wide?: boolean }) {
  const user = useTeacher();
  if (!supabaseConfigured) return <ConfigNotice />;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-brand-100 bg-white/90 backdrop-blur">
        <div className={`mx-auto flex h-16 items-center gap-3 px-4 ${wide ? 'max-w-[1400px]' : 'max-w-6xl'}`}>
          <Logo href="/dashboard/" />
          <div className="ml-auto flex items-center gap-2">
            {actions}
            {user && (
              <button
                onClick={() => teacherDb().auth.signOut()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold text-ink-soft hover:bg-brand-50"
                title={user.email ?? ''}
              >
                <LogOut className="size-4" aria-hidden /> <span className="hidden sm:inline">Sign out</span>
              </button>
            )}
          </div>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 sm:py-8 ${wide ? 'max-w-[1400px]' : 'max-w-6xl'}`}>
        {user ? children(user) : <Spinner />}
      </main>
    </div>
  );
}
