import Link from 'next/link';
import { Clock } from 'lucide-react';
import {
  addDays, getRosterRange, getScheduleSettings, listShiftTemplates, saDay, saTime, shiftState, stateWords, type ShiftState,
} from '@criticom/api';
import { canManageRoster, departmentName, type Silo, type UserRole } from '@criticom/db';
import { getServerSupabase } from '@/lib/supabase';
import { requestT } from '@/lib/i18n';
import { readable } from '@/lib/readable';

/**
 * Who is on shift now in the department, and who has not started — for those
 * who roster it. The same states the late alerts use (shift_attendance), so
 * the card and the alerts never disagree.
 */
/** `silo` is the department shown; `ownSilo` the viewer's (defaults to it). */
export async function AttendanceNow({ viewerRole: role, silo, ownSilo = silo }: { viewerRole: UserRole; silo: Silo; ownSilo?: Silo }) {
  const { t } = await requestT();
  if (!canManageRoster(role, ownSilo, silo)) return null;
  const supabase = await getServerSupabase();
  const today = saDay();
  const [lines, settings, templates] = await Promise.all([
    getRosterRange(supabase, { silo, from: addDays(today, -1), to: today }).catch(() => []),
    getScheduleSettings(supabase, silo),
    listShiftTemplates(supabase, silo, { includeInactive: true }).catch(() => []),
  ]);
  const name = new Map(templates.map((t) => [t.id, t.name]));
  const now = Date.now();
  const current = lines
    .filter((l) => l.published && !l.cancelled_at && l.start_at && l.end_at
      && Date.parse(l.end_at) > now && Date.parse(l.start_at) - 60 * 60_000 <= now)
    .map((l) => ({
      l,
      state: shiftState({ start_at: l.start_at!, end_at: l.end_at!, status: l.status, cancelled_at: l.cancelled_at }, l.attendance, settings, now),
    }));
  const count = (...s: ShiftState[]) => current.filter((c) => s.includes(c.state)).length;
  const attention = current.filter((c) => c.state === 'late' || c.state === 'not_started')
    .sort((a, b) => Date.parse(a.l.start_at!) - Date.parse(b.l.start_at!));

  return (
    <section className="rounded-lg border border-border bg-bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold"><Clock className="h-4 w-4" /> {' '}{t('Shift attendance now · {departmentName}', { departmentName: departmentName(silo) })}</p>
        <div className="flex gap-3 text-xs font-semibold">
          <Link href="/roster/allocation" className="text-accent hover:underline">{t('Duty board')}</Link>
          <Link href="/roster" className="text-accent hover:underline">{t('Roster')}</Link>
        </div>
      </div>
      {current.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('Nobody is on the issued roster right now.')}</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Figure label={t('Started')} value={count('started', 'started_late', 'finished')} />
            <Figure label={t('Starting')} value={count('upcoming', 'due')} />
            <Figure label={t('Late')} value={count('late')} tone={count('late') ? 'warning' : undefined} />
            <Figure label={t('Not started')} value={count('not_started')} tone={count('not_started') ? 'danger' : undefined} />
            <Figure label={t('On leave')} value={count('leave')} />
          </div>
          {attention.length ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              {attention.map(({ l, state }) => (
                <li key={l.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${state === 'not_started' ? 'border-danger/50 bg-danger/5' : 'border-warning/50 bg-warning/5'}`}>
                  <span>
                    <span className="font-semibold">{l.user_name}</span>
                    <span className="ml-2 text-muted-foreground">
                      {(l.template_id && name.get(l.template_id)) || l.activity_type || 'Shift'} {saTime(l.start_at!)}{l.post ? ` · ${l.post}` : ''}{l.station ? ` · ${l.station}` : ''}
                    </span>
                  </span>
                  <span className={`text-xs font-bold ${state === 'not_started' ? 'text-danger' : 'text-warning'}`}>
                    {t('{stateWords} · {floor}', { stateWords: stateWords(state), floor: readable((now - Date.parse(l.start_at!)) / 60_000) })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-severity-low-ink">{t('Everyone due has started.')}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {t('Late after {grace} min, not started after {noshow} min. Record why from the roster.', { grace: settings.grace, noshow: settings.noshow })}</p>
        </>
      )}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'danger' }) {
  return (
    <div>
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : ''}`}>{value}</p>
    </div>
  );
}
