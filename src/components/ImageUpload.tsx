'use client';
import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { MEDIA_BUCKET, teacherDb } from '@/lib/supabase';
import { friendly, uid } from '@/lib/util';

/** Shrinks big photos so they load quickly on students' devices. */
async function shrink(file: File, max = 1600): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 1_000_000) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), type, 0.86));
}

export function ImageUpload({ value, onChange, userId, compact = false, label = 'Add image' }: {
  value: string | null; onChange: (url: string | null) => void; userId: string; compact?: boolean; label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    if (file.size > 15_000_000) { setError('That image is too large (max 15 MB).'); return; }
    setBusy(true);
    try {
      const blob = await shrink(file);
      if (blob.size > 5_000_000) throw new Error('Image is still larger than 5 MB after resizing.');
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const path = `${userId}/${uid()}.${ext}`;
      const db = teacherDb();
      const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: blob.type || file.type, cacheControl: '31536000' });
      if (error) throw error;
      onChange(db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {value ? (
        <div className={`group relative overflow-hidden rounded-xl border-2 border-brand-100 bg-white ${compact ? 'size-14' : 'h-40 w-full'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="size-full object-contain" />
          <button type="button" onClick={() => onChange(null)} aria-label="Remove image"
            className="absolute right-1 top-1 rounded-lg bg-white/95 p-1.5 text-ans-a shadow hover:bg-red-50">
            <Trash2 className={compact ? 'size-3.5' : 'size-4'} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          className={`flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-200 font-bold text-brand-600 hover:bg-brand-50 ${
            compact ? 'size-14' : 'h-40 w-full flex-col'
          }`}
          aria-label={label} title={label}>
          {busy ? <LoaderCircle className="size-5 animate-spin" /> : <ImagePlus className={compact ? 'size-5' : 'size-8'} />}
          {!compact && <span>{busy ? 'Uploading…' : label}</span>}
        </button>
      )}
      {error && <p className="mt-1 text-xs font-bold text-red-600">{error}</p>}
    </div>
  );
}
