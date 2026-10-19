import Link from 'next/link';
import { Activity, LayoutDashboard, SlidersHorizontal, Table2, type LucideIcon } from 'lucide-react';
import { STANDING_TONE, reportKind, formsOf, type ReportRecord, type ReportStanding } from '@criticom/api';
import { POLICE_REPORTS_PATH } from '@criticom/db';
import { formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

/** The four pages, each in its own colour (V4 Reports → Management, plus records, activity and a specialised report). */
export const CENTRE_PAGES: Array<{ id: string; href: string; label: string; blurb: string; tone: string; icon: LucideIcon }> = [
  { id: 'management', href: `${POLICE_REPORTS_PATH}/management`, label: 'Reports management', blurb: 'Totals, graphs and each form at a glance.', tone: '#6366f1', icon: LayoutDashboard },
  { id: 'activity', href: `${POLICE_REPORTS_PATH}/activity`, label: 'Recent activity', blurb: 'Reports as officers file them, newest first.', tone: '#06b6d4', icon: Activity },
  { id: 'records', href: `${POLICE_REPORTS_PATH}/records`, label: 'Records', blurb: 'Every report: search, filter and export.', tone: '#10b981', icon: Table2 },
  { id: 'specialised', href: `${POLICE_REPORTS_PATH}/specialised`, label: 'Specialised report', blurb: 'Choose forms, dates and people; get a PDF.', tone: '#d946ef', icon: SlidersHorizontal },
];

const SEVERITY_TONE: Record<string, string> = { Low: '#22c55e', Medium: '#f59e0b', High: '#f97316', Critical: '#ef4444' };

/** The page heading under the police badge, with the four pages as colour-coded tabs. */
export async function CentreHeader({ title, subtitle, active, actions }: {
  title: string;
  subtitle: string;
  active?: string;
  actions?: React.ReactNode;
}) {
  const { t } = await requestT();
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/dmps-badge.png" alt={t('Durban Metropolitan Police Service')} className="h-14 w-14 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('Durban Metropolitan Police Service')}</p>
            <h1 className="text-2xl font-bold leading-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <nav className="flex flex-wrap gap-2" aria-label={t('Police reports')}>
        <Link
          href={POLICE_REPORTS_PATH}
          className={`frost-pill rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? 'border-border text-muted-foreground hover:text-fg' : 'border-fg/40'}`}
        >
          {t('All reports')}</Link>
        {CENTRE_PAGES.map((p) => {
          const on = p.id === active;
          return (
            <Link
              key={p.id}
              href={p.href}
              aria-current={on ? 'page' : undefined}
              className="frost-pill inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={on
                ? { borderColor: p.tone, backgroundColor: `${p.tone}22`, color: p.tone }
                : { borderColor: `${p.tone}55` }}
            >
              <p.icon className="h-3.5 w-3.5" style={{ color: p.tone }} aria-hidden />
              {p.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** A count in a coloured tile. */
export function Kpi({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone: string; hint?: string }) {
  return (
    <div
      className="frost relative overflow-hidden rounded-xl border p-4"
      style={{ borderColor: `${tone}55`, backgroundImage: `linear-gradient(135deg, ${tone}24, transparent 70%)` }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: tone }} aria-hidden />
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums" style={{ color: tone }}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Where a report stands, in its colour. */
export function StandingPill({ standing }: { standing: ReportStanding }) {
  const tone = STANDING_TONE[standing];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{ borderColor: `${tone}66`, backgroundColor: `${tone}18`, color: tone }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone }} aria-hidden />
      {standing}
    </span>
  );
}

/** The forms a report carries, as short coloured codes. */
export function RecordForms({ record }: { record: Pick<ReportRecord, 'forms'> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {formsOf(record).map((id) => {
        const k = reportKind(id);
        if (!k) return null;
        return (
          <span
            key={id}
            title={k.label}
            className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
            style={{ backgroundColor: `${k.tone}22`, boxShadow: `inset 0 0 0 1px ${k.tone}77`, color: k.tone }}
          >
            {k.code}
          </span>
        );
      })}
    </span>
  );
}

export function SeverityText({ severity }: { severity: string | null }) {
  if (!severity) return <span className="text-muted-foreground">—</span>;
  return <span className="font-semibold" style={{ color: SEVERITY_TONE[severity] ?? undefined }}>{severity}</span>;
}

/** One report as it was filed: when, who, which call, which forms, and where it stands (V4's Recent Activity row). */
export async function ActivityRow({ r }: { r: ReportRecord }) {
  const { t } = await requestT();
  const tone = reportKind(formsOf(r)[0]!)?.tone ?? '#3b82f6';
  return (
    <li>
      <Link
        href={`${POLICE_REPORTS_PATH}/report/${r.id}`}
        className="grid gap-x-4 gap-y-1 rounded-lg border border-border/70 bg-bg-soft p-3 transition-colors hover:bg-bg sm:grid-cols-[7.5rem_1fr_auto]"
        style={{ borderLeft: `4px solid ${tone}` }}
      >
        <span className="text-xs text-muted-foreground tabular-nums">{formatSaTime(r.at)}</span>
        <span className="min-w-0 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold">{r.caseNumber}</span>
            <RecordForms record={r} />
            {r.arrest ? <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-500">{t('Arrest')}</span> : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[r.officer && `${r.officer}${r.badge ? ` (${r.badge})` : ''}`, r.station, r.location].filter(Boolean).join(' · ') || '—'}
          </span>
          {r.incidentNumber ? (
            <span className="block truncate text-xs text-muted-foreground">
              {t('Call {incidentNumber}{value}{value2}', { incidentNumber: r.incidentNumber, value: r.incidentType ? ` · ${r.incidentType}` : '', value2: r.dispatcher ? ` · dispatched by ${r.dispatcher}` : '' })}
              {r.severity ? <> · <SeverityText severity={r.severity} /></> : null}
            </span>
          ) : null}
        </span>
        <span className="self-center"><StandingPill standing={r.standing} /></span>
      </Link>
    </li>
  );
}

/** Horizontal bars, each in its colour: the busiest stations and officers. */
export function BarList({ items, tone, empty }: { items: Array<{ name: string; count: number }>; tone: string; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.name} className="text-sm">
          <div className="mb-0.5 flex justify-between gap-2">
            <span className="truncate">{i.name}</span>
            <span className="font-semibold tabular-nums">{i.count}</span>
          </div>
          <div className="h-2 rounded-full bg-bg-soft">
            <div className="h-2 rounded-full" style={{ width: `${(i.count / max) * 100}%`, backgroundColor: tone }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** What a page shows when the database gives this person no police reports. */
export async function NoReports() {
  const { t } = await requestT();
  return (
    <div className="frost rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {t('No police reports yet. They appear here as officers file them.')}</div>
  );
}
