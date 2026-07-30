import type { Database } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Shift = Database['public']['Tables']['shifts']['Row'];
type RosterEntry = Database['public']['Tables']['rosters']['Row'];

const ACTIVITY_TONE: Record<string, string> = {
  Patrol: 'border-accent/50 bg-accent/10',
  'Station duty': 'border-border bg-bg-soft',
  Training: 'border-severity-medium/50 bg-severity-medium/10',
  'Special ops': 'border-severity-critical/50 bg-severity-critical/10',
  Standby: 'border-severity-low/50 bg-severity-low/10',
};

/**
 * The week at a glance: seven columns, each day's shifts with the members
 * rostered onto them. Pure server rendering over data the page already
 * fetches — the printable detail stays on the duty sheet.
 */
export function WeekBoard({ shifts, roster }: { shifts: Shift[]; roster: RosterEntry[] }) {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getTime() + i * 86_400_000);
    return {
      iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' }),
      isToday: d.toDateString() === new Date().toDateString(),
    };
  });

  const membersByShift = new Map<string, RosterEntry[]>();
  for (const r of roster) {
    if (!r.shift_id) continue;
    const list = membersByShift.get(r.shift_id) ?? [];
    list.push(r);
    membersByShift.set(r.shift_id, list);
  }

  const shiftsOn = (iso: string) =>
    shifts
      .filter((s) => s.start_time.slice(0, 10) === iso)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const weekHasShifts = days.some((d) => shiftsOn(d.iso).length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>This week&apos;s schedule board</CardTitle>
        <CardDescription>
          Shifts by day with everyone rostered onto them — colour is the activity type.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {!weekHasShifts ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No shifts scheduled this week yet — create one below and roster members onto it.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[900px] grid-cols-7 gap-px bg-border">
              {days.map((d) => (
                <div key={d.iso} className={cn('bg-bg-soft px-2.5 py-2 text-center', d.isToday && 'bg-accent/10')}>
                  <p className={cn('text-xs font-bold uppercase tracking-wider', d.isToday ? 'text-accent' : 'text-muted-foreground')}>
                    {d.label}{d.isToday ? ' · today' : ''}
                  </p>
                </div>
              ))}
              {days.map((d) => {
                const dayShifts = shiftsOn(d.iso);
                return (
                  <div key={`${d.iso}-body`} className={cn('min-h-32 space-y-1.5 bg-bg-card p-1.5', d.isToday && 'bg-accent/5')}>
                    {dayShifts.length === 0 ? (
                      <p className="pt-4 text-center text-[10px] text-muted-foreground/50">—</p>
                    ) : dayShifts.map((s) => {
                      const members = membersByShift.get(s.id) ?? [];
                      return (
                        <div
                          key={s.id}
                          className={cn('rounded-lg border p-1.5', ACTIVITY_TONE[s.activity_type ?? ''] ?? 'border-border bg-bg-soft')}
                        >
                          <p className="truncate text-[11px] font-bold">{s.shift_name}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {s.start_time.slice(11, 16)}–{s.end_time.slice(11, 16)}
                          </p>
                          {members.slice(0, 4).map((m) => (
                            <p key={m.id} className="truncate text-[10px]" title={`${m.user_name} · ${m.station}${m.vehicle ? ` · ${m.vehicle}` : ''}`}>
                              {m.call_sign ? `${m.call_sign} ` : ''}{m.user_name.split(' ')[0]}
                            </p>
                          ))}
                          {members.length > 4 ? (
                            <p className="text-[10px] text-muted-foreground">+{members.length - 4} more</p>
                          ) : null}
                          {members.length === 0 ? (
                            <p className="text-[10px] italic text-muted-foreground/70">unstaffed</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
