'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Bell, CheckCircle2, Info, Radio, Siren, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastTone = 'info' | 'success' | 'warning' | 'critical' | 'dispatch';

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
};

type Toast = Required<Omit<ToastInput, 'body' | 'href' | 'badge'>> &
  Pick<ToastInput, 'body' | 'href' | 'badge'> & { createdAt: number };

type ToastApi = {
  push: (t: ToastInput) => string;
  dismiss: (id: string) => void;
  /** Short attention tone. Critical repeats three times. */
  chime: (tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Available anywhere under <ToastProvider>. Falls back to a no-op outside it. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? NOOP;
}

const NOOP: ToastApi = { push: () => '', dismiss: () => {}, chime: () => {} };

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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chime = useChime();

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

  const api = useMemo<ToastApi>(() => ({ push, dismiss, chime }), [push, dismiss, chime]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col-reverse gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
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
          <span className={cn('mt-1.5 inline-block text-xs font-semibold', fg)}>Open →</span>
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
          aria-label="Dismiss notification"
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
