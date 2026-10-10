import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMetroReport, getReportType, reportReadout } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Police Report · HikTech' };

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export default async function MetroReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await getSession();
  const r = await getMetroReport(supabase, id).catch(() => null);
  if (!r) notFound();

  // The DMPS forms' answers, section by section (the shared blocks are in the card above).
  const SHARED = new Set(['Response', 'Outcome', 'Evidence']);
  const readout = r.report_type
    ? reportReadout(getReportType(r.report_type), r as unknown as Record<string, unknown> & { details?: Record<string, unknown> | null })
    : null;
  const formSections = readout?.sections.filter((s) => !SHARED.has(s.title)) ?? [];

  const offenses = (r as { offenses?: Array<{ id: string; offense_type: string; fine_amount: number }> }).offenses ?? [];

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold">{r.case_number}</h1>
          <p className="text-muted-foreground">
            {r.report_type ? getReportType(r.report_type).label : r.incident_category} · {r.date_of_offense} {r.time_of_offense ?? ''} · filed {formatSaTime(r.created_at)}
          </p>
        </div>
        {r.incident_id ? (
          <Link href={`/incidents/${r.incident_id}`} className="text-sm text-accent hover:underline">Open the incident</Link>
        ) : null}
      </header>

      <Card>
        <CardHeader><CardTitle>Report</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Item label="Location" value={r.location} />
          <Item label="Station" value={r.station} />
          <Item label="Officer" value={r.officer_name} />
          <Item label="Badge" value={r.badge_number} />
          <Item label="Partner" value={r.partner_name} />
          <Item label="Bodycam" value={r.bodycam_active} />
          <Item label="Use of force" value={r.use_of_force} />
          <Item label="Offender" value={r.offender_name} />
          <Item label="Ticket #" value={r.ticket_number} />
          <Item label="Total fine" value={r.fine_amount ? `R${r.fine_amount}` : null} />
          <Item label="Vehicle" value={r.vehicle_make} />
          <Item label="Plate" value={r.license_plate} />
          <Item label="VIN" value={r.vin_number} />
          <Item label="Impounded" value={r.vehicle_impounded === 'Yes' ? `Yes — ${r.impound_lot ?? 'lot n/a'}` : 'No'} />
          <Item label="Arrest made" value={r.arrest_made} />
          <Item label="Suspect" value={r.suspect_name} />
          <Item label="Charges" value={r.charges} />
          <Item label="Victim" value={r.victim_name} />
          <Item label="Victim injuries" value={r.victim_injuries} />
          <Item label="Weapon" value={r.weapon_type ? `${r.weapon_type} ${r.weapon_size ?? ''}` : null} />
          <Item label="Contraband" value={r.contraband_seized} />
          <Item
            label="Evidence"
            value={[r.evidence_weapons && 'weapons', r.evidence_drugs && 'drugs', r.evidence_property && 'property']
              .filter(Boolean).join(', ') || null}
          />
        </CardContent>
      </Card>

      {formSections.map((s) => (
        <Card key={s.title}>
          <CardHeader><CardTitle>{s.title}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {s.items.map((i, n) => <Item key={`${i.label}-${n}`} label={i.label} value={i.value} />)}
          </CardContent>
        </Card>
      ))}
      {readout?.extra.length ? (
        <Card>
          <CardHeader><CardTitle>Other answers</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {readout.extra.map((i, n) => <Item key={`${i.label}-${n}`} label={i.label} value={i.value} />)}
          </CardContent>
        </Card>
      ) : null}

      {offenses.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Itemised offenses</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {offenses.map((o) => (
                <li key={o.id} className="flex justify-between rounded-md border border-border/60 bg-bg-soft px-3 py-2">
                  <span>{o.offense_type}</span>
                  <span className="font-mono">R{o.fine_amount}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {r.officer_narrative && (
        <Card>
          <CardHeader><CardTitle>Narrative</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-wrap text-sm">{r.officer_narrative}</p></CardContent>
        </Card>
      )}
    </div>
  );
}
