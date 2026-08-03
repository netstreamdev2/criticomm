import Link from 'next/link';

const TABS = [
  { href: '/performance', label: 'Overview' },
  { href: '/performance/mine', label: 'My Performance' },
  { href: '/performance/reports', label: 'Reports' },
  { href: '/performance/rollup', label: 'KPI Rollup' },
  { href: '/performance/operational', label: 'Operational KPIs' },
  { href: '/performance/role-kpis', label: 'Role KPIs' },
  { href: '/performance/plans', label: 'Appraisal Plans' },
  { href: '/performance/kpis', label: 'KPI Config' },
];

export function PerfNav({ active }: { active: string }) {
  return (
    <nav className="flex flex-wrap justify-center gap-2 border-b border-border pb-3">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
            t.href === active
              ? 'bg-primary/15 text-fg'
              : 'text-fg/60 hover:bg-muted hover:text-fg'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Default From/To = current cycle window (1 Jul → now) unless overridden. */
export function cycleWindow(fromParam?: string, toParam?: string) {
  const now = new Date();
  const cycleStart = now.getMonth() >= 6
    ? new Date(now.getFullYear(), 6, 1)
    : new Date(now.getFullYear() - 1, 6, 1);
  const from = fromParam ?? cycleStart.toISOString().slice(0, 10);
  const to = toParam ?? new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  return { from, to };
}
