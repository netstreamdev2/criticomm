'use client';

import { Ambulance, Flame, Shield, Sparkles, Waves } from 'lucide-react';
import { DEPARTMENT_NAMES, type DeskSilo, type IncidentSeverity } from '@criticom/db';
import { cn } from '@/lib/utils';

/**
 * The pieces the call-taking screen shares: each department in its own
 * colour, the mark on a field Criti filled in, and the field styles.
 */

/** The four departments, in the order the control room reads them (V4). */
export const DEPTS: Array<{ id: DeskSilo; label: string; icon: typeof Flame; hex: string; solid: string }> = [
  { id: 'MetroFire', label: 'Fire', icon: Flame, hex: '#f59e0b', solid: 'bg-[#f59e0b] text-black' },
  { id: 'MetroPolice', label: 'Police', icon: Shield, hex: '#3b82f6', solid: 'bg-[#3b82f6] text-white' },
  { id: 'Medical', label: 'Medical', icon: Ambulance, hex: '#dc3545', solid: 'bg-[#dc3545] text-white' },
  { id: 'EthekwiniDisaster', label: 'Disaster', icon: Waves, hex: '#8b5cf6', solid: 'bg-[#8b5cf6] text-white' },
];
const HEX = Object.fromEntries(DEPTS.map((d) => [d.id, d.hex])) as Record<DeskSilo, string>;

/** In the departments' own order, without repeats. */
export const inDeptOrder = (ds: Iterable<DeskSilo>) => {
  const want = new Set(ds);
  return DEPTS.map((d) => d.id).filter((d) => want.has(d));
};

export const deskList = (ds: readonly DeskSilo[]) => ds.map((d) => DEPARTMENT_NAMES[d]).join(', ');

/** One dot per department a type or an injury needs. */
export function DeptDots({ departments, className }: { departments: readonly DeskSilo[]; className?: string }) {
  if (!departments.length) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-0.5', className)} title={deskList(departments)}>
      {inDeptOrder(departments).map((d) => (
        <span key={d} className="h-2 w-2 rounded-full ring-1 ring-black/10" style={{ background: HEX[d] }} />
      ))}
    </span>
  );
}

/** On a field Criti filled in: the call taker may change it. */
export function CritiMark({ className }: { className?: string }) {
  return (
    <span
      title="Filled in by Criti. Change it if it is wrong."
      className={cn('inline-flex items-center gap-0.5 rounded bg-accent/15 px-1 py-px text-[10px] font-bold normal-case tracking-normal text-accent', className)}
    >
      <Sparkles className="h-2.5 w-2.5" /> Criti
    </span>
  );
}

/** Criti reading the description: not yet, now, done, switched off, or failed (the rules still work). */
export type AiState = 'idle' | 'reading' | 'ready' | 'off' | 'error';

export const AI_STATUS: Record<AiState, string> = {
  idle: 'Reads the description as you type',
  reading: 'Reading the description…',
  ready: 'Read the description',
  off: 'AI is off: the rules still help',
  error: 'Could not read it just now: the rules still help',
};

export const SEVERITIES: readonly IncidentSeverity[] = ['Low', 'Medium', 'High', 'Critical'];
export const SEVERITY_ON: Record<IncidentSeverity, string> = {
  Low: 'bg-severity-low',
  Medium: 'bg-severity-medium',
  High: 'bg-severity-high',
  Critical: 'bg-severity-critical',
};

export const labelCls = 'mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground';
export const fieldCls =
  'h-11 w-full rounded-lg border border-border bg-bg-soft px-3 text-sm text-fg ' +
  'placeholder:text-muted-foreground/60 transition-colors focus:border-accent focus:outline-none ' +
  'focus:ring-2 focus:ring-accent/25';

/** A reference made once per call, so sending twice never logs it twice. */
export function newRef(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Older browsers and plain-http addresses have no randomUUID: the same v4 format by hand.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
