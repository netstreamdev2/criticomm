'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw, Save } from 'lucide-react';
import type { SettingDef } from '@criticom/api';
import { saveSettingAction, resetSettingAction } from './actions';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';

/**
 * One editable knob, rendered from its catalogue definition. Adding a new
 * setting to OPERATIONAL_SETTINGS makes it appear here with the right editor —
 * this file never needs to change.
 */
export function SettingRow({
  def, value, overridden, updatedBy,
}: {
  def: SettingDef;
  value: number | boolean | string;
  overridden: boolean;
  updatedBy: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  const dirty = draft !== String(value);

  const submit = (nextValue: string) => {
    setError(null);
    const fd = new FormData();
    fd.set('key', def.key);
    fd.set('value', nextValue);
    start(async () => {
      const res = await saveSettingAction(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      // The server may have clamped the value — reflect what was stored.
      if (res?.stored !== undefined) setDraft(String(res.stored));
      toast.push({ title: `${def.label} saved`, tone: 'success', duration: 3500 });
      router.refresh();
    });
  };

  const reset = () => {
    const fd = new FormData();
    fd.set('key', def.key);
    start(async () => {
      await resetSettingAction(fd);
      setDraft(String(def.default));
      toast.push({ title: `${def.label} reset to default`, tone: 'info', duration: 3500 });
      router.refresh();
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:flex-nowrap">
      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {def.label}
          {overridden ? (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
              Customised
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{def.description}</p>
        {overridden && updatedBy ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">Set by {updatedBy}</p>
        ) : null}
        {error ? <p className="mt-1 text-xs text-severity-critical-ink">{error}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {def.type === 'boolean' ? (
          <button
            type="button"
            role="switch"
            aria-checked={draft === 'true'}
            disabled={pending}
            onClick={() => {
              const next = draft === 'true' ? 'false' : 'true';
              setDraft(next);
              submit(next);
            }}
            className={cn(
              'relative h-6 w-11 rounded-full transition-colors disabled:opacity-60',
              draft === 'true' ? 'bg-severity-low' : 'bg-muted',
            )}
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
              style={{ left: draft === 'true' ? '1.375rem' : '0.125rem' }}
            />
          </button>
        ) : def.type === 'choice' ? (
          <select
            value={draft}
            disabled={pending}
            onChange={(e) => {
              setDraft(e.target.value);
              submit(e.target.value);
            }}
            className="h-9 rounded-lg border border-border bg-bg-soft px-2.5 text-sm focus:border-accent focus:outline-none"
          >
            {def.options?.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <>
            <div className="relative">
              <input
                type="number"
                value={draft}
                min={def.min}
                max={def.max}
                step={def.key === 'dispatch.eta_road_factor' ? 0.05 : 1}
                disabled={pending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(draft); } }}
                className="h-9 w-28 rounded-lg border border-border bg-bg-soft px-2.5 pr-11 text-sm tabular-nums focus:border-accent focus:outline-none"
              />
              {def.unit ? (
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                  {def.unit}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => submit(draft)}
              disabled={pending || !dirty}
              aria-label={`Save ${def.label}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary transition-opacity disabled:opacity-35"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            </button>
          </>
        )}

        {overridden ? (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            title={`Reset to ${String(def.default)}${def.unit ? ` ${def.unit}` : ''}`}
            aria-label={`Reset ${def.label} to default`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-fg disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  );
}
