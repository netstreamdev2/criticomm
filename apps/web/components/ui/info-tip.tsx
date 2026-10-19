'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

const WIDTH = 256;
const GAP = 6;
const EDGE = 8;

/**
 * The (i) beside a title or a field: hover or focus it to read one line about
 * what it is. The line is drawn on top of the page (outside any card, table
 * or frosted bar, which would otherwise cut it off or paint over it), kept
 * inside the screen, and flipped above when there is no room below.
 */
export function InfoTip({ text, className }: { text: string; className?: string; side?: 'bottom' | 'right' }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - EDGE);
    const above = r.bottom + 120 > window.innerHeight && r.top > 120;
    setAt({ top: above ? r.top - GAP : r.bottom + GAP, left, above });
  }, []);
  const hide = useCallback(() => setAt(null), []);

  // A scroll or resize moves the (i) away from its line: close it.
  useEffect(() => {
    if (!at) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [at, hide]);

  return (
    <span className={cn('inline-flex align-middle print:hidden', className)}>
      <button
        ref={ref}
        type="button"
        aria-label={text}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-muted-foreground outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {at
        ? createPortal(
            <span
              role="tooltip"
              style={{ top: at.top, left: at.left, width: WIDTH, transform: at.above ? 'translateY(-100%)' : undefined }}
              className="pointer-events-none fixed z-[200] rounded-md border border-border bg-bg-card px-3 py-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-fg shadow-xl"
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
