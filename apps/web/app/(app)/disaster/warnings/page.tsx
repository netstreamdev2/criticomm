import Link from 'next/link';
import { ChevronRight, CloudLightning, Siren, Users } from 'lucide-react';
import { currentTenant, getFeedState, listCouncillors, listReadinessSessions, listWarnings, type DisasterWarning } from '@criticom/api';
import type { Translate } from '@criticom/db/i18n';
import { JOC_LEVEL, WARNING_STEPS, isLive, warningState } from '@criticom/db/disaster-warnings';
import { InfoDot } from '@/components/info-dot';
import { WarningBadge, WARNING_TONE } from '@/components/disaster/warning-badge';
import { PageGuide } from '@/components/office/page-guide';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { syncSawsWarnings } from '@/lib/saws-sync';
import { cn, timeAgo } from '@/lib/utils';
import { CheckSawsNow, RecordWarning } from './record-warning';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Early Warnings · HikTech' };

const when = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

/**
 * Early warnings (0116): SA Weather Service impact-based warnings for
 * eThekwini, in force and recent. They arrive by themselves from SAWS; the
 * desk types in one that came by email or PDF. Each opens its own page with
 * the steps: check with FEWS, tell the services, spread it, and at Level 4
 * or higher the JOC's readiness session.
 */
export default async function WarningsPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  // Ask SAWS first (at most every five minutes), but never hold the page up for long.
  const tenant = await currentTenant(supabase);
  if (tenant) await Promise.race([syncSawsWarnings(tenant), new Promise((r) => setTimeout(r, 6000))]).catch(() => undefined);

  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const [warnings, feed, councillors] = await Promise.all([listWarnings(supabase, since), getFeedState(supabase), listCouncillors(supabase)]);
  const sessions = await listReadinessSessions(supabase, warnings.map((w) => w.id));
  const now = new Date();
  const live = warnings.filter((w) => isLive(warningState(w, now))).sort((a, b) => b.level - a.level || a.valid_from.localeCompare(b.valid_from));
  const past = warnings.filter((w) => !isLive(warningState(w, now)));
  const withPhone = councillors.filter((c) => c.is_active && c.phone).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="flex items-center gap-2 text-2xl font-bold"><CloudLightning className="h-6 w-6 text-accent" aria-hidden />{t('Early warnings')}</h1>
          <p className="mt-1 text-muted-foreground">
            {t('Impact-based warnings from the SA Weather Service. Check each one with the FEWS team, tell the services, spread it on every channel. At Level 4 or higher the JOC meets to check readiness.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/disaster/councillors" className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-bg-card px-4 text-sm font-semibold hover:bg-muted">
            <Users className="h-4 w-4" aria-hidden />{t('Councillors ({n})', { n: withPhone })}
          </Link>
          <RecordWarning />
        </div>
      </header>

      <PageGuide id="disaster.warnings" steps={[
        t('Warnings from the SA Weather Service arrive here by themselves. A warning that came by email or PDF: press Record a warning.'),
        t('Open a warning. Tick each step as it is done: FEWS check, services told, every channel.'),
        t('Send the SMS to all councillors with one press. It goes out in SAWS’s own words.'),
        t('Level 4 or higher: record the JOC readiness session and what it decided. If a response is needed, add an incident from the warning.'),
      ]} />

      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className={cn('h-2.5 w-2.5 rounded-full', feed?.ok === false ? 'bg-severity-critical' : feed ? 'bg-severity-low' : 'bg-muted-foreground')} aria-hidden />
        {feed
          ? feed.ok ? t('Checked with the SA Weather Service {ago}.', { ago: timeAgo(feed.synced_at) })
            : t('The SA Weather Service did not answer {ago}. Warnings that come by email can still be recorded.', { ago: timeAgo(feed.synced_at) })
          : t('Not checked with the SA Weather Service yet.')}
        <CheckSawsNow />
        <InfoDot text={t('The system reads the SA Weather Service’s public warning list every five minutes while a Disaster screen is open, and keeps the warnings that name eThekwini.')} />
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('In force and coming ({n})', { n: live.length })}</h2>
        {live.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-bg-card p-8 text-center text-muted-foreground">{t('No warning for eThekwini right now.')}</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {live.map((w) => <WarningCard key={w.id} t={t} w={w} now={now} session={sessions.find((s) => s.warning_id === w.id)?.outcome ?? null} />)}
          </ul>
        )}
      </section>

      {past.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('The last 30 days ({n})', { n: past.length })}</h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {past.map((w) => <WarningCard key={w.id} t={t} w={w} now={now} session={sessions.find((s) => s.warning_id === w.id)?.outcome ?? null} />)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function WarningCard({ t, w, now, session }: { t: Translate; w: DisasterWarning; now: Date; session: string | null }) {
  const state = warningState(w, now);
  const done = WARNING_STEPS.filter((s) => s.key in w.steps).length;
  const needsJoc = w.level >= JOC_LEVEL && !session && isLive(state);
  return (
    <li>
      <Link href={`/disaster/warnings/${w.id}`}
        className={cn('group flex items-start gap-3 rounded-xl border border-l-8 border-border bg-bg-card p-4 shadow-sm hover:bg-muted',
          WARNING_TONE[w.colour]?.bar, !isLive(state) && 'opacity-75')}>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="flex flex-wrap items-center gap-2">
            <WarningBadge colour={w.colour} level={w.level} />
            <span className="font-semibold">{w.hazard}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold">{t(state)}</span>
          </p>
          <p className="text-sm">{when.format(new Date(w.valid_from))} → {when.format(new Date(w.valid_until))}</p>
          <p className="line-clamp-2 text-sm text-muted-foreground">{w.areas}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>{t('{done} of {all} steps done', { done, all: WARNING_STEPS.length })}</span>
            {session ? <span className="font-semibold">{t('JOC: {outcome}', { outcome: t(session) })}</span> : null}
            {needsJoc ? <span className="flex items-center gap-1 font-semibold text-severity-critical-ink"><Siren className="h-4 w-4" aria-hidden />{t('JOC readiness session needed')}</span> : null}
            {w.incident_id ? <span className="font-semibold text-accent">{t('Incident logged')}</span> : null}
            <span className="text-muted-foreground">{w.source === 'Typed in' ? t('Typed in') : t('From the SA Weather Service')}</span>
          </p>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground group-hover:text-fg" aria-hidden />
      </Link>
    </li>
  );
}
