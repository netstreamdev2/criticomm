'use client';

import { useEffect, useState } from 'react';
import { Wind } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useT } from '@/components/i18n';

type WindData = {
  configured: boolean;
  message?: string;
  error?: string;
  windSpeedMs?: number | null;
  windDeg?: number | null;
  windGustMs?: number | null;
  tempC?: number | null;
  humidity?: number | null;
  description?: string | null;
};

const compass = (deg: number) => {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
};

/** WindController.GetLatest widget — live conditions for fire-spread / disaster ops. */
export function WindWidget() {
  const { t } = useT();
  const [data, setData] = useState<WindData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetch('/api/wind')
        .then((r) => r.json())
        .then((d: WindData) => { if (alive) setData(d); })
        .catch(() => { if (alive) setData({ configured: true, error: 'unreachable' }); });
    };
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wind className="h-4 w-4" /> {' '}{t('Wind & weather')}</CardTitle>
        <CardDescription>{t('Durban conditions — refreshed every 5 min.')}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {!data && <p className="text-muted-foreground">{t('Loading…')}</p>}
        {data && !data.configured && (
          <p className="text-muted-foreground">{data.message}</p>
        )}
        {data?.configured && data.error && (
          <p className="text-severity-medium-ink">{t('Weather service unavailable ({error}).', { error: data.error })}</p>
        )}
        {data?.configured && !data.error && data.windSpeedMs != null && (
          <div className="space-y-3">
            <p className="text-3xl font-bold">
              {(data.windSpeedMs * 3.6).toFixed(0)} <span className="text-base font-normal text-muted-foreground">{t('km/h')}</span>
              {data.windDeg != null && (
                <span className="ml-2 text-base font-semibold text-accent">{compass(data.windDeg)}</span>
              )}
            </p>
            <ul className="space-y-1 text-muted-foreground">
              {data.windGustMs != null && <li>{t('Gusts: {fixed} km/h', { fixed: (data.windGustMs * 3.6).toFixed(0) })}</li>}
              {data.tempC != null && <li>{t('Temperature: {fixed} °C', { fixed: data.tempC.toFixed(1) })}</li>}
              {data.humidity != null && <li>{t('Humidity: {humidity}%', { humidity: data.humidity })}</li>}
              {data.description && <li className="capitalize">{data.description}</li>}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
