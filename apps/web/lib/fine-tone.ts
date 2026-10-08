import type { Fine } from '@criticom/db';

/** A fine's status as a pill, the same on every console page. */
export const FINE_STATUS_TONE: Record<Fine['status'], string> = {
  Unpaid: 'bg-severity-medium/15 text-severity-medium-ink',
  'Partially Paid': 'bg-accent/15 text-accent',
  Paid: 'bg-severity-low/15 text-severity-low-ink',
  Disputed: 'bg-severity-critical/15 text-severity-critical-ink',
  Cancelled: 'bg-muted text-muted-foreground line-through',
};
