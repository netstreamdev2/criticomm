import Link from 'next/link';
import { AlertTriangle, CheckCircle2, History, MapPin, PhoneCall } from 'lucide-react';
import { getOperationalSettings } from '@criticom/api';
import type { Database, Silo, UserRole } from '@criticom/db';
import { Card, CardContent } from '@/components/ui/card';
import { OpsMap } from '@/components/ops-map/ops-map';
import type { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { BoardLive } from './board-live';
import { requestT } from '@/lib/i18n';

type Supabase = Awaited<ReturnType<typeof getSession>>['supabase'];
type Incident = Database['public']['Tables']['incidents']['Row'];

/**
 * The call logger's dashboard (the old "intake dashboard": the call intake
 * desk, where calls come in). As V4: two big buttons, then the calls this
 * person logged: how many are still open, how bad, how many closed today,
 * and where they are on the map. Their own calls only — the query asks for
 * them, and the database allows no other (0094). Nothing here opens a call.
 */
export async function IntakeBoard({ supabase, role, silo, userId }: {
  supabase: Supabase; role: UserRole; silo: Silo; userId: string;
}) {
  const { t } = await requestT();
  const settings = await getOperationalSettings(supabase);
  const todayStart = new Date(`${new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())}T00:00:00+02:00`);

  const [liveRes, closedRes] = await Promise.all([
    supabase.from('incidents').select('*')
      .eq('created_by', userId)
      .not('status', 'in', '("Closed","Resolved")')
      .order('incident_created_at', { ascending: false }),
    supabase.from('incidents').select('id', { count: 'exact', head: true })
      .eq('created_by', userId)
      .gte('closed_at', todayStart.toISOString()),
  ]);
  const live = (liveRes.data ?? []) as Incident[];
  const unfinished = live.filter((i) => !i.intake_complete).length;
  const buckets = [
    ['HIGH', live.filter((i) => i.incident_severity === 'Critical' || i.incident_severity === 'High').length, 'bg-severity-critical'],
    ['MED', live.filter((i) => i.incident_severity === 'Medium').length, 'bg-severity-medium'],
    ['LOW', live.filter((i) => i.incident_severity === 'Low').length, 'bg-severity-low'],
  ] as const;

  const big = 'flex h-16 flex-1 items-center justify-center gap-3 rounded-xl text-lg font-bold';

  return (
    <>
      <BoardLive />
      <section className="flex flex-col gap-3 sm:flex-row">
        <Link href="/dispatch/log-call" className={cn(big, 'bg-primary text-white hover:bg-primary/90')}>
          <PhoneCall className="h-6 w-6" /> {t('Log Incoming Call')}
        </Link>
        <Link href="/dispatch/log-history" className={cn(big, 'border border-border bg-bg-card hover:bg-muted')}>
          <History className="h-6 w-6" /> {t('Log History')}
        </Link>
      </section>

      {unfinished > 0 ? (
        <Link
          href="/dispatch/log-history?stage=unfinished"
          className="flex items-center gap-3 rounded-xl border border-severity-high/50 bg-severity-high/10 px-4 py-3 font-semibold text-severity-high-ink"
        >
          <AlertTriangle className="h-5 w-5" />
          {unfinished === 1 ? t('1 call is not finished — finish it') : t('{n} calls are not finished — finish them', { n: unfinished })}
        </Link>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="h-full">
          <CardContent className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="ops-chip" data-tone="critical"><AlertTriangle className="h-5 w-5" /></span>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">{t('My open calls')}</p>
            <p className="stat-glow text-6xl font-bold text-severity-critical-ink">{live.length}</p>
          </CardContent>
        </Card>
        <Card className="h-full">
          <CardContent className="flex h-full flex-col justify-center p-6">
            <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">{t('How serious')}</p>
            <div className="mt-5 flex items-center justify-center">
              {buckets.map(([label, value, dot], i) => (
                <div key={label} className={cn('flex-1 text-center', i > 0 && 'border-l border-border')}>
                  <p className="text-4xl font-bold">{value}</p>
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <span className={cn('h-1.5 w-1.5 rounded-full', dot)} /> {label}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="h-full">
          <CardContent className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="ops-chip" data-tone="low"><CheckCircle2 className="h-5 w-5" /></span>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">{t('Closed today')}</p>
            <p className="stat-glow text-6xl font-bold text-severity-low-ink">{closedRes.count ?? 0}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="p-5">
          <h2 className="mb-4 flex items-center gap-2 text-base font-bold">
            <MapPin className="h-4 w-4 text-accent" /> {t('My calls on the map')}
          </h2>
          <OpsMap
            incidents={live}
            officers={[]}
            layers={['incidents']}
            defaults={['incidents']}
            basemap={settings['map.default_basemap']}
            scopeLabel={t('My calls')}
            height={520}
            me={{ id: userId, role, silo }}
            onlyMine
          />
        </CardContent>
      </Card>
    </>
  );
}
