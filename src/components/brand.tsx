'use client';
import Link from 'next/link';
import { Rocket } from 'lucide-react';
import { APP_NAME } from '@/lib/util';
import { supabaseConfigured } from '@/lib/supabase';

export function Logo({ light = false, size = 'md', href = '/' }: { light?: boolean; size?: 'md' | 'lg'; href?: string }) {
  const big = size === 'lg';
  return (
    <Link href={href} className={`inline-flex items-center gap-2 font-display font-extrabold ${light ? 'text-white' : 'text-ink'}`}>
      <span className={`grid place-items-center rounded-xl bg-rocket text-white shadow-md ${big ? 'size-12' : 'size-9'}`}>
        <Rocket className={big ? 'size-7' : 'size-5'} aria-hidden />
      </span>
      <span className={big ? 'text-4xl' : 'text-2xl'}>{APP_NAME}</span>
    </Link>
  );
}

/** Shown instead of the app until the Supabase keys are configured. */
export function ConfigNotice() {
  if (supabaseConfigured) return null;
  return (
    <div className="mx-auto my-10 max-w-xl card p-6">
      <h2 className="text-2xl font-extrabold">Almost ready! 🔧</h2>
      <p className="mt-2 text-ink-soft">
        This copy of {APP_NAME} is not connected to its database yet. Add <code className="font-bold">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
        <code className="font-bold">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code> (or your hosting provider&apos;s
        environment variables) and rebuild. The README explains every step.
      </p>
    </div>
  );
}
