'use client';

import { useEffect, useState } from 'react';
import { TrafficCone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useT } from '@/components/i18n';

type TrafficIncident = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: { iconCategory?: number; events?: Array<{ description?: string }> };
};
type TrafficResponse =
  | { incidents?: TrafficIncident[] }
  | { configured: false; message: string }
  | { error: string };

// TomTom iconCategory → label (documented category ids)
const CATEGORY: Record<number, string> = {
  0: 'Unknown', 1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Rain', 5: 'Ice',
  6: 'Jam', 7: 'Lane closed', 8: 'Road closed', 9: 'Road works', 10: 'Wind', 11: 'Flooding', 14: 'Broken-down vehicle',
};

/** Live TomTom traffic incidents (via /api/external/traffic). */
export function TrafficPanel() {
  const { t } = useT();
  const [state, setState] = useState<TrafficResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetch('/api/external/traffic')
        .then((r) => r.json())
        .then((d: TrafficResponse) => { if (alive) setState(d); })
        .catch(() => { if (alive) setState({ error: 'unreachable' }); });
    };
    load();
    const t = setInterval(load, 2 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const incidents = state && 'incidents' in state ? state.incidents ?? [] : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrafficCone className="h-4 w-4" /> {' '}{t('Live traffic incidents')}</CardTitle>
        <CardDescription>{t('TomTom feed for the Durban metro bbox — refreshed every 2 min.')}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {!state && <p className="text-muted-foreground">{t('Loading…')}</p>}
        {state && 'configured' in state && !state.configured && (
          <p className="text-muted-foreground">{state.message}</p>
        )}
        {state && 'error' in state && (
          <p className="text-severity-medium-ink">{t('Traffic feed unavailable ({error}).', { error: state.error })}</p>
        )}
        {state && 'incidents' in state && (
          incidents.length === 0 ? (
            <p className="text-severity-low-ink">{t('No active traffic incidents in the metro area.')}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {incidents.slice(0, 12).map((i, idx) => (
                <li key={idx} className="rounded-md border border-border/60 bg-bg-soft p-3">
                  <p className="font-semibold">
                    {CATEGORY[i.properties?.iconCategory ?? 0] ?? 'Incident'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i.properties?.events?.map((e) => e.description).filter(Boolean).join('; ') || 'No details'}
                  </p>
                </li>
              ))}
            </ul>
          )
        )}
      </CardContent>
    </Card>
  );
}
