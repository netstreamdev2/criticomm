'use client';

import { useEffect } from 'react';
import { listLiveMapZones, subscribeMapZones, type MapZone } from '@criticom/api';
import { DEPARTMENT_NAMES, receivesZoneNotices, type UserRole } from '@criticom/db';
import { useToast, type ToastTone } from '@/components/toast';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { roleWords, zoneKind } from '@/lib/ops-map/zones';

/**
 * Tells a console when a perimeter or zone reaches it: set, shared with it,
 * changed or stood down — with who did it and why — on whatever page is open.
 *
 * Consoles only. It listens to map_zones (Realtime applies the same RLS as a
 * read, so each console hears only what it may see) and never writes to
 * `alerts`, which the officer app reads: field officers do not receive
 * perimeters yet (receivesZoneNotices).
 */

const URGENT = new Set(['cordon', 'exclusion', 'evacuation', 'hazard']);

type Notice = 'new' | 'shared' | 'changed' | 'ended';

export function ZoneNotifier({ userId, role, soundEnabled, toastSeconds }: {
  userId: string;
  role: UserRole;
  soundEnabled: boolean;
  toastSeconds: number;
}) {
  const { push, chime } = useToast();

  useEffect(() => {
    if (!receivesZoneNotices(role)) return;
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      return;
    }
    let alive = true;
    /** Zones in force that this console already knows, by when they last changed. */
    const seen = new Map<string, string>();
    let ready = false;

    const tell = (notice: Notice, z: MapZone) => {
      const kind = zoneKind(z.kind);
      const dept = DEPARTMENT_NAMES[z.silo] ?? z.silo;
      const by = (name: string | null, role?: string | null) =>
        `${name ?? 'Someone'}${role ? ` (${roleWords(role)}, ${dept})` : ''}`;
      const copy: Record<Notice, { title: string; body: string; tone: ToastTone }> = {
        new: {
          title: `${kind.label}: ${z.name}`,
          body: `Set by ${by(z.created_by_name, z.created_by_role)}${z.reason ? ` — ${z.reason}` : ''}`,
          tone: URGENT.has(z.kind) ? 'warning' : 'info',
        },
        shared: {
          title: `Shared with you — ${kind.label}: ${z.name}`,
          body: `Set by ${by(z.created_by_name, z.created_by_role)}${z.reason ? ` — ${z.reason}` : ''}`,
          tone: URGENT.has(z.kind) ? 'warning' : 'info',
        },
        changed: {
          title: `Changed — ${kind.label}: ${z.name}`,
          body: `By ${z.updated_by_name ?? 'someone'}. Open it to see what changed.`,
          tone: 'info',
        },
        ended: {
          title: `Removed from the map — ${kind.label}: ${z.name}`,
          body: `By ${z.ended_by_name ?? 'someone'}${z.end_reason ? ` — ${z.end_reason}` : ''}`,
          tone: 'success',
        },
      };
      const c = copy[notice];
      push({
        id: `zone-${z.id}`,
        title: c.title,
        body: c.body,
        tone: c.tone,
        badge: notice === 'ended' ? 'Perimeter' : kind.label,
        href: notice === 'ended' ? '/incidents/map' : `/incidents/map?zone=${z.id}`,
        duration: Math.max(12_000, toastSeconds * 1000),
      });
      if (soundEnabled && notice !== 'ended') chime(c.tone);
    };

    // Start from what is already in force, so opening the console does not replay it.
    listLiveMapZones(sb)
      .then((rows) => { for (const z of rows) seen.set(z.id, z.updated_at); })
      .catch(() => {})
      .finally(() => { ready = true; });

    const off = subscribeMapZones(sb, ({ zone }) => {
      if (!alive || !ready || !zone) return;
      const before = seen.get(zone.id);
      if (zone.status === 'ended') {
        if (before === undefined) return;
        seen.delete(zone.id);
        if (zone.ended_by !== userId) tell('ended', zone);
        return;
      }
      if (before === zone.updated_at) return;
      seen.set(zone.id, zone.updated_at);
      if (zone.visibility === 'private') return;
      if (before === undefined) {
        if (zone.created_by === userId) return;
        // A zone set a while ago and only now shared with this department.
        tell(zone.updated_at !== zone.created_at ? 'shared' : 'new', zone);
      } else if (zone.updated_by !== userId) {
        tell('changed', zone);
      }
    });

    return () => {
      alive = false;
      off();
    };
  }, [userId, role, soundEnabled, toastSeconds, push, chime]);

  return null;
}
