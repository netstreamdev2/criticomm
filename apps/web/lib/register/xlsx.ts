import { readZip, writeZip, ZipError } from './zip.ts';

/**
 * Reading and writing the parts of an Excel workbook (.xlsx) a staff list
 * uses: sheet names and cell text. Formulas are read as their last result,
 * and styles, dates and charts are ignored. Written by hand rather than with
 * a spreadsheet library: a few hundred lines we test ourselves, instead of a
 * dependency that parses untrusted files.
 */

export type Sheet = { name: string; hidden: boolean; read: () => Promise<string[][]> };

const MAX_ROWS = 50_000;

/** XML text as written: entities and Excel's _xHHHH_ escapes undone. */
export function xmlText(s: string): string {
  return s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_m, e: string) => {
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'amp') return '&';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      return String.fromCodePoint(e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10));
    });
}

const attr = (attrs: string, name: string) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}="([^"]*)"`));
  return m ? xmlText(m[1]!) : null;
};

/** All the text of a string item: plain, or in rich-text runs; phonetic guides left out. */
function itemText(xml: string): string {
  const body = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  let out = '';
  for (const m of body.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) out += xmlText(m[1]!);
  return out;
}

/** "B12" → column 1 (zero-based). */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function cellValue(attrs: string, body: string, shared: string[]): string {
  const type = attr(attrs, 't');
  if (type === 'inlineStr') {
    const is = body.match(/<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/);
    return is ? itemText(is[1]!) : '';
  }
  const v = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
  if (!v) return '';
  const raw = xmlText(v[1]!);
  if (type === 's') return shared[Number(raw)] ?? '';
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  if (type === 'e') return '';
  if (type === 'str') return raw;
  // A number. Whole numbers are written out in full (a cellphone stored as a
  // number must not become 8.2E8).
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return Number.isInteger(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER ? n.toFixed(0) : String(n);
}

/** One worksheet's cells as a grid of text; the row index is Excel's row number less one. */
export function parseSheetXml(xml: string, shared: string[]): string[][] {
  const table: string[][] = [];
  let nextRow = 0;
  for (const row of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const r = Number(attr(row[1]!, 'r'));
    const index = Number.isFinite(r) && r > 0 ? r - 1 : nextRow;
    nextRow = index + 1;
    if (index >= MAX_ROWS) throw new ZipError(`This sheet has more than ${MAX_ROWS.toLocaleString('en-ZA')} rows. Split it into smaller files.`);
    const cells: string[] = [];
    let nextCol = 0;
    for (const cell of (row[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = attr(cell[1]!, 'r');
      const col = ref ? columnOf(ref) : nextCol;
      nextCol = col + 1;
      if (col < 0 || col > 200) continue;
      const value = cellValue(cell[1]!, cell[2] ?? '', shared);
      if (value !== '') {
        while (cells.length < col) cells.push('');
        cells[col] = value;
      }
    }
    table[index] = cells;
  }
  for (let i = 0; i < table.length; i++) if (!table[i]) table[i] = [];
  return table;
}

function resolvePart(target: string): string {
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** The sheets of a workbook, each read only when asked for. */
export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const files = await readZip(bytes);
  const text = async (name: string) => {
    const f = files.get(name);
    return f ? new TextDecoder().decode(await f()) : null;
  };
  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw new ZipError('This is not an Excel workbook (.xlsx).');
  const rels = (await text('xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map<string, { target: string; type: string }>();
  for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1]!, 'Id');
    const target = attr(m[1]!, 'Target');
    if (id && target) targets.set(id, { target, type: attr(m[1]!, 'Type') ?? '' });
  }

  let shared: string[] | null = null;
  const sharedStrings = async () => {
    if (shared) return shared;
    const rel = [...targets.values()].find((t) => t.type.endsWith('/sharedStrings'));
    const xml = (await text(rel ? resolvePart(rel.target) : 'xl/sharedStrings.xml')) ?? '';
    shared = [...xml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => itemText(m[1]!));
    return shared;
  };

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
    const name = attr(m[1]!, 'name') ?? `Sheet ${sheets.length + 1}`;
    const rid = attr(m[1]!, 'id');
    const target = rid ? targets.get(rid)?.target : null;
    const path = target ? resolvePart(target) : `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const state = attr(m[1]!, 'state');
    sheets.push({
      name,
      hidden: state === 'hidden' || state === 'veryHidden',
      read: async () => {
        const xml = await text(path);
        if (xml === null) throw new ZipError(`The sheet “${name}” could not be found in this workbook.`);
        return parseSheetXml(xml, await sharedStrings());
      },
    });
  }
  if (!sheets.length) throw new ZipError('This workbook has no sheets.');
  return sheets;
}

// ── Writing (our template) ─────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const columnName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** The styles the template uses, by index into cellXfs. */
export const XLSX_STYLE = { normal: 0, header: 1, text: 2, wrap: 3, title: 4, strong: 5 } as const;

export type WriteSheet = {
  name: string;
  /** Rows of cells: text, or text with a style. */
  rows: Array<Array<string | { text: string; style: number }>>;
  /** Column widths in characters, and a style for empty cells in the column. */
  columns?: Array<{ width: number; style?: number }>;
  /** Keep the first row in view while scrolling. */
  freezeHeader?: boolean;
  /** A drop-down list of allowed values for a range, e.g. E2:E20000. */
  lists?: Array<{ range: string; values: string[]; prompt?: string }>;
  /** Merged ranges, e.g. A1:D1. */
  merges?: string[];
  /** Row heights in points, by zero-based row index. */
  heights?: Record<number, number>;
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFCD2837"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sheet: WriteSheet): string {
  const views = sheet.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const cols = sheet.columns?.length
    ? `<cols>${sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"${c.style ? ` style="${c.style}"` : ''}/>`).join('')}</cols>`
    : '';
  const rows = sheet.rows.map((cells, r) => `<row r="${r + 1}"${sheet.heights?.[r] ? ` ht="${sheet.heights[r]}" customHeight="1"` : ''}>${cells.map((cell, c) => {
    const { text, style } = typeof cell === 'string' ? { text: cell, style: 0 } : cell;
    if (text === '' && !style) return '';
    return `<c r="${columnName(c)}${r + 1}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  const lists = sheet.lists?.length
    ? `<dataValidations count="${sheet.lists.length}">${sheet.lists.map((l) => `<dataValidation type="list" errorStyle="warning" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Not on the list" error="Choose from the list, or keep your value if you are sure."${l.prompt ? ` promptTitle="Department" prompt="${esc(l.prompt)}"` : ''} sqref="${l.range}"><formula1>"${esc(l.values.join(','))}"</formula1></dataValidation>`).join('')}</dataValidations>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${views}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${merges}${lists}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

/** A workbook Excel opens without complaint: inline text, our few styles, drop-down lists. */
export function writeXlsx(sheets: WriteSheet[]): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  return writeZip([
    { name: '[Content_Types].xml', data: content },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}
