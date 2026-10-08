import Link from 'next/link';
import { listFines, paidByFine, type Fine } from '@criticom/api';
import { FINE_STATUSES, fineFigures, fineStage, isOverdue, NOTICE_TYPES, rand } from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { FINE_STATUS_TONE } from '@/lib/fine-tone';
import { fineQueryString, readFineQuery, toFineFilters, type FineQuery } from '@/lib/fines';
import type { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';

type Params = Record<string, string | string[] | undefined>;

/** Dashboard filters carry this prefix so they never collide with the page's own. */
const P = 'f_';

const PERIODS: Array<{ key: NonNullable<FineQuery['period']>; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
];

/** The dashboard URL with one filter changed and every other parameter kept. */
function hrefWith(params: Params, patch: Partial<Record<'period' | 'status' | 'type', string | undefined>>) {
  // "Overdue" travels as a status; readFineQuery() turns it into the overdue filter.
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) p.set(k, value);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v) p.set(`${P}${k}`, v);
    else p.delete(`${P}${k}`);
  }
  const s = p.toString();
  return `/dashboard${s ? `?${s}` : ''}#fines`;
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        'inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition-colors',
        on ? 'border-accent bg-accent text-bg' : 'border-border text-muted-foreground hover:bg-muted hover:text-fg',
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Fines and tickets on the command dashboards: the figures for the chosen
 * period and a filterable list of the latest notices, each linking to its
 * record. Only for those who see the whole register (captains, supervisors,
 * admins); RLS has the final word on the rows.
 */
export async function FinesPanel({
  supabase, params, userId,
}: {
  supabase: Awaited<ReturnType<typeof getSession>>['supabase'];
  params: Params;
  userId: string;
}) {
  const raw = readFineQuery(params, P);
  // This month by default; overdue fines are older, so Overdue looks at all time unless a period is chosen.
  const query: FineQuery = { ...raw, period: raw.period ?? (raw.overdue ? undefined : 'month') };
  let rows: Fine[] = [];
  let failed = false;
  try {
    rows = await listFines(supabase, toFineFilters(query, userId, 1000));
  } catch {
    failed = true;
  }
  const paid = await paidByFine(supabase, rows.map((r) => r.id)).catch(() => new Map<string, number>());
  const f = fineFigures(rows, paid);
  const registerHref = `/police/fines${fineQueryString({ period: query.period, status: query.status, overdue: query.overdue, type: query.type })}`;

  return (
    <Card id="fines" className="scroll-mt-20">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Fines &amp; tickets</CardTitle>
            <CardDescription>AARTO 01 road traffic notices and by-law notices served by Metro Police officers.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Link href={registerHref} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">Open register →</Link>
            <a href={`/police/fines/export${fineQueryString({ period: query.period, status: query.status, overdue: query.overdue, type: query.type })}`} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">CSV</a>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {PERIODS.map((p) => (
            <Chip key={p.key} href={hrefWith(params, { period: p.key })} on={query.period === p.key}>{p.label}</Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <Chip href={hrefWith(params, { type: undefined })} on={!query.type}>All notices</Chip>
          {NOTICE_TYPES.map((n) => (
            <Chip key={n.type} href={hrefWith(params, { type: n.type })} on={query.type === n.type}>{n.type}</Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <Chip href={hrefWith(params, { status: undefined })} on={!query.status && !query.overdue}>Any status</Chip>
          <Chip href={hrefWith(params, { status: 'Overdue' })} on={Boolean(query.overdue)}>Overdue</Chip>
          {FINE_STATUSES.map((s) => (
            <Chip key={s} href={hrefWith(params, { status: s })} on={query.status === s}>{s}</Chip>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        {failed ? (
          <p className="mx-6 rounded-md border border-severity-medium/40 bg-severity-medium/10 p-3 text-sm">
            Fines are not available yet. If migration 0057 has not been run, run it in Supabase.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-px border-y border-border bg-border sm:grid-cols-4 xl:grid-cols-7">
          {[
            { label: 'Charges', value: String(f.total), tone: '' },
            { label: 'Value issued', value: rand(f.value), tone: 'text-accent' },
            { label: 'Collected', value: rand(f.paid), tone: 'text-severity-low-ink' },
            { label: 'Outstanding', value: rand(f.outstanding), tone: 'text-severity-medium-ink' },
            { label: 'Overdue', value: `${f.overdue} · ${rand(f.overdueOwing)}`, tone: 'text-severity-critical-ink' },
            { label: 'Disputed', value: String(f.disputed), tone: 'text-severity-medium-ink' },
            { label: 'Cancelled', value: String(f.cancelled), tone: 'text-muted-foreground' },
          ].map((t) => (
            <div key={t.label} className="bg-bg-card px-5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t.label}</p>
              <p className={cn('mt-1 text-xl font-bold tabular-nums', t.tone)}>{t.value}</p>
            </div>
          ))}
        </div>
        <SimpleTable headers={['Fine', 'Served', 'Notice', 'Vehicle / infringer', 'Offence', 'Officer', 'Amount', 'Status']} empty="No fines in this view.">
          {rows.slice(0, 12).map((r) => (
            <Tr key={r.id}>
              <Td><Link href={`/police/fines/${r.id}`} className="font-mono text-sm font-bold text-accent hover:underline">{r.fine_number}</Link></Td>
              <Td className="whitespace-nowrap text-xs text-muted-foreground">
                {new Date(r.issued_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Td>
              <Td className="text-xs">{r.notice_type}</Td>
              <Td>
                <span className="font-mono text-xs font-bold">{r.vehicle_reg ?? '—'}</span>
                <div className="text-xs text-muted-foreground">{r.offender_name}</div>
              </Td>
              <Td className="max-w-56 truncate text-sm">{r.offence_description}</Td>
              <Td className="text-xs">{r.issued_by_name ?? '—'}</Td>
              <Td className="whitespace-nowrap font-mono text-sm">{rand(r.amount)}</Td>
              <Td>
                <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', FINE_STATUS_TONE[r.status])}>{r.status}</span>
                <div className={cn('mt-1 whitespace-nowrap text-[11px] font-semibold', isOverdue(r) ? 'text-severity-critical-ink' : 'text-muted-foreground')}>{fineStage(r)}</div>
              </Td>
            </Tr>
          ))}
        </SimpleTable>
        {rows.length > 12 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">
            Showing the latest 12 of {rows.length}. <Link href={registerHref} className="font-semibold text-accent hover:underline">See them all in the register</Link>.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
