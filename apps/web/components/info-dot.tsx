'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';

const WIDTH = 288;
const GAP = 6;
const EDGE = 8;

/**
 * The (i) beside a heading on the Disaster screens: hovered, focused or
 * tapped, it says in a sentence or two what the thing is for. A bigger
 * target than ui/InfoTip (gloves, touch screens), drawn on top of the page
 * like it so a card never cuts it off. Tapping elsewhere, Escape or a scroll
 * closes it. Never put it inside another button.
 */
export function InfoDot({ text, title, className }: { text: string; title?: string; className?: string }) {
  const { t } = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [at, setAt] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - EDGE);
    const above = r.bottom + 160 > window.innerHeight && r.top > 160;
    setAt({ top: above ? r.top - GAP : r.bottom + GAP, left, above });
  }, []);
  const hide = useCallback(() => setAt(null), []);

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
    <span className={cn('inline-flex shrink-0 align-middle print:hidden', className)}>
      <button ref={ref} type="button"
        aria-label={title ? t('About: {title}', { title }) : t('What is this?')}
        aria-describedby={at ? id : undefined}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        // A tap focuses and shows it; tapping anywhere else closes it.
        onClick={(e) => { e.stopPropagation(); show(); }}
        onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
        className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <Info className="h-4 w-4" aria-hidden />
      </button>
      {at ? createPortal(
        <span role="tooltip" id={id}
          style={{ top: at.top, left: at.left, width: WIDTH, transform: at.above ? 'translateY(-100%)' : undefined }}
          className="pointer-events-none fixed z-[200] rounded-lg border border-border bg-bg-card p-3 text-left text-sm font-normal normal-case leading-snug tracking-normal text-fg shadow-xl">
          {title ? <span className="mb-1 block font-semibold">{title}</span> : null}
          {text}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}
