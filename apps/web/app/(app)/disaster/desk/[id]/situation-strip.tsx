'use client';

import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';

/**
 * The situation now (0113), from the latest sitreps and the casualty
 * register: the numbers command asks for first. A casualty recorded by name
 * counts as well as one reported as a number; the larger is shown.
 */
export function SituationStrip({ figures, counts, sheltered, children }: {
  figures: Record<string, number>; counts: { injured: number; deceased: number; missing: number }; sheltered: number; children?: React.ReactNode;
}) {
  const { t } = useT();
  const most = (a: number | undefined, b: number) => Math.max(a ?? 0, b);
  const tiles: Array<{ label: string; value: number; tone?: string }> = [
    { label: t('Injured'), value: most(figures.injured, counts.injured), tone: 'text-severity-medium-ink' },
    { label: t('Deceased'), value: most(figures.dead, counts.deceased), tone: 'text-severity-critical-ink' },
    { label: t('Missing'), value: most(figures.missing, counts.missing) },
    { label: t('Evacuated'), value: figures.people_evacuated ?? 0 },
    { label: t('Helped'), value: figures.people_helped ?? 0 },
    { label: t('Homes affected'), value: figures.households_affected ?? 0 },
    { label: t('In shelters now'), value: sheltered, tone: 'text-accent' },
  ];
  return (
    <section className="flex flex-wrap items-stretch gap-3" aria-label={t('The situation now')}>
      <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl border border-border bg-bg-card px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{x.label}</p>
            <p className={cn('text-2xl font-bold tabular-nums', x.value > 0 && x.tone)}>{x.value}</p>
          </div>
        ))}
      </div>
      {children ? <div className="flex items-center">{children}</div> : null}
    </section>
  );
}
