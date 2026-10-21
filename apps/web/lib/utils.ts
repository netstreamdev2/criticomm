import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatElapsed } from '@criticom/api/cases';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formatter = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatSaTime(d: string | Date | null | undefined) {
  if (!d) return '—';
  return formatter.format(typeof d === 'string' ? new Date(d) : d);
}

/**
 * Escape text for an HTML string — map popups and tooltips are bound as HTML,
 * and incident types, addresses and names are typed in by people.
 */
export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function timeAgo(d: string | Date | null | undefined) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  // "45 min ago", "3 days 4 h ago", "5 months ago": never hundreds of days.
  return `${formatElapsed(mins)} ago`;
}
