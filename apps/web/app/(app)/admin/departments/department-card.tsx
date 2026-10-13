'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp, Loader2, Save, Trash2 } from 'lucide-react';
import { uploadDepartmentLogo, type DepartmentBranding } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { DeptBadge } from '@/components/dept-badge';
import { useToast } from '@/components/toast';
import { saveBrandingAction, clearLogoAction } from './actions';

type Branding = DepartmentBranding & { logoUrl: string | null };

const MAX_BYTES = 2 * 1024 * 1024;

export function DepartmentCard({ branding }: { branding: Branding }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Live preview: the badge reflects edits before they're saved.
  const [draft, setDraft] = useState({
    official_name: branding.official_name,
    short_name: branding.short_name,
    monogram: branding.monogram,
    primary_color: branding.primary_color,
    accent_color: branding.accent_color,
    motto: branding.motto ?? '',
  });

  const set = (k: keyof typeof draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set('silo', branding.silo);
    for (const [k, v] of Object.entries(draft)) fd.set(k, v);
    start(async () => {
      const res = await saveBrandingAction(fd);
      if (res?.error) { setError(res.error); return; }
      toast.push({ title: `${draft.short_name} identity saved`, tone: 'success', duration: 4000 });
      router.refresh();
    });
  };

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setError('Crest must be 2 MB or smaller.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      await uploadDepartmentLogo(getBrowserSupabase(), {
        silo: branding.silo as Silo,
        file,
        filename: file.name,
      });
      toast.push({ title: `${branding.short_name} crest uploaded`, tone: 'success' });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clearLogo = () => {
    const fd = new FormData();
    fd.set('silo', branding.silo);
    start(async () => {
      await clearLogoAction(fd);
      toast.push({ title: 'Crest removed — monogram badge restored', tone: 'info' });
      router.refresh();
    });
  };

  const label = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground';
  const field = 'h-10 w-full rounded-lg border border-border bg-bg-soft px-3 text-sm focus:border-accent focus:outline-none';

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      {/* Header strip in the department's own colour */}
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{
          background: `linear-gradient(90deg, ${draft.primary_color}22, transparent 70%)`,
          borderBottom: `2px solid ${draft.primary_color}`,
        }}
      >
        <DeptBadge
          branding={{ ...draft, short_name: draft.short_name }}
          logoUrl={branding.logoUrl}
          size="lg"
        />
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{draft.short_name}</p>
          <p className="truncate text-xs text-muted-foreground">{draft.official_name}</p>
          {draft.motto ? (
            <p className="truncate text-[11px] italic text-muted-foreground/80">“{draft.motto}”</p>
          ) : null}
        </div>
        <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {branding.silo}
        </span>
      </div>

      <div className="space-y-4 p-5">
        {/* Crest */}
        <div>
          <p className={label}>Crest</p>
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor={`logo-${branding.silo}`}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-4 text-sm font-semibold transition-colors hover:border-accent/50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
              {uploading ? 'Uploading…' : branding.logoUrl ? 'Replace crest' : 'Upload crest'}
            </label>
            <input
              ref={fileRef}
              id={`logo-${branding.silo}`}
              type="file"
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            {branding.logoUrl ? (
              <button
                type="button"
                onClick={clearLogo}
                disabled={pending}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-fg disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">
                Using the monogram badge until a crest is uploaded.
              </span>
            )}
          </div>
          {branding.silo === 'Ethekwini' ? (
            <p className="mt-2 text-xs text-muted-foreground">
              The municipality&apos;s crest: it also appears on report PDFs, report screens in the app and the menu. Use a PNG for the PDFs.
            </p>
          ) : null}
        </div>

        {/* Identity */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor={`official-${branding.silo}`}>Official name</label>
            <input
              id={`official-${branding.silo}`} className={field} value={draft.official_name}
              onChange={(e) => set('official_name', e.target.value)}
            />
          </div>
          <div>
            <label className={label} htmlFor={`short-${branding.silo}`}>Short name</label>
            <input
              id={`short-${branding.silo}`} className={field} value={draft.short_name}
              onChange={(e) => set('short_name', e.target.value)}
            />
          </div>
          <div>
            <label className={label} htmlFor={`mono-${branding.silo}`}>Monogram (max 4)</label>
            <input
              id={`mono-${branding.silo}`} className={field} maxLength={4} value={draft.monogram}
              onChange={(e) => set('monogram', e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label className={label} htmlFor={`primary-${branding.silo}`}>Primary colour</label>
            <div className="flex items-center gap-2">
              <input
                type="color" aria-label="Primary colour picker"
                className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-bg-soft"
                value={draft.primary_color}
                onChange={(e) => set('primary_color', e.target.value)}
              />
              <input
                id={`primary-${branding.silo}`} className={`${field} font-mono`} value={draft.primary_color}
                onChange={(e) => set('primary_color', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className={label} htmlFor={`accent-${branding.silo}`}>Accent colour</label>
            <div className="flex items-center gap-2">
              <input
                type="color" aria-label="Accent colour picker"
                className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-bg-soft"
                value={draft.accent_color}
                onChange={(e) => set('accent_color', e.target.value)}
              />
              <input
                id={`accent-${branding.silo}`} className={`${field} font-mono`} value={draft.accent_color}
                onChange={(e) => set('accent_color', e.target.value)}
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor={`motto-${branding.silo}`}>Motto (optional)</label>
            <input
              id={`motto-${branding.silo}`} className={field} value={draft.motto}
              onChange={(e) => set('motto', e.target.value)}
            />
          </div>
        </div>

        {error ? <p className="text-xs text-severity-critical-ink">{error}</p> : null}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save identity
          </button>
          {branding.updated_by ? (
            <span className="text-[11px] text-muted-foreground">Last changed by {branding.updated_by}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
