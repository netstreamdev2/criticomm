import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Radio } from 'lucide-react';
import { getIncident, listPersonnel, partFor } from '@criticom/api';
import { canFileByRadio, DEPARTMENT_NAMES, type Silo } from '@criticom/db';
import { DeptBadge } from '@/components/dept-badge';
import { getBrandingMap } from '@/lib/branding';
import { getSession } from '@/lib/session';
import { DEPARTMENT_TONE } from '@/lib/radio-forms';
import { RadioReport } from './radio-report';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report by radio · HikTech' };

/**
 * Filing by radio (0075): the desk files a crew's report from the console as
 * the crew radioed it in, the same forms the phone fills, then closes it on
 * scene for them. One department at a time.
 */
export default async function RadioReportPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dept?: string }>;
}) {
  const { id } = await params;
  const { dept } = await searchParams;
  const { supabase, role, silo } = await getSession();
  if (!dept || !(dept in DEPARTMENT_TONE) || !canFileByRadio(role, silo, dept as Silo)) notFound();

  const incident = await getIncident(supabase, id).catch(() => null);
  if (!incident) notFound();
  const part = partFor(incident.departments ?? [], dept);
  if (!part) notFound();

  const [people, branding] = await Promise.all([
    listPersonnel(supabase, dept as Silo).catch(() => []),
    getBrandingMap(),
  ]);
  const crew = people
    .filter((p) => p.user_id)
    .map((p) => ({
      id: p.user_id as string,
      name: [p.rank, p.first_name, p.last_name].filter(Boolean).join(' '),
      badge: p.badge_number ?? null,
      onDuty: Boolean(p.is_on_duty),
    }))
    .sort((a, b) => Number(b.onDuty) - Number(a.onDuty) || a.name.localeCompare(b.name));
  const org = branding.Ethekwini;
  const tone = DEPARTMENT_TONE[dept as keyof typeof DEPARTMENT_TONE];

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-10">
      <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to {incident.incident_number}
      </Link>

      {/* The slip: white paper on the console, whatever the theme. */}
      <div className="paper-slip space-y-4 px-4 pb-6 pt-8 sm:px-8 sm:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-dashed border-border pb-3">
        <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <DeptBadge branding={org} logoUrl={org.logoUrl} size="xs" />
          {org.official_name}
        </span>
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Radio slip · {incident.incident_number}
        </span>
      </div>

      <header className="overflow-hidden rounded-xl border border-border bg-bg-card">
        <div className="h-1.5" style={{ backgroundColor: tone }} />
        <div className="flex flex-wrap items-start gap-4 p-5">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: `${tone}22` }}>
            <Radio className="h-6 w-6" style={{ color: tone }} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: tone }}>
              {DEPARTMENT_NAMES[dept as Silo]} · Report by radio
            </p>
            <h1 className="mt-0.5 text-xl font-bold">
              <span className="font-mono">{incident.incident_number}</span> · {incident.incident_type}
            </h1>
            <p className="text-sm text-muted-foreground">{incident.location_address}</p>
          </div>
          <span className="severity-pill" data-sev={incident.incident_severity}>{incident.incident_severity}</span>
        </div>
      </header>

      <RadioReport
        incidentId={incident.id}
        incidentNumber={incident.incident_number}
        silo={dept as Silo}
        departmentName={DEPARTMENT_NAMES[dept as Silo]}
        part={{
          status: part.status,
          leadId: part.lead_id,
          leadName: part.lead_name,
          reportFiledAt: part.report_filed_at,
          closedAt: part.closed_at,
        }}
        crew={crew}
      />
      </div>
    </div>
  );
}
