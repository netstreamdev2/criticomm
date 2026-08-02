'use client';

import { useState } from 'react';
import { ChevronRight, Building2, Users, MapPin, User } from 'lucide-react';
import { type Rollup, type RollupNode, formatDuration } from '@criticom/api/rollup';

const LEVEL_ICON = {
  organisation: Building2,
  department: Users,
  unit: MapPin,
  individual: User,
} as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Drill-down explorer. Each level shows the same six numbers so a chief and a
 * station commander are reading the same metric, not two different ones that
 * happen to share a name.
 */
export function RollupExplorer({ rollup, days }: { rollup: Rollup; days: number }) {
  const [path, setPath] = useState<RollupNode[]>([rollup.root]);
  const current = path[path.length - 1]!;

  const setDays = (d: number) => {
    const u = new URL(window.location.href);
    u.searchParams.set('days', String(d));
    window.location.href = u.toString();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Breadcrumb — the drill path, clickable back up */}
        <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Drill path">
          {path.map((n, i) => (
            <span key={n.key} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : null}
              <button
                type="button"
                onClick={() => setPath(path.slice(0, i + 1))}
                disabled={i === path.length - 1}
                className={i === path.length - 1
                  ? 'font-semibold text-fg'
                  : 'text-accent hover:underline'}
              >
                {n.label}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          {[7, 30, 90, 365].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)}
              className={`h-8 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                d === days ? 'bg-primary text-primary-fg' : 'border border-border hover:bg-muted'}`}>
              {d === 365 ? '1y' : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {rollup.truncated ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          More incidents in this window than the analysis cap. The figures below cover the most
          recent portion only — narrow the window before quoting them.
        </div>
      ) : null}

      {/* Headline metrics for whatever level we're on */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Calls" value={current.kpis.volume.toLocaleString()}
          sub={`${current.kpis.open} still open`} />
        <Metric label="Time to dispatch (p50)" value={formatDuration(current.kpis.timeToDispatchP50)}
          sub={`p90 ${formatDuration(current.kpis.timeToDispatchP90)}`} />
        <Metric label="Total response (p50)" value={formatDuration(current.kpis.totalResponseP50)}
          sub={`p90 ${formatDuration(current.kpis.totalResponseP90)}`} />
        <Metric label="Critical response (p90)" value={formatDuration(current.kpis.criticalTotalResponseP90)}
          sub="Critical & High only" tone="accent" />
        <Metric label="Travel time (p50)" value={formatDuration(current.kpis.travelP50)}
          sub={`p90 ${formatDuration(current.kpis.travelP90)}`} />
        <Metric label="Reached a crew" value={pct(current.kpis.dispatchRate)}
          sub={`${current.kpis.dispatched} of ${current.kpis.volume}`} />
        <Metric label="Crew on scene" value={pct(current.kpis.arrivalRate)}
          sub={`${current.kpis.arrived} arrived`} />
        <Metric label="Closed" value={pct(current.kpis.closureRate)}
          sub={`median ${formatDuration(current.kpis.resolutionP50)}`} />
      </div>

      {/* Severity mix */}
      <div className="rounded-lg border border-border bg-bg-card p-3">
        <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
          Severity mix
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(current.kpis.bySeverity)
            .sort((a, b) => b[1] - a[1])
            .map(([sev, n]) => (
              <span key={sev} className="severity-pill" data-sev={sev}>
                {sev} · {n}
              </span>
            ))}
          {Object.keys(current.kpis.bySeverity).length === 0 ? (
            <span className="text-sm text-muted-foreground">No calls in this window.</span>
          ) : null}
        </div>
      </div>

      {/* Next level down */}
      {current.children && current.children.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-bg-card">
          <table className="w-full min-w-max text-sm">
            <thead className="border-b border-border bg-bg-soft/60">
              <tr>
                {['', 'Calls', 'To dispatch p50', 'Total response p50', 'Critical p90', 'On scene', 'Closed', ''].map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {current.children.map((child) => {
                const Icon = LEVEL_ICON[child.level];
                const canDrill = Boolean(child.children?.length);
                return (
                  <tr key={child.key} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2 font-medium">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {child.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">{child.kpis.volume.toLocaleString()}</td>
                    <td className="px-3 py-2">{formatDuration(child.kpis.timeToDispatchP50)}</td>
                    <td className="px-3 py-2">{formatDuration(child.kpis.totalResponseP50)}</td>
                    <td className="px-3 py-2">{formatDuration(child.kpis.criticalTotalResponseP90)}</td>
                    <td className="px-3 py-2">{pct(child.kpis.arrivalRate)}</td>
                    <td className="px-3 py-2">{pct(child.kpis.closureRate)}</td>
                    <td className="px-3 py-2 text-right">
                      {canDrill ? (
                        <button type="button" onClick={() => setPath([...path, child])}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                          Drill in <ChevronRight className="h-3 w-3" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {current.level === 'individual'
            ? 'Individual level — no further breakdown.'
            : 'No breakdown available for this selection.'}
        </p>
      )}
    </div>
  );
}

function Metric({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: 'accent' }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold leading-tight ${tone === 'accent' ? 'text-accent' : ''}`}>
        {value}
      </p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
