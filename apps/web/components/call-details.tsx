import { DETAIL_FIELDS, QUESTION_PREFIX, catalogueType, sapsCategories, type IncidentDetails } from '@criticom/db';
import type { Translate } from '@criticom/db/i18n';

/**
 * What the call taker filled in for the type (0077): its code, the SAPS
 * category it may fall under, and each detail ("What was taken: Cellphone,
 * TV"). Shown on the dispatch page and the call page. Nothing shows for a
 * call with none.
 */
export function CallDetails({ incident, t }: {
  incident: { incident_type: string; incident_code?: string | null; details?: IncidentDetails | null };
  t: Translate;
}) {
  const details = incident.details ?? {};
  const order = catalogueType(incident.incident_type)?.details ?? [];
  const keys = [...order.filter((k) => k in details), ...Object.keys(details).filter((k) => !order.includes(k))];
  const lines = keys
    .map((k) => ({
      key: k,
      label: k.startsWith(QUESTION_PREFIX) ? k.slice(QUESTION_PREFIX.length) : DETAIL_FIELDS[k]?.label,
      value: details[k],
    }))
    .filter((l): l is { key: string; label: string; value: string | string[] } => Boolean(l.label) && l.value !== undefined);
  const saps = sapsCategories(incident.incident_type, details);
  if (!lines.length && !incident.incident_code && !saps.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-xs">
        {incident.incident_code ? (
          <span className="rounded-full border border-border bg-bg-soft px-2.5 py-0.5 font-mono font-semibold">{incident.incident_code}</span>
        ) : null}
        {saps.length ? (
          <span className="rounded-full border border-border bg-bg-soft px-2.5 py-0.5" title={t('Suggested from the type')}>
            {/* The official SAPS names, as SAPS writes them. */}
            {t('SAPS')}: {saps.join(` ${t('or')} `)}
          </span>
        ) : null}
      </div>
      {lines.length ? (
        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
          {lines.map((l) => (
            <div key={l.key} className="min-w-0">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t(l.label)}</dt>
              <dd className="break-words">{Array.isArray(l.value) ? l.value.map((v) => t(v)).join(', ') : t(l.value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
