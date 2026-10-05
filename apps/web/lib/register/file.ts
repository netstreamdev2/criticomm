import { findHeaderRow } from '@criticom/db/register';
import { decodeText, parseCsv } from './csv.ts';
import { readXlsx } from './xlsx.ts';
import { ZipError } from './zip.ts';

/**
 * A staff list file, read in the administrator's browser. Nothing here sends
 * anything anywhere: the file stays on their computer until they confirm.
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type StaffFile = {
  kind: 'xlsx' | 'csv';
  /** The sheet read, for a workbook. */
  sheet: string | null;
  /** Every visible sheet, so the screen can say which was used. */
  sheets: string[];
  table: string[][];
  /** SHA-256 of the exact bytes, recorded with the import so the file can be matched later. */
  fingerprint: string;
};

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const STAFF_SHEET = /staff|register|personnel|employees/i;

export function readStaffFile(bytes: Uint8Array, fileName: string): Promise<StaffFile> {
  return readSpreadsheet(bytes, fileName, { sheetName: STAFF_SHEET, hasHeadings: (table) => findHeaderRow(table) >= 0 });
}

/**
 * Any register file (staff, firearms, vehicles): the sheet whose name
 * matches, else the first whose headings are recognised, else the first.
 */
export async function readSpreadsheet(
  bytes: Uint8Array,
  fileName: string,
  look: { sheetName: RegExp; hasHeadings: (table: string[][]) => boolean },
): Promise<StaffFile> {
  if (bytes.length > MAX_FILE_BYTES) throw new Error('This file is larger than 20 MB. A register should be far smaller: check it is the right file.');
  if (bytes.length === 0) throw new Error('This file is empty.');
  const fingerprint = await sha256Hex(bytes);

  // An old-style Excel file (.xls) starts with this signature.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new Error('This is an older Excel file (.xls). Open it in Excel, choose Save As, and save it as an Excel Workbook (.xlsx) or CSV.');
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const sheets = (await readXlsx(bytes)).filter((s) => !s.hidden);
      const named = sheets.find((s) => look.sheetName.test(s.name));
      for (const sheet of named ? [named, ...sheets.filter((s) => s !== named)] : sheets) {
        const table = await sheet.read();
        if (look.hasHeadings(table)) return { kind: 'xlsx', sheet: sheet.name, sheets: sheets.map((s) => s.name), table, fingerprint };
      }
      const first = sheets[0]!;
      return { kind: 'xlsx', sheet: first.name, sheets: sheets.map((s) => s.name), table: await first.read(), fingerprint };
    } catch (e) {
      if (e instanceof ZipError) throw new Error(e.message);
      throw new Error(`This workbook could not be read (${(e as Error).message}). Save it again from Excel, or as CSV.`);
    }
  }
  if (/\.(xlsx|xlsm)$/i.test(fileName)) throw new Error('This file is named like an Excel workbook but is not one. Save it again from Excel.');
  return { kind: 'csv', sheet: null, sheets: [], table: parseCsv(decodeText(bytes)), fingerprint };
}
