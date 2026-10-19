/** The duty office screens share these, so every form and table looks the same. */
export const ox = {
  input: 'h-9 w-full rounded-md border border-border bg-bg-soft px-2.5 text-sm disabled:opacity-60',
  area: 'min-h-[4.5rem] w-full rounded-md border border-border bg-bg-soft px-2.5 py-2 text-sm',
  label: 'mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
  primary: 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60',
  secondary: 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-60',
  danger: 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-severity-critical/50 px-3 text-sm font-semibold text-severity-critical hover:bg-severity-critical/10 disabled:opacity-60',
  card: 'rounded-lg border border-border bg-bg-card',
  cardHead: 'flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3',
  cardTitle: 'flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide',
  th: 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
  td: 'px-3 py-2 align-top',
  row: 'border-t border-border',
  pill: 'inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase',
} as const;

/** Oracle's ranks first, then whatever the register holds. */
export const BASE_RANKS = ['ST', 'OC', 'AO', 'PC'];
