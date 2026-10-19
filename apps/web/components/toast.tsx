'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Bell, CheckCircle2, Info, MapPin, Radio, Siren, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';
import { HeadsUpViewport, useHeadsUpStack, type HeadsUpInput } from '@/components/heads-up';

export type { HeadsUpInput };

export type ToastTone = 'info' | 'success' | 'warning' | 'critical' | 'dispatch';
export type Severity = 'Low' | 'Medium' | 'High' | 'Critical';

/** A new call, rendered as the large severity-coloured incident card. */
export type IncidentToastData = {
  severity: Severity;
  number: string;
  type: string;
  location: string;
  /** Short facts under the location: caller, region, who logged it. */
  meta?: string[];
  actions?: Array<{ label: string; href: string; primary?: boolean }>;
};

export type ToastInput = {
  /** Supply your own to make repeat pushes replace rather than stack. */
  id?: string;
  title: string;
  body?: string;
  tone?: ToastTone;
  /** Small pill rendered before the title, e.g. the severity. */
  badge?: string;
  href?: string;
  /** ms before auto-dismiss; 0 keeps it until dismissed. */
  duration?: number;
  /** Render as an incident card coloured by severity instead of a plain toast. */
  incident?: IncidentToastData;
};

type Toast = Required<Omit<ToastInput, 'body' | 'href' | 'badge' | 'incident'>> &
  Pick<ToastInput, 'body' | 'href' | 'badge' | 'incident'> & { createdAt: number };

type ToastApi = {
  push: (t: ToastInput) => string;
  dismiss: (id: string) => void;
  /** Short attention tone. Critical repeats three times. */
  chime: (tone?: ToastTone) => void;
  /** A distinct tone per severity, so a dispatcher can tell a call's weight by ear. */
  chimeSeverity: (severity: Severity) => void;
  /** A notification: the white bubble that drops in from the top (heads-up.tsx). */
  notify: (n: HeadsUpInput) => string;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Available anywhere under <ToastProvider>. Falls back to a no-op outside it. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? NOOP;
}

const NOOP: ToastApi = { push: () => '', dismiss: () => {}, chime: () => {}, chimeSeverity: () => {}, notify: () => '' };

const MAX_VISIBLE = 4;

const TONE_STYLE: Record<ToastTone, { rail: string; icon: typeof Info; fg: string }> = {
  info: { rail: 'bg-accent', icon: Info, fg: 'text-accent' },
  success: { rail: 'bg-severity-low', icon: CheckCircle2, fg: 'text-severity-low-ink' },
  warning: { rail: 'bg-severity-medium', icon: AlertTriangle, fg: 'text-severity-medium-ink' },
  critical: { rail: 'bg-severity-critical', icon: Siren, fg: 'text-severity-critical-ink' },
  dispatch: { rail: 'bg-primary', icon: Radio, fg: 'text-primary' },
};

/**
 * Short synthesised attention tone. Using WebAudio rather than an audio file
 * keeps it dependency-free and instant. Browsers block audio until the user has
 * interacted with the page, so failures are swallowed silently — the visual
 * toast is always the primary signal.
 */
function useChime() {
  const ctxRef = useRef<AudioContext | null>(null);

  return useCallback((tone: ToastTone = 'info') => {
    try {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctxRef.current ??= new Ctor();
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();

      const beeps = tone === 'critical' ? 3 : tone === 'dispatch' || tone === 'warning' ? 2 : 1;
      const freq = tone === 'critical' ? 880 : tone === 'dispatch' ? 660 : 523.25;

      for (let i = 0; i < beeps; i++) {
        const at = ctx.currentTime + i * 0.18;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.16, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.16);
      }
    } catch {
      /* audio unavailable — the toast itself is the signal */
    }
  }, []);
}

type Note = { f: number; at: number; dur: number; wave?: OscillatorType; gain?: number };

/**
 * One tone per severity, rising in urgency. Low is a single soft bell, Medium
 * a two-note chime, High a quick three-note rise, Critical a siren-like
 * two-tone that repeats. Each is distinct enough to recognise without looking
 * at the screen, which is the point: a dispatcher hears the weight of a call
 * before they turn to it.
 */
const SEVERITY_NOTES: Record<Severity, Note[]> = {
  Low: [{ f: 659.25, at: 0, dur: 0.5, gain: 0.12 }],
  Medium: [
    { f: 523.25, at: 0, dur: 0.45, gain: 0.14 },
    { f: 783.99, at: 0.2, dur: 0.6, gain: 0.14 },
  ],
  High: [
    { f: 587.33, at: 0, dur: 0.22, wave: 'triangle', gain: 0.18 },
    { f: 739.99, at: 0.14, dur: 0.22, wave: 'triangle', gain: 0.18 },
    { f: 880, at: 0.28, dur: 0.4, wave: 'triangle', gain: 0.2 },
  ],
  Critical: [0, 1, 2, 3, 4, 5].map((i) => ({
    f: i % 2 === 0 ? 960 : 720, at: i * 0.22, dur: 0.2, wave: 'sawtooth' as OscillatorType, gain: 0.09,
  })),
};

function useSeverityChime() {
  const ctxRef = useRef<AudioContext | null>(null);

  return useCallback((severity: Severity) => {
    try {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctxRef.current ??= new Ctor();
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();

      for (const n of SEVERITY_NOTES[severity] ?? SEVERITY_NOTES.Low) {
        const at = ctx.currentTime + n.at;
        const peak = n.gain ?? 0.14;
        // A quiet octave above gives the bell tones some body.
        for (const [mult, share] of [[1, 1], [2, 0.25]] as const) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = n.wave ?? 'sine';
          osc.frequency.setValueAtTime(n.f * mult, at);
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(peak * share, at + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + n.dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(at);
          osc.stop(at + n.dur + 0.02);
        }
      }
    } catch {
      /* audio unavailable — the card itself is the signal */
    }
  }, []);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chime = useChime();
  const chimeSeverity = useSeverityChime();
  const headsUp = useHeadsUpStack();

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = input.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const toast: Toast = {
      id,
      title: input.title,
      body: input.body,
      badge: input.badge,
      href: input.href,
      tone: input.tone ?? 'info',
      duration: input.duration ?? (input.tone === 'critical' ? 15_000 : 8_000),
      incident: input.incident,
      createdAt: Date.now(),
    };

    setToasts((cur) => {
      // Same id replaces in place so a repeated event doesn't stack up.
      const without = cur.filter((t) => t.id !== id);
      return [...without, toast].slice(-MAX_VISIBLE);
    });

    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    if (toast.duration > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), toast.duration));
    }
    return id;
  }, [dismiss]);

  // Clear every pending timer if the provider unmounts mid-flight.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ push, dismiss, chime, chimeSeverity, notify: headsUp.notify }),
    [push, dismiss, chime, chimeSeverity, headsUp.notify],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <HeadsUpViewport items={headsUp.items} onDismiss={headsUp.dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const { t } = useT();
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-label={t('Notifications')}
      className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[24rem] max-w-[calc(100vw-2rem)] flex-col-reverse gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const { t } = useT();
  if (toast.incident) return <IncidentToastCard toast={toast} incident={toast.incident} onDismiss={onDismiss} />;
  const { rail, icon: Icon, fg } = TONE_STYLE[toast.tone];

  const inner = (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <span className={cn('mt-0.5 shrink-0', fg)}>
        <Icon className={cn('h-4 w-4', toast.tone === 'critical' && 'animate-pulse')} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold leading-snug">
          {toast.badge ? (
            <span className="severity-pill shrink-0" data-sev={toast.badge}>{toast.badge}</span>
          ) : null}
          <span className="min-w-0 break-words">{toast.title}</span>
        </p>
        {toast.body ? (
          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{toast.body}</p>
        ) : null}
        {toast.href ? (
          <span className={cn('mt-1.5 inline-block text-xs font-semibold', fg)}>{t('Open →')}</span>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        'toast-enter pointer-events-auto relative overflow-hidden rounded-xl border bg-bg-card shadow-2xl',
        toast.tone === 'critical' ? 'border-severity-critical/50' : 'border-border',
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', rail)} aria-hidden />
      <div className="flex items-start gap-2 p-3 pl-4">
        {toast.href ? (
          <Link href={toast.href} className="flex min-w-0 flex-1" onClick={() => onDismiss(toast.id)}>
            {inner}
          </Link>
        ) : (
          inner
        )}
        <button
          type="button"
          aria-label={t('Dismiss notification')}
          onClick={() => onDismiss(toast.id)}
          className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {toast.duration > 0 ? (
        <span
          className={cn('absolute bottom-0 left-0 h-0.5 origin-left', rail)}
          style={{ animation: `toast-countdown ${toast.duration}ms linear forwards` }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

// Literal class strings so Tailwind keeps them: red Critical, orange High,
// yellow Medium, green Low — the same scale as the severity pills.
const SEVERITY_STYLE: Record<Severity, { band: string; border: string; ink: string; glow: string; bar: string }> = {
  Critical: {
    band: 'bg-severity-critical', border: 'border-severity-critical/70', ink: 'text-severity-critical-ink',
    glow: 'shadow-[0_0_28px_rgba(239,68,68,0.45)]', bar: 'bg-severity-critical',
  },
  High: {
    band: 'bg-severity-high', border: 'border-severity-high/70', ink: 'text-severity-high-ink',
    glow: 'shadow-[0_0_24px_rgba(249,115,22,0.35)]', bar: 'bg-severity-high',
  },
  Medium: {
    band: 'bg-severity-medium', border: 'border-severity-medium/70', ink: 'text-severity-medium-ink',
    glow: 'shadow-[0_0_22px_rgba(245,158,11,0.3)]', bar: 'bg-severity-medium',
  },
  Low: {
    band: 'bg-severity-low', border: 'border-severity-low/70', ink: 'text-severity-low-ink',
    glow: 'shadow-[0_0_20px_rgba(16,185,129,0.28)]', bar: 'bg-severity-low',
  },
};

/** The new-call card: a solid severity band, the call itself, and what to do next. */
function IncidentToastCard({
  toast, incident, onDismiss,
}: { toast: Toast; incident: IncidentToastData; onDismiss: (id: string) => void }) {
  const { t } = useT();
  const style = SEVERITY_STYLE[incident.severity] ?? SEVERITY_STYLE.Low;
  const critical = incident.severity === 'Critical';
  const loggedAt = new Date(toast.createdAt).toLocaleTimeString('en-ZA', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <div
      role={critical ? 'alert' : 'status'}
      className={cn(
        'toast-enter pointer-events-auto relative overflow-hidden rounded-xl border-2 bg-bg-card',
        style.border, style.glow,
      )}
    >
      {/* Band: foreground comes from the fill's own token (globals.css). */}
      <div className={cn('flex items-center gap-2 px-3 py-2', style.band)}>
        <Siren className={cn('h-4 w-4 shrink-0', critical && 'animate-pulse')} />
        <span className="text-[11px] font-extrabold uppercase tracking-[0.18em]">
          {t('New call · {severity}', { severity: incident.severity })}
        </span>
        <span className="ml-auto font-mono text-xs font-bold opacity-90">{incident.number}</span>
        <button
          type="button"
          aria-label={t('Dismiss notification')}
          onClick={() => onDismiss(toast.id)}
          className="-mr-1 rounded-md p-0.5 opacity-80 transition-opacity hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1.5 px-3.5 pb-3 pt-2.5">
        <p className="text-sm font-bold leading-snug">{incident.type}</p>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <MapPin className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', style.ink)} />
          <span className="break-words">{incident.location}</span>
        </p>
        <p className="text-[11px] text-muted-foreground">
          {[...(incident.meta ?? []), `Logged ${loggedAt}`].join(' · ')}
        </p>

        {incident.actions?.length ? (
          <div className="flex gap-2 pt-1.5">
            {incident.actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                onClick={() => onDismiss(toast.id)}
                className={cn(
                  'inline-flex h-8 flex-1 items-center justify-center rounded-md text-xs font-bold transition-opacity hover:opacity-90',
                  a.primary ? style.band : 'border border-border bg-bg-soft',
                )}
              >
                {a.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {toast.duration > 0 ? (
        <span
          className={cn('absolute bottom-0 left-0 h-1 w-full origin-left', style.bar)}
          style={{ animation: `toast-countdown ${toast.duration}ms linear forwards` }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

/** Standalone bell used by the topbar to show the unread count. */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return <Bell className="h-4 w-4" />;
  return (
    <span className="relative inline-flex">
      <Bell className="h-4 w-4" />
      <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-severity-critical px-1 text-[9px] font-bold">
        {count > 99 ? '99+' : count}
      </span>
    </span>
  );
}
