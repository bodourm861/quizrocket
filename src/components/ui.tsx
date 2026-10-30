'use client';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle, X } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'rocket' | 'success' | 'light';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 chunky',
  rocket: 'bg-rocket text-white hover:bg-rocket-dark chunky',
  success: 'bg-ans-d text-white hover:brightness-110 chunky',
  secondary: 'bg-white text-ink ring-2 ring-brand-100 hover:ring-brand-200 hover:bg-brand-50',
  ghost: 'text-ink-soft hover:bg-brand-50 hover:text-ink',
  danger: 'bg-white text-ans-a ring-2 ring-red-100 hover:bg-red-50',
  light: 'bg-white/15 text-white hover:bg-white/25 ring-1 ring-white/25',
};
const SIZES = { sm: 'h-9 px-3 text-sm gap-1.5', md: 'h-11 px-4 text-[15px] gap-2', lg: 'h-14 px-6 text-lg gap-2.5' };

export function Button({
  variant = 'primary', size = 'md', loading, icon, className = '', children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center rounded-xl font-extrabold transition disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ label = 'Loading…', light = false }: { label?: string; light?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 ${light ? 'text-white' : 'text-ink-soft'}`} role="status">
      <LoaderCircle className="size-9 animate-spin" aria-hidden />
      <span className="font-bold">{label}</span>
    </div>
  );
}

export function Badge({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'orange' | 'green' | 'gray' | 'red' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700', orange: 'bg-orange-50 text-orange-700', green: 'bg-emerald-50 text-emerald-700',
    gray: 'bg-slate-100 text-slate-600', red: 'bg-red-50 text-red-700',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${tones[tone]}`}>{children}</span>;
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={`card max-h-[92dvh] w-full overflow-y-auto rounded-b-none p-5 outline-none animate-rise sm:rounded-b-[1.25rem] sm:p-6 ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-2xl font-extrabold leading-tight">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-soft hover:bg-brand-50" aria-label="Close"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-extrabold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border-2 border-brand-100 bg-white px-3 py-2.5 font-semibold text-ink placeholder:text-slate-400 focus:border-brand-500 focus:outline-none';

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{children}</div>;
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-extrabold text-white shadow-xl animate-rise">
      {message}
    </div>
  );
}
