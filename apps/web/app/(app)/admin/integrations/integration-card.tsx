'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle, Check, ChevronDown, KeyRound, Loader2, PlugZap, Save, X,
} from 'lucide-react';
import type { IntegrationSetting } from '@criticom/api';
import { setBodycamTestVideoAction, setIntegrationEnabledAction, saveIntegrationConfigAction } from './actions';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';

type EnvVar = { name: string; present: boolean };

export function IntegrationCard({
  integration, purpose, env,
}: {
  integration: IntegrationSetting;
  purpose: string;
  env: EnvVar[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [configText, setConfigText] = useState(
    JSON.stringify(integration.config ?? {}, null, 2),
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  const missing = env.filter((v) => !v.present);
  const credentialsReady = missing.length === 0;

  const toggle = () => {
    const fd = new FormData();
    fd.set('key', integration.key);
    fd.set('enabled', String(!integration.enabled));
    start(async () => {
      await setIntegrationEnabledAction(fd);
      router.refresh();
    });
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/integrations/test/${integration.key}`, { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      const outcome = {
        ok: Boolean(data.ok),
        message: data.message ?? data.error ?? 'No response.',
      };
      setResult(outcome);
      toast.push({
        title: `${integration.label.split(' — ')[0]}: ${outcome.ok ? 'connected' : 'not reachable'}`,
        body: outcome.message,
        tone: outcome.ok ? 'success' : 'warning',
      });
      router.refresh();
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const saveConfig = () => {
    setSaveError(null);
    const fd = new FormData();
    fd.set('key', integration.key);
    fd.set('config', configText);
    start(async () => {
      const res = await saveIntegrationConfigAction(fd);
      if (res?.error) {
        setSaveError(res.error);
        return;
      }
      toast.push({ title: 'Configuration saved', tone: 'success', duration: 4000 });
      router.refresh();
    });
  };

  // Bodycams (0054): the sample video stands in until the platform is connected.
  const testVideo = integration.key === 'hikvision'
    ? (integration.config as Record<string, unknown> | null)?.stream_source === 'test'
    : null;
  const toggleTestVideo = () => {
    start(async () => {
      const res = await setBodycamTestVideoAction(!testVideo);
      if (res?.error) {
        toast.push({ title: 'Test video not changed', body: res.error, tone: 'warning' });
        return;
      }
      toast.push({
        title: testVideo ? 'Test video switched off' : 'Test video switched on',
        body: testVideo ? 'Bodycam feeds now come from the Hikvision platform.' : 'Every bodycam feed now shows a sample video, marked as a test.',
        tone: 'success',
      });
      router.refresh();
    });
  };

  const [name, tagline] = integration.label.split(' — ');
  const lastTest = integration.last_tested_at
    ? new Date(integration.last_tested_at).toLocaleString('en-ZA', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
    : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      <div className="flex items-start gap-3 p-4">
        <span
          className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            integration.enabled && credentialsReady
              ? 'bg-severity-low/15 text-severity-low-ink'
              : credentialsReady
                ? 'bg-muted text-muted-foreground'
                : 'bg-severity-medium/15 text-severity-medium-ink',
          )}
        >
          <PlugZap className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
            {name}
            {integration.enabled ? (
              <span className="rounded-full bg-severity-low/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-severity-low-ink">
                Enabled
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Disabled
              </span>
            )}
            {!credentialsReady ? (
              <span className="rounded-full bg-severity-medium/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-severity-medium-ink">
                Credentials missing
              </span>
            ) : null}
          </p>
          {tagline ? <p className="text-xs text-muted-foreground">{tagline}</p> : null}
          {purpose ? <p className="mt-2 text-xs leading-relaxed">{purpose}</p> : null}

          {/* Credential checklist */}
          {env.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {env.map((v) => (
                <li
                  key={v.name}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px]',
                    v.present
                      ? 'border-severity-low/40 text-severity-low-ink'
                      : 'border-severity-medium/40 text-severity-medium-ink',
                  )}
                >
                  {v.present ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  {v.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <KeyRound className="h-3 w-3" /> No credentials required
            </p>
          )}

          {/* Last test outcome */}
          {(result ?? (integration.last_test_ok !== null ? {
            ok: integration.last_test_ok, message: integration.last_test_message ?? '',
          } : null)) ? (
            <p
              className={cn(
                'mt-3 flex items-start gap-1.5 rounded-md border px-2.5 py-2 text-[11px] leading-relaxed',
                (result?.ok ?? integration.last_test_ok)
                  ? 'border-severity-low/40 bg-severity-low/10 text-severity-low-ink'
                  : 'border-severity-critical/40 bg-severity-critical/10 text-severity-critical-ink',
              )}
            >
              {(result?.ok ?? integration.last_test_ok)
                ? <Check className="mt-0.5 h-3 w-3 shrink-0" />
                : <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />}
              <span>
                {result?.message ?? integration.last_test_message}
                {!result && lastTest ? (
                  <span className="ml-1 opacity-70">· last checked {lastTest}</span>
                ) : null}
              </span>
            </p>
          ) : null}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-bg-soft/50 px-4 py-2.5">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
            integration.enabled
              ? 'border border-border hover:bg-muted'
              : 'bg-primary',
          )}
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {integration.enabled ? 'Disable' : 'Enable'}
        </button>

        <button
          type="button"
          onClick={() => void runTest()}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-60"
        >
          {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />}
          {testing ? 'Testing…' : 'Test connection'}
        </button>

        {testVideo !== null ? (
          <button
            type="button"
            onClick={toggleTestVideo}
            disabled={pending}
            aria-pressed={testVideo}
            title="Plays a public sample video in every bodycam feed, marked as a test, until the platform is connected."
            className={cn(
              'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-60',
              testVideo ? 'border-severity-medium/50 bg-severity-medium/10 text-severity-medium-ink' : 'border-border hover:bg-muted',
            )}
          >
            Bodycam test video: {testVideo ? 'on' : 'off'}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-fg"
        >
          Parameters
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {/* Config editor */}
      {expanded ? (
        <div className="space-y-2 border-t border-border p-4">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`cfg-${integration.key}`}>
            Parameters (JSON)
          </label>
          <textarea
            id={`cfg-${integration.key}`}
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            rows={Math.min(12, Math.max(3, configText.split('\n').length + 1))}
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-bg-soft p-3 font-mono text-xs focus:border-accent focus:outline-none"
          />
          {saveError ? (
            <p className="text-xs text-severity-critical-ink">{saveError}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveConfig}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save parameters
            </button>
            <button
              type="button"
              onClick={() => {
                setConfigText(JSON.stringify(integration.config ?? {}, null, 2));
                setSaveError(null);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              Reset
            </button>
            {integration.updated_by ? (
              <span className="ml-auto text-[11px] text-muted-foreground">
                Last changed by {integration.updated_by}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
