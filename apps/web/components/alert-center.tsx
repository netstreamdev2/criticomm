'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Radio, Siren, Clock } from 'lucide-react';
import {
  AUDIENCE_TONE, audienceGroup, audienceLabel, isCallFeedAlert, listMyAlerts, markAlertRead, markAlertsRead,
  subscribeAlerts, subscribeIncidentUpdates, subscribeNewIncidents, type Alert,
} from '@criticom/api';
import {
  CALLER_NOT_GIVEN, canAccess, canDismissSos, DISPATCH_DESK_ROLES, detailsToFollow, GLOBAL_ROLES, receivesLiveOperations, type Silo, type UserRole,
} from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useToast, type Severity, type ToastTone } from '@/components/toast';
import { SosAlert, SosBar } from '@/components/sos-alert';
import { WhileAway } from '@/components/while-away';
import { consoleOutOfSight, desktopAlert } from '@/lib/desktop-alert';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';

const SILO_LABELS: Record<string, string> = {
  Ethekwini: 'Control Room',
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS / Medical',
  EthekwiniDisaster: 'Disaster Mgmt',
};

const toneFor = (severity: string): ToastTone =>
  severity === 'Critical' ? 'critical' : severity === 'High' ? 'warning' : 'info';

const SEVERITY_RANK: Record<string, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };

/**
 * How long a new-call card stays, as a multiple of the admin toast setting.
 * The heavier the call, the longer it waits to be seen — a Critical card
 * should still be on screen when the dispatcher looks up from the radio.
 */
const NEW_CALL_HOLD: Record<Severity, number> = { Low: 1.25, Medium: 2, High: 3, Critical: 4 };

/** No mouse or keys for this long and the dispatcher is taken to be away from the desk. */
const IDLE_MS = 2 * 60_000;
/** On opening the console, what was missed in this long is shown. */
const MISSED_WINDOW_MS = 24 * 3_600_000;

/** Admin-tuned behaviour (Admin → Operations Settings), with safe defaults. */
export type AlertTuning = {
  /** Lowest severity that interrupts with a blocking pop-up. */
  modalMinSeverity: 'Critical' | 'High' | 'Medium' | 'Low';
  soundEnabled: boolean;
  toastSeconds: number;
};
const DEFAULT_TUNING: AlertTuning = {
  modalMinSeverity: 'High', soundEnabled: true, toastSeconds: 8,
};

/**
 * The single place realtime turns into something a human notices.
 *
 * Three streams feed it:
 *   • `alerts`            — deliberate, targeted notifications (dispatch fanout,
 *                           broadcasts). RLS decides who receives which row.
 *   • new incidents       — situational awareness for control-room staff.
 *   • incident updates    — status changes on calls in your scope.
 *
 * Anything marked `presentation: 'modal'` (High/Critical dispatch assignments)
 * blocks the screen until acknowledged, and an SOS brings its own siren pop-up;
 * both are unchanged. Every other notification drops in from the top as a
 * white frosted bubble saying whom it was for (heads-up.tsx).
 */
export function AlertCenter({
  silo, role, userId, tuning = DEFAULT_TUNING,
}: {
  silo: string; role: string; userId: string; tuning?: AlertTuning;
}) {
  const { t } = useT();
  const router = useRouter();
  const { push, notify, chime: rawChime, chimeSeverity: rawChimeSeverity } = useToast();
  const [queue, setQueue] = useState<Alert[]>([]);
  /** SOS alerts folded into the bottom bar: out of the way, still unanswered. */
  const [minimized, setMinimized] = useState<Alert[]>([]);
  const [acking, setAcking] = useState(false);
  const canDispatch = canAccess('/dispatch/assign/sos', role as UserRole, silo as Silo);
  const canDismiss = canDismissSos(role);
  // The call logger opens no call pages (CALL_LOGGER_PAGES): their calls' news
  // points to Log history, and other people's calls are not theirs to hear.
  const canOpenCalls = canAccess('/incidents/x', role as UserRole, silo as Silo);
  const callHref = useCallback((id: string) => (canOpenCalls ? `/incidents/${id}` : '/dispatch/log-history'), [canOpenCalls]);

  // Sound is an admin knob — a silent control room stays silent. Stable
  // callbacks, so toggling nothing never re-subscribes the realtime streams.
  const { soundEnabled } = tuning;
  const chime = useCallback<typeof rawChime>(
    (tone) => { if (soundEnabled) rawChime(tone); },
    [soundEnabled, rawChime],
  );
  const chimeSeverity = useCallback<typeof rawChimeSeverity>(
    (severity) => { if (soundEnabled) rawChimeSeverity(severity); },
    [soundEnabled, rawChimeSeverity],
  );

  // The dispatch desk works the pending queue (Operations Manual ch. 11–12):
  // a new call is its next job, so it gets the full severity card and tone.
  const isDispatchDesk = DISPATCH_DESK_ROLES.includes(role as UserRole);
  const toastMs = tuning.toastSeconds * 1000;
  const interruptsAt = SEVERITY_RANK[tuning.modalMinSeverity] ?? 2;

  // The SuperAdmin owns the platform and is not paged by day-to-day operations.
  const onTheFloor = receivesLiveOperations(role as UserRole);

  // Global roles hear everything; department staff only their own channel.
  const isGlobal = GLOBAL_ROLES.includes(role as UserRole) || silo === 'Ethekwini';
  const scope: Silo | 'all' = isGlobal ? 'all' : (silo as Silo);

  // A department's dispatch desk hears only the calls sent to it (0068). The
  // database already withholds the rest; this holds even if one slips through.
  const deskSilo: Silo | null = ['Dispatcher', 'ControlRoom', 'IncidentLogger'].includes(role) && silo !== 'Ethekwini'
    ? (silo as Silo) : null;
  const forThisDesk = useCallback((incident: { silo: Silo; tagged_silos?: Silo[] | null; dispatched_silos?: Silo[] | null; created_by?: string | null }) =>
    !deskSilo
    || incident.silo === deskSilo
    || (incident.tagged_silos ?? []).includes(deskSilo)
    || (incident.dispatched_silos ?? []).includes(deskSilo)
    || incident.created_by === userId, [deskSilo, userId]);

  // Status changes fire in bursts as a crew works a call; only the last one per
  // incident is worth a toast.
  const lastStatus = useRef(new Map<string, string>());

  /* ── While away (0097) ─────────────────────────────────────────────
   * Every step of the live feed is also kept for the desks. Seen live, it is
   * marked seen. Arriving while the console is out of sight, or while nobody
   * has touched it for a while (lunch), it waits, with a desktop alert, and
   * is shown with a sound when the dispatcher is back. Opening the console
   * after being away (the computer off) shows what is still unseen. */
  const [away, setAway] = useState<Alert[]>([]);
  const waiting = useRef<Alert[]>([]);
  const lastInput = useRef(Date.now());
  const outOfSight = useCallback(() => consoleOutOfSight() || Date.now() - lastInput.current > IDLE_MS, []);
  const showWaiting = useCallback((rows: Alert[]) => {
    if (!rows.length) return;
    setAway((cur) => {
      const have = new Set(cur.map((a) => a.id));
      return [...rows.filter((a) => !have.has(a.id)), ...cur].sort((a, b) => b.created_at.localeCompare(a.created_at));
    });
    const urgent = rows.some((a) => a.kind === 'incident_new' && (a.severity === 'Critical' || a.severity === 'High'));
    chime(urgent ? 'critical' : 'dispatch');
  }, [chime]);

  useEffect(() => {
    if (!onTheFloor) return;
    const back = () => {
      if (consoleOutOfSight()) return;
      lastInput.current = Date.now();
      const rows = waiting.current;
      waiting.current = [];
      showWaiting(rows);
    };
    const input = () => {
      const wasIdle = Date.now() - lastInput.current > IDLE_MS;
      lastInput.current = Date.now();
      if (wasIdle || waiting.current.length) back();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, input, { passive: true });
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);

    // Opened after time away: what is still unseen.
    let alive = true;
    try {
      void listMyAlerts(getBrowserSupabase(), { limit: 200, unreadOnly: true })
        .then((rows) => {
          if (!alive) return;
          const since = Date.now() - MISSED_WINDOW_MS;
          const missed = rows.filter((a) => isCallFeedAlert(a) && Date.parse(a.created_at) > since);
          if (consoleOutOfSight()) waiting.current = [...missed, ...waiting.current];
          else showWaiting(missed);
        })
        .catch(() => {});
    } catch { /* no live connection: nothing to catch up */ }

    return () => {
      alive = false;
      for (const e of events) window.removeEventListener(e, input);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [onTheFloor, showWaiting]);

  const showAlert = useCallback((alert: Alert) => {
    // An officer's SOS (migration 0043) goes to the front of the queue and
    // brings its own siren, whatever the sound setting: a colleague is calling
    // for help.
    if (alert.kind === 'sos') {
      setQueue((cur) => (cur.some((a) => a.id === alert.id) ? cur : [alert, ...cur]));
      return;
    }

    // The admin threshold decides what interrupts: an alert blocks the screen
    // when its severity clears the configured bar, or when the sender demanded
    // acknowledgement outright. Everything else is a corner toast.
    const rank = SEVERITY_RANK[alert.severity] ?? 0;
    const blocking = alert.requires_ack
      || (alert.kind === 'assignment' && rank >= interruptsAt)
      || (alert.presentation === 'modal' && rank >= interruptsAt);

    if (blocking) {
      setQueue((cur) => (cur.some((a) => a.id === alert.id) ? cur : [...cur, alert]));
      chime('critical');
      return;
    }
    notify({
      id: `alert-${alert.id}`,
      title: alert.title,
      body: alert.body ?? undefined,
      href: alert.link && (canOpenCalls || !alert.link.startsWith('/incidents')) ? alert.link : undefined,
      from: alert.created_by && alert.created_by !== userId ? alert.created_by_name : null,
      audience: audienceLabel(alert),
      accent: AUDIENCE_TONE[audienceGroup(alert)],
      kind: alert.kind,
      severity: alert.severity,
      duration: Math.max(toastMs, 6000),
    });
    // A person's note is a soft bell; HikTech's own operational ones keep their tone.
    const quiet = ['info', 'mail', 'task', 'broadcast'].includes(alert.kind) && rank < 2;
    chime(alert.severity === 'Critical' ? 'critical' : quiet ? 'info' : 'dispatch');
    void markAlertRead(getBrowserSupabase(), alert.id).catch(() => {});
  }, [notify, chime, interruptsAt, toastMs, userId, canOpenCalls]);

  useEffect(() => {
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      // Missing config must never take the app shell down with it.
      return;
    }

    // RLS delivers only what is meant for this person (0084): them, a few
    // named people, their role, their department or everyone.
    const offAlerts = subscribeAlerts(sb, (alert) => {
      if (alert.target_user_id && alert.target_user_id !== userId) return;
      // Off the floor (the SuperAdmin): what is sent to you or your role, and
      // the organisation's news, never an SOS or a department-wide escalation.
      if (!onTheFloor && (alert.audience === 'department' || alert.kind === 'sos')) return;
      // A step of the live feed (0097): the live cards below show it to someone
      // looking; for someone who is not, it waits, and the computer says so.
      if (isCallFeedAlert(alert)) {
        if (!onTheFloor) return;
        if (outOfSight()) {
          waiting.current = [alert, ...waiting.current.filter((a) => a.id !== alert.id)];
          desktopAlert({
            tag: alert.id,
            title: alert.title,
            body: alert.body,
            href: alert.link && canOpenCalls ? alert.link : '/notifications',
            urgent: alert.kind === 'incident_new' && (alert.severity === 'Critical' || alert.severity === 'High'),
          });
        } else {
          void markAlertRead(sb, alert.id).catch(() => {});
        }
        return;
      }
      showAlert(alert);
    });

    // New calls and status changes are the floor itself.
    if (!onTheFloor) return () => { offAlerts(); };

    const offNew = subscribeNewIncidents(sb, scope, (incident) => {
      // The person who logged it already has their own confirmation.
      if (incident.created_by && incident.created_by === userId) return;
      if (!canOpenCalls) return;
      if (!forThisDesk(incident)) return;

      // An officer's SOS raises its own blocking alert; a second card for the
      // same emergency would only compete with it.
      if (isDispatchDesk && incident.source !== 'Responder-Panic') {
        const severity = (SEVERITY_RANK[incident.incident_severity] !== undefined
          ? incident.incident_severity : 'Low') as Severity;
        push({
          id: `new-${incident.id}`,
          title: `New ${severity} call ${incident.incident_number}`,
          duration: Math.round(toastMs * NEW_CALL_HOLD[severity]),
          incident: {
            severity,
            number: incident.incident_number,
            type: incident.incident_type,
            location: incident.location_address,
            meta: [
              // Sent early on an urgent call (0076): the caller and the rest follow.
              detailsToFollow(incident) ? 'Details to follow' : null,
              incident.caller_name && incident.caller_name !== CALLER_NOT_GIVEN ? `Caller ${incident.caller_name}` : null,
              incident.region,
              incident.call_taken_by ? `by ${incident.call_taken_by}` : null,
            ].filter((m): m is string => Boolean(m)),
            actions: [
              { label: 'Open', href: `/incidents/${incident.id}` },
              { label: 'Assign →', href: `/dispatch/assign/${incident.id}`, primary: true },
            ],
          },
        });
        chimeSeverity(severity);
        return;
      }

      push({
        id: `new-${incident.id}`,
        title: `New ${incident.incident_severity} call — ${SILO_LABELS[incident.silo] ?? incident.silo}`,
        body: `${incident.incident_type} · ${incident.location_address}`,
        badge: incident.incident_severity,
        tone: toneFor(incident.incident_severity),
        href: `/incidents/${incident.id}`,
        duration: toastMs,
      });
      if (incident.incident_severity === 'Critical') chime('critical');
    });

    const offUpd = subscribeIncidentUpdates(sb, scope, (incident) => {
      // An SOS finished anywhere (dismissed as a mistake, 0093, or worked to
      // the end) leaves this screen too: its pop-up and its bar.
      if (incident.source === 'Responder-Panic' && (incident.status === 'Resolved' || incident.status === 'Closed')) {
        setQueue((cur) => cur.filter((a) => !(a.kind === 'sos' && a.incident_id === incident.id)));
        setMinimized((cur) => cur.filter((a) => a.incident_id !== incident.id));
        const dismissed = (incident as { sos_dismissed_at?: string | null; sos_dismissed_by_name?: string | null }).sos_dismissed_at;
        if (dismissed && lastStatus.current.get(incident.id) !== 'dismissed') {
          lastStatus.current.set(incident.id, 'dismissed');
          push({
            id: `sos-dismissed-${incident.id}`,
            title: `SOS dismissed: ${incident.caller_name ?? incident.incident_number}`,
            body: (incident as { sos_dismiss_reason?: string | null }).sos_dismiss_reason ?? undefined,
            tone: 'success',
            href: callHref(incident.id),
            duration: 6000,
          });
          router.refresh();
          return;
        }
      }
      if (!forThisDesk(incident)) return;
      if (!canOpenCalls && incident.created_by !== userId) return;
      if (lastStatus.current.get(incident.id) === incident.status) return;
      lastStatus.current.set(incident.id, incident.status);
      push({
        id: `upd-${incident.id}`,
        title: `${incident.incident_number} → ${incident.status}`,
        body: `${incident.incident_type} · ${incident.location_address}`,
        tone: incident.status === 'Resolved' || incident.status === 'Closed' ? 'success' : 'info',
        href: callHref(incident.id),
        duration: 6000,
      });
    });

    return () => { offAlerts(); offNew(); offUpd(); };
  }, [scope, userId, push, chime, chimeSeverity, showAlert, isDispatchDesk, toastMs, onTheFloor, forThisDesk, canOpenCalls, callHref, outOfSight]);

  const current = queue[0];

  const acknowledge = async (thenOpen: boolean) => {
    if (!current) return;
    setAcking(true);
    try {
      await markAlertRead(getBrowserSupabase(), current.id, { acknowledged: true });
    } catch {
      // Acknowledgement is best-effort; never trap the operator behind a
      // failed write when there is a call to run.
    } finally {
      setAcking(false);
      setQueue((cur) => cur.slice(1));
      if (thenOpen && current.link && (canOpenCalls || !current.link.startsWith('/incidents'))) router.push(current.link);
    }
  };

  /** Clear an SOS wherever it is — on screen or in the bar. */
  const clearSos = (alert: Alert, href?: string) => {
    void (async () => {
      setAcking(true);
      try {
        await markAlertRead(getBrowserSupabase(), alert.id, { acknowledged: true });
      } catch {
        // Best-effort, as for every alert: never trap the operator.
      } finally {
        setAcking(false);
        setQueue((cur) => cur.filter((a) => a.id !== alert.id));
        setMinimized((cur) => cur.filter((a) => a.id !== alert.id));
        // The SOS banner lives in the layout, which navigation keeps; refresh
        // it so a cleared SOS leaves the banner too.
        router.refresh();
        if (href) router.push(href);
      }
    })();
  };

  const minimizeSos = useCallback((alert: Alert) => {
    setQueue((cur) => cur.filter((a) => a.id !== alert.id));
    setMinimized((cur) => (cur.some((a) => a.id === alert.id) ? cur : [...cur, alert]));
  }, []);

  const expandSos = (alert: Alert) => {
    setMinimized((cur) => cur.filter((a) => a.id !== alert.id));
    setQueue((cur) => [alert, ...cur.filter((a) => a.id !== alert.id)]);
  };

  const bar = (
    <SosBar alerts={minimized} canDispatch={canDispatch} canDismiss={canDismiss} onExpand={expandSos} onAcknowledge={clearSos} />
  );

  const awayCard = (
    <WhileAway
      items={away}
      canOpenCalls={canOpenCalls}
      onSeen={() => {
        const ids = away.map((a) => a.id);
        setAway([]);
        void markAlertsRead(getBrowserSupabase(), ids).catch(() => {});
      }}
      onLater={() => setAway([])}
    />
  );

  if (!current) return <>{bar}{awayCard}</>;

  if (current.kind === 'sos') {
    return (
      <>
        {bar}
        {awayCard}
        <SosAlert
          alert={current}
          waiting={queue.length - 1}
          acking={acking}
          canDispatch={canDispatch}
          canDismiss={canDismiss}
          canOpen={canOpenCalls}
          onAcknowledge={(href) => clearSos(current, href)}
          onMinimize={() => minimizeSos(current)}
        />
      </>
    );
  }

  const critical = current.severity === 'Critical';

  return (
    <>
    {bar}
    {awayCard}
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-title"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div
        className={cn(
          'alert-modal-enter w-full max-w-lg overflow-hidden rounded-2xl border-2 bg-bg-card shadow-2xl',
          critical ? 'border-severity-critical' : 'border-severity-high',
        )}
      >
        {/* Banner */}
        <div
          className={cn(
            'flex items-center gap-3 px-6 py-4',
            critical ? 'bg-severity-critical' : 'bg-severity-high',
          )}
        >
          {/* Foreground comes from the fill's own theme token — see the
              @layer components rules in globals.css. */}
          <Siren className={cn('h-6 w-6 shrink-0', critical && 'animate-pulse')} />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80">
              {current.severity} · {SILO_LABELS[current.silo] ?? current.silo}
            </p>
            <p className="text-lg font-bold leading-tight">{t('Incident assigned')}</p>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <p id="alert-title" className="text-lg font-bold leading-snug">{current.title}</p>
            {current.body ? (
              <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{current.body}</span>
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {new Date(current.created_at).toLocaleTimeString('en-ZA', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </span>
            {current.created_by_name ? (
              <span className="flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5" />
                {t('Dispatched by {value}', { value: current.created_by_name })}
              </span>
            ) : null}
            {queue.length > 1 ? (
              <span className="ml-auto font-semibold text-fg">
                {t('+{value} more waiting', { value: queue.length - 1 })}</span>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {current.link ? (
              <button
                type="button"
                disabled={acking}
                onClick={() => void acknowledge(true)}
                className="h-11 flex-1 rounded-lg bg-primary text-sm font-bold disabled:opacity-60"
              >
                {t('Acknowledge & open')}</button>
            ) : null}
            <button
              type="button"
              disabled={acking}
              onClick={() => void acknowledge(false)}
              className={cn(
                'h-11 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-60',
                current.link ? 'sm:w-40' : 'flex-1',
              )}
            >
              {t('Acknowledge')}</button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
