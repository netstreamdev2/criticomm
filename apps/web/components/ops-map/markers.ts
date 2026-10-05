import type * as Leaflet from 'leaflet';
import type { OnDutyOfficer } from '@criticom/api';
import type { Database } from '@criticom/db';
import {
  CRIME_KINDS, SEVERITY_COLOUR, type CrimeKind, type CrimeZone, type Facility, type TrafficItem,
} from '@/lib/ops-map/layers';
import { escapeHtml as e, formatSaTime, timeAgo } from '@/lib/utils';

/**
 * Icons and hover cards for the live operations map. Tooltips are bound as
 * HTML, so every value from the database or a feed goes through escapeHtml.
 */

type L = typeof Leaflet;
type Incident = Database['public']['Tables']['incidents']['Row'];
type Hydrant = Database['public']['Tables']['hydrants']['Row'];
type Camera = Database['public']['Tables']['cameras']['Row'];

/** Worse calls draw above lesser ones where pins overlap; an SOS above everything. */
export const SEVERITY_Z: Record<string, number> = { Critical: 900, High: 600, Medium: 300, Low: 0 };
export const SOS_Z = 2000;

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export function incidentIcon(L: L, incident: Incident, fresh: boolean) {
  const colour = SEVERITY_COLOUR[incident.incident_severity] ?? SEVERITY_COLOUR.Medium;
  const classes = ['map-teardrop-wrap', 'ops-pin'];
  if (incident.incident_severity === 'Critical') classes.push('ops-pin--pulse');
  if (fresh) classes.push('ops-pin--new');
  return L.divIcon({
    className: classes.join(' '),
    html: `<span class="ops-pin-body" style="--pin:${colour}"><span class="ops-pin-ring"></span><span class="map-teardrop"></span></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 24],
    tooltipAnchor: [0, -22],
  });
}

export function sosIcon(L: L) {
  return L.divIcon({
    className: 'ops-sos-wrap',
    html: '<span class="ops-sos"><span class="ops-sos-ring"></span><span class="ops-sos-ring"></span><span class="ops-sos-core">SOS</span></span>',
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    tooltipAnchor: [0, -22],
  });
}

export function incidentTooltip(i: Incident) {
  return `<div class="ops-tip">
    <div class="ops-tip-title">${e(i.incident_number)} · <span style="color:${SEVERITY_COLOUR[i.incident_severity] ?? 'inherit'}">${e(i.incident_severity)}</span></div>
    <div>${e(i.incident_type)}</div>
    <div class="ops-tip-muted">${e(i.location_address)}</div>
    <div class="ops-tip-muted">${e(i.status)} · logged ${e(timeAgo(i.incident_created_at))}</div>
  </div>`;
}

export function sosTooltip(i: Incident) {
  return `<div class="ops-tip">
    <div class="ops-tip-title" style="color:#f87171">SOS · ${e(i.incident_number)}</div>
    <div>${e(i.caller_name || i.responding_officer || 'Officer')}</div>
    <div class="ops-tip-muted">${e(i.location_address)}</div>
    <div class="ops-tip-muted">${e(i.status)} · raised ${e(timeAgo(i.incident_created_at))}</div>
  </div>`;
}

export function unitIcon(L: L, busy: boolean, stale: boolean) {
  return L.divIcon({
    className: 'ops-unit-wrap',
    html: `<span class="ops-unit" data-busy="${busy}" data-stale="${stale}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    tooltipAnchor: [0, -10],
  });
}

export function unitTooltip(o: OnDutyOfficer, stale: boolean) {
  const unit = [o.unitNumber && `Unit ${o.unitNumber}`, o.station].filter(Boolean).join(' · ');
  const work = o.busyWith
    ? `On ${e(o.busyWith.number)}${o.activeCalls > 1 ? ` (+${o.activeCalls - 1} more)` : ''}`
    : 'Available';
  return `<div class="ops-tip">
    <div class="ops-tip-title">${e(o.name || 'Officer')}${o.badge ? ` · ${e(o.badge)}` : ''}</div>
    ${unit ? `<div>${e(unit)}</div>` : ''}
    <div>${work}</div>
    <div class="ops-tip-muted">${stale ? 'No GPS for a while · ' : ''}position ${e(timeAgo(o.seenAt))}</div>
  </div>`;
}

export function crimeTooltip(z: CrimeZone, kind: CrimeKind, year: string | null, stations: number) {
  const what = CRIME_KINDS.find((k) => k.key === kind)?.label ?? kind;
  return `<div class="ops-tip">
    <div class="ops-tip-title">${e(titleCase(z.station.station_name))} SAPS</div>
    <div>${z.count.toLocaleString('en-ZA')} · ${e(what.toLowerCase())}</div>
    <div class="ops-tip-muted">#${z.rank} of ${stations} stations${year ? ` · ${e(year)}` : ''}</div>
  </div>`;
}

export function hydrantTooltip(h: Hydrant) {
  return `<div class="ops-tip">
    <div class="ops-tip-title">${e(h.location_name)}</div>
    <div>${e(h.status)}</div>
    <div class="ops-tip-muted">${h.last_inspected ? `Inspected ${e(formatSaTime(h.last_inspected))}` : 'Not yet inspected by the fire service'}</div>
  </div>`;
}

export function cameraTooltip(c: Camera) {
  return `<div class="ops-tip">
    <div class="ops-tip-title">${e(c.name || 'Camera')}</div>
    ${c.roadway_name ? `<div>${e(c.roadway_name)}${c.direction_of_travel ? ` · ${e(c.direction_of_travel)}` : ''}</div>` : ''}
  </div>`;
}

const FACILITY_LETTER: Record<Facility['kind'], string> = { hospital: 'H', police: 'P', fire: 'F', other: '+' };

export function facilityIcon(L: L, f: Facility) {
  return L.divIcon({
    className: 'ops-poi-wrap',
    html: `<span class="ops-poi" data-kind="${f.kind}">${FACILITY_LETTER[f.kind]}</span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    tooltipAnchor: [0, -10],
  });
}

export function facilityTooltip(f: Facility) {
  return `<div class="ops-tip">
    <div class="ops-tip-title">${e(f.name)}</div>
    ${f.address ? `<div class="ops-tip-muted">${e(f.address)}</div>` : ''}
  </div>`;
}

export function trafficTooltip(t: TrafficItem) {
  return `<div class="ops-tip">
    <div class="ops-tip-title" style="color:#fb923c">${e(t.label)}</div>
    ${t.description !== t.label ? `<div>${e(t.description)}</div>` : ''}
  </div>`;
}
