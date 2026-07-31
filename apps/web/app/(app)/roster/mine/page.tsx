import Link from 'next/link';
import {
  BadgeCheck, CalendarClock, Car, Clock, MapPin, Radio, Umbrella,
} from 'lucide-react';
import { getMySchedule, inclusiveDays } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DeptBadge } from '@/components/dept-badge';
import { getSession } from '@/lib/session';
import { getBrandingMap } from '@/lib/branding';
import { formatSaTime, cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Schedule · Criticom' };

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

const STATUS_TONE: Record<string, string> = {
  Approved: 'text-severity-low-ink',
  Rejected: 'text-severity-critical-ink',
  Pending: 'text-severity-medium-ink',
};

export default async function MySchedulePage() {
  const { supabase, userId, silo, fullName, role } = await getSession();
  const [schedule, branding] = await Promise.all([
    getMySchedule(supabase, { userId, silo: silo as Silo }),
    getBrandingMap(),
  ]);
  const dept = branding[silo as Silo];

  const upcoming = schedule.duties.filter((d) => d !== schedule.onDutyNow);

  return (
    <div className="space-y-6">
      {/* Identity header, branded to the member's department */}
      <header
        className="flex flex-wrap items-center gap-4 overflow-hidden rounded-2xl border border-border p-5"
        style={{ background: `linear-gradient(100deg, ${dept.primary_color}1f, transparent 65%)` }}
      >
        <DeptBadge branding={dept} logoUrl={dept.logoUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">My schedule</h1>
          <p className="text-sm text-muted-foreground">
            {fullName} · {role} · {dept.short_name}
          </p>
        </div>
        <Link
          href="/leave"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted"
        >
          <Umbrella className="h-4 w-4" /> Apply for leave
        </Link>
      </header>

      {/* Right now / next up */}
      <section className="grid gap-3 md:grid-cols-2">
        <Card className={cn(schedule.onDutyNow && 'border-severity-low/50')}>
          <CardContent className="p-5">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Radio className="h-3.5 w-3.5" /> On duty now
            </p>
            {schedule.onDutyNow ? (
              <>
                <p className="mt-2 text-xl font-bold">{schedule.onDutyNow.shiftName}</p>
                <p className="text-sm text-muted-foreground">
                  {schedule.onDutyNow.startTime ? `${timeLabel(schedule.onDutyNow.startTime)}–` : ''}
                  {schedule.onDutyNow.endTime ? timeLabel(schedule.onDutyNow.endTime) : ''}
                  {' · '}{schedule.onDutyNow.station}
                </p>
                <p className="mt-2 flex flex-wrap gap-2 text-xs">
                  {schedule.onDutyNow.callSign ? (
                    <span className="rounded-md bg-muted px-2 py-0.5 font-mono">{schedule.onDutyNow.callSign}</span>
                  ) : null}
                  {schedule.onDutyNow.vehicle ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                      <Car className="h-3 w-3" /> {schedule.onDutyNow.vehicle}
                    </span>
                  ) : null}
                  {schedule.onDutyNow.sector ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                      <MapPin className="h-3 w-3" /> {schedule.onDutyNow.sector}
                    </span>
                  ) : null}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Not on a scheduled duty right now.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Next up
            </p>
            {schedule.nextDuty?.startTime ? (
              <>
                <p className="mt-2 text-xl font-bold">{schedule.nextDuty.shiftName}</p>
                <p className="text-sm text-muted-foreground">
                  {dayLabel(schedule.nextDuty.startTime)} · {timeLabel(schedule.nextDuty.startTime)}
                  {schedule.nextDuty.endTime ? `–${timeLabel(schedule.nextDuty.endTime)}` : ''}
                  {' · '}{schedule.nextDuty.station}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Nothing scheduled in the next 30 days.</p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Leave balances */}
      {schedule.balances.filter((b) => b.entitlement > 0).length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {schedule.balances.filter((b) => b.entitlement > 0).map((b) => {
            const used = Math.min(100, Math.round(((b.taken + b.pending) / b.entitlement) * 100));
            return (
              <Card key={b.type}>
                <CardContent className="p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{b.type}</p>
                  <p className="mt-1.5 text-2xl font-bold">
                    {b.remaining}
                    <span className="text-sm font-normal text-muted-foreground"> / {b.entitlement} days</span>
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', used >= 90 ? 'bg-severity-critical' : used >= 65 ? 'bg-severity-medium' : 'bg-severity-low')}
                      style={{ width: `${used}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : null}

      {/* Upcoming duties */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-accent" /> Upcoming duties ({upcoming.length})
          </CardTitle>
          <CardDescription>Your roster allocations for the next 30 days.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Nothing rostered yet — your supervisor allocates duty from the roster board.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((d) => (
                <li key={d.rosterId} className="flex flex-wrap items-center gap-3 px-6 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{d.shiftName}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.startTime ? `${dayLabel(d.startTime)} · ${timeLabel(d.startTime)}` : 'Unscheduled'}
                      {d.endTime ? `–${timeLabel(d.endTime)}` : ''}
                      {' · '}{d.activityType} · {d.station}
                    </p>
                    {d.specialInstructions ? (
                      <p className="mt-1 text-xs italic text-severity-medium-ink">{d.specialInstructions}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {d.callSign ? <span className="rounded-md bg-muted px-2 py-0.5 font-mono">{d.callSign}</span> : null}
                    {d.vehicle ? <span className="rounded-md bg-muted px-2 py-0.5">{d.vehicle}</span> : null}
                    {d.sector ? <span className="rounded-md bg-muted px-2 py-0.5">{d.sector}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Leave + endorsements */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Umbrella className="h-4 w-4 text-accent" /> My leave
            </CardTitle>
            <CardDescription>Current and upcoming requests.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {schedule.leave.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">No upcoming leave.</p>
            ) : (
              <ul className="divide-y divide-border">
                {schedule.leave.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-6 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{l.absence ?? 'Leave'}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.eff_from} → {l.eff_to} · {inclusiveDays(l.eff_from, l.eff_to)} day
                        {inclusiveDays(l.eff_from, l.eff_to) === 1 ? '' : 's'}
                        {l.approved_by ? ` · by ${l.approved_by}` : ''}
                      </p>
                    </div>
                    <span className={cn('shrink-0 text-xs font-semibold', STATUS_TONE[l.status] ?? '')}>
                      {l.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-accent" /> My endorsements
            </CardTitle>
            <CardDescription>Court attendance, special events and standing instructions.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {schedule.endorsements.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">None active.</p>
            ) : (
              <ul className="divide-y divide-border">
                {schedule.endorsements.map((e) => (
                  <li key={e.id} className="px-6 py-3">
                    <p className="text-sm font-semibold">{e.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.start_date}{e.end_date ? ` → ${e.end_date}` : ''}
                      {e.created_by ? ` · by ${e.created_by}` : ''}
                    </p>
                    {e.details ? <p className="mt-1 text-xs">{e.details}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Schedule generated {formatSaTime(new Date().toISOString())}
      </p>
    </div>
  );
}
