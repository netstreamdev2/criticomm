/**
 * The disaster after-action report (post-mortem, migration 0065): the
 * Disaster Management officer's close-out of an incident, as data. Sections
 * and labels follow V4's Disaster/PostMortem form. The phone and the console
 * build their forms from these; file_post_mortem() checks the same things
 * again and has the final word. Keys are post_mortem_reports columns.
 */

export type PostMortemField = {
  key: string;
  label: string;
  kind: 'datetime' | 'count' | 'multiline' | 'text';
  placeholder?: string;
  required?: boolean;
};

export type PostMortemSection = { id: string; title: string; icon: string; fields: PostMortemField[] };

export const POST_MORTEM_SECTIONS: PostMortemSection[] = [
  {
    id: 'overview', title: 'Incident Overview', icon: 'information-circle-outline', fields: [
      { key: 'start_time', label: 'Start Time', kind: 'datetime', required: true },
      { key: 'end_time', label: 'Resolved Time', kind: 'datetime', required: true },
    ],
  },
  {
    id: 'impact', title: 'Impact Metrics', icon: 'people-outline', fields: [
      { key: 'injuries', label: 'Confirmed Injuries', kind: 'count' },
      { key: 'fatalities', label: 'Confirmed Fatalities', kind: 'count' },
      { key: 'displaced_people', label: 'Displaced Persons (Requiring Shelter)', kind: 'count' },
    ],
  },
  {
    id: 'analysis', title: 'Operational Analysis', icon: 'analytics-outline', fields: [
      { key: 'root_cause', label: 'Root Cause Analysis', kind: 'multiline', placeholder: 'What caused this incident?', required: true },
      { key: 'lessons_learned', label: 'Lessons Learned / Recommendations', kind: 'multiline', placeholder: 'How can response be improved in the future?', required: true },
      { key: 'reporting_officer', label: 'Reporting Officer Name', kind: 'text', placeholder: 'Commander / Dispatcher Name', required: true },
    ],
  },
];

export const POST_MORTEM_FIELDS: PostMortemField[] = POST_MORTEM_SECTIONS.flatMap((s) => s.fields);

/** "2026-10-10 14:05": the date and time as typed on the phone and the console. */
const DATETIME = /^\d{4}-\d{2}-\d{2}[ T]([01]\d|2[0-3]):[0-5]\d$/;

/** A typed date and time as an instant, read as South African time. */
export function saInstant(v: string | null | undefined): Date | null {
  const s = (v ?? '').trim();
  if (!DATETIME.test(s)) return null;
  const d = new Date(`${s.replace(' ', 'T')}:00+02:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** An instant as "YYYY-MM-DD HH:MM" in South African time. */
export function saStamp(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour') === '24' ? '00' : p('hour')}:${p('minute')}`;
}

/** Hours between the start and the resolved time, to two places. */
export function durationHours(start: string, end: string): number | null {
  const a = saInstant(start);
  const b = saInstant(end);
  if (!a || !b || b < a) return null;
  return Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 100) / 100;
}

/** What file_post_mortem() would refuse, with the fields to mark. */
export function postMortemProblems(answers: Record<string, string>): Array<{ message: string; keys: string[] }> {
  const out: Array<{ message: string; keys: string[] }> = [];
  const v = (k: string) => (answers[k] ?? '').trim();
  for (const f of POST_MORTEM_FIELDS) {
    if (f.required && !v(f.key)) out.push({ message: `${f.label} is required.`, keys: [f.key] });
  }
  for (const k of ['start_time', 'end_time']) {
    if (v(k) && !saInstant(v(k))) out.push({ message: `${k === 'start_time' ? 'Start Time' : 'Resolved Time'} must be a date and time (YYYY-MM-DD HH:MM).`, keys: [k] });
  }
  const a = saInstant(v('start_time'));
  const b = saInstant(v('end_time'));
  if (a && b && b < a) out.push({ message: 'Resolved Time cannot be before Start Time.', keys: ['end_time'] });
  if (b && b.getTime() > Date.now() + 5 * 60_000) out.push({ message: 'Resolved Time cannot be in the future.', keys: ['end_time'] });
  for (const k of ['injuries', 'fatalities', 'displaced_people']) {
    if (v(k) && !/^\d{1,6}$/.test(v(k))) out.push({ message: 'Counts must be whole numbers.', keys: [k] });
  }
  return out;
}

export function validatePostMortem(answers: Record<string, string>): string[] {
  return postMortemProblems(answers).map((p) => p.message);
}

/** The answers as file_post_mortem() takes them: trimmed, counts defaulting to 0. */
export function postMortemPayload(answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of POST_MORTEM_FIELDS) {
    const v = (answers[f.key] ?? '').trim();
    out[f.key] = f.kind === 'count' ? (v || '0') : v;
  }
  return out;
}
