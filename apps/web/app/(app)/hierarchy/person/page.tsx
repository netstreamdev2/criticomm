import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  listEndorsements, listLeaveEntries, listTrainingRecords, listCertifications,
  getPlanScores, cycleYearFor, cycleLabel, listPersonnel, listAllProfiles, listReportingLines,
} from '@criticom/api';
import { ADMIN_ROLES, type Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { buildMembers, keyOf } from '@/lib/org';
import { setReportsToAction } from './actions';

const CAN_EDIT = new Set([...ADMIN_ROLES, 'Supervisor', 'Captain', 'FireChief', 'Chief']);

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Personnel Record · Criticom' };

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export default async function PersonPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; id?: string }>;
}) {
  const { supabase, role } = await getSession();
  const { kind, id } = await searchParams;
  if (!id || (kind !== 'user' && kind !== 'staff')) notFound();

  // Resolve the person from either source.
  let name = '', rank = '', badge: string | null = null, silo = '', station: string | null = null;
  let onDuty = false, contact: string | null = null, email: string | null = null;
  let emergency: string | null = null, callSign: string | null = null, platoon: string | null = null;
  let serviceNo: string | null = null, forceNo: string | null = null, unit: string | null = null;
  let assignedUnit: string | null = null;
  let userId: string | null = null, personnelId: string | null = null;

  if (kind === 'user') {
    const { data: p } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (!p) notFound();
    userId = p.id; name = p.full_name ?? p.email ?? 'Unknown'; rank = p.rank ?? p.role;
    badge = p.badge_number; silo = p.silo; station = p.station; onDuty = p.is_on_duty;
    contact = p.contact_number; email = p.email; emergency = p.emergency_contact;
    callSign = p.call_sign; platoon = p.platoon;
    const { data: per } = await supabase
      .from('personnel')
      .select('*, apparatus:assigned_apparatus_id (unit_number, name)')
      .eq('user_id', id).maybeSingle();
    if (per) {
      personnelId = per.id; serviceNo = per.service_number; forceNo = per.force_number; unit = per.unit;
      assignedUnit = (per as { apparatus?: { unit_number?: string; name?: string } }).apparatus?.unit_number ?? null;
    }
  } else {
    const { data: per } = await supabase
      .from('personnel')
      .select('*, apparatus:assigned_apparatus_id (unit_number, name)')
      .eq('id', id).maybeSingle();
    if (!per) notFound();
    personnelId = per.id; userId = per.user_id; name = `${per.first_name} ${per.last_name}`.trim();
    rank = per.rank; badge = per.badge_number; silo = per.silo; station = per.station; onDuty = per.is_on_duty;
    emergency = per.emergency_contact; platoon = per.platoon; serviceNo = per.service_number;
    forceNo = per.force_number; unit = per.unit;
    assignedUnit = (per as { apparatus?: { unit_number?: string } }).apparatus?.unit_number ?? null;
  }

  // Related HR data.
  const cycleYear = cycleYearFor();
  const [endorsements, leave, training, certs, planRow] = await Promise.all([
    userId ? listEndorsements(supabase, { userId, includeInactive: true }).catch(() => [])
      : badge ? supabase.from('endorsements').select('*').eq('badge_number', badge).then((r) => r.data ?? [])
      : Promise.resolve([]),
    userId ? listLeaveEntries(supabase, userId).catch(() => []) : Promise.resolve([]),
    personnelId ? listTrainingRecords(supabase, personnelId).catch(() => []) : Promise.resolve([]),
    personnelId ? listCertifications(supabase, personnelId).catch(() => []) : Promise.resolve([]),
    userId ? supabase.from('performance_plans').select('*').eq('user_id', userId).eq('cycle_year', cycleYear).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const scores = planRow ? await getPlanScores(supabase, planRow.id).catch(() => []) : [];
  const midScores = scores.filter((s) => s.stage === 'MidYear');
  const midAvg = midScores.length ? Math.round((midScores.reduce((a, s) => a + s.score, 0) / midScores.length) * 10) / 10 : null;

  // "Reports to" editor data (supervisors / admin only).
  const canEdit = CAN_EDIT.has(role) && !!silo;
  let reportsToChoice = 'auto';
  let managerOptions: { value: string; label: string }[] = [];
  if (canEdit) {
    const [lines, profs, pers] = await Promise.all([
      listReportingLines(supabase, silo as Silo).catch(() => []),
      listAllProfiles(supabase, silo as Silo).catch(() => []),
      listPersonnel(supabase, silo as Silo).catch(() => []),
    ]);
    const mine = lines.find((l) => l.member_kind === kind && l.member_id === id);
    if (mine) reportsToChoice = mine.manager_kind && mine.manager_id ? `${mine.manager_kind}:${mine.manager_id}` : 'top';
    managerOptions = buildMembers(profs, pers, new Map())
      .filter((m) => !(m.kind === kind && m.id === id))
      .map((m) => ({ value: keyOf(m.kind, m.id), label: `${m.name} — ${m.rank}` }));
  }

  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="space-y-6">
      <Link href="/hierarchy" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Back to hierarchy
      </Link>

      <header className="flex flex-wrap items-center gap-4">
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-2xl font-bold text-accent">
          {initials || '?'}
          <span className={`absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-bg ${onDuty ? 'bg-severity-low' : 'bg-muted-foreground'}`} />
        </span>
        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          <p className="text-muted-foreground">{rank} · {silo} · {onDuty ? 'On duty' : 'Off duty'}</p>
        </div>
      </header>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Reporting line</CardTitle>
            <CardDescription>Pin who this member reports to, or leave it automatic (inferred from rank).</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={setReportsToAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="silo" value={silo} />
              <input type="hidden" name="member_kind" value={kind} />
              <input type="hidden" name="member_id" value={id} />
              <div className="min-w-[260px] flex-1">
                <label className="text-xs uppercase text-muted-foreground" htmlFor="choice">Reports to</label>
                <select id="choice" name="choice" defaultValue={reportsToChoice} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm">
                  <option value="auto">Automatic (inferred from rank)</option>
                  <option value="top">— Top of chain (no manager) —</option>
                  {managerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Save reporting line</button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Identity & posting</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Item label="Badge number" value={badge} />
          <Item label="Service number" value={serviceNo} />
          <Item label="Force number" value={forceNo} />
          <Item label="Call sign" value={callSign} />
          <Item label="Station" value={station} />
          <Item label="Platoon" value={platoon} />
          <Item label="Unit" value={unit} />
          <Item label="Assigned vehicle" value={assignedUnit} />
          <Item label="Contact" value={contact} />
          <Item label="Email" value={email} />
          <Item label="Emergency contact" value={emergency} />
        </CardContent>
      </Card>

      {planRow && (
        <Card>
          <CardHeader>
            <CardTitle>Performance appraisal — {cycleLabel(cycleYear)}</CardTitle>
            <CardDescription>Status {planRow.status}. Mid-year average {midAvg ?? '—'} / 5.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['KPI', 'Stage', 'Score', 'Approved']} empty="No scores recorded.">
              {scores.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-semibold">{s.kpi_title}</Td>
                  <Td>{s.stage}</Td>
                  <Td className="font-mono">{s.score}/5</Td>
                  <Td>{s.approved ? <span className="text-severity-low">Yes</span> : 'Pending'}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Endorsements ({endorsements.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Type', 'Details', 'Period', 'Active']} empty="No endorsements.">
              {endorsements.map((e) => (
                <Tr key={e.id}>
                  <Td className="font-semibold">{e.type}</Td>
                  <Td className="max-w-[180px] truncate">{e.details ?? '—'}</Td>
                  <Td className="font-mono text-xs">{e.start_date}{e.end_date ? ` → ${e.end_date}` : ' →'}</Td>
                  <Td>{e.is_active ? <span className="text-severity-low">Yes</span> : 'No'}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Leave ({leave.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Type', 'From', 'To', 'Status']} empty="No leave records.">
              {leave.map((l) => (
                <Tr key={l.id}>
                  <Td>{l.absence ?? '—'}</Td>
                  <Td className="font-mono">{l.eff_from}</Td>
                  <Td className="font-mono">{l.eff_to}</Td>
                  <Td>
                    <span className={l.status === 'Approved' ? 'text-severity-low' : l.status === 'Rejected' ? 'text-severity-critical' : 'text-severity-medium'}>{l.status}</span>
                  </Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Training ({training.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Training', 'Completed', 'Notes']} empty="No training records.">
              {training.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-semibold">{t.training_name}</Td>
                  <Td className="font-mono">{t.date_completed}</Td>
                  <Td className="max-w-[180px] truncate">{t.notes_learned ?? '—'}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Certifications ({certs.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Certification', 'Issued by', 'Expires']} empty="No certifications.">
              {certs.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-semibold">{c.name}</Td>
                  <Td>{c.issued_by ?? '—'}</Td>
                  <Td className="font-mono">{c.expiry_date}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
