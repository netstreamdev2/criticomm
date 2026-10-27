/**
 * A spreadsheet of councillors, however the office laid it out: find the
 * ward, name, cellphone and email columns by their headings, and keep the
 * rows that have a name. The database checks each row again on the way in.
 */

export type CouncillorRow = { ward: string; name: string; phone: string; email: string };

const HEADINGS: Record<keyof CouncillorRow, RegExp> = {
  ward: /^ward(\s*(no|number|#))?\.?$/i,
  name: /^(councillor|councillor name|name|full name|names)$/i,
  phone: /^(cell|cellphone|cell phone|cell no|mobile|mobile number|phone|telephone|tel|contact|contact number)\.?$/i,
  email: /^(e-?mail|email address)$/i,
};

/** The first row that names a name column is the heading row; the rows below it are councillors. */
export function councillorRows(table: string[][]): { rows: CouncillorRow[]; missing: Array<keyof CouncillorRow> } {
  const head = table.findIndex((r) => r.some((c) => HEADINGS.name.test(c.trim())));
  if (head < 0) return { rows: [], missing: ['name'] };
  const cols = Object.fromEntries((Object.keys(HEADINGS) as Array<keyof CouncillorRow>)
    .map((k) => [k, table[head]!.findIndex((c) => HEADINGS[k].test(c.trim()))])) as Record<keyof CouncillorRow, number>;
  const cell = (r: string[], k: keyof CouncillorRow) => (cols[k] >= 0 ? (r[cols[k]] ?? '').trim() : '');
  const rows = table.slice(head + 1)
    .map((r) => ({ ward: cell(r, 'ward').replace(/^ward\s*/i, ''), name: cell(r, 'name'), phone: cell(r, 'phone'), email: cell(r, 'email') }))
    .filter((r) => r.name.length >= 2);
  return { rows, missing: (Object.keys(cols) as Array<keyof CouncillorRow>).filter((k) => cols[k] < 0 && k !== 'email') };
}
