'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfigNotice, Logo } from '@/components/brand';
import { Button, ErrorBox, Field, inputCls } from '@/components/ui';
import { supabaseConfigured, teacherDb } from '@/lib/supabase';
import { friendly } from '@/lib/util';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured) return;
    const db = teacherDb();
    const recovering = window.location.hash.includes('type=recovery');
    const RECOVERY_MSG = 'You are signed in. Type a new password above and press "Set new password".';
    if (recovering) setInfo(RECOVERY_MSG);
    db.auth.getSession().then(({ data }) => {
      if (!recovering && data.session?.user && !data.session.user.is_anonymous) router.replace('/dashboard/');
    });
    const { data: sub } = db.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { setMode('signin'); setInfo(RECOVERY_MSG); }
      else if (!recovering && session?.user && !session.user.is_anonymous && event === 'SIGNED_IN') router.replace('/dashboard/');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    const db = teacherDb();
    try {
      if (mode === 'signin') {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace('/dashboard/');
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
        const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/login/` } });
        if (error) throw error;
        if (data.session) router.replace('/dashboard/');
        else { setInfo('Check your inbox and click the confirmation link, then sign in here.'); setMode('signin'); }
      } else {
        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login/` });
        if (error) throw error;
        setInfo('If that email has an account, a reset link is on its way.');
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function setNewPassword() {
    if (password.length < 8) { setError('Use a password with at least 8 characters.'); return; }
    setBusy(true);
    const { error } = await teacherDb().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(friendly(error)); else router.replace('/dashboard/');
  }

  if (!supabaseConfigured) return <ConfigNotice />;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-4 py-10">
      <Logo size="lg" />
      <form onSubmit={submit} className="card mt-8 w-full max-w-md space-y-4 p-6 sm:p-8 animate-rise">
        <div>
          <h1 className="text-3xl font-extrabold">
            {mode === 'signin' ? 'Teacher sign in' : mode === 'signup' ? 'Create a teacher account' : 'Reset password'}
          </h1>
          <p className="text-ink-soft">Students never need an account — they join with a link or PIN.</p>
        </div>
        <Field label="Email">
          <input type="email" required autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode !== 'reset' && (
          <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
            <input type="password" required minLength={mode === 'signup' ? 8 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <ErrorBox>{error}</ErrorBox>
        {info && <div role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{info}</div>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </Button>
        {info?.startsWith('You are signed in') && (
          <Button type="button" variant="secondary" className="w-full" onClick={setNewPassword} loading={busy}>Set new password</Button>
        )}
        <div className="flex flex-wrap justify-between gap-2 text-sm font-bold">
          {mode !== 'signin' && <button type="button" className="text-brand-600 hover:underline" onClick={() => setMode('signin')}>Back to sign in</button>}
          {mode === 'signin' && <button type="button" className="text-brand-600 hover:underline" onClick={() => setMode('signup')}>New here? Create an account</button>}
          {mode === 'signin' && <button type="button" className="text-ink-soft hover:underline" onClick={() => setMode('reset')}>Forgot password?</button>}
        </div>
      </form>
    </div>
  );
}
