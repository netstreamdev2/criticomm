'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Play, Save } from 'lucide-react';
import type { AutomationRule, RuleField } from '@criticom/api';
import { runAutomationAction, saveAutomationAction, toggleAutomationAction } from './actions';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';

/**
 * One automation rule: what it does, whether it is on, its thresholds, and what
 * it did last time.
 *
 * The last-run line is not decoration. These rules act on live operations
 * without anyone watching, so the answer to "is this actually working" has to
 * be visible on the same card as the switch that controls it — otherwise the
 * only way to find out a rule has been erroring for a week is to notice the
 * escalations that never arrived.
 */
export function RuleCard({
  rule, fields, canEdit,
}: {
  rule: AutomationRule;
  fields: RuleField[];
  /** Only the SuperAdmin changes or fires rules — they run for every tenant. */
  canEdit: boolean;
}) {
  const { t } = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, String(rule.config[f.key] ?? '')])),
  );
  const [interval, setInterval] = useState(String(rule.interval_minutes));
  const [error, setError] = useState<string | null>(null);

  const dirty =
    interval !== String(rule.interval_minutes)
    || fields.some((f) => draft[f.key] !== String(rule.config[f.key] ?? ''));

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set('key', rule.key);
    fd.set('interval_minutes', interval);
    for (const field of fields) fd.set(field.key, draft[field.key] ?? '');

    start(async () => {
      const res = await saveAutomationAction(fd);
      if (res?.error) { setError(res.error); return; }
      if (res?.stored) {
        // Reflect clamping rather than leaving the typed value on screen.
        setDraft((cur) => ({
          ...cur,
          ...Object.fromEntries(Object.entries(res.stored).map(([k, v]) => [k, String(v)])),
        }));
      }
      toast.push({ title: `${rule.name} saved`, tone: 'success', duration: 3500 });
      router.refresh();
    });
  };

  const toggle = () => {
    setError(null);
    const fd = new FormData();
    fd.set('key', rule.key);
    fd.set('enabled', String(!rule.enabled));
    start(async () => {
      const res = await toggleAutomationAction(fd);
      if (res?.error) { setError(res.error); return; }
      toast.push({
        title: `${rule.name} ${rule.enabled ? 'disabled' : 'enabled'}`,
        tone: rule.enabled ? 'warning' : 'success',
        duration: 3500,
      });
      router.refresh();
    });
  };

  const runNow = () => {
    setError(null);
    const fd = new FormData();
    fd.set('key', rule.key);
    start(async () => {
      const res = await runAutomationAction(fd);
      if (res?.error) { setError(res.error); return; }
      toast.push({
        title: res?.status === 'error' ? `${rule.name} failed` : `${rule.name} ran`,
        body: res?.detail,
        tone: res?.status === 'error' ? 'critical' : 'success',
        duration: 6000,
      });
      router.refresh();
    });
  };

  const lastStatusTone =
    rule.last_status === 'error' ? 'text-severity-critical'
      : rule.last_status === 'ok' ? 'text-success'
        : 'text-muted-foreground';

  return (
    <li className={cn('p-4', !rule.enabled && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{rule.name}</h3>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                rule.enabled
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-border bg-bg-soft text-muted-foreground',
              )}
            >
              {rule.enabled ? 'On' : 'Off'}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{rule.description}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={runNow}
            disabled={pending || !canEdit}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-bg-soft disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {t('Run now')}</button>
          <button
            type="button"
            onClick={toggle}
            disabled={pending || !canEdit}
            className={cn(
              'inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold disabled:opacity-50',
              rule.enabled
                ? 'border border-border hover:bg-bg-soft'
                : 'bg-primary text-primary-foreground',
            )}
          >
            {rule.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <label key={field.key} className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {field.label}
            </span>
            <span className="mt-1 flex items-center gap-2">
              <input
                type={field.kind === 'int' ? 'number' : 'text'}
                inputMode={field.kind === 'int' ? 'numeric' : 'text'}
                min={field.kind === 'int' ? field.min : undefined}
                max={field.kind === 'int' ? field.max : undefined}
                value={draft[field.key] ?? ''}
                onChange={(e) => setDraft((cur) => ({ ...cur, [field.key]: e.target.value }))}
                disabled={!canEdit}
                className="h-9 w-24 rounded-md border border-border bg-bg-soft px-2 text-sm tabular-nums"
              />
              {field.unit ? (
                <span className="text-sm text-muted-foreground">{field.unit}</span>
              ) : null}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {field.hint}
            </span>
          </label>
        ))}

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('Check every')}</span>
          <span className="mt-1 flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={10080}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              disabled={!canEdit}
              className="h-9 w-24 rounded-md border border-border bg-bg-soft px-2 text-sm tabular-nums"
            />
            <span className="text-sm text-muted-foreground">{t('minutes')}</span>
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {t('How often this rule is evaluated. The scheduler ticks every 5 minutes, so anything below that runs every tick.')}</span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          {rule.last_run_at ? (
            <>
              {t('Last run')}{' '}
              <time dateTime={rule.last_run_at}>
                {new Date(rule.last_run_at).toLocaleString('en-ZA')}
              </time>{' '}
              — <span className={lastStatusTone}>{rule.last_detail ?? rule.last_status}</span>
            </>
          ) : (
            'Has not run yet.'
          )}
        </p>

        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty || !canEdit}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {t('Save')}</button>
      </div>

      {error ? (
        <p className="mt-2 text-sm text-severity-critical">{error}</p>
      ) : null}
    </li>
  );
}
