import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import {
  getFieldIncident, getIncident, getIncidentUpdates, getMyBodycam, getMyPersonnel, listAssignedToMe,
  listIncidentAttachments, listMyActiveIncidents, listMyAlerts,
} from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

/** Each call is read again at most this often. */
const AGAIN_AFTER_MS = 2 * 60_000;

/**
 * Keeps on the phone, while there is signal, everything the officer needs to
 * work their calls without it: each call they are on or have been sent —
 * the call sheet, its timeline and attachments, the report form's details —
 * plus their own record and alerts. Each is read exactly as its screen reads
 * it, so the offline cache (lib/offline-cache.ts) holds the answer the
 * screen will ask for. A call opened once is kept anyway; this covers the
 * one dispatch sent while the officer was looking at something else.
 *
 * Draws nothing.
 */
export function OfflinePrefetch() {
  const { session, offline } = useAuth();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId || offline) return;
    const sb = getSupabase();
    const readAt = new Map<string, number>();
    let running = false;

    const warm = async () => {
      if (running) return;
      running = true;
      try {
        const net = await NetInfo.fetch().catch(() => null);
        if (net && (net.isConnected === false || net.isInternetReachable === false)) return;
        const [mine, sent] = await Promise.all([
          listMyActiveIncidents(sb, userId).catch(() => []),
          listAssignedToMe(sb, userId).catch(() => []),
        ]);
        const ids = [...new Set([...mine.map((c) => c.id), ...sent.map((c) => c.id)])];
        const now = Date.now();
        for (const id of ids) {
          if (now - (readAt.get(id) ?? 0) < AGAIN_AFTER_MS) continue;
          readAt.set(id, now);
          await Promise.all([
            getFieldIncident(sb, id).catch(() => null),
            getIncident(sb, id).catch(() => null),
            getIncidentUpdates(sb, id).catch(() => null),
            listIncidentAttachments(sb, id).catch(() => null),
          ]);
        }
        if (now - (readAt.get('me') ?? 0) >= AGAIN_AFTER_MS) {
          readAt.set('me', now);
          await Promise.all([
            getMyPersonnel(sb, userId).catch(() => null),
            getMyBodycam(sb).catch(() => null),
            listMyAlerts(sb, { limit: 60 }).catch(() => null),
          ]);
        }
      } finally {
        running = false;
      }
    };

    void warm();
    const timer = setInterval(() => { void warm(); }, AGAIN_AFTER_MS);
    const offNet = NetInfo.addEventListener((s) => { if (s.isInternetReachable ?? s.isConnected) void warm(); });
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') void warm(); });
    return () => {
      clearInterval(timer);
      offNet();
      app.remove();
    };
  }, [userId, offline]);

  return null;
}
