import { attendanceSummary, lastClockEvent, listAttendance } from '@criticom/api';
import { SUPERVISORY_ROLES } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { cn, formatSaTime } from '@/lib/utils';
import { clockAction } from './actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Time & Attendance · HikTech' };

export default async function AttendancePage() {
  const { t } = await requestT();
  await requireFeaturePage('web.time_attendance');
  const { supabase, userId, role } = await getSession();

  // The register shows the last 7 days; RLS scopes it — a member sees their
  // own punches, the supervisory tier sees the silo, the global tier sees all.
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [events, last] = await Promise.all([
    listAttendance(supabase, { sinceIso: since }),
    lastClockEvent(supabase, userId),
  ]);
  const onClock = last?.kind === 'clock_in';
  const summary = attendanceSummary(events);
  const isSupervisor = SUPERVISORY_ROLES.includes(role) || role === 'SystemController';

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Time & Attendance')}</h1>
          <p className="text-muted-foreground">{t('The clock register — append-only, corrections are new punches.')}</p>
        </div>
        <form action={clockAction} className="flex items-center gap-2">
          <input type="hidden" name="kind" value={onClock ? 'clock_out' : 'clock_in'} />
          <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold uppercase',
            onClock ? 'bg-severity-low/15 text-severity-low-ink' : 'bg-muted text-muted-foreground')}>
            {onClock ? `On the clock since ${formatSaTime(last!.at)}` : 'Off the clock'}
          </span>
          <button
            type="submit"
            className={cn('h-10 rounded-md px-5 text-sm font-semibold',
              onClock ? 'bg-severity-critical/85 text-white' : 'bg-primary')}
          >
            {onClock ? 'Clock out' : 'Clock in'}
          </button>
        </form>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('Hours this week')}</CardTitle>
          <CardDescription>
            {t('Ins paired with outs per person; someone still on the clock accrues to now.{value}', { value: isSupervisor ? '' : ' You see your own record here.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Member', 'First in', 'Last out', 'Hours', 'Now']} empty={t('No punches in the last 7 days.')}>
            {summary.map((s) => (
              <Tr key={s.userId}>
                <Td className="font-medium">{s.name}</Td>
                <Td className="text-xs text-muted-foreground">{s.firstIn ? formatSaTime(s.firstIn) : '—'}</Td>
                <Td className="text-xs text-muted-foreground">{s.lastOut ? formatSaTime(s.lastOut) : '—'}</Td>
                <Td className="font-mono">{s.hours}</Td>
                <Td>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                    s.onClock ? 'bg-severity-low/15 text-severity-low-ink' : 'bg-muted text-muted-foreground')}>
                    {s.onClock ? 'On duty' : 'Off'}
                  </span>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Register')}</CardTitle>
          <CardDescription>{t('Every punch, newest first.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['When', 'Member', 'Event', 'Source', 'Note']} empty={t('Nothing recorded yet.')}>
            {events.slice(0, 100).map((e) => (
              <Tr key={e.id}>
                <Td className="text-xs text-muted-foreground">{formatSaTime(e.at)}</Td>
                <Td>{e.user_name ?? '—'}</Td>
                <Td>
                  <span className={cn('text-xs font-semibold',
                    e.kind === 'clock_in' ? 'text-severity-low-ink' : 'text-severity-medium-ink')}>
                    {e.kind === 'clock_in' ? 'Clock in' : 'Clock out'}
                  </span>
                </Td>
                <Td className="text-xs text-muted-foreground">{e.source}</Td>
                <Td className="text-xs text-muted-foreground">{e.note ?? '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
