import { FIREARM_COLUMNS, FIREARM_TYPES, VEHICLE_COLUMNS, VEHICLE_TYPES } from '@criticom/db/assets';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import type { SheetColumn } from '@criticom/db/sheet';
import type { Silo } from '@criticom/db/types';
import { type WriteSheet, writeXlsx, XLSX_STYLE } from './xlsx.ts';

/**
 * The armoury and fleet templates: one sheet to fill in (drop-downs where the
 * values are fixed, serials and plates kept as text) and one of instructions.
 */

const DEPARTMENTS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini'];
const col = (i: number) => String.fromCharCode(65 + i);

function buildTemplate<F extends string>(spec: {
  sheet: string;
  title: string;
  intro: string[];
  columns: SheetColumn<F>[];
  lists: Partial<Record<F, readonly string[]>>;
  text: F[];
  widths?: Partial<Record<F, number>>;
}): Uint8Array {
  const data: WriteSheet = {
    name: spec.sheet,
    freezeHeader: true,
    rows: [spec.columns.map((c) => ({ text: c.header, style: XLSX_STYLE.header }))],
    columns: spec.columns.map((c) => ({ width: spec.widths?.[c.field] ?? 18, style: spec.text.includes(c.field) ? XLSX_STYLE.text : undefined })),
    lists: (Object.entries(spec.lists) as Array<[F, readonly string[]]>).map(([field, values]) => {
      const c = col(spec.columns.findIndex((x) => x.field === field));
      return { range: `${c}2:${c}5000`, values: [...values] };
    }),
  };

  const S = XLSX_STYLE;
  const rows: WriteSheet['rows'] = [];
  const merges: string[] = [];
  const heights: Record<number, number> = {};
  const paragraph = (text: string, style: number = S.wrap) => {
    merges.push(`A${rows.length + 1}:D${rows.length + 1}`);
    heights[rows.length] = Math.max(1, Math.ceil(text.length / 120)) * 16;
    rows.push([{ text, style }]);
  };
  paragraph(spec.title, S.title);
  heights[0] = 22;
  for (const p of spec.intro) paragraph(p);
  rows.push([]);
  rows.push([{ text: 'Column', style: S.strong }, { text: 'Required', style: S.strong }, { text: 'What to put in it', style: S.strong }, { text: 'Example', style: S.strong }]);
  for (const c of spec.columns) {
    rows.push([{ text: c.header, style: S.strong }, { text: c.required ? 'Yes' : 'If known', style: S.wrap }, { text: c.help, style: S.wrap }, c.example ?? '']);
  }
  rows.push([]);
  paragraph('A blank cell never erases what the register already holds. Importing the same file again is safe: matching entries are updated, never duplicated.');

  return writeXlsx([data, { name: 'Instructions', columns: [{ width: 24 }, { width: 10 }, { width: 70 }, { width: 18 }], rows, merges, heights }]);
}

export const FIREARMS_TEMPLATE_NAME = 'HikTech armoury template.xlsx';
export const VEHICLES_TEMPLATE_NAME = 'HikTech fleet template.xlsx';

export function buildFirearmsTemplate(): Uint8Array {
  return buildTemplate({
    sheet: 'Firearms',
    title: 'HikTech armoury register',
    intro: [
      'One row per firearm the department holds. Officers can only book out a firearm that is on this register.',
      'Firearms already on the register are matched by serial number and updated; who holds one right now never changes.',
    ],
    columns: FIREARM_COLUMNS,
    lists: { firearm_type: FIREARM_TYPES, department: DEPARTMENTS.map((d) => DEPARTMENT_NAMES[d]) },
    text: ['serial_number'],
    widths: { serial_number: 20, notes: 36, department: 20 },
  });
}

export function buildVehiclesTemplate(): Uint8Array {
  return buildTemplate({
    sheet: 'Vehicles',
    title: 'HikTech fleet register',
    intro: [
      'One row per vehicle. Officers choose from these at the start of a shift.',
      'Vehicles already on the register are matched by department and unit number and updated; a vehicle off the road stays off the road.',
    ],
    columns: VEHICLE_COLUMNS,
    lists: { type: VEHICLE_TYPES, department: DEPARTMENTS.map((d) => DEPARTMENT_NAMES[d]) },
    text: ['unit_number', 'license_plate', 'vin', 'year'],
    widths: { name: 22, type: 18, department: 20, vin: 22, disc_expiry: 20 },
  });
}
