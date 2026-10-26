'use client';

import Link from 'next/link';
import { ChevronRight, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';

export type TileTone = 'critical' | 'warn' | 'info' | 'calm' | 'plain';
/** Each tile's colour: the bar on top, the icon and the figure. */
const TONE: Record<TileTone, { rail: string; icon: string; value: string }> = {
  critical: { rail: 'border-t-severity-critical', icon: 'bg-severity-critical/15 text-severity-critical-ink', value: 'text-severity-critical-ink' },
  warn: { rail: 'border-t-severity-medium', icon: 'bg-severity-medium/15 text-severity-medium-ink', value: 'text-severity-medium-ink' },
  info: { rail: 'border-t-accent', icon: 'bg-accent/15 text-accent', value: 'text-accent' },
  calm: { rail: 'border-t-severity-low', icon: 'bg-severity-low/15 text-severity-low-ink', value: '' },
  plain: { rail: 'border-t-border', icon: 'bg-muted text-muted-foreground', value: '' },
};

export type TileItem = { key: string; label: string; note?: string | null; href?: string | null; urgent?: boolean };

const SHOWN = 6;

/**
 * One figure, big and coloured by how it stands. Hovered, or tapped on a
 * phone or a touch screen, it says what it counts and lists what is behind
 * the number, each a link where there is one.
 */
export function InfoTile({ label, value, hint, icon, tone, explain, items, more, align = 'left', size = 'large' }: {
  label: string; value: string | number; hint?: string; icon: ReactNode; tone: TileTone;
  explain: string; items?: TileItem[]; more?: { href: string; label: string }; align?: 'left' | 'right'; size?: 'large' | 'small';
}) {
  const { t } = useT();
  const list = items ?? [];
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the explanation on touch screens and keyboards.
    <div tabIndex={0} className="group relative rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <div className={cn('h-full rounded-2xl border border-t-4 border-border bg-bg-card shadow-sm transition-colors group-hover:bg-muted group-focus:bg-muted',
        TONE[tone].rail, size === 'large' ? 'p-4' : 'px-4 py-2.5')}>
        <div className="flex items-center justify-between gap-2">
          <p className={cn('flex items-center gap-1.5 font-semibold', size === 'large' ? 'text-sm' : 'text-xs')}>
            {label}<Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          </p>
          {size === 'large' ? <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', TONE[tone].icon)}>{icon}</span> : null}
        </div>
        <p className={cn('font-bold tabular-nums leading-none', TONE[tone].value, size === 'large' ? 'mt-3 text-4xl' : 'mt-1 text-2xl')}>{value}</p>
        {hint && size === 'large' ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
      </div>

      <div role="tooltip" className={cn('invisible absolute top-full z-40 w-80 max-w-[calc(100vw-2rem)] pt-2 opacity-0 transition-opacity',
        'group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100', align === 'right' ? 'right-0' : 'left-0')}>
        <div className="rounded-xl border border-border bg-bg-card p-4 text-sm shadow-2xl">
          <p className="font-semibold">{label}</p>
          <p className="mt-1 text-muted-foreground">{explain}</p>
          {list.length ? (
            <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
              {list.slice(0, SHOWN).map((x) => {
                const body = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{x.label}</span>
                      {x.note ? <span className={cn('block text-xs', x.urgent ? 'text-severity-critical-ink' : 'text-muted-foreground')}>{x.note}</span> : null}
                    </span>
                    {x.href ? <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
                  </>
                );
                return (
                  <li key={x.key}>
                    {x.href
                      ? <Link href={x.href} className="-mx-2 flex items-start gap-2 rounded-md px-2 py-1 hover:bg-muted">{body}</Link>
                      : <div className="flex items-start gap-2 py-1">{body}</div>}
                  </li>
                );
              })}
              {list.length > SHOWN ? <li className="text-xs text-muted-foreground">{t('and {n} more', { n: list.length - SHOWN })}</li> : null}
            </ul>
          ) : null}
          {more ? <Link href={more.href} className="mt-3 inline-block font-semibold text-accent hover:underline">{more.label}</Link> : null}
        </div>
      </div>
    </div>
  );
}
