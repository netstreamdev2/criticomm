/**
 * The incidents search box: one line of text matched against the incident
 * number, type, address, status, severity and the day it came in. Every word
 * typed must match somewhere, so "critical today" and "robbery 05-08-2026"
 * narrow the list the way an officer would expect.
 */

export type Searchable = {
  incident_number: string;
  incident_type: string;
  incident_severity: string;
  location_address: string | null;
  suburb?: string | null;
  status: string;
  /** When the call reached the officer's department, else when it was logged. */
  at: string | null;
};

const SA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
});

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Every way a day might be typed: 2026-08-05, 05-08-2026, 05/08/2026, 5/8/2026, today, yesterday. */
function dayForms(at: string | null, now: Date): string[] {
  if (!at) return [];
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return [];
  const iso = SA_DAY.format(when);
  const [y, m, d] = iso.split('-') as [string, string, string];
  const forms = [iso, `${d}-${m}-${y}`, `${d}/${m}/${y}`, `${Number(d)}/${Number(m)}/${y}`, `${d}.${m}.${y}`];
  if (iso === SA_DAY.format(now)) forms.push('today');
  if (iso === SA_DAY.format(new Date(now.getTime() - 86_400_000))) forms.push('yesterday');
  return forms;
}

export function incidentHaystack(i: Searchable, now: Date = new Date()): string {
  return fold([
    i.incident_number, i.incident_type, i.incident_severity, i.location_address ?? '', i.suburb ?? '', i.status,
    ...dayForms(i.at, now),
  ].join(' '));
}

export function matchesQuery(haystack: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.every((w) => haystack.includes(w));
}

/** 850 m, 4.2 km, 23 km. */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}
