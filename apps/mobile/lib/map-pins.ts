import type { IncidentStatus } from '@criticom/db/types';
import { callView, type FieldCall } from './response.ts';

/**
 * What the live map draws for each incident: a pin at the coordinates the
 * dispatcher captured at intake (incidents.location_lat / location_lng),
 * coloured by severity, plus the few facts its tap-to-expand card shows.
 * No dependencies beyond the response rules, so it can be tested.
 */
export type MapPin = {
  id: string;
  number: string;
  type: string;
  severity: string;
  color: string;
  status: string;
  address: string;
  /** When it was sent out (or logged) — the card shows "4m ago" from it. */
  sentAt: string;
  lat: number;
  lng: number;
  /** Assigned to me, or I am responding — drawn with a blue ring. */
  mine: boolean;
  /** "Assigned to you", "Led by Sgt Dube", "Open — first to respond leads". */
  holder: string;
  /** Arrived since the map opened — drops in with a ripple. */
  fresh: boolean;
  /** An officer's SOS (source Responder-Panic): its own pin and tag. */
  sos: boolean;
};

export type PinSource = FieldCall & {
  incident_number: string;
  incident_type: string;
  incident_severity: string;
  location_address: string;
  location_lat: number | null;
  location_lng: number | null;
  dispatch_time: string | null;
  incident_created_at: string;
  source?: string | null;
};

/** No fix recorded, or the 0,0 the intake form stores for "unknown". */
export function hasLocation(lat: number | null | undefined, lng: number | null | undefined) {
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng)
    && !(lat === 0 && lng === 0)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function toPins(
  incidents: readonly PinSource[],
  me: { userId: string; silo: string; onDuty: boolean | null },
  colorOf: (severity: string) => string,
  opts: { queued?: ReadonlyMap<string, IncidentStatus>; fresh?: ReadonlySet<string> } = {},
): MapPin[] {
  const pins: MapPin[] = [];
  for (const i of incidents) {
    if (!hasLocation(i.location_lat, i.location_lng)) continue;
    const queued = opts.queued?.get(i.id) ?? null;
    const v = callView(i, me, queued);
    const holder = v.ownSos ? 'Your SOS — help is being sent'
      : v.role === 'lead' ? 'You are leading'
      : v.role === 'backup' ? 'You are backup'
        : v.assignment.kind === 'you' ? 'Assigned to you'
          : v.assignment.kind === 'other' ? (v.lead ? `Led by ${v.assignment.name}` : `Assigned to ${v.assignment.name}`)
            : 'Open — first to respond leads';
    pins.push({
      id: i.id,
      number: i.incident_number,
      type: i.incident_type,
      severity: i.incident_severity,
      color: colorOf(i.incident_severity),
      status: v.role === 'lead' && queued ? queued : i.status,
      address: i.location_address,
      sentAt: i.dispatch_time ?? i.incident_created_at,
      lat: i.location_lat as number,
      lng: i.location_lng as number,
      mine: v.role !== null || v.assignment.kind === 'you',
      holder,
      fresh: opts.fresh?.has(i.id) ?? false,
      sos: i.source === 'Responder-Panic',
    });
  }
  return pins;
}
