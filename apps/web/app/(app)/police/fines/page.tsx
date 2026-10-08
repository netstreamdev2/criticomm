import Link from 'next/link';
import { listFines, paidByFine, type Fine } from '@criticom/api';
import {
  canIssueFines, canViewAllFines, FINE_STATUSES, fineFigures, fineStage, isOverdue, maskId, NOTICE_TYPES, rand, STAGE_INFO,
} from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { byOfficer, fineQueryString, readFineQuery, toFineFilters } from '@/lib/fines';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { FINE_STATUS_TONE as STATUS_TONE } from '@/lib/fine-tone';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fines · HikTech' };


const FIELD = 'h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

function Stat({ label, value, sub, tone = 'text-fg' }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1.5 text-2xl font-bold tabular-nums', tone)}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/**
 * The fines register (migration 0057). Officers see the fines they issued;
 * captains, supervisors and admins see every Metro Police fine. Filters live
 * in the URL, so the view can be bookmarked and exported exactly as shown.
 */
export default async function FinesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireFeaturePage('web.enforcement');
  const { supabase, role, silo, userId } = await getSession();
  const query = readFineQuery(await searchParams);
  const command = canViewAllFines({ role, silo });
  const issuer = canIssueFines({ role, silo });

  let rows: Fine[] = [];
  let loadError: string | null = null;
  try {
    rows = byOfficer(await listFines(supabase, toFineFilters(query, userId)), query.officer);
  } catch (e) {
    loadError = invitationErrorMessage(e, 'The fines register could not be loaded.');
  }
  const paid = await paidByFine(supabase, rows.map((r) => r.id)).catch(() => new Map<string, number>());
  const figures = fineFigures(rows, paid);
  const officers = [...new Set(rows.map((r) => r.issued_by_name).filter((n): n is string => Boolean(n)))].sort();
  const filtered = Boolean(query.q || query.type || query.status || query.overdue || query.from || query.to || query.period || query.mine || query.officer);
  const typeMax = Math.max(1, ...Object.values(figures.byType));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Metro Police · Enforcement</p>
          <h1 className="mt-1 text-2xl font-bold">{command ? 'Fines register' : 'My fines'}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Road traffic offences on AARTO 01 notices; by-law offences on Section 56 (offender present) or Section 341
            (unattended vehicle) notices. Every charge has its own FN- number, and a served notice can never be edited
            or deleted — only cancelled, with a reason.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {issuer ? (
            <Link href="/police/fines/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Capture paper notice
            </Link>
          ) : null}
          {command ? (
            <Link href="/police/fines/payments" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
              Import payments
            </Link>
          ) : null}
          {command ? (
            <Link href="/police/fines/account" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
              Account look-up
            </Link>
          ) : null}
          {command ? (
            <Link href="/police/fines/offences" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
              Charge book
            </Link>
          ) : null}
          <a
            href={`/police/fines/export${fineQueryString(query)}`}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted"
          >
            Export CSV
          </a>
        </div>
      </header>

      {loadError ? (
        <div className="rounded-xl border border-severity-critical/40 bg-severity-critical/10 p-4 text-sm font-semibold text-severity-critical-ink">{loadError}</div>
      ) : null}

      <section aria-label="Figures" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label={filtered ? 'Charges (filtered)' : 'Charges'} value={figures.total} sub={`${figures.today} today · ${figures.thisMonth} this month`} />
        <Stat label="Value issued" value={rand(figures.value)} sub={`${rand(figures.valueThisMonth)} this month`} tone="text-accent" />
        <Stat label="Collected" value={rand(figures.paid)} sub={`${figures.byStatus.Paid} paid in full`} tone="text-severity-low-ink" />
        <Stat label="Outstanding" value={rand(figures.outstanding)} sub="Discount applied while it runs" tone="text-severity-medium-ink" />
        <Link href={`/police/fines${fineQueryString({ ...query, status: undefined, overdue: true })}`} className="block">
          <Stat label="Overdue" value={figures.overdue} sub={`${rand(figures.overdueOwing)} past the pay-by date`} tone="text-severity-critical-ink" />
        </Link>
        <Stat label="Disputed" value={figures.disputed} sub="Representations lodged" tone="text-severity-medium-ink" />
        <Stat label="Cancelled" value={figures.cancelled} sub="Kept on the record" tone="text-muted-foreground" />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {NOTICE_TYPES.map((n) => (
          <Link
            key={n.type}
            href={`/police/fines${fineQueryString({ ...query, type: query.type === n.type ? undefined : n.type })}`}
            className={cn(
              'rounded-xl border bg-bg-card p-4 transition-colors hover:border-accent/50',
              query.type === n.type ? 'border-accent' : 'border-border',
            )}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold">{n.label}</span>
              <span className="text-xl font-bold tabular-nums">{figures.byType[n.type]}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(figures.byType[n.type] / typeMax) * 100}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{n.use}</p>
          </Link>
        ))}
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Filter</CardTitle>
          <CardDescription>Search a fine or notice number, a registration, an ID number, a name or an offence.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <input name="q" defaultValue={query.q} placeholder="Search…" className={cn(FIELD, 'md:col-span-2')} aria-label="Search" />
            <select name="type" defaultValue={query.type ?? ''} className={FIELD} aria-label="Notice type">
              <option value="">All notices</option>
              {NOTICE_TYPES.map((n) => <option key={n.type} value={n.type}>{n.type}</option>)}
            </select>
            <select name="status" defaultValue={query.overdue ? 'Overdue' : query.status ?? ''} className={FIELD} aria-label="Status">
              <option value="">All statuses</option>
              <option value="Overdue">Overdue</option>
              {FINE_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select name="period" defaultValue={query.period ?? ''} className={FIELD} aria-label="Period">
              <option value="">Any time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="month">This month</option>
            </select>
            <input type="date" name="from" defaultValue={query.from} className={FIELD} aria-label="From" />
            <input type="date" name="to" defaultValue={query.to} className={FIELD} aria-label="To" />
            {command ? (
              <select name="officer" defaultValue={query.officer ?? ''} className={FIELD} aria-label="Officer">
                <option value="">All officers</option>
                {officers.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : null}
            <div className="flex items-center gap-3 md:col-span-4 xl:col-span-8">
              {command ? (
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="mine" value="1" defaultChecked={query.mine} className="h-4 w-4" />
                  Only fines I issued
                </label>
              ) : null}
              <div className="flex-1" />
              {filtered ? <Link href="/police/fines" className="text-sm font-semibold text-muted-foreground hover:text-fg">Reset</Link> : null}
              <button type="submit" className="h-10 rounded-md bg-accent px-5 text-sm font-semibold text-bg">Apply</button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{rows.length} charge{rows.length === 1 ? '' : 's'}</CardTitle>
          <CardDescription>
            {command ? 'Every Metro Police fine you may see.' : 'The fines you issued.'} Open one for the slip, payments and its history.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Fine', 'Served', 'Infringer', 'Vehicle', 'Offence', 'Officer', 'Amount', 'Status']} empty={filtered ? 'No fines match these filters.' : 'No fines on the register yet.'}>
            {rows.map((f) => {
              const got = paid.get(f.id) ?? 0;
              return (
                <Tr key={f.id}>
                  <Td>
                    <Link href={`/police/fines/${f.id}`} className="font-mono text-sm font-bold text-accent hover:underline">{f.fine_number}</Link>
                    <div className="text-[11px] text-muted-foreground">
                      {f.notice_type}{f.notice_number ? ` · No. ${f.notice_number}` : ''}{f.captured_from === 'paper' ? ' · paper' : ''}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(f.issued_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })}
                  </Td>
                  <Td>
                    {command && f.offender_id_number ? (
                      <Link href={`/police/fines/account?id=${encodeURIComponent(f.offender_id_number)}`} className="font-medium hover:text-accent hover:underline">{f.offender_name}</Link>
                    ) : <span className="font-medium">{f.offender_name}</span>}
                    <div className="text-xs text-muted-foreground">{f.offender_id_type ? `${f.offender_id_type} ${maskId(f.offender_id_number)}` : '—'}</div>
                  </Td>
                  <Td className="font-mono text-xs font-bold">
                    {command && f.vehicle_reg ? <Link href={`/police/fines/account?reg=${encodeURIComponent(f.vehicle_reg)}`} className="hover:text-accent hover:underline">{f.vehicle_reg}</Link> : (f.vehicle_reg ?? '—')}
                  </Td>
                  <Td className="max-w-64">
                    <span className="text-sm">{f.offence_description}</span>
                    <div className="truncate text-xs text-muted-foreground">{[f.offence_code, f.suburb ?? f.location].filter(Boolean).join(' · ')}</div>
                  </Td>
                  <Td className="text-xs">{f.issued_by_name ?? '—'}</Td>
                  <Td className="whitespace-nowrap font-mono text-sm">
                    {rand(f.amount)}
                    {got > 0 ? <div className="text-[11px] text-severity-low-ink">{rand(got)} paid</div> : null}
                    {f.amount_source === 'officer' ? <div className="text-[11px] text-severity-medium-ink">officer’s amount</div> : null}
                  </Td>
                  <Td>
                    <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', STATUS_TONE[f.status])}>{f.status}</span>
                    <div
                      className={cn('mt-1 whitespace-nowrap text-[11px] font-semibold', isOverdue(f) ? 'text-severity-critical-ink' : STAGE_INFO[fineStage(f)].tone === 'warn' ? 'text-severity-medium-ink' : 'text-muted-foreground')}
                      title={STAGE_INFO[fineStage(f)].means}
                    >
                      {fineStage(f)}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
