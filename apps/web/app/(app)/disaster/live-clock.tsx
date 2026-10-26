'use client';

import { useEffect, useState } from 'react';

const TIME = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** South African time, to the second, whatever the clock of the computer is set to. Drawn after load, so it never shows the server's time. */
export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-right">
      <p className="font-mono text-4xl font-bold tabular-nums leading-none tracking-tight" aria-live="off">{now ? TIME.format(now) : '--:--:--'}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">{now ? DAY.format(now) : ' '} · SAST</p>
    </div>
  );
}
