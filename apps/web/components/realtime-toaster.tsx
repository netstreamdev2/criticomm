'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { subscribeNewIncidents } from '@criticom/api';
import { GLOBAL_ROLES, type Silo, type UserRole } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type Toast = {
  id: string;
  incidentId: string;
  title: string;
  body: string;
  severity: string;
};

/** App-wide replacement for V4's SignalR dispatcher toast (ReceiveNewIncident). */
export function RealtimeToaster({ silo, role }: { silo: string; role: string }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const sb = getBrowserSupabase();
    // Global roles hear everything; silo staff only their own channel.
    const scope = GLOBAL_ROLES.includes(role as UserRole) || silo === 'Ethekwini'
      ? ('all' as const)
      : (silo as Silo);

    const off = subscribeNewIncidents(sb, scope, (incident) => {
      const toast: Toast = {
        id: `${incident.id}-${Date.now()}`,
        incidentId: incident.id,
        title: `New ${incident.incident_severity} incident — ${incident.silo}`,
        body: `${incident.incident_type} · ${incident.location_address}`,
        severity: incident.incident_severity,
      };
      setToasts((cur) => [...cur.slice(-3), toast]);
      // Auto-dismiss after 8s
      setTimeout(() => {
        setToasts((cur) => cur.filter((t) => t.id !== toast.id));
      }, 8000);
    });
    return off;
  }, [silo, role]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-enter pointer-events-auto rounded-lg border border-border bg-bg-card p-3 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/incidents/${t.incidentId}`}
              className="min-w-0 flex-1"
              onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className="severity-pill" data-sev={t.severity}>{t.severity}</span>
                <span className="truncate">{t.title}</span>
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{t.body}</p>
            </Link>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
