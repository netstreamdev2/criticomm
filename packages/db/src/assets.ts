/**
 * The armoury and fleet registers (migration 0051): importing them from a
 * spreadsheet. The same check runs in the administrator's browser before
 * anything is sent, and the database checks every row again.
 */

import type { Silo } from './types.generated';
import { DEPARTMENT_NAMES } from './onboarding.ts';
import { departmentFrom, tidyLabel } from './register.ts';
import { matchKey, type SheetColumn, type SheetRow } from './sheet.ts';

// ── Columns ─────────────────────────────────────────────────────────────

export type FirearmField = 'serial_number' | 'make' | 'model' | 'calibre' | 'firearm_type' | 'department' | 'station' | 'notes';

export const FIREARM_COLUMNS: SheetColumn<FirearmField>[] = [
  { field: 'serial_number', header: 'Serial number', required: true, example: 'SN-48812',
    help: 'Exactly as stamped on the firearm.', aliases: ['serial', 'serial no', 'serial nr', 'firearm number', 'firearm no', 'sn'] },
  { field: 'make', header: 'Make', required: true, example: 'Glock',
    help: 'The manufacturer, e.g. Glock, Beretta, Vektor.', aliases: ['manufacturer', 'brand'] },
  { field: 'model', header: 'Model', required: true, example: '17',
    help: 'e.g. 17, 92F, Z88.', aliases: ['model no', 'model number'] },
  { field: 'calibre', header: 'Calibre', required: false, example: '9mm',
    help: 'e.g. 9mm.', aliases: ['caliber', 'cal'] },
  { field: 'firearm_type', header: 'Type', required: false, example: 'Sidearm',
    help: 'Sidearm, Rifle, Shotgun, Less-lethal or Other. Blank means Sidearm.', aliases: ['firearm type', 'weapon type', 'category'] },
  { field: 'department', header: 'Department', required: true, example: 'Metro Police',
    help: 'The department whose armoury holds it, usually Metro Police.', aliases: ['dept', 'service'] },
  { field: 'station', header: 'Station', required: false, example: 'Durban Central',
    help: 'Where it is kept.', aliases: ['armoury', 'location', 'safe', 'base'] },
  { field: 'notes', header: 'Notes', required: false, example: '',
    help: 'Anything the armourer should know.', aliases: ['remarks', 'comments'] },
];

export type VehicleField =
  | 'unit_number' | 'name' | 'type' | 'department' | 'make' | 'model' | 'year' | 'license_plate' | 'vin'
  | 'station_number' | 'fuel_type' | 'disc_expiry';

export const VEHICLE_COLUMNS: SheetColumn<VehicleField>[] = [
  { field: 'unit_number', header: 'Unit number', required: true, example: 'MP-12',
    help: 'The fleet or unit number painted on the vehicle.', aliases: ['unit', 'unit no', 'fleet number', 'fleet no', 'vehicle number', 'vehicle no'] },
  { field: 'type', header: 'Type', required: true, example: 'Patrol vehicle',
    help: 'Patrol vehicle, Fire engine, Ladder truck, Ambulance, Rescue unit, Command vehicle, Water tanker, Motorcycle or Other.',
    aliases: ['vehicle type', 'category', 'class'] },
  { field: 'department', header: 'Department', required: true, example: 'Metro Police',
    help: 'Metro Police, Fire & Rescue, EMS / Medical, Disaster Management or Control Room.', aliases: ['dept', 'service'] },
  { field: 'name', header: 'Name', required: false, example: 'Patrol 12',
    help: 'How crews refer to it. Blank uses the type and unit number.', aliases: ['description', 'vehicle name', 'call sign'] },
  { field: 'make', header: 'Make', required: false, example: 'Toyota', help: '', aliases: ['manufacturer', 'brand'] },
  { field: 'model', header: 'Model', required: false, example: 'Corolla', help: '', aliases: [] },
  { field: 'year', header: 'Year', required: false, example: '2023', help: 'Model year.', aliases: ['model year', 'yr'] },
  { field: 'license_plate', header: 'Registration', required: false, example: 'ND 123-456',
    help: 'The number plate.', aliases: ['registration number', 'reg no', 'reg', 'licence plate', 'license plate', 'number plate', 'plate'] },
  { field: 'vin', header: 'VIN', required: false, example: '', help: 'Vehicle identification number.', aliases: ['vin number', 'chassis number', 'chassis no'] },
  { field: 'station_number', header: 'Station', required: false, example: 'Durban Central',
    help: 'Where it is based.', aliases: ['base', 'depot', 'station number'] },
  { field: 'fuel_type', header: 'Fuel', required: false, example: 'Petrol', help: 'Petrol or Diesel.', aliases: ['fuel type'] },
  { field: 'disc_expiry', header: 'Licence disc expiry', required: false, example: '2027-03-31',
    help: 'The date on the licence disc.', aliases: ['disc expiry', 'licence expiry', 'license expiry', 'license disc expiry', 'licence disc'] },
];

export const FIREARM_TYPES = ['Sidearm', 'Rifle', 'Shotgun', 'Less-lethal', 'Other'] as const;
export type FirearmType = (typeof FIREARM_TYPES)[number];

export const VEHICLE_TYPES = [
  'Patrol vehicle', 'Fire engine', 'Ladder truck', 'Ambulance', 'Rescue unit', 'Command vehicle', 'Water tanker', 'Motorcycle', 'Other',
] as const;

// ── Values ──────────────────────────────────────────────────────────────

const plain = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tidy = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** "Pistol" is a Sidearm, "taser" is Less-lethal; blank is a Sidearm; anything else unknown is null. */
export function firearmTypeFrom(value: unknown): FirearmType | null {
  const v = plain(value);
  if (!v || ['sidearm', 'pistol', 'handgun', 'revolver', 'side arm'].includes(v)) return 'Sidearm';
  if (['rifle', 'carbine', 'assault rifle', 'r5', 'r4', 'long gun'].includes(v)) return 'Rifle';
  if (['shotgun', 'shot gun'].includes(v)) return 'Shotgun';
  if (['less lethal', 'lesslethal', 'taser', 'stun gun', 'rubber', 'pepper', 'non lethal'].includes(v)) return 'Less-lethal';
  if (v === 'other') return 'Other';
  return null;
}

/** Common names for vehicle types, mapped to the fleet's own; anything else is kept as typed. */
export function vehicleTypeFrom(value: unknown): string {
  const v = plain(value);
  const map: Record<string, string> = {
    'patrol vehicle': 'Patrol vehicle', patrol: 'Patrol vehicle', 'patrol car': 'Patrol vehicle', 'police car': 'Patrol vehicle', sedan: 'Patrol vehicle', bakkie: 'Patrol vehicle',
    'fire engine': 'Fire engine', 'fire truck': 'Fire engine', pumper: 'Fire engine', engine: 'Fire engine',
    'ladder truck': 'Ladder truck', ladder: 'Ladder truck', aerial: 'Ladder truck',
    ambulance: 'Ambulance', ems: 'Ambulance',
    'rescue unit': 'Rescue unit', rescue: 'Rescue unit',
    'command vehicle': 'Command vehicle', command: 'Command vehicle',
    'water tanker': 'Water tanker', tanker: 'Water tanker',
    motorcycle: 'Motorcycle', motorbike: 'Motorcycle', bike: 'Motorcycle',
    other: 'Other',
  };
  return map[v] ?? tidy(value);
}

/** A number plate in one form: capitals, single spaces. */
export function normalisePlate(value: unknown): string | null {
  const v = tidy(value).toUpperCase();
  return v || null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A date as people and Excel write it: 2027-03-31, 31/03/2027, 31 Mar 2027,
 * or Excel's own day number (46477). Day first, as South Africa writes it.
 * Returns YYYY-MM-DD, or null when it cannot be read.
 */
export function parseSheetDate(value: unknown): string | null {
  const v = tidy(value);
  if (!v) return null;
  let y: number; let m: number; let d: number;
  let match: RegExpMatchArray | null;
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const serial = Math.floor(Number(v));
    if (serial < 20000 || serial > 80000) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    y = date.getUTCFullYear(); m = date.getUTCMonth() + 1; d = date.getUTCDate();
  } else if ((match = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    d = Number(match[1]); m = Number(match[2]); y = Number(match[3]);
  } else if ((match = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]+(\d{4})$/))) {
    d = Number(match[1]); m = MONTHS.indexOf(match[2]!.slice(0, 3).toLowerCase()) + 1; y = Number(match[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── The check ───────────────────────────────────────────────────────────

export type AssetFix = { skip?: boolean; silo?: Silo; firearmType?: FirearmType; dropValue?: boolean; acceptMatch?: boolean };
export type AssetFixKind = 'skip' | 'department' | 'firearm-type' | 'drop-value' | 'accept-match';
export type AssetIssue = { code: string; message: string; fixes: AssetFixKind[] };
export type AssetChange = { label: string; from: string; to: string };

export type CheckedAsset<T> = {
  line: number;
  item: T;
  label: string;
  outcome: 'add' | 'update' | 'unchanged' | 'merged' | 'attention' | 'skipped';
  issues: AssetIssue[];
  changes: AssetChange[];
  notes: string[];
  mergedInto: number | null;
};

export type AssetListCheck<T> = {
  rows: CheckedAsset<T>[];
  counts: Record<CheckedAsset<T>['outcome'], number>;
  /** Rows the import sends: added, updated and unchanged. */
  toImport: Array<T & { line: number }>;
};

type Kind<T, E, F extends string> = {
  clean: (raw: SheetRow<F>, fix: AssetFix) => { item: T; issues: AssetIssue[] };
  key: (item: T) => string;
  entryKey: (entry: E) => string;
  label: (item: T) => string;
  /** Why an existing entry may not be the same thing, or null. */
  conflict: (entry: E, item: T) => string | null;
  changes: (entry: E, item: T) => AssetChange[];
  notes?: (entry: E, item: T) => string[];
  same: (a: T, b: T) => boolean;
};

function checkAssets<T, E, F extends string>(kind: Kind<T, E, F>, raws: SheetRow<F>[], register: E[], fixes: Record<number, AssetFix>): AssetListCheck<T> {
  const rows: CheckedAsset<T>[] = raws.map((raw) => {
    const fix = fixes[raw.line] ?? {};
    const { item, issues } = kind.clean(raw, fix);
    return {
      line: raw.line, item, label: kind.label(item), outcome: fix.skip ? 'skipped' : issues.length ? 'attention' : 'add',
      issues: fix.skip ? [] : issues, changes: [], notes: [], mergedInto: null,
    };
  });

  const byKey = new Map<string, CheckedAsset<T>[]>();
  for (const r of rows) {
    const key = kind.key(r.item);
    if (r.outcome === 'skipped' || !key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group as [CheckedAsset<T>, ...CheckedAsset<T>[]];
    if (rest.every((r) => kind.same(r.item, first.item))) {
      for (const r of rest) { r.outcome = 'merged'; r.mergedInto = first.line; r.issues = []; }
    } else {
      for (const r of group) {
        const others = group.filter((o) => o !== r).map((o) => o.line).join(', ');
        r.outcome = 'attention';
        r.issues.push({ code: 'file-duplicate', message: `Also on row ${others} with different details`, fixes: ['skip'] });
      }
    }
  }

  const registerByKey = new Map<string, E[]>();
  for (const e of register) {
    const key = kind.entryKey(e);
    if (key) registerByKey.set(key, [...(registerByKey.get(key) ?? []), e]);
  }
  for (const r of rows) {
    if (r.outcome === 'skipped' || r.outcome === 'merged') continue;
    const fix = fixes[r.line] ?? {};
    const matches = registerByKey.get(kind.key(r.item)) ?? [];
    if (matches.length > 1) {
      r.outcome = 'attention';
      r.issues.push({ code: 'register-duplicate', message: 'Matches more than one entry on the register: fix the register first', fixes: ['skip'] });
      continue;
    }
    const match = matches[0];
    if (match && !fix.acceptMatch) {
      const why = kind.conflict(match, r.item);
      if (why) {
        r.outcome = 'attention';
        r.issues.push({ code: 'mismatch', message: why, fixes: ['accept-match', 'skip'] });
      }
    }
    if (r.outcome === 'attention') continue;
    if (!match) { r.outcome = 'add'; continue; }
    r.item = keepRegisterSpelling(match, r.item);
    r.changes = kind.changes(match, r.item);
    r.notes = kind.notes?.(match, r.item) ?? [];
    r.outcome = r.changes.length ? 'update' : 'unchanged';
  }

  const counts = { add: 0, update: 0, unchanged: 0, merged: 0, attention: 0, skipped: 0 };
  for (const r of rows) counts[r.outcome]++;
  const toImport = rows
    .filter((r) => r.outcome === 'add' || r.outcome === 'update' || r.outcome === 'unchanged')
    .map((r) => ({ ...r.item, line: r.line }));
  return { rows, counts, toImport };
}

/** The same words, whatever the capitals or spacing. */
function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return tidy(a).toLowerCase() === tidy(b).toLowerCase();
}

/**
 * "GLOCK" in the file and "Glock" on the register are the same make, and
 * "ND 123 456" is plate ND 123-456: keep the register's spelling, so a file
 * typed differently changes nothing.
 */
const MATCHED_BY_KEY = new Set(['serial_number', 'unit_number', 'license_plate']);

function keepRegisterSpelling<T, E>(entry: E, item: T): T {
  const out = { ...item } as Record<string, unknown>;
  const reg = entry as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    const r = reg[k];
    if (typeof v !== 'string' || typeof r !== 'string' || v === r) continue;
    if (sameText(v, r) || (MATCHED_BY_KEY.has(k) && matchKey(v) === matchKey(r))) out[k] = r;
  }
  return out as T;
}

/** A change, for fields where the file has a value that differs (a blank cell never erases). */
function diff(label: string, from: string | number | null | undefined, to: string | number | null | undefined): AssetChange[] {
  if (to === null || to === undefined || to === '') return [];
  if (sameText(String(to), from === null || from === undefined ? '' : String(from))) return [];
  return [{ label, from: from === null || from === undefined || from === '' ? '—' : String(from), to: String(to) }];
}

function departmentOf(raw: unknown, fix: AssetFix): { silo: Silo | null; issue: AssetIssue | null } {
  const silo = fix.silo ?? departmentFrom(raw);
  if (silo) return { silo, issue: null };
  const text = tidy(raw);
  return {
    silo: null,
    issue: text
      ? { code: 'unknown-department', message: `Department “${text}” not recognised`, fixes: ['department', 'skip'] }
      : { code: 'no-department', message: 'No department given', fixes: ['department', 'skip'] },
  };
}

// ── Firearms ────────────────────────────────────────────────────────────

export type FirearmItem = {
  serial_number: string; make: string; model: string; calibre: string | null; firearm_type: FirearmType;
  silo: Silo | null; station: string | null; notes: string | null;
};

/** A firearm already on the register, as the check needs it. */
export type FirearmEntry = {
  id: string; serial_number: string; make: string; model: string; calibre: string | null; firearm_type: string;
  silo: Silo; station: string | null; notes: string | null; status: string;
};

const FIREARM_KIND: Kind<FirearmItem, FirearmEntry, FirearmField> = {
  clean(raw, fix) {
    const issues: AssetIssue[] = [];
    const serial = tidy(raw.serial_number);
    const make = tidyLabel(raw.make);
    const model = tidyLabel(raw.model);
    const type = fix.firearmType ?? firearmTypeFrom(raw.firearm_type);
    const dept = departmentOf(raw.department, fix);
    if (!matchKey(serial)) issues.push({ code: 'no-serial', message: 'No serial number', fixes: ['skip'] });
    if (!make || !model) issues.push({ code: 'no-make-model', message: 'Make and model are both needed', fixes: ['skip'] });
    if (!type) issues.push({ code: 'unknown-type', message: `Type “${tidy(raw.firearm_type)}” not recognised`, fixes: ['firearm-type', 'skip'] });
    if (dept.issue) issues.push(dept.issue);
    return {
      item: {
        serial_number: serial, make, model, calibre: tidy(raw.calibre) || null, firearm_type: type ?? 'Other',
        silo: dept.silo, station: tidyLabel(raw.station) || null, notes: tidy(raw.notes) || null,
      },
      issues,
    };
  },
  key: (i) => matchKey(i.serial_number),
  entryKey: (e) => matchKey(e.serial_number),
  label: (i) => `${i.serial_number || '(no serial)'} · ${[i.make, i.model].filter(Boolean).join(' ')}`,
  conflict: (e, i) => (i.make && e.make.toLowerCase() !== i.make.toLowerCase()
    ? `Serial ${e.serial_number} is on the register as a ${e.make} ${e.model}`
    : null),
  changes: (e, i) => [
    ...diff('Make', e.make, i.make), ...diff('Model', e.model, i.model), ...diff('Calibre', e.calibre, i.calibre),
    ...diff('Type', e.firearm_type, i.firearm_type), ...diff('Department', DEPARTMENT_NAMES[e.silo], i.silo ? DEPARTMENT_NAMES[i.silo] : null),
    ...diff('Station', e.station, i.station), ...diff('Notes', e.notes, i.notes),
  ],
  notes: (e) => (e.status === 'Issued' ? ['Booked out right now: its details update, its custody does not.'] : []),
  same: (a, b) => sameText(a.make, b.make) && sameText(a.model, b.model) && sameText(a.calibre, b.calibre) && a.firearm_type === b.firearm_type
    && a.silo === b.silo && sameText(a.station, b.station),
};

export function checkFirearmList(raws: SheetRow<FirearmField>[], register: FirearmEntry[], fixes: Record<number, AssetFix> = {}) {
  return checkAssets(FIREARM_KIND, raws, register, fixes);
}

// ── Vehicles ────────────────────────────────────────────────────────────

export type VehicleItem = {
  unit_number: string; name: string; type: string; silo: Silo | null; make: string | null; model: string | null;
  year: number | null; license_plate: string | null; vin: string | null; station_number: string | null;
  fuel_type: string | null; disc_expiry: string | null;
};

export type VehicleEntry = {
  id: string; unit_number: string; name: string; type: string; silo: Silo; make: string | null; model: string | null;
  year: number | null; license_plate: string | null; vin: string | null; station_number: string | null;
  fuel_type: string | null; disc_expiry: string | null; status: string;
};

const THIS_YEAR = new Date().getUTCFullYear();

const VEHICLE_KIND: Kind<VehicleItem, VehicleEntry, VehicleField> = {
  clean(raw, fix) {
    const issues: AssetIssue[] = [];
    const unit = tidy(raw.unit_number);
    const type = vehicleTypeFrom(raw.type);
    const dept = departmentOf(raw.department, fix);
    const yearText = tidy(raw.year);
    let year = yearText ? Number(yearText) : null;
    if (year !== null && !(Number.isInteger(year) && year >= 1950 && year <= THIS_YEAR + 1)) {
      if (fix.dropValue) year = null;
      else issues.push({ code: 'bad-year', message: `Year “${yearText}” is not a vehicle year`, fixes: ['drop-value', 'skip'] });
    }
    const discText = tidy(raw.disc_expiry);
    let disc = discText ? parseSheetDate(discText) : null;
    if (discText && !disc) {
      if (fix.dropValue) disc = null;
      else issues.push({ code: 'bad-date', message: `Licence disc date “${discText}” not understood`, fixes: ['drop-value', 'skip'] });
    }
    if (!matchKey(unit)) issues.push({ code: 'no-unit', message: 'No unit number', fixes: ['skip'] });
    if (!type) issues.push({ code: 'no-type', message: 'No vehicle type', fixes: ['skip'] });
    if (dept.issue) issues.push(dept.issue);
    return {
      item: {
        unit_number: unit, name: tidyLabel(raw.name) || [type, unit].filter(Boolean).join(' '), type, silo: dept.silo,
        make: tidyLabel(raw.make) || null, model: tidyLabel(raw.model) || null, year: year !== null && Number.isFinite(year) ? year : null,
        license_plate: normalisePlate(raw.license_plate), vin: tidy(raw.vin).toUpperCase() || null,
        station_number: tidyLabel(raw.station_number) || null, fuel_type: tidyLabel(raw.fuel_type) || null, disc_expiry: disc,
      },
      issues,
    };
  },
  key: (i) => (i.silo ? `${i.silo}|${matchKey(i.unit_number)}` : `?|${matchKey(i.unit_number)}`),
  entryKey: (e) => `${e.silo}|${matchKey(e.unit_number)}`,
  label: (i) => `${i.unit_number || '(no unit)'} · ${i.name}`,
  conflict: (e, i) => (i.license_plate && e.license_plate && matchKey(e.license_plate) !== matchKey(i.license_plate)
    ? `Unit ${e.unit_number} is on the register with registration ${e.license_plate}`
    : null),
  changes: (e, i) => [
    ...diff('Name', e.name, i.name), ...diff('Type', e.type, i.type), ...diff('Make', e.make, i.make), ...diff('Model', e.model, i.model),
    ...diff('Year', e.year, i.year), ...diff('Registration', e.license_plate, i.license_plate), ...diff('VIN', e.vin, i.vin),
    ...diff('Station', e.station_number, i.station_number), ...diff('Fuel', e.fuel_type, i.fuel_type),
    ...diff('Licence disc expiry', e.disc_expiry, i.disc_expiry),
  ],
  notes: (e) => (['Out of Service', 'Maintenance', 'Decommissioned', 'In Use'].includes(e.status)
    ? [`Currently ${e.status}: its details update, its status does not.`] : []),
  same: (a, b) => matchKey(a.name) === matchKey(b.name) && a.type === b.type && sameText(a.make, b.make) && sameText(a.model, b.model) && a.year === b.year
    && matchKey(a.license_plate ?? '') === matchKey(b.license_plate ?? '') && sameText(a.station_number, b.station_number),
};

export function checkVehicleList(raws: SheetRow<VehicleField>[], register: VehicleEntry[], fixes: Record<number, AssetFix> = {}) {
  const result = checkAssets(VEHICLE_KIND, raws, register, fixes);
  // The same number plate on two different vehicles is a typing slip somewhere.
  const plates = new Map<string, string[]>();
  for (const e of register) if (e.license_plate) plates.set(matchKey(e.license_plate), [...(plates.get(matchKey(e.license_plate)) ?? []), `${e.silo}|${matchKey(e.unit_number)}`]);
  for (const r of result.rows) {
    if (r.outcome === 'skipped' || r.outcome === 'merged' || !r.item.license_plate) continue;
    const owners = (plates.get(matchKey(r.item.license_plate)) ?? []).filter((k) => k !== VEHICLE_KIND.key(r.item));
    if (owners.length && !(fixes[r.line]?.acceptMatch)) {
      r.outcome = 'attention';
      r.issues.push({ code: 'plate-elsewhere', message: `Registration ${r.item.license_plate} is already on unit ${owners[0]!.split('|')[1]}`, fixes: ['accept-match', 'skip'] });
    }
  }
  // …and so is the same plate on two different units in the file itself,
  // when the register does not already say whose it is.
  const inFile = new Map<string, CheckedAsset<VehicleItem>[]>();
  for (const r of result.rows) {
    if (r.outcome === 'skipped' || r.outcome === 'merged' || !r.item.license_plate) continue;
    const plate = matchKey(r.item.license_plate);
    inFile.set(plate, [...(inFile.get(plate) ?? []), r]);
  }
  for (const [plate, group] of inFile) {
    if (plates.has(plate) || new Set(group.map((r) => VEHICLE_KIND.key(r.item))).size < 2) continue;
    for (const r of group) {
      const other = group.find((o) => VEHICLE_KIND.key(o.item) !== VEHICLE_KIND.key(r.item))!;
      r.outcome = 'attention';
      r.issues.push({ code: 'plate-in-file', message: `Registration ${r.item.license_plate} is also on row ${other.line} (unit ${other.item.unit_number})`, fixes: ['skip'] });
    }
  }
  if (result.rows.some((r) => r.issues.some((i) => i.code === 'plate-elsewhere' || i.code === 'plate-in-file'))) {
    const counts = { add: 0, update: 0, unchanged: 0, merged: 0, attention: 0, skipped: 0 };
    for (const r of result.rows) counts[r.outcome]++;
    result.counts = counts;
    result.toImport = result.rows
      .filter((r) => r.outcome === 'add' || r.outcome === 'update' || r.outcome === 'unchanged')
      .map((r) => ({ ...r.item, line: r.line }));
  }
  return result;
}
