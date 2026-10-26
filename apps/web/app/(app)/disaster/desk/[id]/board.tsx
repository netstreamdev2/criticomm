'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Ban, Building, Building2, CircleCheck, Clock, Ellipsis, FileText, Flame, HandHeart, HeartPulse, Info, Landmark,
  LogOut, MapPin, MessageCircle, Phone, Radio, RefreshCw, Search, Shield, Siren, Timer, TriangleAlert, Truck, UserRound, Users, Zap,
} from 'lucide-react';
import {
  deskChecks, isWorking, lastHeard, UPDATE_EVERY_MINUTES,
  type DeskCallout, type DeskChannel, type DeskCheck, type DisasterBrief,
} from '@criticom/api/criti/disaster';
import { LeafletMap } from '@/components/leaflet-map';
import { CallButton } from '@/components/disaster/call-button';
import { CritiMascot } from '@/components/criti/mascot';
import { useT } from '@/components/i18n';
import { cn, escapeHtml } from '@/lib/utils';
import { callOutAction, calloutStatusAction, deskUpdateAction, setLevelAction } from '../actions';
import { AssessmentTile, type BoardAssessment } from './assessment-tile';
import { CallFacts, LevelChip, type BoardFacts } from './call-facts';
import { SheltersTile, type BoardOpening, type BoardShelter } from './shelters-tile';

/**
 * The Disaster desk's command board for one call (0111, 0112): the whole
 * operation, run from the desk. Partners called out and where they are, the
 * timeline as it comes in by phone, radio or WhatsApp, and Criti reading it
 * all as it grows. Big buttons, few words: the desk is busy.
 */

export type BoardCallout = DeskCallout & {
  contact: string | null; radio: string | null; reason: string | null; suggestedByAi: boolean; calledBy: string | null;
};
export type BoardUpdate = { id: string; at: string; source: DeskChannel; from: string | null; calloutId: string | null; text: string; by: string | null };
export type BoardPartner = { id: string; name: string; type: string; contact: string | null; radio: string | null; commander: string | null };
export type BoardIncident = {
  id: string; number: string; type: string; severity: string; address: string; suburb: string | null; status: string;
  calledInAt: string; description: string; lat: number | null; lng: number | null; finished: boolean;
};

type Props = {
  incident: BoardIncident;
  callouts: BoardCallout[];
  updates: BoardUpdate[];
  notes: Array<{ at: string; text: string; by: string | null }>;
  partners: BoardPartner[];
  brief: DisasterBrief | null;
  briefAt: string | null;
  marker: string;
  ready: boolean;
  canWrite: boolean;
  /** The call the eThekwini way (0112): title, hazard, level; shelters; Disaster's own officers; assessments. */
  facts: BoardFacts;
  openings: BoardOpening[];
  register: BoardShelter[];
  officers: BoardOfficer[];
  assessments: BoardAssessment[];
};
export type BoardOfficer = { id: string; name: string; phone: string | null; duty: string | null; status: string | null };

const CHANNELS: Array<{ id: DeskChannel; label: string; icon: typeof Phone }> = [
  { id: 'Call', label: 'Call', icon: Phone },
  { id: 'Radio', label: 'Radio', icon: Radio },
  { id: 'WhatsApp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'Other', label: 'Other', icon: Ellipsis },
];
const CHANNEL_ICON: Record<DeskChannel, typeof Phone> = { Call: Phone, Radio, WhatsApp: MessageCircle, Other: Ellipsis };

const TYPE_ICON: Record<string, typeof Phone> = {
  'eThekwini services': Building, Utilities: Zap, 'Fire Stations': Flame, Hospitals: Building2, 'Ambulance & EMS': HeartPulse,
  'Relief & NGO': HandHeart, 'Rescue & NGO': HandHeart, Government: Landmark, 'Law Enforcement': Shield, 'Disaster centres': Siren,
  'Disaster Management officer': UserRound,
};
const typeIcon = (t: string | null) => TYPE_ICON[t ?? ''] ?? Users;

const STATUS_TONE: Record<DeskCallout['status'], string> = {
  Called: 'bg-sky-500/15 text-sky-300 ring-sky-400/40',
  'On the way': 'bg-severity-medium/15 text-severity-medium-ink ring-severity-medium/40',
  'On scene': 'bg-severity-low/15 text-severity-low-ink ring-severity-low/40',
  'Left scene': 'bg-muted text-muted-foreground ring-border',
  'Stood down': 'bg-muted text-muted-foreground ring-border',
};

const SEVERITY_TONE: Record<string, string> = {
  Critical: 'border-t-severity-critical', High: 'border-t-severity-high', Medium: 'border-t-severity-medium', Low: 'border-t-severity-low',
};

const clock = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false });
const hhmm = (iso: string) => clock.format(new Date(iso));
const mins = (from: string | null | undefined, now: number) => (from ? Math.max(0, Math.floor((now - new Date(from).getTime()) / 60_000)) : 0);
const span = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`);
const newRef = () => crypto.randomUUID();

/** Ticks every 15 seconds so the timers and the desk's rules stay true. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function DeskBoard(props: Props) {
  const { t } = useT();
  const { incident, callouts, updates, canWrite, ready } = props;
  const now = useNow();
  const live = canWrite && ready && !incident.finished;
  const working = callouts.filter(isWorking);
  const checks = useMemo(
    () => (incident.finished ? [] : deskChecks({ calledInAt: incident.calledInAt, callouts, updates }, new Date(now))),
    [incident.finished, incident.calledInAt, callouts, updates, now],
  );
  const quiet = mins(lastHeard({ calledInAt: incident.calledInAt, callouts, updates }), now);
  const [error, setError] = useState<string | null>(null);

  return (
    // Solid tiles with room to breathe; the page scrolls. On top what came in
    // with Criti beside it; then the timeline and the partners called out;
    // then the partner list across the page.
    <div className="space-y-6">
      <Header incident={incident} facts={props.facts} now={now} quiet={quiet} working={working} total={callouts.length} anyCalled={callouts.length > 0} />

      {!ready ? (
        <p role="alert" className="shrink-0 rounded-lg border border-severity-medium bg-bg-card px-4 py-3 text-sm font-medium text-severity-medium-ink">
          {t('The Disaster desk is not switched on yet. Ask the system administrator to finish the update.')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-severity-critical bg-bg-card px-4 py-3 text-sm font-medium text-severity-critical-ink">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-xs underline">{t('Close')}</button>
        </p>
      ) : null}

      <CallFacts incidentId={incident.id} facts={props.facts} live={live} onError={setError} />
      {/* What came in, with Criti beside it reading it. */}
      <div className={cn('grid items-stretch gap-6', live && 'xl:grid-cols-2')}>
        {live ? <UpdateComposer incidentId={incident.id} callouts={callouts} onError={setError} /> : null}
        <CritiPanel {...props} checks={checks} live={live} onError={setError} />
      </div>
      {/* The record so far, and the partners on the call. */}
      <div className="grid items-start gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <Timeline callouts={callouts} updates={updates} notes={props.notes} now={now} />
        </div>
        <div className="xl:col-span-5">
          <CalloutList incidentId={incident.id} callouts={callouts} now={now} live={live} onError={setError} />
        </div>
      </div>
      {/* The people displaced, and what was found on site. */}
      <div className="grid items-start gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <SheltersTile incidentId={incident.id} openings={props.openings} register={props.register} live={live} onError={setError} />
        </div>
        <div className="xl:col-span-5">
          <AssessmentTile incidentId={incident.id} assessments={props.assessments} live={live} onError={setError}
            officers={callouts.filter((c) => c.type === 'Disaster Management officer').map((c) => c.name)} />
        </div>
      </div>
      {/* The whole partner list, and Disaster's own officers, across the page. */}
      {live ? <PartnerPicker incidentId={incident.id} partners={props.partners} officers={props.officers} callouts={callouts} onError={setError} /> : null}
    </div>
  );
}

/* ── The call at a glance ─────────────────────────────────────────────── */

function Header({ incident, facts, now, quiet, working, total, anyCalled }: {
  incident: BoardIncident; facts: BoardFacts; now: number; quiet: number; working: DeskCallout[]; total: number; anyCalled: boolean;
}) {
  const { t } = useT();
  const onScene = working.filter((c) => c.status === 'On scene').length;
  const onWay = working.filter((c) => c.status === 'On the way').length;
  const called = working.filter((c) => c.status === 'Called').length;
  const quietTone = incident.finished || working.length === 0 ? 'text-muted-foreground'
    : quiet >= UPDATE_EVERY_MINUTES ? 'text-severity-critical-ink animate-pulse'
    : quiet >= UPDATE_EVERY_MINUTES - 10 ? 'text-severity-medium-ink' : 'text-severity-low-ink';
  return (
    <header className={cn('grid gap-5 rounded-xl border border-t-4 border-border bg-bg-card p-6 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto_18rem]', SEVERITY_TONE[incident.severity] ?? 'border-t-accent')}>
        <div className="min-w-0 space-y-2">
          <Link href="/disaster/desk" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-fg">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />{t('All disaster calls')}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold sm:text-3xl">{facts.shortTitle || incident.type}</h1>
            <LevelChip level={facts.level} />
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-muted-foreground">{incident.number}</span>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide">{incident.severity}</span>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">{incident.status}</span>
            {facts.hazard ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">{facts.hazard}</span> : null}
          </p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />{[incident.address, incident.suburb].filter(Boolean).join(', ')}
          </p>
          {incident.description ? <p className="line-clamp-2 max-w-3xl pt-1 text-sm" title={incident.description}>{incident.description}</p> : null}
          <div className="flex flex-wrap gap-3 pt-3">
            {!incident.finished && anyCalled ? (
              <Link href={`/disaster/desk/${incident.id}/post-mortem`}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
                <FileText className="h-4 w-4" aria-hidden />{t('Post-mortem and close')}
              </Link>
            ) : null}
            <Link href={`/incidents/${incident.id}`} className="inline-flex h-10 items-center rounded-md border border-border bg-bg-soft px-4 text-sm hover:bg-muted">
              {t('Full call record')}
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 self-start lg:grid-cols-1">
          <Stat icon={Clock} label={t('Since the call')} value={span(mins(incident.calledInAt, now))} />
          <Stat icon={Timer} label={t('Last news')} value={t('{span} ago', { span: span(quiet) })} tone={quietTone} />
          <Stat icon={Users} label={t('Partners')} value={total === 0 ? t('None yet') : t('{a} there · {b} coming · {c} called', { a: onScene, b: onWay, c: called })} />
        </div>
        {incident.lat != null && incident.lng != null ? (
          <div className="hidden overflow-hidden rounded-lg border border-border lg:block">
            <LeafletMap height={200} zoom={14} center={[incident.lat, incident.lng]} pin markers={[{
              id: incident.id, lat: incident.lat, lng: incident.lng, kind: incident.severity.toLowerCase(),
              popupHtml: `<strong>${escapeHtml(incident.number)}</strong><br/>${escapeHtml(incident.address)}`,
            }]} />
          </div>
        ) : null}
    </header>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Clock; label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[9rem] rounded-lg border border-border bg-bg-soft px-3 py-2">
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</p>
      <p className={cn('mt-0.5 text-base font-bold tabular-nums', tone)}>{value}</p>
    </div>
  );
}

/* ── Criti ────────────────────────────────────────────────────────────── */

const CHECK_TONE: Record<DeskCheck['level'], string> = {
  urgent: 'border-severity-critical/50 bg-severity-critical/10 text-severity-critical-ink',
  warn: 'border-severity-medium/50 bg-severity-medium/10 text-severity-medium-ink',
  info: 'border-accent/40 bg-accent/10 text-accent',
};

function CritiPanel({ incident, partners, facts, brief: saved, briefAt: savedAt, marker, checks, live, onError }: Props & {
  checks: DeskCheck[]; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [brief, setBrief] = useState<DisasterBrief | null>(saved);
  const [at, setAt] = useState<string | null>(savedAt);
  const [thinking, setThinking] = useState(false);
  const [state, setState] = useState<'ok' | 'off' | 'down'>('ok');
  const busy = useRef(false);
  const now = useNow();

  const ask = useCallback(async (force = false) => {
    if (busy.current) return;
    busy.current = true;
    setThinking(true);
    try {
      const res = await fetch('/api/disaster/brief', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ incidentId: incident.id, force }),
      });
      const j = (await res.json()) as { brief?: DisasterBrief | null; at?: string | null; configured?: boolean; error?: string };
      if (j.brief) setBrief(j.brief);
      if (j.at) setAt(j.at);
      setState(j.configured === false ? 'off' : j.error ? 'down' : 'ok');
    } catch {
      setState('down');
    } finally {
      busy.current = false;
      setThinking(false);
    }
  }, [incident.id]);

  // A new reading whenever something changes on the call, and every few
  // minutes while it is open (time passing matters too).
  useEffect(() => {
    if (incident.finished) return;
    void ask();
  }, [marker, incident.finished, ask]);
  useEffect(() => {
    if (incident.finished) return;
    const tick = setInterval(() => void ask(), 4 * 60_000);
    return () => clearInterval(tick);
  }, [incident.finished, ask]);

  const byId = new Map(partners.map((p) => [p.id, p]));
  const f = brief?.figures;
  const figures = f ? [
    [t('Homes'), f.homesAffected], [t('Displaced'), f.peopleDisplaced], [t('Injured'), f.injured], [t('Dead'), f.deaths],
  ].filter(([, v]) => v != null) as Array<[string, number]> : [];

  return (
    <section aria-label={t('Criti')} className="flex flex-col overflow-hidden rounded-xl border border-t-4 border-border border-t-accent bg-bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <CritiMascot className="h-9 w-9" />
          <div>
            <p className="font-semibold">{t('Criti on this call')}</p>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {thinking ? t('Reading the call…')
                : state === 'off' ? t('Criti is switched off. The desk rules still work.')
                : state === 'down' ? t('Criti could not answer just now. The desk rules still work.')
                : at ? t('Read {span} ago', { span: span(mins(at, now)) }) : t('Not read yet')}
            </p>
          </div>
        </div>
        {!incident.finished ? (
          <button type="button" onClick={() => void ask(true)} disabled={thinking}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-accent/40 px-3 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">
            <RefreshCw className={cn('h-3.5 w-3.5', thinking && 'animate-spin')} aria-hidden />{t('Think again')}
          </button>
        ) : null}
      </div>

      {/* A long reading scrolls inside the tile, so it never pushes the rest down. */}
      <div className="max-h-[26rem] space-y-5 overflow-y-auto p-5">
        {checks.length ? (
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.text} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium', CHECK_TONE[c.level])}>
                {c.level === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {brief?.summary ? <p className="text-[15px] leading-relaxed">{brief.summary}</p> : null}

        {brief?.levelAdvice && brief.levelAdvice.level !== facts.level ? (
          <LevelAdvice incidentId={incident.id} advice={brief.levelAdvice} live={live} onError={onError} />
        ) : null}

        {figures.length ? (
          <div className="flex flex-wrap gap-2">
            {figures.map(([label, v]) => (
              <span key={label} className="rounded-md border border-border bg-bg-soft px-2.5 py-1 text-sm"><b className="tabular-nums">{v}</b> {label}</span>
            ))}
          </div>
        ) : null}

        {brief?.callouts.length ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Call out next')}</p>
            <ul className="space-y-3">
              {brief.callouts.map((s) => (
                <Suggestion key={s.partnerId} incidentId={incident.id} partner={byId.get(s.partnerId)} name={s.name} type={s.type}
                  why={s.why} urgent={s.urgency === 'now'} live={live} onError={onError} />
              ))}
            </ul>
          </div>
        ) : null}

        {brief?.watch.length ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Watch out')}</p>
            <ul className="space-y-1 text-sm">{brief.watch.map((w) => <li key={w} className="flex gap-2"><span className="text-severity-medium-ink">•</span>{w}</li>)}</ul>
          </div>
        ) : null}
        {brief?.ask.length ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Ask next')}</p>
            <ul className="space-y-1 text-sm">{brief.ask.map((q) => <li key={q} className="flex gap-2"><span className="text-accent">?</span>{q}</li>)}</ul>
          </div>
        ) : null}
        {!brief?.summary && !checks.length && !thinking ? <p className="text-sm text-muted-foreground">{t('Nothing to add right now.')}</p> : null}
      </div>
    </section>
  );
}

/** Criti's advice to change the level of co-ordination (the Plan's Bronze, Silver, Gold). */
function LevelAdvice({ incidentId, advice, live, onError }: {
  incidentId: string; advice: { level: 'Bronze' | 'Silver' | 'Gold'; why: string }; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const go = () => {
    if (advice.level === 'Gold' && !window.confirm(t('Activate the DOC and call the SCG into session?'))) return;
    start(async () => {
      const res = await setLevelAction({ incidentId, level: advice.level, note: advice.why });
      if ('error' in res) onError(res.error);
    });
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-severity-high bg-bg-soft p-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-semibold">{t('Level')} <LevelChip level={advice.level} /></p>
        {advice.why ? <p className="mt-0.5 text-sm text-muted-foreground">{advice.why}</p> : null}
      </div>
      {live ? (
        <button type="button" onClick={go} disabled={pending}
          className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {t('Change to {level}', { level: advice.level })}
        </button>
      ) : null}
    </div>
  );
}

function Suggestion({ incidentId, partner, name, type, why, urgent, live, onError }: {
  incidentId: string; partner: BoardPartner | undefined; name: string; type: string; why: string; urgent: boolean; live: boolean;
  onError: (e: string) => void;
}) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const ref = useRef(newRef());
  const Icon = typeIcon(type);
  const callOut = (how: DeskChannel) => start(async () => {
    const res = await callOutAction({ incidentId, clientRef: ref.current, how, partnerId: partner?.id, reason: why, suggestedByAi: true });
    if ('error' in res) onError(res.error);
    else ref.current = newRef();
  });
  return (
    <li className={cn('rounded-lg border bg-bg-soft p-4', urgent ? 'border-severity-high' : 'border-border')}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">{name}{urgent ? <span className="ml-2 rounded bg-severity-high/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-severity-high-ink">{t('Now')}</span> : null}</p>
          {why ? <p className="mt-0.5 text-sm text-muted-foreground">{why}</p> : null}
          {partner?.radio ? <p className="mt-1 font-mono text-sm text-muted-foreground">{partner.radio}</p> : null}
        </div>
      </div>
      {live && partner ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <CallButton number={partner.contact} />
          <button type="button" disabled={pending} onClick={() => callOut('Call')}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            <Phone className="h-4 w-4" aria-hidden />{t('Called by phone')}
          </button>
          <button type="button" disabled={pending} onClick={() => callOut('Radio')}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-60">
            <Radio className="h-4 w-4" aria-hidden />{t('Radio')}
          </button>
          <button type="button" disabled={pending} onClick={() => callOut('WhatsApp')}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-60">
            <MessageCircle className="h-4 w-4" aria-hidden />{t('WhatsApp')}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/* ── Partners called out ──────────────────────────────────────────────── */

function CalloutList({ incidentId, callouts, now, live, onError }: {
  incidentId: string; callouts: BoardCallout[]; now: number; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const order = { 'On scene': 0, 'On the way': 1, Called: 2, 'Left scene': 3, 'Stood down': 4 } as const;
  const sorted = [...callouts].sort((a, b) => order[a.status] - order[b.status] || a.calledAt.localeCompare(b.calledAt));
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm">
      <h2 className="flex items-center gap-2 border-b border-border px-5 py-4 font-semibold">
        <Truck className="h-4 w-4 text-accent" aria-hidden />{t('Called out ({n})', { n: callouts.length })}
      </h2>
      {sorted.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('Nobody called out yet.')}</p> : null}
      <ul className="max-h-[40rem] divide-y divide-border overflow-y-auto">
        {sorted.map((c) => <CalloutRow key={c.id} incidentId={incidentId} c={c} now={now} live={live} onError={onError} />)}
      </ul>
    </section>
  );
}

function CalloutRow({ incidentId, c, now, live, onError }: {
  incidentId: string; c: BoardCallout; now: number; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [eta, setEta] = useState('');
  const Icon = typeIcon(c.type);
  const HowIcon = CHANNEL_ICON[c.how];
  const move = (status: 'On the way' | 'On scene' | 'Left scene' | 'Stood down') => start(async () => {
    const res = await calloutStatusAction({ incidentId, calloutId: c.id, status, how: c.how, etaMinutes: status === 'On the way' ? eta : null });
    if ('error' in res) onError(res.error);
    else setEta('');
  });
  const timer = c.status === 'Called' ? t('called {span} ago', { span: span(mins(c.calledAt, now)) })
    : c.status === 'On the way'
      ? (c.etaMinutes != null
        ? (() => { const left = c.etaMinutes - mins(c.onWayAt, now); return left >= 0 ? t('due in {n} min', { n: left }) : t('{n} min late', { n: -left }); })()
        : t('on the way {span}', { span: span(mins(c.onWayAt, now)) }))
    : c.status === 'On scene' ? t('on scene {span}', { span: span(mins(c.onSceneAt, now)) })
    : t('{status} at {time}{was}', {
      status: c.status === 'Left scene' ? t('Left') : t('Stood down'), time: c.leftAt ? hhmm(c.leftAt) : '—',
      was: c.onSceneAt && c.leftAt ? ` · ${t('{span} on scene', { span: span(mins(c.onSceneAt, new Date(c.leftAt).getTime())) })}` : '',
    });
  const late = c.status === 'On the way' && c.etaMinutes != null && mins(c.onWayAt, now) > c.etaMinutes;
  return (
    <li className={cn('px-5 py-4', !isWorking(c) && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{c.name}</p>
            {isWorking(c) ? <CallButton number={c.contact} label={c.contact ?? undefined} size="sm" /> : null}
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold ring-1', STATUS_TONE[c.status])}>{c.status}</span>
            {c.suggestedByAi ? <span className="text-xs text-muted-foreground">{t('Suggested by Criti')}</span> : null}
          </div>
          <p className={cn('mt-0.5 text-sm tabular-nums', late ? 'font-semibold text-severity-medium-ink' : 'text-muted-foreground')}>
            <HowIcon className="mr-1 inline h-3.5 w-3.5" aria-hidden />{timer}
          </p>
          {c.radio ? <p className="mt-0.5 font-mono text-sm text-muted-foreground">{c.radio}</p> : null}
          {c.reason ? <p className="mt-0.5 text-xs text-muted-foreground">{c.reason}</p> : null}
        </div>
      </div>
      {live && isWorking(c) ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-8">
          {c.status === 'Called' ? (
            <>
              <input value={eta} onChange={(e) => setEta(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric"
                placeholder={t('min')} aria-label={t('Minutes until they arrive')}
                className="h-10 w-16 rounded-md border border-border bg-bg-soft px-2 text-center text-sm" />
              <StatusButton icon={Truck} label={t('On the way')} onClick={() => move('On the way')} pending={pending} />
            </>
          ) : null}
          {c.status !== 'On scene' ? <StatusButton icon={CircleCheck} label={t('On scene')} onClick={() => move('On scene')} pending={pending} strong /> : null}
          {c.status === 'On scene' ? <StatusButton icon={LogOut} label={t('Left the scene')} onClick={() => move('Left scene')} pending={pending} strong /> : null}
          {c.status !== 'On scene' ? <StatusButton icon={Ban} label={t('Stand down')} onClick={() => move('Stood down')} pending={pending} quiet /> : null}
        </div>
      ) : null}
    </li>
  );
}

function StatusButton({ icon: Icon, label, onClick, pending, strong, quiet }: {
  icon: typeof Truck; label: string; onClick: () => void; pending: boolean; strong?: boolean; quiet?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={pending}
      className={cn('inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold disabled:opacity-60',
        strong ? 'bg-severity-low text-severity-low-fg hover:opacity-90' : quiet ? 'text-muted-foreground hover:bg-muted' : 'border border-border hover:bg-muted')}>
      <Icon className="h-4 w-4" aria-hidden />{label}
    </button>
  );
}

/* ── Calling a partner out ────────────────────────────────────────────── */

const OFFICERS = 'Our officers';

function PartnerPicker({ incidentId, partners, officers, callouts, onError }: {
  incidentId: string; partners: BoardPartner[]; officers: BoardOfficer[]; callouts: BoardCallout[]; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const working = new Set(callouts.filter(isWorking).map((c) => c.partnerId));
  const officerOut = new Set(callouts.filter(isWorking).map((c) => c.name));
  const ORDER = ['eThekwini services', 'Utilities', 'Fire Stations', 'Law Enforcement', 'Ambulance & EMS', 'Hospitals', 'Government', 'Disaster centres', 'Relief & NGO'];
  const types = [...new Set(partners.map((p) => p.type))].filter((x) => x !== 'Internal')
    .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const needle = q.trim().toLowerCase();
  const shown = type === OFFICERS ? [] : partners
    .filter((p) => p.type !== 'Internal' && (!type || p.type === type))
    .filter((p) => !needle || `${p.name} ${p.type} ${p.commander ?? ''}`.toLowerCase().includes(needle))
    .slice(0, 60);
  // On duty first, then on standby, then the rest.
  const rank = (o: BoardOfficer) => (o.status === 'On duty' ? 0 : o.status === 'On standby' ? 1 : 2);
  const shownOfficers = (type === OFFICERS || (!type && needle)) ? officers
    .filter((o) => !needle || `${o.name} ${o.duty ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)) : [];
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm">
      <h2 className="border-b border-border px-5 py-4 font-semibold">{t('Call out a partner or an officer')}</h2>
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative block lg:w-80 lg:shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search: Eskom, Amanzimtoti, SASSA…')}
              className="h-11 w-full rounded-md border border-border bg-bg-soft pl-9 pr-3 text-sm" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {['', OFFICERS, ...types].map((x) => {
              const Icon = x === OFFICERS ? UserRound : x ? typeIcon(x) : Users;
              return (
                <button key={x || 'all'} type="button" onClick={() => setType(x)} aria-pressed={type === x}
                  className={cn('inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold',
                    type === x ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:bg-muted')}>
                  <Icon className="h-4 w-4" aria-hidden />{x ? t(x) : t('All')}
                </button>
              );
            })}
          </div>
        </div>
        <ul className="grid max-h-[30rem] content-start gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((p) => {
            const busy = working.has(p.id);
            const Icon = typeIcon(p.type);
            return (
              <li key={p.id} className={cn('rounded-lg border', picked === p.id ? 'border-accent bg-accent/5' : 'border-border')}>
                <button type="button" disabled={busy} onClick={() => setPicked(picked === p.id ? null : p.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{[p.contact, p.radio].filter(Boolean).join(' · ') || p.type}</span>
                  </span>
                  {busy ? <span className="text-xs text-muted-foreground">{t('On the call')}</span> : null}
                </button>
                {picked === p.id ? <CallOutForm incidentId={incidentId} partner={p} onDone={() => setPicked(null)} onError={onError} /> : null}
              </li>
            );
          })}
          {shownOfficers.map((o) => {
            const busy = officerOut.has(o.name);
            return (
              <li key={o.id} className={cn('rounded-lg border', picked === o.id ? 'border-accent bg-accent/5' : 'border-border')}>
                <button type="button" disabled={busy} onClick={() => setPicked(picked === o.id ? null : o.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent">
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{o.name}</span>
                    <span className={cn('block truncate text-xs', o.status ? 'font-semibold text-severity-low-ink' : 'text-muted-foreground')}>
                      {o.status ? `${t(o.status)} · ${o.duty ?? ''}` : (o.phone ?? t('Not on the roster now'))}
                    </span>
                  </span>
                  {busy ? <span className="text-xs text-muted-foreground">{t('On the call')}</span> : null}
                </button>
                {picked === o.id ? <CallOutForm incidentId={incidentId} partner={null} officer={o} onDone={() => setPicked(null)} onError={onError} /> : null}
              </li>
            );
          })}
          {shown.length === 0 && shownOfficers.length === 0 ? <li className="col-span-full px-2 py-3 text-sm text-muted-foreground">{t('No partner matches.')}</li> : null}
        </ul>
        <button type="button" onClick={() => setOther(!other)} className="text-sm font-semibold text-accent hover:underline">
          {other ? t('Close') : t('Someone not on the list')}
        </button>
        {other ? <CallOutForm incidentId={incidentId} partner={null} onDone={() => setOther(false)} onError={onError} /> : null}
      </div>
    </section>
  );
}

function CallOutForm({ incidentId, partner, officer, onDone, onError }: {
  incidentId: string; partner: BoardPartner | null; officer?: BoardOfficer; onDone: () => void; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [how, setHow] = useState<DeskChannel>('Call');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [eta, setEta] = useState('');
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const ref = useRef(newRef());
  const submit = () => start(async () => {
    const res = await callOutAction({
      incidentId, clientRef: ref.current, how, partnerId: partner?.id ?? null, officerId: officer?.id ?? null,
      agencyName: partner || officer ? null : name, contactNumber: partner || officer ? null : number, etaMinutes: eta, reason,
    });
    if ('error' in res) onError(res.error);
    else onDone();
  });
  return (
    <div className="space-y-2.5 px-2.5 pb-3 pt-1">
      {partner?.contact || officer?.phone ? <CallButton number={partner?.contact ?? officer?.phone} label={t('Call {number}', { number: partner?.contact ?? officer?.phone ?? '' })} className="w-full justify-center" /> : null}
      {partner || officer ? null : (
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Who')} aria-label={t('Who')}
            className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder={t('Number')} aria-label={t('Number')} inputMode="tel"
            className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
      )}
      <ChannelChips value={how} onChange={setHow} />
      <div className="flex gap-2">
        <input value={eta} onChange={(e) => setEta(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric"
          placeholder={t('min')} aria-label={t('Minutes until they arrive')} className="h-10 w-16 rounded-md border border-border bg-bg-soft px-2 text-center text-sm" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('What for (optional)')} maxLength={500}
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-bg-soft px-3 text-sm" />
      </div>
      <button type="button" onClick={submit} disabled={pending || (!partner && !officer && !name.trim())}
        className="h-11 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? t('Saving…') : t('Called out')}
      </button>
    </div>
  );
}

function ChannelChips({ value, onChange }: { value: DeskChannel; onChange: (c: DeskChannel) => void }) {
  const { t } = useT();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {CHANNELS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}
          className={cn('flex h-12 min-w-0 items-center justify-center gap-2 rounded-md border px-2 text-sm font-semibold',
            value === id ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:bg-muted')}>
          <Icon className="h-4 w-4" aria-hidden />{t(label)}
        </button>
      ))}
    </div>
  );
}

/* ── Logging what came in ─────────────────────────────────────────────── */

function UpdateComposer({ incidentId, callouts, onError }: { incidentId: string; callouts: BoardCallout[]; onError: (e: string) => void }) {
  const { t } = useT();
  const [source, setSource] = useState<DeskChannel>('Radio');
  const [from, setFrom] = useState('');
  const [fromName, setFromName] = useState('');
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const ref = useRef(newRef());
  const working = callouts.filter(isWorking);
  const submit = () => {
    if (!text.trim()) return;
    start(async () => {
      const res = await deskUpdateAction({
        incidentId, clientRef: ref.current, source, text,
        calloutId: from && from !== '_other' && from !== '_caller' ? from : null,
        fromName: from === '_caller' ? t('Caller') : from === '_other' ? fromName : null,
      });
      if ('error' in res) { onError(res.error); return; }
      ref.current = newRef();
      setText('');
    });
  };
  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-bg-card p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><MessageCircle className="h-4 w-4 text-accent" aria-hidden />{t('Log what came in')}</h2>
      <div className="grid gap-3 lg:grid-cols-[1fr_15rem]">
        <ChannelChips value={source} onChange={setSource} />
        <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('From')}
          className="h-12 rounded-md border border-border bg-bg-soft px-3 text-sm">
          <option value="">{t('From…')}</option>
          {working.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="_caller">{t('Caller')}</option>
          <option value="_other">{t('Someone else')}</option>
        </select>
      </div>
      {from === '_other' ? (
        <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder={t('Who')} maxLength={200}
          className="mt-3 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm" />
      ) : null}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
        placeholder={t('What did they say? For example: 30 homes affected, 6 on fire, power off in the area.')}
        className="mt-3 min-h-[6rem] w-full flex-1 resize-none rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
      <button type="button" onClick={submit} disabled={pending || !text.trim()}
        className="mt-3 h-12 w-full shrink-0 rounded-md bg-accent text-base font-semibold text-accent-foreground disabled:opacity-50">
        {pending ? t('Saving…') : t('Log update')}
      </button>
    </section>
  );
}

/* ── The timeline ─────────────────────────────────────────────────────── */

type Event = { key: string; at: string; icon: typeof Phone; tone: string; title: string; text?: string; by?: string | null };

function Timeline({ callouts, updates, notes, now }: {
  callouts: BoardCallout[]; updates: BoardUpdate[]; notes: Props['notes']; now: number;
}) {
  const { t } = useT();
  const how = (c: DeskChannel) => t(c === 'Call' ? 'by phone' : c === 'Radio' ? 'by radio' : c === 'WhatsApp' ? 'on WhatsApp' : 'another way');
  const events: Event[] = [
    ...updates.map((u): Event => ({
      key: `u${u.id}`, at: u.at, icon: CHANNEL_ICON[u.source], tone: 'text-accent',
      title: u.from ? t('{from}, {how}', { from: u.from, how: how(u.source) }) : t('Update {how}', { how: how(u.source) }), text: u.text, by: u.by,
    })),
    ...callouts.flatMap((c): Event[] => [
      { key: `c${c.id}`, at: c.calledAt, icon: Phone, tone: 'text-sky-300', title: t('{name} called out {how}', { name: c.name, how: how(c.how) }), text: c.reason ?? undefined, by: c.calledBy },
      ...(c.onWayAt ? [{ key: `w${c.id}`, at: c.onWayAt, icon: Truck, tone: 'text-severity-medium-ink',
        title: c.etaMinutes != null ? t('{name} on the way, {n} min', { name: c.name, n: c.etaMinutes }) : t('{name} on the way', { name: c.name }) }] : []),
      ...(c.onSceneAt ? [{ key: `s${c.id}`, at: c.onSceneAt, icon: CircleCheck, tone: 'text-severity-low-ink', title: t('{name} on scene', { name: c.name }) }] : []),
      ...(c.leftAt ? [{ key: `l${c.id}`, at: c.leftAt, icon: c.status === 'Stood down' ? Ban : LogOut, tone: 'text-muted-foreground',
        title: c.status === 'Stood down' ? t('{name} stood down', { name: c.name }) : t('{name} left the scene', { name: c.name }) }] : []),
    ]),
    ...notes.map((n, i): Event => ({ key: `n${i}`, at: n.at, icon: FileText, tone: 'text-muted-foreground', title: t('On the call'), text: n.text, by: n.by })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm">
      <h2 className="flex items-center gap-2 border-b border-border px-5 py-4 font-semibold"><Clock className="h-4 w-4 text-accent" aria-hidden />{t('Timeline')}</h2>
      <ol className="relative max-h-[42rem] overflow-y-auto px-5 py-4">
        {events.map((e) => (
          <li key={e.key} className="relative flex gap-4 pb-5 last:pb-0">
            <div className="flex w-14 shrink-0 flex-col items-end pt-0.5 text-right">
              <span className="font-mono text-sm font-semibold tabular-nums">{hhmm(e.at)}</span>
              <span className="text-[11px] text-muted-foreground">{span(mins(e.at, now))}</span>
            </div>
            <div className="relative flex flex-col items-center">
              <span className={cn('grid h-7 w-7 place-items-center rounded-full border border-border bg-bg-soft', e.tone)}><e.icon className="h-3.5 w-3.5" aria-hidden /></span>
              <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-semibold">{e.title}</p>
              {e.text ? <p className="whitespace-pre-wrap text-[15px] leading-snug">{e.text}</p> : null}
              {e.by ? <p className="mt-0.5 text-xs text-muted-foreground">{e.by}</p> : null}
            </div>
          </li>
        ))}
        {events.length === 0 ? <li className="py-6 text-center text-sm text-muted-foreground">{t('Nothing logged yet.')}</li> : null}
      </ol>
    </section>
  );
}
