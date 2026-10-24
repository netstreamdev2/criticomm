import type { DisasterAssessment, StandbyRecord } from '@criticom/api';
import { RELIEF_ITEMS, assessmentTotals } from '@criticom/db/disaster';
import type { Translate as T } from '@criticom/db/i18n';
import { formatSaTime, timeAgo } from '@/lib/utils';

/** A call's figures from every place assessed (0107), in one line of plain numbers. */
export function AssessmentFigures({ rows, t }: { rows: readonly DisasterAssessment[]; t: T }) {
  const s = assessmentTotals(rows);
  const relief = RELIEF_ITEMS.filter((r) => (s[r.key] ?? 0) > 0).map((r) => `${s[r.key]} ${t(r.label).toLowerCase()}`);
  const figure = (n: number | undefined, label: string) => (
    <div><p className="text-2xl font-bold">{n ?? 0}</p><p className="text-xs uppercase text-muted-foreground">{label}</p></div>
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {figure(s.places, t('Places'))}
        {figure(s.households_affected, t('Households'))}
        {figure(s.people_displaced, t('Displaced'))}
        {figure(s.homes_destroyed, t('Homes destroyed'))}
        {figure(s.homes_damaged, t('Homes damaged'))}
        {figure(s.people_sheltered, t('Sheltered'))}
      </div>
      {(s.injured ?? 0) + (s.deaths ?? 0) + (s.missing ?? 0) > 0 ? (
        <p className="text-sm font-semibold text-severity-critical-ink">
          {t('{injured} injured · {deaths} dead · {missing} missing', { injured: s.injured ?? 0, deaths: s.deaths ?? 0, missing: s.missing ?? 0 })}
        </p>
      ) : null}
      {relief.length ? <p className="text-sm text-muted-foreground">{t('Relief handed out: {list}', { list: relief.join(', ') })}</p> : null}
    </div>
  );
}

/** Every place assessed on a call, newest last: for the call's page. */
export function AssessmentList({ rows, t }: { rows: readonly DisasterAssessment[]; t: T }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((a) => (
        <li key={a.id} className="space-y-1 px-5 py-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">{a.place}{a.ward ? <span className="font-normal text-muted-foreground"> · {t('Ward {ward}', { ward: a.ward })}</span> : null}</p>
            <p className="text-xs text-muted-foreground">{t(a.hazard)} · {a.filed_by_name ?? '—'} · {formatSaTime(a.filed_at)}</p>
          </div>
          <p>
            {t('{households} households, {people} people affected, {displaced} displaced; {destroyed} homes destroyed, {damaged} damaged', {
              households: a.households_affected, people: a.people_affected, displaced: a.people_displaced,
              destroyed: a.homes_destroyed, damaged: a.homes_damaged,
            })}
          </p>
          {a.people_sheltered > 0 ? <p>{t('{n} sheltered at {hall}', { n: a.people_sheltered, hall: a.shelter_name ?? '—' })}</p> : null}
          {a.needs.length ? <p className="text-muted-foreground">{t('Needs: {list}', { list: a.needs.map((n) => t(n)).join(', ') })}</p> : null}
          {a.services.length ? <p className="text-muted-foreground">{t('Services hit: {list}', { list: a.services.map((n) => t(n)).join(', ') })}</p> : null}
          {a.notes ? <p className="whitespace-pre-wrap text-muted-foreground">{a.notes}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** Who is on standby now, for the call centre and the JOC (0107): a number to call, any kit missing. */
export function StandbyList({ rows, t }: { rows: readonly StandbyRecord[]; t: T }) {
  if (!rows.length) return <p className="p-5 text-sm text-muted-foreground">{t('Nobody is on standby.')}</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
          <div>
            <p className="font-semibold">{s.name ?? '—'}</p>
            <p className="text-xs text-muted-foreground">{t('On standby since {when}', { when: timeAgo(s.started_at) })}</p>
            {s.kit_missing.length ? <p className="text-xs font-semibold text-severity-medium-ink">{t('Kit missing: {list}', { list: s.kit_missing.map((k) => t(k)).join(', ') })}</p> : null}
          </div>
          {s.contact_number ? (
            <a href={`tel:${s.contact_number}`} className="rounded-md border border-border px-3 py-1.5 font-mono text-sm text-accent hover:bg-muted">{s.contact_number}</a>
          ) : <span className="text-xs text-muted-foreground">{t('No number given')}</span>}
        </li>
      ))}
    </ul>
  );
}
