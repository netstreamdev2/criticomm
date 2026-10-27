'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { InfoDot } from '@/components/info-dot';
import { cn } from '@/lib/utils';

const STORE = 'criticom.disaster.folds';

function remembered(): Record<string, boolean> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    return saved && typeof saved === 'object' ? (saved as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/**
 * A tile on the Disaster screens that folds away with one press on its
 * heading, and stays the way this person left it in this browser. Folded,
 * the heading can still say what is inside (summary). The (i) explains the
 * tile. The body stays on the page while folded, so a half-typed form is
 * kept. data-guide marks it for Criti's tour.
 */
export function Fold({ id, title, icon: Icon, info, summary, actions, defaultOpen = true, className, bodyClassName, children }: {
  /** Where the open or folded state is remembered; one per tile. */
  id: string;
  title: ReactNode;
  icon?: LucideIcon;
  info?: string;
  summary?: ReactNode;
  /** Buttons beside the heading, shown while open. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  useEffect(() => {
    const saved = remembered()[id];
    if (typeof saved === 'boolean') setOpen(saved);
  }, [id]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...remembered(), [id]: next }));
    } catch {
      /* private window: folds until the page reloads */
    }
  };

  return (
    <section data-guide={id} className={cn('overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm', className)}>
      <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2', open && 'border-b border-border')}>
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={bodyId}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left font-semibold hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <ChevronRight className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
          {Icon ? <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden /> : null}
          <span className="min-w-0">{title}</span>
          {!open && summary ? <span className="min-w-0 truncate text-sm font-normal text-muted-foreground">· {summary}</span> : null}
        </button>
        {info ? <InfoDot text={info} /> : null}
        {open && actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {/* Classes only while open: a display class would beat the hidden attribute. */}
      <div id={bodyId} hidden={!open} className={open ? bodyClassName : undefined}>{children}</div>
    </section>
  );
}
