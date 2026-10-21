import { Suspense } from 'react';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { CALLER_NOT_GIVEN, DEPARTMENT_NAMES, canAccess, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { QUEUE_STAGES, deskTags, listOnDutyOfficers, listQueue, partWords, sortParts, type QueueSort } from '@criticom/api';
import { Card, CardContent } from '@/components/ui/card';
import { DispatchMapButton } from '@/components/dispatch-map-button';
import { DetailsToFollow } from '@/components/details-to-follow';
import { chatTime } from '@/lib/when';
import { PendingRealtimeBridge } from './realtime-bridge';
import { IncidentRow, StopClick } from './incident-row';
import { QueueFilters } from './queue-filters';
import { CritiTiles } from '@/components/criti/insight-tiles';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pending queue · HikTech' };

type QueueParams = {
  q?: string; sort?: string; severity?: string; region?: string; department?: string;
  category?: string; stage?: string; from?: string; to?: string;
};

const SORTS: Array<[QueueSort, string]> = [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['severity', 'Most severe first']];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const REGIONS = ['Central', 'North', 'South', 'West', 'Outer'];
/** How a call is classified when it is logged (incident_category). */
const CATEGORIES = ['Crime', 'Medical', 'Fire', 'Disaster', 'Traffic', 'Public Order'];
const DEPARTMENTS: Array<[string, string]> = [
  ['MetroPolice', 'Metro Police'], ['MetroFire', 'Fire & Rescue'],
  ['Medical', 'EMS'], ['EthekwiniDisaster', 'Disaster Management'],
];
/** A department's dispatch desk, as opposed to the central control room (0068). */
const DESK_ROLES = ['Dispatcher', 'ControlRoom', 'IncidentLogger'];
const FIELD: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

export default async function PendingPage({ searchParams }: { searchParams: Promise<QueueParams> }) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  const sort = (SORTS.find(([s]) => s === params.sort)?.[0] ?? 'newest') as QueueSort;
  // A department's desk receives only the calls sent to it, and keeps each
  // in its queue until it dispatches its own crews (0073); it counts its own
  // crews only. The control room sees every desk and every crew.
  const deskOf: Silo | null = DESK_ROLES.includes(role) && silo !== 'Ethekwini' ? (silo as Silo) : null;
  const crews: Silo[] = deskOf ? [deskOf] : silo !== 'Ethekwini' && FIELD.includes(silo as Silo) ? [silo as Silo] : FIELD;
  const [pending, officers] = await Promise.all([
    listQueue(supabase, {
      q: params.q, severity: params.severity, region: params.region, department: deskOf ?? params.department, sort,
      category: CATEGORIES.includes(params.category ?? '') ? params.category : null,
      stage: params.stage, from: params.from, to: params.to,
    }),
    listOnDutyOfficers(supabase, crews).catch(() => []),
  ]);
  // Who a dispatch would reach right now; live via the realtime bridge.
  const onDuty = officers.length;
  const available = officers.filter((o) => o.activeCalls === 0).length;
  // Two-desk split: a Dispatcher works this queue and never captures calls,
  // so only chairs that may log a call see the button.
  const canLogCall = canAccess('/dispatch/log-call', role, silo);
  const canAssign = canAccess('/dispatch/assign/x', role, silo);
  const filtered = Boolean(params.q || params.severity || params.region || params.department
    || params.category || params.stage || params.from || params.to);
  const now = new Date();

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-card px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <span
            className={`text-2xl font-bold leading-none tabular-nums ${
              pending.length === 0 ? 'text-success' : 'text-severity-critical stat-glow'
            }`}
          >
            {pending.length}
          </span>
          <h1 className="font-semibold">{t('awaiting dispatch{value}', { value: filtered ? ' (filtered)' : '' })}</h1>
          {deskOf ? <span className="text-xs text-muted-foreground">{t('sent to the {value} desk', { value: DEPARTMENT_NAMES[deskOf] })}</span> : null}
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold ${
            onDuty === 0
              ? 'border-severity-critical/40 bg-severity-critical/10 text-severity-critical-ink'
              : 'border-severity-low/40 bg-severity-low/10 text-severity-low-ink'
          }`}
          title={onDuty === 0 ? 'No one is on duty to receive a dispatch' : undefined}
        >
          <span className={`h-2 w-2 rounded-full ${onDuty === 0 ? 'bg-severity-critical' : 'animate-pulse bg-severity-low'}`} />
          {onDuty === 0 ? 'No one on duty' : `${onDuty} on duty · ${available} available`}
        </span>
        {canLogCall ? (
          <Link href="/dispatch/log-call" className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-sm font-semibold">
            {t('+ Log new call')}</Link>
        ) : null}
      </header>

      {/* Criti: what needs attention now, for this person. */}
      <CritiTiles />

      <Suspense fallback={<div className="h-[54px] rounded-lg border border-border bg-bg-card" />}>
        <QueueFilters
          sorts={SORTS} severities={SEVERITIES} categories={CATEGORIES} stages={QUEUE_STAGES} regions={REGIONS}
          departments={deskOf ? [] : DEPARTMENTS} shown={pending.length}
        />
      </Suspense>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left">{t('Incident #')}</th>
                <th className="px-4 py-3 text-left">{t('Severity')}</th>
                <th className="px-4 py-3 text-left">{t('Type')}</th>
                <th className="px-4 py-3 text-left">{t('Status')}</th>
                <th className="px-4 py-3 text-left">{t('Caller')}</th>
                <th className="px-4 py-3 text-left">{t('Location')}</th>
                <th className="px-4 py-3 text-left">{t('Time logged')}</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    {filtered ? 'No calls match these filters.' : 'Queue is clear. All calls have been dispatched.'}
                  </td>
                </tr>
              )}
              {pending.map((i) => (
                <IncidentRow key={i.id} incidentId={i.id}>
                  <td className="px-4 py-3 font-mono text-accent">
                    {i.incident_number}
                    {i.source === 'Responder-Panic' ? (
                      <span className="ml-2 rounded bg-severity-critical px-1.5 py-0.5 font-sans text-[10px] font-bold text-white">SOS</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span>
                  </td>
                  <td className="px-4 py-3">
                    {i.incident_type}
                    <DetailsToFollow incident={i} className="mt-1 flex w-fit" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {/* Each department's part: what the others have already done (0073). */}
                      {i.departments?.length
                        ? sortParts(i.departments).map((d) => (
                            <span
                              key={d.silo}
                              title={partWords(d)}
                              className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                d.status === 'Waiting'
                                  ? 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium-ink'
                                  : 'border-severity-low/40 bg-severity-low/10 text-severity-low-ink'
                              }`}
                            >
                              {DEPARTMENT_NAMES[d.silo]} · {partWords(d)}
                            </span>
                          ))
                        : deskTags(i).map((d) => (
                            <span key={d} className="whitespace-nowrap rounded-full border border-border bg-bg-soft px-2 py-0.5 text-[11px] font-semibold">
                              {DEPARTMENT_NAMES[d]}
                            </span>
                          ))}
                      {!i.departments?.length && deskTags(i).length === 0 ? <span className="text-xs text-severity-medium-ink">{t('Control room only')}</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className={i.caller_name === CALLER_NOT_GIVEN ? 'text-muted-foreground' : undefined}>{i.caller_name}</div>
                    <div className="text-xs text-muted-foreground">{i.caller_number}</div>
                  </td>
                  <td className="max-w-[300px] px-4 py-3">
                    <StopClick>
                      <DispatchMapButton
                        incident={{
                          id: i.id, number: i.incident_number, type: i.incident_type, severity: i.incident_severity,
                          address: i.location_address, lat: i.location_lat, lng: i.location_lng,
                        }}
                        officers={officers}
                        canAssign={canAssign}
                        className="max-w-full"
                      >
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                        <span className="truncate">{i.location_address}</span>
                      </DispatchMapButton>
                    </StopClick>
                    {i.region ? <div className="pl-5 text-xs text-muted-foreground">{i.region}</div> : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground" title={new Date(i.call_timestamp).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}>
                    {chatTime(i.call_timestamp, now)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StopClick>
                      <Link
                        href={`/dispatch/assign/${i.id}`}
                        className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold"
                      >
                        {t('Dispatch')}</Link>
                    </StopClick>
                  </td>
                </IncidentRow>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <PendingRealtimeBridge />
    </div>
  );
}
