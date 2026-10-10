/**
 * When something happened, the way a chat list says it: "Just now", "12 min",
 * the time today ("14:05"), "Yesterday", then the date ("05-08-2026"). South
 * African time throughout, so midnight is Durban's midnight.
 */

const SA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' });
const SA_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false });

/** "2026-08-05" → "05-08-2026". */
function dmy(isoDay: string) {
  const [y, m, d] = isoDay.split('-');
  return `${d}-${m}-${y}`;
}

export function chatTime(at: string | Date | null | undefined, now: Date = new Date()): string {
  if (!at) return '—';
  const when = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(when.getTime())) return '—';
  const mins = Math.floor((now.getTime() - when.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min`;
  const day = SA_DAY.format(when);
  if (day === SA_DAY.format(now)) return SA_TIME.format(when);
  const yesterday = SA_DAY.format(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (day === yesterday) return 'Yesterday';
  return dmy(day);
}
