import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFine, listNoticeCharges, listTransactions, paidByFine, type ChargeTransaction } from '@criticom/api';
import {
  amountDue, canViewAllFines, fineStage, noticeInfo, OBSERVATION_FIELDS, rand, signaturePath, STAGE_INFO,
} from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { FINE_STATUS_TONE } from '@/lib/fine-tone';
import { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { FineActions } from './fine-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fine · HikTech' };

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' }) : '—';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <dt className="w-40 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium">{children === null || children === undefined || children === '' ? '—' : children}</dd>
    </div>
  );
}

function Signature({ svg, caption, refused, none }: { svg: string | null; caption: string; refused?: boolean; none: string }) {
  // Drawn from the parsed path, never from the stored markup.
  const sig = signaturePath(svg);
  return (
    <div>
      <div className="flex h-24 items-center justify-center rounded-lg border border-border bg-white p-2 [&_svg]:max-h-20 [&_svg]:max-w-full">
        {sig
          ? (
            <svg viewBox={sig.viewBox} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label={caption}>
              <path d={sig.d} fill="none" stroke="#0f172a" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )
          : <span className={cn('text-sm', refused ? 'font-bold uppercase tracking-wider text-severity-critical-ink' : 'italic text-slate-400')}>{refused ? 'Refused to sign' : none}</span>}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

/**
 * One notice: every charge served on it, the slip, the money against it and
 * its history. Command staff record payments, representations and
 * cancellations here; nothing that was served can be edited.
 */
export default async function FinePage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeaturePage('web.enforcement');
  const { id } = await params;
  const { supabase, role, silo, userId } = await getSession();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const fine = await getFine(supabase, id).catch(() => null);
  if (!fine) notFound();
  const charges = await listNoticeCharges(supabase, fine);
  const [paid, ledger] = await Promise.all([
    paidByFine(supabase, charges.map((c) => c.id)).catch(() => new Map<string, number>()),
    Promise.all(charges.map((c) => listTransactions(supabase, { fineId: c.id }).catch(() => [] as ChargeTransaction[])))
      .then((all) => all.flat().sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))),
  ]);
  const ids = [...charges.map((c) => c.id), ...(fine.group_ref ? [fine.group_ref] : [])];
  const { data: history } = await supabase
    .from('audit_logs').select('timestamp, user_name, action_type, details')
    .eq('entity_type', 'fine').in('entity_id', ids).order('timestamp', { ascending: false }).limit(50);

  const info = noticeInfo(fine.notice_type);
  const command = canViewAllFines({ role, silo });
  const isIssuer = fine.issued_by === userId;
  const total = charges.reduce((s, c) => s + Number(c.amount), 0);
  const totalPaid = [...paid.values()].reduce((s, v) => s + v, 0);
  const due = Math.max(0, charges.filter((c) => c.status !== 'Cancelled').reduce((s, c) => s + amountDue(c), 0) - totalPaid);
  const obs = OBSERVATION_FIELDS.filter((f) => typeof fine.observations?.[f.key] === 'string' && String(fine.observations[f.key]).trim());

  return (
    <div className="space-y-5">
      <Link href="/police/fines" className="text-sm font-semibold text-muted-foreground hover:text-fg">← Fines register</Link>

      <section className="overflow-hidden rounded-2xl border border-border bg-bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4 bg-gradient-to-r from-primary/20 via-bg-card to-bg-card p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">{fine.issuing_authority ?? 'Metro Police'} · {info.label}</p>
            <h1 className="mt-1 font-mono text-2xl font-bold">{charges.map((c) => c.fine_number).join(' · ')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Served {when(fine.issued_at)} by {fine.issued_by_name ?? '—'}
              {fine.officer_infrastructure_no ? ` (${fine.officer_infrastructure_no})` : ''}
              {fine.captured_from === 'paper' ? ' · captured from a paper book' : ''}
              {fine.notice_number ? ` · Notice no. ${fine.notice_number}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={cn('rounded-full px-3 py-1 text-xs font-bold uppercase', FINE_STATUS_TONE[fine.status])}>{fine.status}</span>
            <a
              href={`/police/fines/${fine.id}/slip`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Print slip
            </a>
          </div>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-3">
          <div className="bg-bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Penalty</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{rand(total)}</p>
            {fine.notice_type === 'AARTO 01' ? (
              <p className="text-xs text-muted-foreground">{rand(total - charges.reduce((s, c) => s + Number(c.discount_amount), 0))} if paid by {fine.due_date}</p>
            ) : null}
          </div>
          <div className="bg-bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Paid</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-severity-low-ink">{rand(totalPaid)}</p>
            <p className="text-xs text-muted-foreground">{ledger.length} ledger entr{ledger.length === 1 ? 'y' : 'ies'}</p>
          </div>
          <div className="bg-bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {fine.notice_type === 'Section 56' ? 'Admission of guilt due' : 'Due now'}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-severity-medium-ink">{fine.status === 'Cancelled' ? '—' : rand(due)}</p>
            <p className="text-xs text-muted-foreground">
              {fine.notice_type === 'Section 56' ? `Court: ${fine.court_name ?? '—'} on ${fine.court_date ?? '—'}` : `Pay by ${fine.due_date ?? '—'}`}
            </p>
          </div>
        </div>
      </section>

      {fine.status !== 'Cancelled' ? (() => {
        const stage = fineStage(fine);
        const tone = STAGE_INFO[stage].tone;
        return (
          <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border p-4 text-sm',
            tone === 'bad' ? 'border-severity-critical/40 bg-severity-critical/10' : tone === 'warn' ? 'border-severity-medium/40 bg-severity-medium/10'
              : tone === 'done' ? 'border-severity-low/40 bg-severity-low/10' : 'border-accent/30 bg-accent/5')}
          >
            <b>{stage}</b>
            <span className="text-muted-foreground">{STAGE_INFO[stage].means}</span>
          </div>
        );
      })() : null}

      {command ? (
        <div className="flex flex-wrap gap-2 text-sm">
          {fine.offender_id_number ? (
            <Link href={`/police/fines/account?id=${encodeURIComponent(fine.offender_id_number)}`} className="rounded-md border border-border px-3 py-1.5 font-semibold hover:bg-muted">
              All fines for this ID number →
            </Link>
          ) : null}
          {fine.vehicle_reg ? (
            <Link href={`/police/fines/account?reg=${encodeURIComponent(fine.vehicle_reg)}`} className="rounded-md border border-border px-3 py-1.5 font-semibold hover:bg-muted">
              All fines for {fine.vehicle_reg} →
            </Link>
          ) : null}
        </div>
      ) : null}

      {fine.status === 'Cancelled' && fine.cancel_reason ? (
        <div className="rounded-xl border border-severity-critical/40 bg-severity-critical/10 p-4 text-sm">
          <b>Cancelled</b> {when(fine.cancelled_at)} by {fine.cancelled_by_name ?? '—'}: {fine.cancel_reason}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle>{charges.length > 1 ? `Charges (${charges.length})` : 'Charge'}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <SimpleTable headers={['Fine', 'Offence', 'Penalty', 'Paid', 'Status']}>
                {charges.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-mono text-sm font-bold">{c.fine_number}{c.notice_number ? <div className="text-[11px] font-normal text-muted-foreground">No. {c.notice_number}</div> : null}</Td>
                    <Td>
                      {c.offence_description}
                      <div className="text-xs text-muted-foreground">
                        {[c.offence_code ? `Code ${c.offence_code}` : null, c.legal_ref, c.demerit_points ? `${c.demerit_points} demerit points` : null].filter(Boolean).join(' · ') || 'No code'}
                        {c.amount_source === 'officer' ? ' · amount entered by the officer' : ''}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap font-mono">{rand(c.amount)}</Td>
                    <Td className="whitespace-nowrap font-mono text-severity-low-ink">{rand(paid.get(c.id) ?? 0)}</Td>
                    <Td><span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', FINE_STATUS_TONE[c.status])}>{c.status}</span></Td>
                  </Tr>
                ))}
              </SimpleTable>
            </CardContent>
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle>{info.personPresent ? 'Infringer' : 'Owner'}</CardTitle></CardHeader>
              <CardContent>
                <dl>
                  <Field label="Name">{fine.offender_name}</Field>
                  {info.personPresent ? (
                    <>
                      <Field label={fine.offender_id_type ?? 'Identification'}><span className="font-mono">{fine.offender_id_number}</span></Field>
                      <Field label="Date of birth">{fine.offender_dob}</Field>
                      <Field label="Sex">{fine.offender_gender}</Field>
                      <Field label="Licence code">{[fine.offender_licence_code, fine.offender_prdp_code ? `PrDP ${fine.offender_prdp_code}` : null].filter(Boolean).join(' · ')}</Field>
                      <Field label="Cell">{fine.offender_phone}</Field>
                      <Field label="Address">{fine.offender_address}</Field>
                    </>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle>Vehicle and place</CardTitle></CardHeader>
              <CardContent>
                <dl>
                  <Field label="Registration"><span className="font-mono font-bold">{fine.vehicle_reg}</span></Field>
                  <Field label="Licence disc">{fine.vehicle_licence_disc}</Field>
                  <Field label="Vehicle">{[fine.vehicle_type, fine.vehicle_make, fine.vehicle_model, fine.vehicle_colour].filter(Boolean).join(' · ')}</Field>
                  <Field label="Where">{[fine.street_a, fine.street_b, fine.suburb, fine.city].filter(Boolean).join(', ') || fine.location}</Field>
                  {fine.direction ? <Field label="Direction">{fine.direction}</Field> : null}
                  <Field label="Offence time">{when(fine.offence_at ?? fine.issued_at)}</Field>
                  {fine.latitude !== null && fine.longitude !== null ? (
                    <Field label="GPS">
                      <a
                        className="font-mono text-accent hover:underline"
                        href={`https://www.openstreetmap.org/?mlat=${fine.latitude}&mlon=${fine.longitude}#map=18/${fine.latitude}/${fine.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {Number(fine.latitude).toFixed(5)}, {Number(fine.longitude).toFixed(5)}
                      </a>
                    </Field>
                  ) : null}
                  {fine.incident_id ? <Field label="Incident"><Link href={`/incidents/${fine.incident_id}`} className="text-accent hover:underline">Open incident</Link></Field> : null}
                </dl>
              </CardContent>
            </Card>
          </div>

          {obs.length || fine.notes ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle>Notes</CardTitle><CardDescription>From the notice’s notes page.</CardDescription></CardHeader>
              <CardContent>
                <dl>
                  {obs.map((f) => <Field key={f.key} label={f.label}>{String(fine.observations[f.key])}</Field>)}
                  {fine.notes ? <Field label="Other">{fine.notes}</Field> : null}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2"><CardTitle>Signatures</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Signature svg={fine.officer_signature} caption={`Officer · ${fine.issued_by_name ?? '—'}`} none={fine.captured_from === 'paper' ? 'Signed on the paper notice' : 'Not signed'} />
              <Signature
                svg={fine.infringer_signature}
                refused={fine.infringer_refused}
                caption={`${info.personPresent ? 'Infringer' : 'Owner'} · ${fine.offender_name}`}
                none={info.personPresent ? (fine.captured_from === 'paper' ? 'Signed on the paper notice' : 'Not signed') : 'Left on the vehicle'}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle>Payments</CardTitle><CardDescription>The ledger sets Paid and Partially Paid. Entries are never edited or deleted.</CardDescription></CardHeader>
            <CardContent className="p-0">
              <SimpleTable headers={['Date paid', 'Fine', 'Type', 'Method', 'Amount', 'Receipt', 'Recorded by']} empty="No payments recorded.">
                {ledger.map((t) => (
                  <Tr key={t.id}>
                    <Td className="whitespace-nowrap text-xs">{t.paid_on ?? when(t.recorded_at)}</Td>
                    <Td className="font-mono text-xs">{charges.find((c) => c.id === t.fine_id)?.fine_number ?? '—'}</Td>
                    <Td>{t.tx_type}</Td>
                    <Td>{t.method}</Td>
                    <Td className={cn('whitespace-nowrap font-mono', t.tx_type === 'Refund' && 'text-severity-critical-ink')}>{t.tx_type === 'Refund' ? '−' : ''}{rand(t.amount)}</Td>
                    <Td className="font-mono text-xs">{t.reference ?? '—'}</Td>
                    <Td className="text-xs">{t.recorded_name ?? '—'}<div className="text-muted-foreground">{when(t.recorded_at)}</div></Td>
                  </Tr>
                ))}
              </SimpleTable>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <FineActions
            charges={charges.map((c) => ({
              id: c.id, fineNumber: c.fine_number, status: c.status, noticeNumber: c.notice_number,
              due: Math.max(0, amountDue(c) - (paid.get(c.id) ?? 0)),
            }))}
            canManage={command}
            canNumber={command || isIssuer}
          />

          <Card>
            <CardHeader className="pb-2"><CardTitle>History</CardTitle><CardDescription>Every change, from the audit trail.</CardDescription></CardHeader>
            <CardContent>
              {history?.length ? (
                <ol className="space-y-3">
                  {history.map((h, i) => (
                    <li key={`${h.timestamp}-${i}`} className="border-l-2 border-border pl-3">
                      <p className="text-sm font-semibold">{h.action_type.replace(/^Fine/, '').replace(/([A-Z])/g, ' $1').trim()}</p>
                      <p className="text-xs text-muted-foreground">{when(h.timestamp)} · {h.user_name ?? '—'}</p>
                      {h.details ? <p className="mt-0.5 text-xs">{h.details}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-muted-foreground">No history yet.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
