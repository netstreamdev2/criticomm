import Link from 'next/link';
import { FileDown } from 'lucide-react';
import { getReportForm, getReportType, reportReadout, type getMetroReport } from '@criticom/api';
import { ReportFormChips } from '@/components/report-form-chips';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export type MetroReport = Awaited<ReturnType<typeof getMetroReport>>;

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

/**
 * One police report in full, under the police badge: the case report, each
 * DMPS form in its colour, the offences and the narrative, with its PDF.
 * `back`: a link back to where the reader came from.
 */
export async function PoliceReportView({ r, back }: { r: MetroReport; back?: React.ReactNode }) {
  const { t } = await requestT();
  // The DMPS forms' answers, section by section (the shared blocks are in the card above).
  const SHARED = new Set(['Response', 'Outcome', 'Evidence']);
  const readout = r.report_type
    ? reportReadout(
        getReportType(r.report_type),
        r as unknown as Record<string, unknown> & { details?: Record<string, unknown> | null },
      )
    : null;
  const formSections = readout?.sections.filter((s) => !SHARED.has(s.title)) ?? [];

  const offenses =
    (r as { offenses?: Array<{ id: string; offense_type: string; fine_amount: number }> })
      .offenses ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/dmps-badge.png"
            alt={t('Durban Metropolitan Police Service')}
            className="h-12 w-12 shrink-0 object-contain"
          />
          <div>
            <h1 className="font-mono text-2xl font-bold">{r.case_number}</h1>
            <p className="text-muted-foreground">
              {t('{value} · {value2} {value3} · filed {saTime}', { value: r.report_type ? getReportType(r.report_type).label : r.incident_category, value2: r.date_of_offense, value3: r.time_of_offense ?? '', saTime: formatSaTime(r.created_at) })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {back}
          {r.incident_id ? (
            <Link
              href={`/incidents/${r.incident_id}`}
              className="text-sm text-accent hover:underline"
            >
              {t('Open the incident')}</Link>
          ) : null}
          <a
            href={`/api/pdf/police-report/${r.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg-soft px-3 text-sm font-semibold hover:bg-bg"
          >
            <FileDown className="h-4 w-4" /> {' '}{t('Download PDF')}</a>
        </div>
      </header>

      {r.report_type ? <ReportFormChips forms={getReportType(r.report_type).forms ?? []} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('Report')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Item label={t('Location')} value={r.location} />
          <Item label={t('Station')} value={r.station} />
          <Item label={t('Officer')} value={r.officer_name} />
          <Item label={t('Badge')} value={r.badge_number} />
          <Item label={t('Partner')} value={r.partner_name} />
          <Item label={t('Bodycam')} value={r.bodycam_active} />
          <Item label={t('Use of force')} value={r.use_of_force} />
          <Item label={t('Offender')} value={r.offender_name} />
          <Item label={t('Ticket #')} value={r.ticket_number} />
          <Item label={t('Total fine')} value={r.fine_amount ? `R${r.fine_amount}` : null} />
          <Item label={t('Vehicle')} value={r.vehicle_make} />
          <Item label={t('Plate')} value={r.license_plate} />
          <Item label="VIN" value={r.vin_number} />
          <Item
            label={t('Impounded')}
            value={r.vehicle_impounded === 'Yes' ? `Yes — ${r.impound_lot ?? 'lot n/a'}` : 'No'}
          />
          <Item label={t('Arrest made')} value={r.arrest_made} />
          <Item label={t('Suspect')} value={r.suspect_name} />
          <Item label={t('Charges')} value={r.charges} />
          <Item label={t('Victim')} value={r.victim_name} />
          <Item label={t('Victim injuries')} value={r.victim_injuries} />
          <Item
            label={t('Weapon')}
            value={r.weapon_type ? `${r.weapon_type} ${r.weapon_size ?? ''}` : null}
          />
          <Item label={t('Contraband')} value={r.contraband_seized} />
          <Item
            label={t('Evidence')}
            value={
              [
                r.evidence_weapons && 'weapons',
                r.evidence_drugs && 'drugs',
                r.evidence_property && 'property',
              ]
                .filter(Boolean)
                .join(', ') || null
            }
          />
        </CardContent>
      </Card>

      {formSections.map((s) => (
        <Card
          key={s.title}
          style={
            s.form
              ? { borderLeft: `4px solid ${getReportForm(s.form)?.tone ?? 'transparent'}` }
              : undefined
          }
        >
          <CardHeader>
            <CardTitle>{s.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {s.items.map((i, n) => (
              <Item key={`${i.label}-${n}`} label={i.label} value={i.value} />
            ))}
          </CardContent>
        </Card>
      ))}
      {readout?.extra.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('Other answers')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {readout.extra.map((i, n) => (
              <Item key={`${i.label}-${n}`} label={i.label} value={i.value} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {offenses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('Itemised offenses')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {offenses.map((o) => (
                <li
                  key={o.id}
                  className="flex justify-between rounded-md border border-border/60 bg-bg-soft px-3 py-2"
                >
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
          <CardHeader>
            <CardTitle>{t('Narrative')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{r.officer_narrative}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
