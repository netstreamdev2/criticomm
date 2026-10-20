'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, X } from 'lucide-react';
import { useT } from '@/components/i18n';

/**
 * The duty office's "done" banner: a frosted pill that drops in at the top of
 * the screen, says what happened, runs a thin timer line down and leaves on
 * its own (tap to close sooner), like a phone's notification. One at a time;
 * a new one replaces the last. It outlives a page change (Add New Staff opens
 * the new record), because the host sits in the duty office layout.
 *
 * It can carry the next step ("Next: add its call signs →"), so nobody has to
 * guess where to go after a save; it then stays a little longer.
 */

const SHOW_MS = 3500;
const SHOW_MS_WITH_NEXT = 9000;
export type NoticeAction = { label: string; href: string };
type Notice = { id: number; title: string; detail?: string; action?: NoticeAction };
let seq = 0;
const listeners = new Set<(n: Notice) => void>();

/** Show the banner, with an optional next step. */
export function notify(title: string, detail?: string, action?: NoticeAction) {
  const n = { id: ++seq, title, detail, action };
  for (const l of listeners) l(n);
}

export function NoticeHost() {
  const { t } = useT();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [shown, setShown] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ms = notice?.action ? SHOW_MS_WITH_NEXT : SHOW_MS;

  useEffect(() => {
    setMounted(true);
    const on = (n: Notice) => { setShown(false); setNotice(n); };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);

  useEffect(() => {
    if (!notice) return;
    // Next frame: slide in, so the transition runs.
    const enter = requestAnimationFrame(() => setShown(true));
    const leave = setTimeout(() => setShown(false), ms);
    const gone = setTimeout(() => setNotice(null), ms + 300);
    return () => { cancelAnimationFrame(enter); clearTimeout(leave); clearTimeout(gone); };
  }, [notice, ms]);

  if (!mounted || !notice) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[300] flex justify-center px-4" aria-live="polite">
      <div
        className={`pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-b from-primary/20 to-bg-card/70 px-4 py-3 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-out motion-reduce:transition-none ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-severity-low/20">
            <CheckCircle2 className="h-5 w-5 text-severity-low" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-fg">{notice.title}</span>
            {notice.detail ? <span className="block truncate text-xs text-muted-foreground">{notice.detail}</span> : null}
          </span>
          <button type="button" onClick={() => setShown(false)} aria-label={t('Close')}
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-white/10 hover:text-fg">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {notice.action ? (
          <Link href={notice.action.href} onClick={() => setShown(false)}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90">
            {t(notice.action.label)} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
        {/* The timer: a thin red line that runs down while it shows. */}
        <span
          key={notice.id}
          aria-hidden
          className="absolute bottom-0 left-0 h-0.5 bg-primary/80 ease-linear motion-reduce:hidden"
          style={{ width: shown ? '0%' : '100%', transitionProperty: 'width', transitionDuration: shown ? `${ms}ms` : '0ms' }}
        />
      </div>
    </div>,
    document.body,
  );
}
