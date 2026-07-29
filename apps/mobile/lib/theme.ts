/**
 * Mobile design tokens — mirrors the web app's `criticom-dark` theme
 * (apps/web/app/themes.css) so both surfaces read as one product.
 *
 * The responder app stays dark-only on purpose: crews work night shifts and
 * read screens in cabs, so a bright mode would hurt more than it helps.
 */

export const colors = {
  bg: '#050510',
  bgSoft: '#0b0b1a',
  bgCard: '#11112a',
  bgElevated: '#181838',
  border: '#1f1f3a',
  borderStrong: '#2e2e52',
  text: '#ffffff',
  textDim: '#c9cdd8',
  muted: '#9ca3af',
  primary: '#dc3545',
  primarySoft: 'rgba(220, 53, 69, 0.16)',
  accent: '#3b82f6',
  accentSoft: 'rgba(59, 130, 246, 0.16)',
  low: '#10b981',
  lowSoft: 'rgba(16, 185, 129, 0.16)',
  medium: '#f59e0b',
  mediumSoft: 'rgba(245, 158, 11, 0.16)',
  high: '#f97316',
  highSoft: 'rgba(249, 115, 22, 0.16)',
  critical: '#ef4444',
  criticalSoft: 'rgba(239, 68, 68, 0.16)',
} as const;

/** 4pt grid. */
export const space = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, '3xl': 32,
} as const;

export const radius = {
  sm: 6, md: 10, lg: 14, xl: 18, pill: 999,
} as const;

export const type = {
  display: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  h1: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  h2: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400' },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 13, fontWeight: '400' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  mono: { fontSize: 12, fontFamily: 'monospace', letterSpacing: 0.5 },
} as const;

/** Card elevation — Android needs `elevation`, iOS the shadow* props. */
export const elevation = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  raised: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

export function severityColor(sev: string): string {
  switch (sev) {
    case 'Critical': return colors.critical;
    case 'High': return colors.high;
    case 'Medium': return colors.medium;
    default: return colors.low;
  }
}

export function severityTint(sev: string): string {
  switch (sev) {
    case 'Critical': return colors.criticalSoft;
    case 'High': return colors.highSoft;
    case 'Medium': return colors.mediumSoft;
    default: return colors.lowSoft;
  }
}

/** Status → accent colour, matching the web incident-status badges. */
export function statusColor(status: string): string {
  switch (status) {
    case 'Pending': return colors.muted;
    case 'Dispatched': return colors.accent;
    case 'En Route': return colors.accent;
    case 'Arrived':
    case 'On Scene': return colors.medium;
    case 'Transporting': return colors.high;
    case 'Resolved':
    case 'Closed': return colors.low;
    case 'Cancelled': return colors.muted;
    default: return colors.accent;
  }
}

/** "4 min ago" / "2 h ago" — responders care about elapsed time, not clocks. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} d ago`;
}
