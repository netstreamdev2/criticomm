import type { InspectionItemStatus, ShiftStartRecord } from '@criticom/api';

/**
 * DMPS 187(c) vehicle inspection — the sheet Durban Metro officers sign at the
 * start of every shift. Sections, keys and labels match the V4 form item for
 * item, so a record filed here reads the same as one filed on the old system.
 *
 * Items are stored as `section.item` because some names repeat across
 * sections (windows.left_rear_cab vs grids.left_rear_cab).
 */

export type Section = { id: string; title: string; items: readonly (readonly [string, string])[] };

export const SECTIONS = {
  ext_lights: {
    id: 'ext_lights', title: 'External Lights',
    items: [
      ['brake', 'Brake'], ['park', 'Park'], ['dim', 'Dim'], ['bright', 'Bright'],
      ['indicators', 'Indicators'], ['hazard', 'Hazard'], ['front_spots', 'Front Spots'],
      ['side_spots', 'Side Spots'], ['roof_spots', 'Roof Spots'], ['blue_lights', 'Blue Lights'],
      ['gizwacks', 'Gizwacks'],
    ],
  },
  int_lights: {
    id: 'int_lights', title: 'Internal Lights',
    items: [['cab_interior', 'Cab Interior'], ['van_interior', 'Van Interior'], ['dash_lights', 'Dash Lights']],
  },
  other_interior: {
    id: 'other_interior', title: 'Other Interior',
    items: [
      ['mirror', 'Mirror'], ['switches', 'Switches'], ['hooter', 'Hooter'], ['upholstery', 'Upholstery'],
      ['handles', 'Handles'], ['handbrakes', 'Handbrakes'], ['radio_two_way', 'Radio - Two Way'],
    ],
  },
  windows: {
    id: 'windows', title: 'Windows',
    items: [
      ['windscreen', 'Windscreen'], ['left_front_cab', 'Left Front Cab'], ['left_rear_cab', 'Left Rear Cab'],
      ['right_front_cab', 'Right Front Cab'], ['right_rear_cab', 'Right Rear Cab'], ['rear', 'Rear'],
    ],
  },
  grids: {
    id: 'grids', title: 'Grids',
    items: [['left_rear_cab', 'Left Rear Cab'], ['right_rear_cab', 'Right Rear Cab'], ['rear_canopy', 'Rear Canopy']],
  },
  pannels: {
    id: 'pannels', title: 'Panels',
    items: [
      ['bonnet', 'Bonnet'], ['right_front_arch', 'Right Front Arch'], ['right_front_door', 'Right Front Door'],
      ['right_rear_door', 'Right Rear Door'], ['right_rear_arch', 'Right Rear Arch'],
      ['rear_panel_boot', 'Rear Panel / Boot'], ['rear_door', 'Rear Door'], ['left_front_arch', 'Left Front Arch'],
      ['left_front_door', 'Left Front Door'], ['left_rear_door', 'Left Rear Door'], ['left_rear_arch', 'Left Rear Arch'],
    ],
  },
  bumpers: {
    id: 'bumpers', title: 'Bumpers',
    items: [['front_push_bars', 'Front Push Bars'], ['front', 'Front'], ['rear', 'Rear']],
  },
  other: {
    id: 'other', title: 'Other',
    items: [['wiper_blades', 'Wiper Blades'], ['reflectors', 'Reflectors']],
  },
  fluids: {
    id: 'fluids', title: 'Fluids & Fuel Levels',
    items: [
      ['engine_oil', 'Engine Oil'], ['radiator_water', 'Radiator Water'], ['windscreen_water', 'Windscreen Water'],
      ['brake_levels', 'Brake Levels'], ['gearbox_levels', 'Gearbox Levels'], ['clutch_levels', 'Clutch Levels'],
      ['battery_levels', 'Battery Levels'],
    ],
  },
  tyres: {
    id: 'tyres', title: 'Tyres & Tools',
    items: [
      ['left_front', 'Left Front'], ['left_rear', 'Left Rear'], ['right_front', 'Right Front'],
      ['right_rear', 'Right Rear'], ['spare', 'Spare'], ['jack', 'Jack'], ['wheel_spanner', 'Wheel Spanner'],
    ],
  },
  equipment: {
    id: 'equipment', title: 'Equipment',
    items: [
      ['spade', 'Spade'], ['fire_extinguisher', 'Fire Extinguisher'], ['first_aid_kit', 'First Aid Kit'],
      ['crowbar', 'Crowbar'], ['broom', 'Broom'], ['six_cones', '6 x Cones'], ['blanket', 'Blanket'],
    ],
  },
} as const satisfies Record<string, Section>;

export const SECTION_ORDER: Section[] = Object.values(SECTIONS);

export const ITEM_KEYS: string[] = SECTION_ORDER.flatMap((s) => s.items.map(([k]) => `${s.id}.${k}`));
export const TOTAL_ITEMS = ITEM_KEYS.length; // 67

/** The eight tabs of the V4 wizard. Item tabs list the sections they hold. */
export const TABS = [
  { id: 'check', label: 'Vehicle Check', sections: [] },
  { id: 'details', label: 'Details', sections: [] },
  { id: 'lights', label: 'Lights', sections: [SECTIONS.ext_lights, SECTIONS.int_lights] },
  { id: 'interior', label: 'Interior', sections: [SECTIONS.other_interior, SECTIONS.windows, SECTIONS.grids] },
  { id: 'body', label: 'Body', sections: [SECTIONS.pannels, SECTIONS.bumpers, SECTIONS.other] },
  { id: 'mechanical', label: 'Mechanical & Fluids', sections: [SECTIONS.fluids, SECTIONS.tyres, SECTIONS.equipment] },
  { id: 'review', label: 'Review', sections: [] },
  { id: 'signoff', label: 'Sign Off', sections: [] },
] as const satisfies readonly { id: string; label: string; sections: readonly Section[] }[];

export const ESSENTIALS = [
  ['lights_functional', 'Lights (Functioning properly)'],
  ['tires_condition_ok', 'Tyres (Condition OK)'],
  ['equipment_stocked', 'Emergency Equipment Stocked'],
  ['comms_working', 'Communication/GPS Working'],
  ['brakes_responsive', 'Brakes Responsive'],
] as const;
export type EssentialKey = (typeof ESSENTIALS)[number][0];

export const FUEL_LEVELS = ['1/4', '1/2', '3/4', 'Full'] as const;
export type FuelLevel = (typeof FUEL_LEVELS)[number];

export const SHIFT_TYPES = [
  ['DAY', 'Day Shift'], ['NIGHT', 'Night Shift'], ['MORNING', 'Morning Shift'], ['AFTERNOON', 'Afternoon Shift'],
] as const;

export const READINESS_ITEMS = [
  ['memory_recall', 'Memory Recall (Can you remember key facts?)'],
  ['judgment', 'Judgment (Split-second decision confidence?)'],
  ['situational_awareness', 'Situational Awareness (Aware of surroundings?)'],
  ['not_under_influence', 'Are you free from the influence of Alcohol/Drugs?'],
  ['anger_check', 'Emotional Wellbeing (Feeling mentally balanced?)'],
  ['reflexes', 'Reflexes (Motor skills functioning optimally?)'],
] as const;

export const CHAMBER_STATUSES = [
  ['condition_1', 'Condition 1 — round chambered'],
  ['condition_3', 'Condition 3 — magazine in, chamber empty'],
  ['unloaded', 'Unloaded'],
] as const;

export const FIREARM_CONDITIONS = [
  ['clean', 'Clean & functional'],
  ['requires_cleaning', 'Requires cleaning'],
  ['damaged', 'Damaged / defective'],
] as const;

export const FIREARM_CHECKS = [
  ['serial_verified', 'Serial number matches the register'],
  ['barrel_clear', 'Barrel clear of obstruction'],
  ['action_functional', 'Action / slide functions'],
  ['safety_functional', 'Safety / decocker functions'],
  ['sights_secure', 'Sights secure'],
] as const;
export type FirearmCheckKey = (typeof FIREARM_CHECKS)[number][0];

export type ItemMap = Record<string, InspectionItemStatus>;

export function countItems(items: ItemMap) {
  let ok = 0; let fault = 0; let nil = 0;
  for (const key of ITEM_KEYS) {
    const v = items[key];
    if (v === 'ok') ok += 1;
    else if (v === 'fault') fault += 1;
    else if (v === 'nil') nil += 1;
  }
  return { ok, fault, nil, done: ok + fault + nil };
}

export function sectionKeys(section: Section) {
  return section.items.map(([k]) => `${section.id}.${k}`);
}

export function faultLabels(items: ItemMap) {
  return SECTION_ORDER.flatMap((s) => s.items
    .filter(([k]) => items[`${s.id}.${k}`] === 'fault')
    .map(([, label]) => `${s.title}: ${label}`));
}

/** "Thu, 01 Oct 2026" in South African time. */
export function saLongDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(d);
}

/** 01/10/2026 */
export function saShortDate(d: Date | string = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(typeof d === 'string' ? new Date(d) : d);
}

export function saTime(d: Date | string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit',
  }).format(typeof d === 'string' ? new Date(d) : d);
}

/** DMPS-<NDM>-<YYYYMMDD>, the V4 reference format. */
export function inspectionRef(ndm: string, d = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).replace(/-/g, '');
  const clean = ndm.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'NA';
  return `DMPS-${clean}-${ymd}`;
}

/* ── Export ──────────────────────────────────────────────────────────── */

export type ReportContext = {
  record: ShiftStartRecord;
  officialName: string;
  shortName: string;
  logoUrl: string | null;
  officerName: string;
};

const STATUS_TEXT: Record<InspectionItemStatus, string> = { ok: 'OK', fault: 'FAULT', nil: 'NIL' };

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function labelFor(list: readonly (readonly [string, string])[], key: string | null | undefined) {
  return list.find(([k]) => k === key)?.[1] ?? key ?? '—';
}

/** The printable start-of-shift record: readiness, 187(c) sheet, firearm loadout. */
export function buildReportHtml({ record, officialName, shortName, logoUrl, officerName }: ReportContext) {
  const { readiness, inspection, firearm, noFirearm } = record;
  const items = (inspection?.items ?? {}) as ItemMap;
  const counts = countItems(items);
  const passed = Boolean(inspection && ESSENTIALS.every(([k]) => inspection[k]) && inspection.declaration_accepted);
  const unit = inspection?.apparatus;

  const sectionTables = SECTION_ORDER.map((s) => {
    const keys = sectionKeys(s);
    const ok = keys.filter((k) => items[k] === 'ok').length;
    const rows = s.items.map(([k, label]) => {
      const v = items[`${s.id}.${k}`];
      return `<tr><td>${esc(label)}</td><td class="st ${v ?? ''}">${v ? STATUS_TEXT[v] : '—'}</td></tr>`;
    }).join('');
    return `<div class="sec"><div class="sech"><span>${esc(s.title)}</span><span>${ok}/${keys.length} OK</span></div><table>${rows}</table></div>`;
  }).join('');

  const readinessRows = READINESS_ITEMS.map(([k, label]) => {
    const v = readiness ? readiness[k] : null;
    return `<tr><td>${esc(label)}</td><td class="st ${v ? 'ok' : v === false ? 'fault' : ''}">${v == null ? '—' : v ? 'YES' : 'NO'}</td></tr>`;
  }).join('');

  const essentialRows = ESSENTIALS.map(([k, label]) => {
    const v = inspection ? inspection[k] : null;
    return `<tr><td>${esc(label)}</td><td class="st ${v ? 'ok' : v === false ? 'fault' : ''}">${v == null ? '—' : v ? 'YES' : 'NO'}</td></tr>`;
  }).join('');

  const firearmBlock = firearm ? `
    <h2>Firearm &amp; loadout</h2>
    <table class="kv">
      <tr><td>Firearm</td><td>${esc(firearm.make_model)} · S/N ${esc(firearm.serial_number)}</td></tr>
      <tr><td>Rounds issued</td><td>${esc(firearm.rounds_issued)}</td></tr>
      <tr><td>Magazines</td><td>${esc(firearm.magazines)}</td></tr>
      <tr><td>Chamber status</td><td>${esc(labelFor(CHAMBER_STATUSES, firearm.chamber_status))}</td></tr>
      <tr><td>Condition</td><td>${esc(labelFor(FIREARM_CONDITIONS, firearm.condition))}</td></tr>
      ${FIREARM_CHECKS.map(([k, label]) => `<tr><td>${esc(label)}</td><td class="st ${firearm[k] ? 'ok' : 'fault'}">${firearm[k] ? 'YES' : 'NO'}</td></tr>`).join('')}
      <tr><td>Notes</td><td>${esc(firearm.defects ?? '—')}</td></tr>
      <tr><td>Result</td><td class="st ${firearm.passed && firearm.condition !== 'damaged' ? 'ok' : 'fault'}">${firearm.passed && firearm.condition !== 'damaged' ? 'BOOKED OUT' : 'SENT TO ARMOURER'}</td></tr>
      <tr><td>Time</td><td>${esc(saShortDate(firearm.created_at))} ${esc(saTime(firearm.created_at))}</td></tr>
    </table>` : noFirearm ? `
    <h2>Firearm &amp; loadout</h2>
    <table class="kv">
      <tr><td>Firearm</td><td class="st nil">NONE DRAWN</td></tr>
      <tr><td>Reason</td><td>${esc(noFirearm.reason ?? '—')}</td></tr>
      <tr><td>Declared</td><td>${esc(saShortDate(noFirearm.created_at))} ${esc(saTime(noFirearm.created_at))}</td></tr>
    </table>` : '';

  const signature = inspection?.signature_svg
    ? `<img class="sig" src="data:image/svg+xml;utf8,${encodeURIComponent(inspection.signature_svg)}" />`
    : '<div class="muted">Not signed</div>';

  const crest = logoUrl
    ? `<img class="crest" src="${esc(logoUrl)}" />`
    : `<div class="mono">${esc(shortName.slice(0, 4).toUpperCase())}</div>`;

  return `<!doctype html><html><head><meta charset="utf-8" />
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Rubik, -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #1e293b; margin: 0; padding: 24px; font-size: 11px; }
  .top { text-align: center; margin-bottom: 14px; }
  .crest { width: 56px; height: 56px; object-fit: contain; }
  .mono { display: inline-block; width: 56px; height: 56px; line-height: 56px; border-radius: 10px; background: #1e3a8a; color: #fff; font-weight: 800; }
  .org { font-weight: 700; font-size: 14px; margin-top: 4px; }
  .sub { color: #64748b; letter-spacing: 1px; font-size: 9px; }
  .band { background: #0f172a; color: #fff; border-radius: 10px; padding: 16px 20px; margin-bottom: 14px; }
  .ref { font-family: monospace; color: #94a3b8; font-size: 9px; }
  .band h1 { margin: 4px 0 2px; font-size: 20px; } .band h1 span { color: #3b82f6; }
  .grid { display: flex; gap: 18px; margin-top: 10px; flex-wrap: wrap; }
  .grid div small { display: block; color: #94a3b8; font-size: 8px; letter-spacing: 1px; text-transform: uppercase; }
  .grid div b { font-size: 12px; }
  .badge { display: inline-block; margin-top: 10px; padding: 3px 10px; border-radius: 999px; font-weight: 700; font-size: 9px; letter-spacing: 1px; }
  .pass { background: rgba(16,185,129,.18); color: #10b981; } .fail { background: rgba(239,68,68,.18); color: #ef4444; }
  .stats { display: flex; gap: 8px; margin-bottom: 12px; }
  .stats div { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center; padding: 8px; }
  .stats b { display: block; font-size: 18px; } .stats small { color: #64748b; font-size: 8px; letter-spacing: 1px; }
  h2 { color: #3b82f6; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  .kv td:first-child { color: #64748b; width: 40%; }
  .cols { column-count: 3; column-gap: 10px; }
  .sec { break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 10px; overflow: hidden; }
  .sech { display: flex; justify-content: space-between; background: #f1f5f9; padding: 5px 8px; font-weight: 700; color: #3b82f6; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; }
  .st { text-align: right; font-weight: 700; font-size: 9px; color: #94a3b8; }
  .st.ok { color: #10b981; } .st.fault { color: #ef4444; } .st.nil { color: #64748b; }
  .remarks { border-left: 3px solid #ef4444; background: #fef2f2; padding: 8px 10px; border-radius: 4px; }
  .okmsg { border-left: 3px solid #10b981; background: #ecfdf5; color: #059669; padding: 8px 10px; border-radius: 4px; font-weight: 600; }
  .sig { height: 70px; border-bottom: 1px solid #cbd5e1; }
  .muted { color: #94a3b8; }
  .foot { margin-top: 18px; color: #94a3b8; font-size: 8px; text-align: center; }
</style></head><body>
  <div class="top">${crest}<div class="org">${esc(officialName)}</div><div class="sub">START OF SHIFT RECORD · VEHICLE INSPECTION 187(C)</div></div>

  <div class="band">
    <div class="ref">${esc(inspection?.inspection_ref ?? '')}</div>
    <h1>DMPS <span>187(c)</span></h1>
    <div class="sub" style="color:#94a3b8">VEHICLE INSPECTION REPORT · ELECTRONIC RECORD</div>
    <div class="grid">
      <div><small>NDM Number</small><b>${esc(inspection?.ndm_number ?? '—')}</b></div>
      <div><small>Mileage</small><b>${inspection?.mileage_km != null ? `${esc(inspection.mileage_km)} km` : '—'}</b></div>
      <div><small>Shift</small><b>${esc(inspection?.shift_type ?? '—')}</b></div>
      <div><small>Date</small><b>${inspection ? esc(saShortDate(inspection.checked_at)) : '—'}</b></div>
      <div><small>Unit</small><b>${unit ? esc(`${unit.unit_number} — ${unit.name}`) : '—'}</b></div>
      <div><small>Inspector</small><b>${esc(inspection?.inspector_name ?? officerName)}</b></div>
    </div>
    <div class="badge ${passed ? 'pass' : 'fail'}">● ${passed ? 'VEHICLE PASSED INSPECTION' : 'VEHICLE NOT CLEARED FOR DUTY'}</div>
  </div>

  <div class="stats">
    <div><b style="color:#3b82f6">${TOTAL_ITEMS}</b><small>TOTAL ITEMS</small></div>
    <div><b style="color:#10b981">${counts.ok}</b><small>WORKING</small></div>
    <div><b style="color:#ef4444">${counts.fault}</b><small>FAULTS</small></div>
    <div><b style="color:#64748b">${counts.nil}</b><small>NIL / N/A</small></div>
  </div>
  ${counts.fault > 0
    ? `<div class="remarks"><b>Faults reported:</b> ${esc(faultLabels(items).join(', '))}<br/>${esc(inspection?.fault_remarks ?? '')}</div>`
    : '<div class="okmsg">✓ All inspected items are in working order — no faults detected.</div>'}

  <h2>Readiness assessment</h2>
  <table class="kv">${readinessRows}
    <tr><td>Comments</td><td>${esc(readiness?.comments || '—')}</td></tr>
    <tr><td>Time</td><td>${readiness ? `${esc(saShortDate(readiness.timestamp))} ${esc(saTime(readiness.timestamp))}` : '—'}</td></tr>
  </table>

  <h2>Essential checks</h2>
  <table class="kv">
    <tr><td>Fuel level</td><td>${esc(inspection?.fuel_level ?? '—')}</td></tr>
    ${essentialRows}
  </table>

  <h2>Inspection detail</h2>
  <div class="cols">${sectionTables}</div>

  ${firearmBlock}

  <h2>Sign off</h2>
  <table class="kv">
    <tr><td>Inspected by</td><td>${esc(inspection?.inspector_name ?? officerName)}</td></tr>
    <tr><td>Inspection date</td><td>${inspection?.inspection_date ? esc(saShortDate(inspection.inspection_date)) : '—'}</td></tr>
    <tr><td>Photos attached</td><td>${esc((inspection?.photo_paths ?? []).length)} · Licence disk ${inspection?.licence_disk_path ? '✓' : '—'} · Licence photo ${inspection?.licence_photo_path ? '✓' : '—'}</td></tr>
    <tr><td>Declaration</td><td>${inspection?.declaration_accepted ? 'Accepted — the inspector physically inspected the vehicle and accepts full responsibility for this declaration.' : 'Not accepted'}</td></tr>
    <tr><td>Signature</td><td>${signature}</td></tr>
  </table>

  <div class="foot">Generated ${esc(saLongDate())} ${esc(saTime(new Date()))} · ${esc(inspection?.inspection_ref ?? '')} · HikTech</div>
</body></html>`;
}

function csvCell(value: unknown) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per fact: section, item, value — opens cleanly in Excel. */
export function buildReportCsv({ record, officerName }: Pick<ReportContext, 'record' | 'officerName'>) {
  const { readiness, inspection, firearm, noFirearm } = record;
  const items = (inspection?.items ?? {}) as ItemMap;
  const rows: unknown[][] = [['Section', 'Item', 'Value']];
  const unit = inspection?.apparatus;

  rows.push(
    ['Record', 'Reference', inspection?.inspection_ref ?? ''],
    ['Record', 'Officer', inspection?.inspector_name ?? officerName],
    ['Record', 'Date', inspection ? saShortDate(inspection.checked_at) : ''],
    ['Record', 'Unit', unit ? `${unit.unit_number} — ${unit.name}` : ''],
    ['Record', 'NDM number', inspection?.ndm_number ?? ''],
    ['Record', 'Mileage (km)', inspection?.mileage_km ?? ''],
    ['Record', 'Shift', inspection?.shift_type ?? ''],
  );
  for (const [k, label] of READINESS_ITEMS) {
    rows.push(['Readiness', label, readiness ? (readiness[k] ? 'Yes' : 'No') : '']);
  }
  rows.push(['Readiness', 'Comments', readiness?.comments ?? '']);
  rows.push(['Essential checks', 'Fuel level', inspection?.fuel_level ?? '']);
  for (const [k, label] of ESSENTIALS) {
    rows.push(['Essential checks', label, inspection ? (inspection[k] ? 'Yes' : 'No') : '']);
  }
  for (const s of SECTION_ORDER) {
    for (const [k, label] of s.items) {
      const v = items[`${s.id}.${k}`];
      rows.push([s.title, label, v ? STATUS_TEXT[v] : '']);
    }
  }
  const counts = countItems(items);
  rows.push(
    ['Summary', 'Working', counts.ok],
    ['Summary', 'Faults', counts.fault],
    ['Summary', 'NIL / N/A', counts.nil],
    ['Summary', 'Fault remarks', inspection?.fault_remarks ?? ''],
    ['Sign off', 'Declaration accepted', inspection?.declaration_accepted ? 'Yes' : 'No'],
    ['Sign off', 'Signed', inspection?.signature_svg ? 'Yes' : 'No'],
    ['Sign off', 'Photos attached', (inspection?.photo_paths ?? []).length],
  );
  if (firearm) {
    rows.push(
      ['Firearm', 'Make / model', firearm.make_model ?? ''],
      ['Firearm', 'Serial number', firearm.serial_number],
      ['Firearm', 'Rounds issued', firearm.rounds_issued],
      ['Firearm', 'Magazines', firearm.magazines],
      ['Firearm', 'Chamber status', labelFor(CHAMBER_STATUSES, firearm.chamber_status)],
      ['Firearm', 'Condition', labelFor(FIREARM_CONDITIONS, firearm.condition)],
      ...FIREARM_CHECKS.map(([k, label]) => ['Firearm', label, firearm[k] ? 'Yes' : 'No']),
      ['Firearm', 'Notes', firearm.defects ?? ''],
      ['Firearm', 'Result', firearm.passed && firearm.condition !== 'damaged' ? 'Booked out' : 'Sent to armourer'],
    );
  } else if (noFirearm) {
    rows.push(
      ['Firearm', 'Firearm', 'None drawn'],
      ['Firearm', 'Reason', noFirearm.reason ?? ''],
    );
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}
