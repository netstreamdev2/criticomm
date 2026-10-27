import Link from 'next/link';
import { CloudLightning, Phone } from 'lucide-react';
import { CritiMascot } from '@/components/criti/mascot';
import { listCallFacts, listLiveWarnings, listOpenDisasterIncidents } from '@criticom/api';
import { EMERGENCY_NUMBER, telLink } from '@criticom/db/disaster-plan';
import { JOC_LEVEL, warningState } from '@criticom/db/disaster-warnings';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { WARNING_TONE } from './warning-badge';
import { WarningWatcher } from './warning-watcher';

const SHOWN = 3;
const hhmm = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * The strip on top of every Disaster screen: whether the JOC is on standby
 * or active (any open incident at Gold), the SA Weather Service warnings in
 * force for eThekwini (0116), and the emergency number, 031 361 0000, one
 * press from anywhere.
 */
export async function DisasterFrame() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const [open, warnings] = await Promise.all([
    listOpenDisasterIncidents(supabase).catch(() => []),
    listLiveWarnings(supabase).catch(() => []),
  ]);
  const facts = await listCallFacts(supabase, open.map((i) => i.id)).catch(() => []);
  // A stood-down incident may still say Gold; only an active one has the JOC sitting.
  const gold = facts.filter((f) => f.level === 'Gold' && (f.dm_status ?? 'Active') === 'Active').length;
  const readiness = warnings.some((w) => w.level >= JOC_LEVEL && warningState(w) === 'In force');
  const tel = telLink(EMERGENCY_NUMBER);

  return (
    <div data-guide="frame" className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-border bg-bg-card px-3 py-2 shadow-sm">
      <WarningWatcher />
      <Link href="/disaster/desk"
        title={gold ? t('The JOC is coordinating {n} incident(s) at Gold.', { n: gold })
          : readiness ? t('A Level 4 or higher warning is in force: the JOC checks readiness.')
            : t('No incident is at Gold. The JOC is ready to be activated.')}
        className={cn('inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-bold',
          gold ? 'bg-[#d4a72c] text-slate-950' : readiness ? 'bg-severity-medium/20 text-severity-medium-ink' : 'bg-muted text-fg')}>
        <span className={cn('h-2.5 w-2.5 rounded-full', gold ? 'animate-pulse bg-slate-950' : readiness ? 'animate-pulse bg-severity-medium' : 'bg-muted-foreground')} aria-hidden />
        {gold ? t('JOC active · {n} at Gold', { n: gold }) : readiness ? t('JOC: check readiness') : t('JOC on standby')}
      </Link>

      {warnings.slice(0, SHOWN).map((w) => {
        const coming = warningState(w) === 'Upcoming';
        return (
          <Link key={w.id} href={`/disaster/warnings/${w.id}`}
            className={cn('inline-flex min-h-10 max-w-full items-center gap-2 rounded-full px-4 text-sm font-bold', WARNING_TONE[w.colour]?.chip)}>
            <CloudLightning className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">
              {t('Level {n} {hazard}', { n: w.level, hazard: w.hazard })} · {coming
                ? t('from {time}', { time: hhmm.format(new Date(w.valid_from)) })
                : t('until {time}', { time: hhmm.format(new Date(w.valid_until)) })}
            </span>
          </Link>
        );
      })}
      {warnings.length > SHOWN ? (
        <Link href="/disaster/warnings" className="text-sm font-semibold text-accent hover:underline">{t('and {n} more', { n: warnings.length - SHOWN })}</Link>
      ) : null}

      <Link href="/disaster?tour=1" title={t('Criti shows you round the Disaster screens')}
        className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-semibold hover:bg-muted">
        <CritiMascot className="h-6 w-6" />{t('Tour')}
      </Link>
      {tel ? (
        <a href={tel} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-severity-critical/40 px-4 text-sm font-bold text-severity-critical-ink hover:bg-severity-critical/10">
          <Phone className="h-4 w-4" aria-hidden />{t('Emergency {number}', { number: EMERGENCY_NUMBER })}
        </a>
      ) : null}
    </div>
  );
}
