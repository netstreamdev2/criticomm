import { useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { useLiveIncidents } from '@/lib/use-live-incidents';
import { hasLocation, toPins } from '@/lib/map-pins';
import { severityColor, useTheme } from '@/lib/theme';

/**
 * Live incidents as map pins, for the Home map and the Live Map page.
 * `unlocated` counts the incidents dispatch sent without a usable location —
 * they cannot be pinned, and the map says so.
 */
export function useMapPins() {
  const { session, silo } = useAuth();
  const { onDuty } = useDuty();
  const { incidents, loading, error, refresh, queued, freshIds } = useLiveIncidents();
  // Pin colours come from the theme: rebuild them when it switches.
  const { mode } = useTheme();

  const pins = useMemo(
    () => toPins(incidents, { userId: session?.user.id ?? '', silo, onDuty }, severityColor, { queued, fresh: freshIds }),
    [incidents, session, silo, onDuty, queued, freshIds, mode],
  );
  const unlocated = useMemo(
    () => incidents.filter((i) => !hasLocation(i.location_lat, i.location_lng)).length,
    [incidents],
  );

  return { pins, unlocated, freshIds, loading, error, refresh };
}
