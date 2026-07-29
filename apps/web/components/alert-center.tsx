'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Radio, Siren, Clock } from 'lucide-react';
import {
  markAlertRead, subscribeAlerts, subscribeIncidentUpdates, subscribeNewIncidents,
  type Alert,
} from '@criticom/api';
import { GLOBAL_ROLES, type Silo, type UserRole } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useToast, type ToastTone } from '@/components/toast';
import { cn } from '@/lib/utils';

const SILO_LABELS: Record<string, string> = {
  Ethekwini: 'Control Room',
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS / Medical',
  EthekwiniDisaster: 'Disaster Mgmt',
};

const toneFor = (severity: string): ToastTone =>
  severity === 'Critical' ? 'critical' : severity === 'High' ? 'warning' : 'info';

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
 * blocks the screen until acknowledged; everything else is a corner toast.
 */
export function AlertCenter({
  silo, role, userId,
}: {
  silo: string; role: string; userId: string;
}) {
  const router = useRouter();
  const { push, chime } = useToast();
  const [queue, setQueue] = useState<Alert[]>([]);
  const [acking, setAcking] = useState(false);

  // Global roles hear everything; department staff only their own channel.
  const isGlobal = GLOBAL_ROLES.includes(role as UserRole) || silo === 'Ethekwini';
  const scope: Silo | 'all' = isGlobal ? 'all' : (silo as Silo);

  // Status changes fire in bursts as a crew works a call; only the last one per
  // incident is worth a toast.
  const lastStatus = useRef(new Map<string, string>());

  const showAlert = useCallback((alert: Alert) => {
    if (alert.presentation === 'modal') {
      setQueue((cur) => (cur.some((a) => a.id === alert.id) ? cur : [...cur, alert]));
      chime('critical');
      return;
    }
    push({
      id: `alert-${alert.id}`,
      title: alert.title,
      body: alert.body ?? undefined,
      badge: alert.severity,
      tone: alert.kind === 'assignment' ? 'dispatch' : toneFor(alert.severity),
      href: alert.link ?? undefined,
    });
    chime(alert.severity === 'Critical' ? 'critical' : 'dispatch');
    void markAlertRead(getBrowserSupabase(), alert.id).catch(() => {});
  }, [push, chime]);

  useEffect(() => {
    let sb;
    try {
      sb = getBrowserSupabase();
    } catch {
      // Missing config must never take the app shell down with it.
      return;
    }

    const offAlerts = subscribeAlerts(sb, { silo: scope }, (alert) => {
      // A silo-wide alert reaches every session in that silo; a targeted one
      // only its addressee.
      if (alert.target_user_id && alert.target_user_id !== userId) return;
      showAlert(alert);
    });

    const offNew = subscribeNewIncidents(sb, scope, (incident) => {
      push({
        id: `new-${incident.id}`,
        title: `New ${incident.incident_severity} call — ${SILO_LABELS[incident.silo] ?? incident.silo}`,
        body: `${incident.incident_type} · ${incident.location_address}`,
        badge: incident.incident_severity,
        tone: toneFor(incident.incident_severity),
        href: `/incidents/${incident.id}`,
      });
      if (incident.incident_severity === 'Critical') chime('critical');
    });

    const offUpd = subscribeIncidentUpdates(sb, scope, (incident) => {
      if (lastStatus.current.get(incident.id) === incident.status) return;
      lastStatus.current.set(incident.id, incident.status);
      push({
        id: `upd-${incident.id}`,
        title: `${incident.incident_number} → ${incident.status}`,
        body: `${incident.incident_type} · ${incident.location_address}`,
        tone: incident.status === 'Resolved' || incident.status === 'Closed' ? 'success' : 'info',
        href: `/incidents/${incident.id}`,
        duration: 6000,
      });
    });

    return () => { offAlerts(); offNew(); offUpd(); };
  }, [scope, userId, push, chime, showAlert]);

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
      if (thenOpen && current.link) router.push(current.link);
    }
  };

  if (!current) return null;

  const critical = current.severity === 'Critical';

  return (
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
            <p className="text-lg font-bold leading-tight">Incident assigned</p>
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
                Dispatched by {current.created_by_name}
              </span>
            ) : null}
            {queue.length > 1 ? (
              <span className="ml-auto font-semibold text-fg">
                +{queue.length - 1} more waiting
              </span>
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
                Acknowledge & open
              </button>
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
              Acknowledge
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
