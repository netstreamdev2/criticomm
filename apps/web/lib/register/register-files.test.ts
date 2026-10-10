import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { checkStaffList, staffRowsFromTable } from '@criticom/db/register';
import { decodeText, guessDelimiter, parseCsv } from './csv.ts';
import { readStaffFile, sha256Hex } from './file.ts';
import { buildStaffListTemplate } from './template.ts';
import { parseSheetXml, readXlsx, writeXlsx, xmlText } from './xlsx.ts';
import { crc32, readZip, writeZip } from './zip.ts';

const enc = (s: string) => new TextEncoder().encode(s);

test('CSV: quotes, separators inside fields, line breaks and every separator Excel uses', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('"two\nlines",x'), [['two\nlines', 'x']]);
  assert.equal(guessDelimiter('Surname;First names;Badge\nA;B;C'), ';');
  assert.equal(guessDelimiter('Surname\tFirst names\tBadge'), '\t');
  assert.equal(guessDelimiter('"a;b",c,d'), ',', 'separators inside quotes do not count');
  assert.deepEqual(parseCsv('x,y'), [['x', 'y']], 'no final line break');
});

test('text from Excel in any of its encodings', () => {
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('Zoë')])), 'Zoë', 'CSV UTF-8 with its BOM');
  assert.equal(decodeText(new Uint8Array([0x5a, 0x6f, 0xeb])), 'Zoë', 'plain CSV is Windows-1252');
  const utf16 = new Uint8Array([0xff, 0xfe, 0x5a, 0, 0x6f, 0, 0xeb, 0]);
  assert.equal(decodeText(utf16), 'Zoë', '"Unicode text" is UTF-16');
});

test('zip: what we write we can read back, with a correct checksum', async () => {
  assert.equal(crc32(enc('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  const zip = writeZip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.txt', data: 'world' }]);
  const files = await readZip(zip);
  assert.deepEqual([...files.keys()], ['a.txt', 'dir/b.txt']);
  assert.equal(new TextDecoder().decode(await files.get('dir/b.txt')!()), 'world');
});

test('XML text: entities and Excel escapes', () => {
  assert.equal(xmlText('Fire &amp; Rescue &lt;3 &#233;&#x41;_x000D_'), 'Fire & Rescue <3 éA\r');
});

/** A zip with compressed entries, as Excel writes them. */
function deflatedZip(entries: Array<{ name: string; data: string }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc(e.name);
    const raw = enc(e.data);
    const data = new Uint8Array(deflateRawSync(raw));
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(14, crc32(raw), true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(16, crc32(raw), true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true); c.set(name, 46);
    parts.push(local, data); central.push(c);
    offset += local.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) { out.set(p, at); at += p.length; }
  return out;
}

const EXCEL_LIKE = deflatedZip([
  { name: 'xl/workbook.xml', data: '<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="Notes" sheetId="1" r:id="rId1"/><x:sheet name="Old" sheetId="2" r:id="rId2" state="hidden"/><x:sheet name="Staff list" sheetId="3" r:id="rId3"/></x:sheets></x:workbook>' },
  { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="t/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="t/worksheet" Target="/xl/worksheets/sheet3.xml"/><Relationship Id="rId4" Type="t/sharedStrings" Target="sharedStrings.xml"/></Relationships>' },
  { name: 'xl/sharedStrings.xml', data: '<x:sst><x:si><x:t>Surname</x:t></x:si><x:si><x:t>First names</x:t></x:si><x:si><x:t>Badge number</x:t></x:si><x:si><x:t>Rank</x:t></x:si><x:si><x:t>Department</x:t></x:si><x:si><x:t>Cellphone</x:t></x:si><x:si><x:r><x:t>DLA</x:t></x:r><x:r><x:rPr><x:b/></x:rPr><x:t xml:space="preserve">MINI</x:t></x:r><x:rPh><x:t>ignored</x:t></x:rPh></x:si><x:si><x:t>Fire &amp; Rescue</x:t></x:si></x:sst>' },
  { name: 'xl/worksheets/sheet1.xml', data: '<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Read me first</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>' },
  { name: 'xl/worksheets/sheet2.xml', data: '<x:worksheet><x:sheetData/></x:worksheet>' },
  { name: 'xl/worksheets/sheet3.xml', data: '<x:worksheet><x:sheetData>'
    + '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>eThekwini staff, October</x:t></x:is></x:c></x:row>'
    + '<x:row r="3"><x:c r="A3" t="s"><x:v>0</x:v></x:c><x:c r="B3" t="s"><x:v>1</x:v></x:c><x:c r="C3" t="s"><x:v>2</x:v></x:c><x:c r="D3" t="s"><x:v>3</x:v></x:c><x:c r="E3" t="s"><x:v>4</x:v></x:c><x:c r="F3" t="s"><x:v>5</x:v></x:c></x:row>'
    + '<x:row r="4"><x:c r="A4" t="s"><x:v>6</x:v></x:c><x:c r="B4" t="inlineStr"><x:is><x:t>Thandeka</x:t></x:is></x:c><x:c r="C4"><x:v>1042</x:v></x:c><x:c r="D4" t="str"><x:f>UPPER("constable")</x:f><x:v>CONSTABLE</x:v></x:c><x:c r="E4" t="s"><x:v>7</x:v></x:c><x:c r="F4"><x:v>8.21234567E8</x:v></x:c></x:row>'
    + '<x:row r="5"/>'
    + '<x:row r="6"><x:c r="B6" t="inlineStr"><x:is><x:t>Gap</x:t></x:is></x:c><x:c r="D6" t="b"><x:v>1</x:v></x:c><x:c r="E6" t="e"><x:v>#N/A</x:v></x:c></x:row>'
    + '</x:sheetData></x:worksheet>' },
]);

test('a workbook as Excel writes it: compressed, namespaced, shared and rich text, formulas, numbers', async () => {
  const sheets = await readXlsx(EXCEL_LIKE);
  assert.deepEqual(sheets.map((s) => [s.name, s.hidden]), [['Notes', false], ['Old', true], ['Staff list', false]]);
  const table = await sheets[2]!.read();
  assert.equal(table[0]?.[0], 'eThekwini staff, October');
  assert.deepEqual(table[1], [], 'missing rows keep their place');
  assert.deepEqual(table[3], ['DLAMINI', 'Thandeka', '1042', 'CONSTABLE', 'Fire & Rescue', '821234567']);
  assert.deepEqual(table[5], ['', 'Gap', '', 'TRUE'], 'empty cells hold their column; errors read as blank');
});

test('reading a staff file picks the staff sheet and finds the headings under a title', async () => {
  const file = await readStaffFile(EXCEL_LIKE, 'staff.xlsx');
  assert.equal(file.kind, 'xlsx');
  assert.equal(file.sheet, 'Staff list');
  assert.deepEqual(file.sheets, ['Notes', 'Staff list'], 'hidden sheets are not offered');
  const parsed = staffRowsFromTable(file.table);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.headerRow, 2);
  assert.equal(parsed.rows[0]?.line, 4, 'row numbers are Excel’s');
  const check = checkStaffList(parsed.rows, []);
  const first = check.rows[0]!;
  assert.equal(first.person.last_name, 'Dlamini');
  assert.equal(first.person.rank, 'Constable');
  assert.equal(first.person.silo, 'MetroFire');
  assert.equal(first.person.work_cellphone, '+27821234567');
  assert.equal(first.outcome, 'add');
  assert.equal(check.rows[1]?.outcome, 'attention', 'the half-filled row needs a person to look');
});

test('files we cannot read say what to do', async () => {
  const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await assert.rejects(readStaffFile(xls, 'old.xls'), /older Excel file \(\.xls\)/);
  await assert.rejects(readStaffFile(new Uint8Array(), 'empty.csv'), /empty/);
  await assert.rejects(readStaffFile(enc('not a zip'), 'fake.xlsx'), /not one/);
  await assert.rejects(readStaffFile(new Uint8Array([0x50, 0x4b, 1, 2, 3]), 'broken.xlsx'), /damaged/);
  const csv = await readStaffFile(enc('Surname;First names;Badge number;Rank;Department\nZulu;Bheki;MP-2000;Constable;Metro Police\n'), 'list.csv');
  assert.equal(csv.kind, 'csv');
  assert.equal(csv.table[1]?.[2], 'MP-2000');
  assert.equal(csv.fingerprint, await sha256Hex(enc('Surname;First names;Badge number;Rank;Department\nZulu;Bheki;MP-2000;Constable;Metro Police\n')));
  assert.match(csv.fingerprint, /^[0-9a-f]{64}$/);
});

test('our template reads back as an empty staff list with every heading', async () => {
  const bytes = buildStaffListTemplate();
  const sheets = await readXlsx(bytes);
  assert.deepEqual(sheets.map((s) => s.name), ['Staff', 'Instructions']);
  const staff = await sheets[0]!.read();
  assert.deepEqual(staff[0], ['First names', 'Surname', 'Badge number', 'Rank', 'Department', 'Station', 'Work email',
    'Work cellphone', 'Role in current system']);
  const parsed = staffRowsFromTable(staff);
  assert.ok(parsed.ok && parsed.rows.length === 0);
  const xml = new TextDecoder().decode(await (await readZip(bytes)).get('xl/worksheets/sheet1.xml')!());
  assert.match(xml, /<dataValidation type="list"[^>]*sqref="E2:E20000"><formula1>"Metro Police,Fire &amp; Rescue,EMS,Disaster Management,Control Room"<\/formula1>/);
  assert.match(xml, /<col min="3" max="3" width="18" customWidth="1" style="2"\/>/, 'badge numbers are text');
  const instructions = (await sheets[1]!.read()).map((r) => r.join(' ')).join('\n');
  assert.match(instructions, /do not add ID numbers/);
  assert.ok(!/undefined/.test(instructions));
});

test('a filled-in template goes through the whole check', async () => {
  const bytes = writeXlsx([{ name: 'Staff', rows: [
    ['First names', 'Surname', 'Badge number', 'Rank', 'Department', 'Station', 'Work email', 'Work cellphone', 'Role in current system'],
    ['LWAZI', 'CELE', 'MP-5000', 'CONSTABLE', 'Metro Police', 'DURBAN CBD', '', '082 123 4567', 'Officer'],
    ['Nomsa', 'Shabalala', 'FF 2290', 'Firefighter', 'Fire & Rescue', 'Pinetown', 'n.shabalala@durban.gov.za', '', ''],
  ] }]);
  const file = await readStaffFile(bytes, 'filled.xlsx');
  const parsed = staffRowsFromTable(file.table);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const check = checkStaffList(parsed.rows, []);
  assert.deepEqual(check.counts, { add: 2, update: 0, unchanged: 0, merged: 0, attention: 0, skipped: 0 });
  assert.equal(check.toImport[0]?.station, 'Durban CBD');
  assert.equal(check.toImport[0]?.proposed_role, 'Police');
  assert.equal(check.toImport[1]?.work_email, 'n.shabalala@durban.gov.za');
  assert.deepEqual(check.departments.sort(), ['MetroFire', 'MetroPolice']);
});

test('one worksheet parses without a shared-string table', () => {
  const t = parseSheetXml('<sheetData><row><c t="inlineStr"><is><t>a</t></is></c><c><v>2</v></c></row><row><c t="s"><v>9</v></c></row></sheetData>', []);
  assert.deepEqual(t, [['a', '2'], []], 'cells without references fill in order; unknown shared strings are blank');
});

test('the armoury and fleet templates read back with every heading, through the same import', async () => {
  const { buildFirearmsTemplate, buildVehiclesTemplate } = await import('./asset-templates.ts');
  const { FIREARM_COLUMNS, VEHICLE_COLUMNS } = await import('@criticom/db/assets');
  const { findSheetHeaderRow, sheetRowsFromTable } = await import('@criticom/db/sheet');
  const { readSpreadsheet } = await import('./file.ts');
  for (const [bytes, columns, sheet] of [
    [buildFirearmsTemplate(), FIREARM_COLUMNS, 'Firearms'],
    [buildVehiclesTemplate(), VEHICLE_COLUMNS, 'Vehicles'],
  ] as const) {
    const file = await readSpreadsheet(bytes, 't.xlsx', { sheetName: /firearm|vehicle/i, hasHeadings: (t) => findSheetHeaderRow(t, columns as never) >= 0 });
    assert.equal(file.sheet, sheet);
    assert.deepEqual(file.table[0], columns.map((c) => c.header));
    const parsed = sheetRowsFromTable(file.table, columns as never, 'test');
    assert.ok(parsed.ok && parsed.rows.length === 0);
  }
});

test('a filled-in armoury list and fleet list go through the whole check', async () => {
  const { FIREARM_COLUMNS, VEHICLE_COLUMNS, checkFirearmList, checkVehicleList } = await import('@criticom/db/assets');
  const { findSheetHeaderRow, sheetRowsFromTable } = await import('@criticom/db/sheet');
  const { readSpreadsheet } = await import('./file.ts');

  const guns = writeXlsx([{ name: 'Armoury', rows: [
    ['Serial no', 'Make', 'Model', 'Calibre', 'Type', 'Department', 'Station'],
    ['sn 48812', 'GLOCK', '17', '9MM', 'pistol', 'Metro Police', 'DURBAN CENTRAL'],
    ['R5-0091', 'Vektor', 'R5', '5.56', 'R5', 'Metro Police', 'Pinetown'],
    ['SN48812', 'Glock', '17', '9mm', 'Sidearm', 'Metro Police', 'Durban Central'],
  ] }]);
  const gunFile = await readSpreadsheet(guns, 'armoury.xlsx', { sheetName: /firearm|armou?ry/i, hasHeadings: (t) => findSheetHeaderRow(t, FIREARM_COLUMNS) >= 0 });
  const gunRows = sheetRowsFromTable(gunFile.table, FIREARM_COLUMNS, 'armoury');
  assert.ok(gunRows.ok);
  if (!gunRows.ok) return;
  const gunCheck = checkFirearmList(gunRows.rows, []);
  assert.equal(gunCheck.counts.add, 2);
  assert.equal(gunCheck.counts.merged, 1, 'the same serial typed twice is one firearm');
  assert.equal(gunCheck.toImport.find((g) => g.make === 'Vektor')?.firearm_type, 'Rifle');

  const cars = writeXlsx([{ name: 'Fleet', rows: [
    ['Unit no', 'Type', 'Department', 'Make', 'Year', 'Registration', 'Licence disc expiry'],
    ['MP-12', 'bakkie', 'Metro Police', 'Toyota', '2023', 'nd 123-456', '31/03/2027'],
    ['MP-14', 'Patrol vehicle', 'Metro Police', 'VW', '2022', 'ND123456', ''],
  ] }]);
  const carFile = await readSpreadsheet(cars, 'fleet.xlsx', { sheetName: /vehicle|fleet/i, hasHeadings: (t) => findSheetHeaderRow(t, VEHICLE_COLUMNS) >= 0 });
  const carRows = sheetRowsFromTable(carFile.table, VEHICLE_COLUMNS, 'fleet');
  assert.ok(carRows.ok);
  if (!carRows.ok) return;
  const carCheck = checkVehicleList(carRows.rows, []);
  const mp12 = carCheck.rows.find((r) => r.item.unit_number === 'MP-12');
  assert.equal(mp12?.item.type, 'Patrol vehicle');
  assert.equal(mp12?.item.disc_expiry, '2027-03-31');
  assert.ok(carCheck.counts.attention >= 1, 'one number plate on two units is flagged');
});
