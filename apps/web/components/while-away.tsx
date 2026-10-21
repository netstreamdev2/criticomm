'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BellRing, Monitor, X } from 'lucide-react';
import type { Alert } from '@criticom/api';
import { allowDesktopAlerts, desktopAlertsState } from '@/lib/desktop-alert';
import { useT } from '@/components/i18n';
import { cn, timeAgo } from '@/lib/utils';

const SHOWN = 6;

const DOT: Record<string, string> = {
  Critical: 'bg-severity-critical', High: 'bg-severity-high', Medium: 'bg-severity-medium', Low: 'bg-severity-low',
};

/**
 * "While you were away": the calls and crew movements that came in while the
 * dispatcher was not looking (another window, lunch, the computer off). It
 * waits until they say they have seen them; everything is also in
 * Notifications, unread.
 */
export function WhileAway({ items, canOpenCalls, onSeen, onLater }: {
  items: Alert[];
  canOpenCalls: boolean;
  /** Mark them all as seen. */
  onSeen: () => void;
  /** Close the card and leave them unread in Notifications. */
  onLater: () => void;
}) {
  const { t } = useT();
  const [desktop, setDesktop] = useState<string>('unsupported');
  useEffect(() => { setDesktop(desktopAlertsState()); }, []);
  if (items.length === 0) return null;

  const calls = items.filter((a) => a.kind === 'incident_new').length;
  const urgent = items.some((a) => a.kind === 'incident_new' && (a.severity === 'Critical' || a.severity === 'High'));

  return (
    <section
      role="alertdialog" aria-labelledby="while-away-title"
      className={cn(
        'frost-white-strong fixed bottom-20 right-4 z-[85] w-[min(92vw,26rem)] rounded-2xl p-4 text-fg shadow-2xl',
        urgent && 'ring-2 ring-severity-critical/70',
      )}
    >
      <header className="flex items-start gap-2.5">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white', urgent ? 'bg-severity-critical' : 'bg-accent')}>
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="while-away-title" className="text-base font-bold leading-tight">{t('While you were away')}</h2>
          <p className="text-xs text-muted-foreground">
            {calls > 0
              ? t('{calls} new calls · {n} updates in total', { calls, n: items.length })
              : t('{n} updates on calls', { n: items.length })}
          </p>
        </div>
        <button type="button" onClick={onLater} aria-label={t('Close')} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-fg">
          <X className="h-4 w-4" />
        </button>
      </header>

      <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
        {items.slice(0, SHOWN).map((a) => {
          const href = a.link && (canOpenCalls || !a.link.startsWith('/incidents')) ? a.link : null;
          const line = (
            <>
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.kind === 'incident_new' ? DOT[a.severity] ?? 'bg-accent' : 'bg-accent/70')} />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-sm', a.kind === 'incident_new' && 'font-semibold')}>{a.title}</span>
                {a.body ? <span className="block truncate text-xs text-muted-foreground">{a.body}</span> : null}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground" suppressHydrationWarning>{timeAgo(a.created_at)}</span>
            </>
          );
          return (
            <li key={a.id}>
              {href
                ? <Link href={href} onClick={onLater} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-fg/5">{line}</Link>
                : <div className="flex items-start gap-2 px-2 py-1.5">{line}</div>}
            </li>
          );
        })}
      </ul>
      {items.length > SHOWN ? (
        <p className="mt-1 px-2 text-xs text-muted-foreground">{t('{n} more in Notifications', { n: items.length - SHOWN })}</p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onSeen} className="h-10 flex-1 rounded-lg bg-accent text-sm font-bold">
          {t('Mark as seen')}
        </button>
        <Link href="/notifications" onClick={onLater} className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-border text-sm font-semibold hover:bg-fg/5">
          {t('Open notifications')}
        </Link>
      </div>

      {desktop === 'default' ? (
        <button
          type="button"
          onClick={() => void allowDesktopAlerts().then(setDesktop)}
          className="mt-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-left text-xs text-muted-foreground hover:text-fg"
        >
          <Monitor className="h-4 w-4 shrink-0" />
          {t('Allow desktop alerts, so new calls show on this computer even when this window is not in front.')}
        </button>
      ) : null}
    </section>
  );
}

/** On the Notifications page: turn the computer's own alerts on, or say they are on or blocked. */
export function DesktopAlertsButton() {
  const { t } = useT();
  const [state, setState] = useState<string>('unsupported');
  useEffect(() => { setState(desktopAlertsState()); }, []);
  if (state === 'unsupported') return null;
  if (state === 'granted') {
    return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Monitor className="h-3.5 w-3.5" /> {t('Desktop alerts are on')}</span>;
  }
  if (state === 'denied') {
    return <span className="text-xs text-muted-foreground">{t('Desktop alerts are blocked in this browser’s settings.')}</span>;
  }
  return (
    <button
      type="button" onClick={() => void allowDesktopAlerts().then(setState)}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-fg/5"
    >
      <Monitor className="h-4 w-4" /> {t('Allow desktop alerts')}
    </button>
  );
}
