'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Bell, CalendarClock, ClipboardCheck, Mail, Megaphone, Radio, Users, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';

/**
 * The notification pop-up: a white frosted bubble that drops in from the top
 * of the screen, the way a phone's heads-up does, and lifts away by itself.
 * Swipe it up or press × to dismiss; hovering holds it.
 *
 * For notifications only. The emergency pop-ups (SOS, the blocking dispatch
 * alert) and the new-call cards keep their own look and place.
 */
export type HeadsUpInput = {
  /** Supply your own so a repeat replaces rather than stacks. */
  id?: string;
  title: string;
  body?: string;
  href?: string;
  /** Who sent it, e.g. "Patricia Naidoo". */
  from?: string | null;
  /** Whom it is for, in words: "Just you", "Metro Police admins". */
  audience?: string;
  /** The audience colour (AUDIENCE_TONE). */
  accent?: string;
  /** Picks the icon. */
  kind?: string;
  severity?: string;
  /** ms before it lifts away; 0 keeps it. */
  duration?: number;
};

type HeadsUp = HeadsUpInput & { id: string; createdAt: number; leaving?: boolean };

const MAX_STACK = 3;
const LEAVE_MS = 260;

export function useHeadsUpStack() {
  const [items, setItems] = useState<HeadsUp[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, leaving: true } : i)));
    setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), LEAVE_MS);
  }, []);

  const notify = useCallback((input: HeadsUpInput) => {
    const id = input.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((cur) => [{ ...input, id, createdAt: Date.now() }, ...cur.filter((i) => i.id !== id)].slice(0, MAX_STACK));
    return id;
  }, []);

  return { items, notify, dismiss };
}

export function HeadsUpViewport({ items, onDismiss }: { items: HeadsUp[]; onDismiss: (id: string) => void }) {
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <section
      aria-live="polite"
      aria-label={t('New notifications')}
      className="pointer-events-none fixed inset-x-0 top-3 z-[75] flex flex-col items-center gap-2 px-3"
    >
      {items.map((item) => (
        <HeadsUpBubble key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </section>
  );
}

const KIND_ICON: Record<string, typeof Bell> = {
  mail: Mail,
  task: ClipboardCheck,
  broadcast: Megaphone,
  schedule: CalendarClock,
  assignment: Radio,
  dispatch: Radio,
  backup: Users,
};

function HeadsUpBubble({ item, onDismiss }: { item: HeadsUp; onDismiss: (id: string) => void }) {
  const { t } = useT();
  const [held, setHeld] = useState(false);
  const [dy, setDy] = useState(0);
  const drag = useRef<{ start: number; moved: boolean } | null>(null);
  const duration = item.duration ?? 6000;

  useEffect(() => {
    if (held || item.leaving || duration <= 0) return;
    const timer = setTimeout(() => onDismiss(item.id), duration);
    return () => clearTimeout(timer);
  }, [held, item.leaving, duration, item.id, onDismiss]);

  const urgent = item.severity === 'High' || item.severity === 'Critical';
  const Icon = KIND_ICON[item.kind ?? ''] ?? (urgent ? AlertTriangle : Bell);
  const accent = item.accent ?? '#3b82f6';

  const content = (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <span
        className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${accent}26`, color: accent }}
      >
        <Icon className="h-[18px] w-[18px]" />
        {urgent ? (
          <span
            className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white/70',
              item.severity === 'Critical' ? 'bg-severity-critical' : 'bg-severity-high')}
            aria-hidden
          />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-semibold text-fg/80">HikTech</span>
          {item.audience ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate font-medium" style={{ color: accent }}>{item.audience}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span className="shrink-0">{t('now')}</span>
        </p>
        <p className="mt-0.5 break-words text-sm font-semibold leading-snug">{item.title}</p>
        {item.body ? (
          <p className="mt-0.5 line-clamp-2 break-words text-[13px] leading-snug text-muted-foreground">{item.body}</p>
        ) : null}
        {item.from ? (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{t('From {name}', { name: item.from })}</p>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        'frost-white-strong pointer-events-auto w-[26rem] max-w-full touch-pan-x select-none rounded-[22px]',
        item.leaving ? 'heads-up-leave' : 'heads-up-enter',
      )}
      style={dy ? { transform: `translateY(${dy}px)`, opacity: Math.max(0.2, 1 + dy / 120) } : undefined}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onPointerDown={(e) => { drag.current = { start: e.clientY, moved: false }; }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const d = Math.min(0, e.clientY - drag.current.start);
        if (d < -4) drag.current.moved = true;
        setDy(d);
      }}
      onPointerUp={() => {
        if (dy < -36) onDismiss(item.id);
        else setDy(0);
        setTimeout(() => { drag.current = null; }, 0);
      }}
      onPointerCancel={() => { drag.current = null; setDy(0); }}
      onClickCapture={(e) => { if (drag.current?.moved) e.preventDefault(); }}
    >
      <div className="flex items-start gap-2 px-4 py-3">
        {item.href ? (
          <Link href={item.href} className="flex min-w-0 flex-1" onClick={() => onDismiss(item.id)}>
            {content}
          </Link>
        ) : content}
        <button
          type="button"
          aria-label={t('Dismiss notification')}
          onClick={() => onDismiss(item.id)}
          className="-mr-1.5 -mt-1 shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-fg/10 hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-fg/15" aria-hidden />
    </div>
  );
}
