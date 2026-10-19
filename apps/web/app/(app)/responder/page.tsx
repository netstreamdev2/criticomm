import Link from 'next/link';
import { Siren, Smartphone } from 'lucide-react';
import { getMyPersonnel, hasCompletedShiftStartToday, listFieldIncidents, type FieldIncident } from '@criticom/api';
import { RESPONDER_MONITOR_ROLES, RESPONDER_ROLES } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { IncidentLive } from '@/components/incident-live';
import { getSession } from '@/lib/session';
import { timeAgo } from '@/lib/utils';
import { uploadEvidenceAction } from './actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Calls · HikTech' };

/** My place on a call, as the phone shows it (0042). */
function partOf(call: FieldIncident, userId: string): { label: string; tone: string; working: boolean } {
  const mine = call.responders?.find((r) => r.user_id === userId);
  if (mine?.role === 'lead' || call.accepted_by === userId) {
    return { label: 'You lead this call', tone: 'border-accent/50 bg-accent/10 text-accent', working: true };
  }
  if (mine) return { label: 'You are backup', tone: 'border-border bg-bg-soft text-fg', working: true };
  if (call.assigned_to === userId) {
    return { label: 'Assigned to you: respond in the app', tone: 'border-severity-high/50 bg-severity-high/10 text-severity-high-ink', working: false };
  }
  return { label: 'Sent to everyone on duty', tone: 'border-border bg-bg-soft text-muted-foreground', working: false };
}

/**
 * The calls sent to this officer, on the console. Responding, the status
 * steps and the report happen in the HikTech Responder app, which works
 * offline and carries the officer's position; this page shows the same calls
 * and takes evidence files from a computer. It used to offer its own status
 * buttons, including a Resolved the database refuses for police and fire.
 */
export default async function ResponderPage() {
  const { t } = await requestT();
  const { supabase, userId, silo, role } = await getSession();
  // An administrator opening My calls: the crews out are on the terminal.
  const deskSide = RESPONDER_MONITOR_ROLES.includes(role) && !RESPONDER_ROLES.includes(role);

  const [me, shiftDone, calls] = await Promise.all([
    getMyPersonnel(supabase, userId).catch(() => null),
    hasCompletedShiftStartToday(supabase).catch(() => false),
    listFieldIncidents(supabase, silo, userId).catch(() => []),
  ]);
  // Mine first (leading, backing up, assigned), then the ones open to anyone.
  const ordered = [...calls].sort((a, b) => Number(partOf(b, userId).working || b.assigned_to === userId)
    - Number(partOf(a, userId).working || a.assigned_to === userId));

  return (
    <div className="space-y-4">
      <IncidentLive />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('My calls')}</h1>
          <p className="text-muted-foreground">
            {me
              ? `${me.apparatus?.unit_number ? `Unit ${me.apparatus.unit_number} · ` : ''}${me.is_on_duty ? 'On duty' : 'Off duty'}`
              : 'No personnel record linked to your account yet — contact your supervisor.'}
          </p>
        </div>
        {!shiftDone && (
          <Link
            href="/shift/mental-check"
            className="inline-flex h-10 items-center rounded-md bg-severity-medium px-4 text-sm font-semibold"
          >
            {t('Start of shift not done →')}</Link>
        )}
      </header>

      {deskSide ? (
        <Link
          href="/responder/monitor"
          className="frost flex items-center gap-3 rounded-xl border border-red-500/40 p-4 text-sm transition-colors hover:bg-bg-soft/40"
          style={{ backgroundImage: 'linear-gradient(135deg, #ef444422, transparent 70%)' }}
        >
          <Siren className="h-5 w-5 shrink-0 text-red-500" aria-hidden />
          <span>
            <span className="block font-semibold">{t('Every crew out is on the Active Responders terminal')}</span>
            <span className="text-muted-foreground">{t('This page shows calls sent to you yourself, as a field officer sees them.')}</span>
          </span>
        </Link>
      ) : null}

      <Card>
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
          <p className="text-muted-foreground">
            {t('Respond, mark en route and on scene, and file the report in the')}{' '}<strong className="text-fg">{t('HikTech Responder app')}</strong>{t('. It keeps working without signal and sends your position to dispatch. The call closes when your report is filed.')}</p>
        </CardContent>
      </Card>

      {ordered.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {t('No calls sent to you or your department right now.')}</CardContent>
        </Card>
      )}

      {ordered.map((i) => {
        const part = partOf(i, userId);
        return (
          <Card key={i.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="font-mono">{i.incident_number}</CardTitle>
                  <CardDescription>
                    {i.incident_type} · <span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span> {' '}{t('· dispatched {timeAgo}', { timeAgo: timeAgo(i.dispatch_time) })}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${part.tone}`}>{part.label}</span>
                  <span className="status-badge" data-status={i.status}>{i.status}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p><span className="text-muted-foreground">{t('Location:')}</span> {i.location_address}</p>
              <p><span className="text-muted-foreground">{t('Description:')}</span> {i.call_description}</p>
              {i.responding_officer && !part.working ? (
                <p><span className="text-muted-foreground">{t('Lead:')}</span> {i.responding_officer}</p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/incidents/${i.id}`} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
                  {t('Full details')}</Link>
              </div>

              {part.working && (
                <form action={uploadEvidenceAction} className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <input type="hidden" name="incident_id" value={i.id} />
                  <input type="hidden" name="silo" value={i.silo} />
                  <input type="file" name="file" accept="image/*,audio/*,video/*" className="text-xs" aria-label={t('Evidence file')} />
                  <input
                    name="caption" placeholder={t('Caption (optional)')} aria-label={t('Caption')}
                    className="h-9 w-48 rounded-md border border-border bg-bg-soft px-3 text-xs"
                  />
                  <button type="submit" className="h-9 rounded-md bg-accent px-3 text-xs font-semibold">
                    {t('Upload evidence')}</button>
                </form>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
