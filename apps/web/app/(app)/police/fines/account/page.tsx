import Link from 'next/link';
import { redirect } from 'next/navigation';
import { amountDue, canViewAllFines, fineStage, isOverdue, rand, STAGE_INFO } from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { loadFineAccount } from '@/lib/fine-account';
import { FINE_STATUS_TONE } from '@/lib/fine-tone';
import { accountQueryString, readAccountKey } from '@/lib/fines';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fines account · HikTech' };

const FIELD = 'h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STAGE_TONE = {
  ok: 'text-accent', warn: 'text-severity-medium-ink', bad: 'text-severity-critical-ink', done: 'text-severity-low-ink', muted: 'text-muted-foreground',
} as const;

/**
 * One person's (ID number) or one vehicle's (registration) account: every
 * fine on the register, every payment and when it was made, and what is owed
 * today. Command staff only; a printable statement for the counter.
 */
export default async function FineAccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireFeaturePage('web.enforcement');
  const { supabase, role, silo } = await getSession();
  if (!canViewAllFines({ role, silo })) redirect('/police/fines');
  const params = await searchParams;
  const key = readAccountKey(params);

  const data = key ? await loadFineAccount(supabase, key).catch(() => null) : null;
  const today = new Date();
  const live = data?.fines.filter((f) => f.status !== 'Cancelled') ?? [];
  const owingOf = (id: string) => {
    const f = data?.fines.find((x) => x.id === id);
    if (!f || f.status === 'Paid' || f.status === 'Cancelled') return 0;
    return Math.max(0, amountDue(f, today) - (data?.paid.get(f.id) ?? 0));
  };
  const issued = live.reduce((s, f) => s + Number(f.amount), 0);
  const paid = data ? [...data.paid.values()].reduce((s, v) => s + v, 0) : 0;
  const owing = live.reduce((s, f) => s + owingOf(f.id), 0);
  const overdue = live.filter((f) => isOverdue(f)).length;

  return (
    <div className="space-y-5">
      <Link href="/police/fines" className="text-sm font-semibold text-muted-foreground hover:text-fg">← Fines register</Link>
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Metro Police · Enforcement</p>
        <h1 className="mt-1 text-2xl font-bold">Fines account</h1>
        <p className="text-sm text-muted-foreground">Everything on the register for one ID number or one vehicle: fines, payments and when they were made, and what is owed today.</p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input name="id" defaultValue={key?.id ?? ''} placeholder="ID or passport number" className={cn(FIELD, 'font-mono')} aria-label="ID number" />
            <input name="reg" defaultValue={key?.reg ?? ''} placeholder="Vehicle registration" className={cn(FIELD, 'font-mono uppercase')} aria-label="Registration" />
            <button type="submit" className="h-10 rounded-md bg-accent px-5 text-sm font-semibold text-bg">Open account</button>
          </form>
        </CardContent>
      </Card>

      {!key ? (
        <p className="text-sm text-muted-foreground">Enter a full ID number, a registration, or both.</p>
      ) : !data ? (
        <div className="rounded-xl border border-severity-critical/40 bg-severity-critical/10 p-4 text-sm font-semibold text-severity-critical-ink">The account could not be loaded.</div>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-border bg-bg-card">
            <div className="flex flex-wrap items-start justify-between gap-4 p-5">
              <div>
                <h2 className="text-xl font-bold">{data.person?.offender_name ?? (key.reg ? `Vehicle ${key.reg}` : 'Unknown person')}</h2>
                <p className="font-mono text-sm text-muted-foreground">
                  {[key.id ? `${data.person?.offender_id_type ?? 'ID'} ${key.id}` : null, key.reg].filter(Boolean).join(' · ')}
                </p>
              </div>
              <a
                href={`/police/fines/account/statement${accountQueryString(key)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Print statement
              </a>
            </div>
            <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-5">
              {[
                { label: 'Fines', value: String(live.length), tone: '' },
                { label: 'Issued', value: rand(issued), tone: '' },
                { label: 'Paid', value: rand(paid), tone: 'text-severity-low-ink' },
                { label: 'Owing today', value: rand(owing), tone: 'text-severity-medium-ink' },
                { label: 'Overdue', value: String(overdue), tone: 'text-severity-critical-ink' },
              ].map((t) => (
                <div key={t.label} className="bg-bg-card px-5 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t.label}</p>
                  <p className={cn('mt-1 text-xl font-bold tabular-nums', t.tone)}>{t.value}</p>
                </div>
              ))}
            </div>
          </section>

          <Card>
            <CardHeader className="pb-2"><CardTitle>Fines ({data.fines.length})</CardTitle><CardDescription>Newest first. Cancelled fines stay on the account, struck through.</CardDescription></CardHeader>
            <CardContent className="p-0">
              <SimpleTable headers={['Fine', 'Served', 'Offence', 'Vehicle', 'Where it stands', 'Penalty', 'Paid', 'Owing', 'Status']} empty="Nothing on the register for this account.">
                {data.fines.map((f) => {
                  const stage = fineStage(f);
                  return (
                    <Tr key={f.id}>
                      <Td>
                        <Link href={`/police/fines/${f.id}`} className="font-mono text-sm font-bold text-accent hover:underline">{f.fine_number}</Link>
                        <div className="text-[11px] text-muted-foreground">{f.notice_type}</div>
                      </Td>
                      <Td className="whitespace-nowrap text-xs">{day(f.issued_at)}</Td>
                      <Td className={cn('max-w-64 text-sm', f.status === 'Cancelled' && 'line-through opacity-60')}>{f.offence_description}</Td>
                      <Td className="font-mono text-xs">{f.vehicle_reg ?? '—'}</Td>
                      <Td>
                        <span className={cn('text-sm font-semibold', STAGE_TONE[STAGE_INFO[stage].tone])}>{stage}</span>
                        {f.due_date && f.status !== 'Paid' && f.status !== 'Cancelled' ? <div className="text-xs text-muted-foreground">pay by {day(f.due_date)}</div> : null}
                      </Td>
                      <Td className="whitespace-nowrap font-mono text-sm">{rand(f.amount)}</Td>
                      <Td className="whitespace-nowrap font-mono text-sm text-severity-low-ink">{rand(data.paid.get(f.id) ?? 0)}</Td>
                      <Td className="whitespace-nowrap font-mono text-sm">{f.status === 'Cancelled' ? '—' : rand(owingOf(f.id))}</Td>
                      <Td><span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', FINE_STATUS_TONE[f.status])}>{f.status}</span></Td>
                    </Tr>
                  );
                })}
              </SimpleTable>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle>Payments ({data.ledger.length})</CardTitle><CardDescription>By the date on the receipt.</CardDescription></CardHeader>
            <CardContent className="p-0">
              <SimpleTable headers={['Date paid', 'Fine', 'Type', 'Method', 'Receipt', 'Amount', 'Recorded']} empty="No payments recorded.">
                {data.ledger.map((t) => (
                  <Tr key={t.id}>
                    <Td className="whitespace-nowrap text-sm">{day(t.paid_on ?? t.recorded_at)}</Td>
                    <Td className="font-mono text-xs">{data.fines.find((f) => f.id === t.fine_id)?.fine_number ?? '—'}</Td>
                    <Td>{t.tx_type}</Td>
                    <Td>{t.method}</Td>
                    <Td className="font-mono text-xs">{t.reference ?? '—'}</Td>
                    <Td className={cn('whitespace-nowrap font-mono text-sm', t.tx_type === 'Refund' && 'text-severity-critical-ink')}>{t.tx_type === 'Refund' ? '−' : ''}{rand(t.amount)}</Td>
                    <Td className="text-xs text-muted-foreground">{t.recorded_name ?? '—'} · {day(t.recorded_at)}</Td>
                  </Tr>
                ))}
              </SimpleTable>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
