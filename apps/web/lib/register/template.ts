import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import { STAFF_LIST_COLUMNS } from '@criticom/db/register';
import type { Silo } from '@criticom/db/types';
import { type WriteSheet, writeXlsx, XLSX_STYLE } from './xlsx.ts';

/**
 * The staff-list template sent to eThekwini HR: one "Staff" sheet to fill in
 * and one "Instructions" sheet. Badge and cellphone columns are text, so
 * Excel keeps leading zeros; Department offers a drop-down.
 */

export const TEMPLATE_FILE_NAME = 'HikTech staff list template.xlsx';

const DEPARTMENTS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini'];

export function buildStaffListTemplate(): Uint8Array {
  const columns = STAFF_LIST_COLUMNS.filter((c) => !c.extra);
  const departmentCol = String.fromCharCode(65 + columns.findIndex((c) => c.field === 'department'));
  const textFields = new Set(['badge_number', 'work_cellphone']);

  const staff: WriteSheet = {
    name: 'Staff',
    freezeHeader: true,
    rows: [columns.map((c) => ({ text: c.header, style: XLSX_STYLE.header }))],
    columns: columns.map((c) => ({
      width: c.field === 'work_email' ? 32 : c.field === 'previous_role' ? 24 : c.field === 'department' ? 22 : 18,
      style: textFields.has(c.field) ? XLSX_STYLE.text : undefined,
    })),
    lists: [{
      range: `${departmentCol}2:${departmentCol}20000`,
      values: DEPARTMENTS.map((d) => DEPARTMENT_NAMES[d]),
      prompt: 'Choose the department this person works in.',
    }],
  };

  const S = XLSX_STYLE;
  const rows: WriteSheet['rows'] = [];
  const merges: string[] = [];
  const heights: Record<number, number> = {};
  // A paragraph across all three columns. Excel does not grow merged cells to
  // fit wrapped text, so each gets the height its length needs.
  const paragraph = (text: string, style: number = S.wrap) => {
    merges.push(`A${rows.length + 1}:C${rows.length + 1}`);
    heights[rows.length] = Math.max(1, Math.ceil(text.length / 110)) * 16;
    rows.push([{ text, style }]);
  };

  paragraph('HikTech staff list for eThekwini Municipality', S.title);
  heights[0] = 22;
  paragraph('One row per person on the "Staff" sheet, for everyone who will use HikTech: the control room, Metro Police, Fire & Rescue, EMS and Disaster Management.');
  paragraph('Only what is listed below. Please do not add ID numbers, home addresses, dates of birth or salaries: HikTech does not need them, and POPIA asks us not to hold them.');
  paragraph('Adding someone here gives them no access. Each person later receives their own invitation and activates their account themselves.');
  rows.push([]);
  rows.push([{ text: 'Column', style: S.strong }, { text: 'Required', style: S.strong }, { text: 'What to put in it', style: S.strong }]);
  for (const c of columns) {
    rows.push([{ text: c.header, style: S.strong }, { text: c.required ? 'Yes' : 'If known', style: S.wrap }, { text: c.help, style: S.wrap }]);
  }
  rows.push([]);
  rows.push([{ text: 'Departments', style: S.strong }]);
  for (const d of DEPARTMENTS) rows.push([DEPARTMENT_NAMES[d]]);
  rows.push([]);
  rows.push([{ text: 'When it is done', style: S.strong }]);
  paragraph('Save the file as it is (.xlsx) and return it to the HikTech administrator who sent it, through the municipality\'s usual secure channel. A list exported from another system works too, as long as its columns carry these headings.');

  const instructions: WriteSheet = { name: 'Instructions', columns: [{ width: 26 }, { width: 12 }, { width: 80 }], rows, merges, heights };
  return writeXlsx([staff, instructions]);
}
