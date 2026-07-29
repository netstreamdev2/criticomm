'use client';

import { useEffect, useRef, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type Status = 'idle' | 'locating' | 'sharing' | 'error' | 'denied' | 'expired';

export function ShareLocationClient({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [updates, setUpdates] = useState(0);
  const watchId = useRef<number | null>(null);

  const stop = () => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setStatus('idle');
  };

  const start = () => {
    if (!('geolocation' in navigator)) {
      setStatus('error');
      return;
    }
    setStatus('locating');
    const sb = getBrowserSupabase();
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        const { error } = await sb.rpc('citizen_update_location', {
          p_token: token, p_latitude: lat, p_longitude: lng,
        });
        if (error) {
          setStatus(error.message.toLowerCase().includes('expire') ? 'expired' : 'error');
          stop();
          return;
        }
        setUpdates((n) => n + 1);
        setStatus('sharing');
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  };

  useEffect(() => stop, []);

  return (
    <div className="space-y-4">
      {status === 'sharing' && coords && (
        <div className="rounded-lg border border-severity-low/40 bg-severity-low/10 p-4 text-sm">
          <p className="font-semibold text-severity-low-ink">✓ Sharing your location</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} · {updates} update{updates === 1 ? '' : 's'} sent
          </p>
        </div>
      )}
      {status === 'denied' && (
        <p className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 p-4 text-sm">
          Location permission was denied. Please allow location access in your browser
          settings, then try again.
        </p>
      )}
      {status === 'expired' && (
        <p className="rounded-lg border border-severity-medium/40 bg-severity-medium/10 p-4 text-sm">
          This link has expired. If you still need help, call the emergency line again.
        </p>
      )}
      {status === 'error' && (
        <p className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 p-4 text-sm">
          We couldn't send your location. Check your connection and try again.
        </p>
      )}

      {status === 'sharing' || status === 'locating' ? (
        <button
          type="button"
          onClick={stop}
          className="h-12 w-full rounded-md border border-border text-sm font-semibold hover:bg-muted"
        >
          {status === 'locating' ? 'Locating…' : 'Stop sharing'}
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          className="h-12 w-full rounded-md bg-primary text-base font-semibold"
        >
          Share my location
        </button>
      )}
    </div>
  );
}
