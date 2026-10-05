/**
 * Reading a register (staff, firearms, vehicles) out of a spreadsheet grid:
 * which column holds what, where the headings are, and the rows under them.
 * Pure functions, shared by every import.
 */

export type SheetColumn<F extends string> = {
  field: F;
  /** The heading in our template. */
  header: string;
  required: boolean;
  /** What to put in it, for the template's instructions. */
  help: string;
  /** Other headings people's own spreadsheets use for the same thing. */
  aliases: string[];
  /** An example value for the template's instructions. */
  example?: string;
};

/** A heading reduced to plain words: case, punctuation, "(required)" and "*" forgiven. */
export function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type SheetHeaderMap<F extends string> = {
  columns: Partial<Record<F, number>>;
  /** Headings not recognised: their columns are ignored, never read into a row. */
  ignored: string[];
  missing: F[];
};

/** Which column holds what. Each field takes the first column that matches. */
export function mapSheetHeaders<F extends string>(headers: string[], spec: SheetColumn<F>[]): SheetHeaderMap<F> {
  const found = new Map<F, number>();
  const ignored: string[] = [];
  headers.forEach((raw, i) => {
    const h = normaliseHeader(raw ?? '');
    if (!h) return;
    const col = spec.find((c) => normaliseHeader(c.header) === h || c.aliases.includes(h));
    if (col && !found.has(col.field)) found.set(col.field, i);
    else ignored.push(String(raw).trim());
  });
  return {
    columns: Object.fromEntries(found) as Partial<Record<F, number>>,
    ignored,
    missing: spec.filter((c) => c.required && !found.has(c.field)).map((c) => c.field),
  };
}

/** Files often start with a title: the headings are the first row with at least `min` recognised columns. */
export function findSheetHeaderRow<F extends string>(table: string[][], spec: SheetColumn<F>[], min = 3, within = 10): number {
  for (let i = 0; i < Math.min(within, table.length); i++) {
    if (Object.keys(mapSheetHeaders(table[i] ?? [], spec).columns).length >= min) return i;
  }
  return -1;
}

export type SheetRow<F extends string> = { line: number } & Partial<Record<F, string>>;

/** The grid as rows, each keeping the row number Excel shows. Blank rows are skipped. */
export function sheetRowsFromTable<F extends string>(
  table: string[][],
  spec: SheetColumn<F>[],
  what: string,
): { ok: true; headerRow: number; header: SheetHeaderMap<F>; rows: SheetRow<F>[] } | { ok: false; error: string } {
  const headerRow = findSheetHeaderRow(table, spec);
  const required = spec.filter((c) => c.required).map((c) => c.header).join(', ');
  if (headerRow < 0) {
    return { ok: false, error: `No column headings found. The first rows should name the columns, as in the ${what} template: ${required}.` };
  }
  const header = mapSheetHeaders(table[headerRow] ?? [], spec);
  if (header.missing.length) {
    const names = header.missing.map((f) => spec.find((c) => c.field === f)?.header ?? f);
    return { ok: false, error: `These columns are missing: ${names.join(', ')}. Use the template, or rename the columns to match it.` };
  }
  const rows: SheetRow<F>[] = [];
  for (let i = headerRow + 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    if (!cells.some((c) => String(c ?? '').trim())) continue;
    const row = { line: i + 1 } as SheetRow<F>;
    for (const [field, col] of Object.entries(header.columns) as Array<[F, number]>) {
      const v = cells[col];
      if (v !== undefined && v !== null && String(v).trim()) (row as Record<string, unknown>)[field] = String(v);
    }
    rows.push(row);
  }
  return { ok: true, headerRow, header, rows };
}

/** Letters and digits only, in capitals: how serials, units and badges are matched. */
export function matchKey(value: string | null | undefined): string {
  return (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
