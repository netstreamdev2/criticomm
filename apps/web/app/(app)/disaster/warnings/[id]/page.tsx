import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText, History, MapPin } from 'lucide-react';
import { getWarning, listCouncillors, listReadinessSessions, listWarningEvents } from '@criticom/api';
import { EMERGENCY_NUMBER } from '@criticom/db/disaster-plan';
import { isLive, warningMessage, warningSms, warningState } from '@criticom/db/disaster-warnings';
import { Fold } from '@/components/disaster/fold';
import { ShapesMap } from '@/components/disaster/shapes-map';
import { WarningBadge, WARNING_TONE } from '@/components/disaster/warning-badge';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { cn, formatSaTime } from '@/lib/utils';
import { WarningWork } from './warning-work';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Warning · HikTech' };

const when = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

/**
 * One SA Weather Service warning and the process it goes through (0116):
 * what SAWS says and where, the checks and channels (W2), the JOC readiness
 * session at Level 4 or higher (W3), and logging an incident from it.
 */
export default async function WarningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await requestT();
  const { supabase } = await getSession();
  const w = await getWarning(supabase, id);
  if (!w) notFound();
  const [events, sessions, councillors, incident] = await Promise.all([
    listWarningEvents(supabase, id), listReadinessSessions(supabase, [id]), listCouncillors(supabase),
    w.incident_id
      ? supabase.from('incidents').select('id, incident_number').eq('id', w.incident_id).maybeSingle().then((r) => r.data as { id: string; incident_number: string } | null)
      : Promise.resolve(null),
  ]);
  const state = warningState(w);
  const live = isLive(state) && w.status === 'Active';
  const tone = WARNING_TONE[w.colour] ?? WARNING_TONE.Yellow!;

  return (
    <div className="space-y-6">
      <Link href="/disaster/warnings" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />{t('All warnings')}
      </Link>

      <header className={cn('rounded-2xl border border-l-8 border-border bg-bg-card p-5 shadow-sm', tone.bar)}>
        <div className="flex flex-wrap items-center gap-3">
          <WarningBadge colour={w.colour} level={w.level} className="text-sm" />
          <h1 className="text-2xl font-bold">{w.hazard}</h1>
          <span className="rounded-full border border-border px-3 py-1 text-sm font-semibold">{t(state)}</span>
        </div>
        <p className="mt-2 text-lg">{when.format(new Date(w.valid_from))} → {when.format(new Date(w.valid_until))}</p>
        <p className="mt-1 text-muted-foreground">{w.areas}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {w.source === 'Typed in'
            ? t('Typed in by {name}, {at}.', { name: w.created_by_name ?? '—', at: formatSaTime(w.created_at) })
            : t('From the SA Weather Service, issued {at}.', { at: formatSaTime(w.issued_at ?? w.created_at) })}
          {w.ended_reason ? ` ${t('Ended: {reason}', { reason: w.ended_reason })}` : ''}
        </p>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-5">
          <Fold id="warning.says" icon={FileText} title={t('What the SA Weather Service says')} bodyClassName="space-y-4 p-5"
            info={t('The warning in SAWS’s own words. Pass it on as it is.')}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Expected impacts')}</p>
              <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed">{w.impacts ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('What people should do')}</p>
              <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed">{w.instructions ?? '—'}</p>
            </div>
          </Fold>
          <Fold id="warning.where" icon={MapPin} title={t('Where')} bodyClassName="p-3"
            info={t('The parts of eThekwini the warning covers, as SAWS drew them.')}>
            {w.area_shapes?.length
              ? <ShapesMap shapes={w.area_shapes.map((points) => ({ points, colour: tone.map, label: `${w.hazard} · ${w.colour} Level ${w.level}` }))} height={340} className="overflow-hidden rounded-lg" />
              : <p className="p-2 text-sm text-muted-foreground">{t('No map shapes with this warning. Areas: {areas}', { areas: w.areas })}</p>}
          </Fold>
        </div>

        <div className="space-y-6 xl:col-span-7">
          <WarningWork warningId={w.id} live={live} level={w.level} colour={w.colour} colourByDesk={w.colour_by_desk}
            steps={w.steps} message={warningMessage(w, EMERGENCY_NUMBER)} sms={warningSms(w, EMERGENCY_NUMBER)}
            councillors={councillors.filter((c) => c.is_active && c.phone).length}
            sessions={sessions.map((s) => ({ id: s.id, at: s.held_at, outcome: s.outcome ?? '', attended: s.attended, notes: s.notes, by: s.created_by_name }))}
            incident={incident ? { id: incident.id, number: incident.incident_number } : null} />
        </div>
      </div>

      <Fold id="warning.record" icon={History} title={t('Record ({n})', { n: events.length })} defaultOpen={false}
        info={t('Everything that happened to this warning, newest first: from SAWS, every tick, the SMS and the JOC sessions.')}>
        <ol className="divide-y divide-border">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-4 px-5 py-2.5 text-sm">
              <span className="w-36 shrink-0 tabular-nums text-muted-foreground">{formatSaTime(e.at)}</span>
              <span className="min-w-0 flex-1">{e.text}</span>
              <span className="text-muted-foreground">{e.by_name}</span>
            </li>
          ))}
        </ol>
      </Fold>
    </div>
  );
}
