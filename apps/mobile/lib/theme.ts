/** Shared palette — mirrors the web app's dark tokens. */
export const colors = {
  bg: '#0b1220',
  bgSoft: '#111a2b',
  bgCard: '#141e33',
  border: '#26324a',
  text: '#ffffff',
  muted: '#8b9bb4',
  primary: '#2563eb',
  accent: '#38bdf8',
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
} as const;

export function severityColor(sev: string): string {
  switch (sev) {
    case 'Critical': return colors.critical;
    case 'High': return colors.high;
    case 'Medium': return colors.medium;
    default: return colors.low;
  }
}
