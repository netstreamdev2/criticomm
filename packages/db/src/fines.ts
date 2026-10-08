/**
 * Fines (migration 0057): the rules a notice is served under, shared by the
 * phone that issues it and the console that keeps the register. The database
 * checks everything again in issue_fines() and has the final word; these let
 * each screen say what is wrong before the officer presses Submit.
 *
 * The law, as it stands for eThekwini from 1 July 2026 (AARTO Phase 2):
 *   • Road traffic offences — AARTO 01 infringement notice, served in person.
 *     Pay the discounted amount (50%) within 32 days, or apply to pay in
 *     instalments (AARTO 04), or make a representation (AARTO 08). After 32
 *     days a courtesy letter adds a fee and the discount falls away; after
 *     that an enforcement order blocks licence and registration renewals.
 *   • Municipal by-law offences — still the Criminal Procedure Act. Section 56
 *     written notice when the offender is present (pay the admission of guilt
 *     amount, or appear in court on the date given), or a Section 341 notice
 *     left on an unattended vehicle.
 */

import type { Database, FineNoticeType } from './types.generated';

export type Fine = Database['public']['Tables']['fines']['Row'];
export type FineOffence = Database['public']['Tables']['fine_offences']['Row'];
export type FineStatus = Fine['status'];

export const FINE_STATUSES: readonly FineStatus[] = ['Unpaid', 'Partially Paid', 'Paid', 'Disputed', 'Cancelled'];

export const NOTICE_TYPES: ReadonlyArray<{
  type: FineNoticeType;
  label: string;
  /** What it is for, in a line the officer reads when choosing. */
  use: string;
  /** The law it is issued under, printed on the slip. */
  law: string;
  regime: FineOffence['regime'];
  /** Whether a person is there to identify and to sign. */
  personPresent: boolean;
}> = [
  {
    type: 'AARTO 01', label: 'AARTO 01 · Road traffic', use: 'A road traffic offence, driver present.',
    law: 'Infringement notice issued in terms of section 17(1) of the AARTO Act, 1998',
    regime: 'AARTO', personPresent: true,
  },
  {
    type: 'Section 56', label: 'Section 56 · By-law', use: 'A by-law offence, offender present.',
    law: 'Written notice to appear in court, section 56 of the Criminal Procedure Act, 1977',
    regime: 'By-law', personPresent: true,
  },
  {
    type: 'Section 341', label: 'Section 341 · Unattended vehicle', use: 'A by-law offence by a vehicle with nobody present.',
    law: 'Notice in terms of section 341 of the Criminal Procedure Act, 1977',
    regime: 'By-law', personPresent: false,
  },
];

export function noticeInfo(type: FineNoticeType) {
  return NOTICE_TYPES.find((n) => n.type === type) ?? NOTICE_TYPES[0]!;
}

export const ID_TYPES: ReadonlyArray<NonNullable<Fine['offender_id_type']>> = ['RSA ID', 'Passport', 'Driving licence', 'Foreign ID'];
/** Driving licence codes as printed on the AARTO 01. */
export const LICENCE_CODES = ['A1', 'A', 'B', 'C1', 'C', 'EB', 'EC1', 'EC', 'None'] as const;
/** Professional driving permit categories: goods, passengers, dangerous goods. */
export const PRDP_CODES = ['G', 'P', 'D'] as const;
export const FINE_VEHICLE_TYPES = ['Light motor vehicle', 'Motorcycle', 'Minibus taxi', 'Bus', 'Light delivery vehicle', 'Truck', 'Truck-tractor', 'Trailer', 'Other'] as const;
export const DIRECTIONS = ['North', 'South', 'East', 'West', 'Inbound', 'Outbound'] as const;

/** The AARTO 01 notes page, kept as observations on the record. */
export const OBSERVATION_FIELDS: ReadonlyArray<{ key: string; label: string; hint: string }> = [
  { key: 'driver_description', label: 'Description of driver', hint: 'Hair, glasses, build' },
  { key: 'passengers', label: 'Number of passengers', hint: '' },
  { key: 'weather', label: 'Weather', hint: 'Clear, rain, fog' },
  { key: 'road_conditions', label: 'Road / street conditions', hint: 'Dry, wet, potholes' },
  { key: 'traffic_conditions', label: 'Traffic conditions', hint: 'Light, heavy, congested' },
  { key: 'witnesses', label: 'Witnesses', hint: 'Name and contact number' },
];

/** AARTO: the discounted amount applies when paid within this many days of service. */
export const AARTO_DISCOUNT_DAYS = 32;
/** Section 341: days given to pay before the matter goes to court. */
export const S341_PAY_DAYS = 30;
/** Charges one notice can carry (each gets its own number). */
export const MAX_CHARGES = 3;

// ── Identification ──────────────────────────────────────────────────────

/** A South African ID number: 13 digits, a real birth date, and a Luhn check digit. */
export function isValidRsaId(raw: string | null | undefined): boolean {
  const id = (raw ?? '').replace(/\s/g, '');
  if (!/^\d{13}$/.test(id)) return false;
  const month = Number(id.slice(2, 4));
  const day = Number(id.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[12 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * What an RSA ID number says about its holder, to fill the form: date of
 * birth (century inferred against today), gender (sequence 5000+ is male),
 * and whether the holder is a citizen.
 */
export function rsaIdDetails(raw: string, today: Date = new Date()): { dob: string; gender: 'Male' | 'Female'; citizen: boolean } | null {
  const id = raw.replace(/\s/g, '');
  if (!isValidRsaId(id)) return null;
  const yy = Number(id.slice(0, 2));
  const thisYY = today.getFullYear() % 100;
  const century = yy > thisYY ? 1900 : 2000;
  const dob = `${century + yy}-${id.slice(2, 4)}-${id.slice(4, 6)}`;
  return { dob, gender: Number(id.slice(6, 10)) >= 5000 ? 'Male' : 'Female', citizen: id[10] === '0' };
}

/** Registrations are compared without spaces or dashes: "ND 123-456" → "ND123456". */
export function normaliseReg(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Initials from first names: "Bongani Sipho" → "BS". */
export function initialsOf(firstNames: string): string {
  return firstNames.trim().split(/\s+/).filter(Boolean).map((n) => n[0]!.toUpperCase()).join('');
}

// ── Money and dates ─────────────────────────────────────────────────────

export function discountFor(type: FineNoticeType, amount: number): number {
  return type === 'AARTO 01' ? Math.round(amount * 50) / 100 : 0;
}

/** A calendar date (YYYY-MM-DD) in South Africa, where every notice is served. */
export function saDate(at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  // SAST is UTC+2 all year (no daylight saving).
  return new Date(d.getTime() + 2 * 3600_000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The date the slip tells the infringer to pay by. Mirrors issue_fines(). */
export function payByDate(type: FineNoticeType, issuedAt: Date | string, courtDate?: string | null): string | null {
  const day = saDate(issuedAt);
  if (type === 'AARTO 01') return addDays(day, AARTO_DISCOUNT_DAYS);
  if (type === 'Section 56') return courtDate ?? null;
  return addDays(day, S341_PAY_DAYS);
}

/** What is owed today: the AARTO discount while the 32 days run. Mirrors fine_amount_due(). */
export function amountDue(fine: Pick<Fine, 'notice_type' | 'amount' | 'discount_amount' | 'issued_at'>, now: Date = new Date()): number {
  return amountDueOn(fine, saDate(now));
}

/**
 * What a fine costs on a South African day: the AARTO discount through the
 * 32nd day after service, the full penalty after. Mirrors fine_amount_due_on() (0058).
 */
export function amountDueOn(fine: Pick<Fine, 'notice_type' | 'amount' | 'discount_amount' | 'issued_at'>, day: string): number {
  const amount = Number(fine.amount);
  if (fine.notice_type !== 'AARTO 01') return amount;
  return day <= addDays(saDate(fine.issued_at), AARTO_DISCOUNT_DAYS) ? amount - Number(fine.discount_amount) : amount;
}

// ── Where a fine stands (0058) ──────────────────────────────────────────

export type FineStage =
  | 'Discount period' | 'Courtesy letter' | 'Enforcement order'
  | 'Awaiting court' | 'Court date passed'
  | 'Open' | 'Overdue'
  | 'Representation' | 'Paid' | 'Cancelled';

/** What each stage means, for a tooltip or the line under a fine. */
export const STAGE_INFO: Record<FineStage, { tone: 'ok' | 'warn' | 'bad' | 'done' | 'muted'; means: string }> = {
  'Discount period': { tone: 'ok', means: 'Within 32 days of service: the 50% discount applies.' },
  'Courtesy letter': { tone: 'warn', means: 'Past 32 days unpaid: the discount has fallen away and a courtesy letter is due.' },
  'Enforcement order': { tone: 'bad', means: 'Past the courtesy letter period: an enforcement order may block licence and registration renewals.' },
  'Awaiting court': { tone: 'ok', means: 'Before the court date: the admission of guilt may still be paid.' },
  'Court date passed': { tone: 'bad', means: 'The court date passed without payment: a warrant may be issued.' },
  Open: { tone: 'ok', means: 'Within the time given to pay.' },
  Overdue: { tone: 'bad', means: 'Past the date to pay: the owner may be summoned.' },
  Representation: { tone: 'warn', means: 'A representation or dispute is lodged; the clock is paused.' },
  Paid: { tone: 'done', means: 'Paid in full.' },
  Cancelled: { tone: 'muted', means: 'Cancelled, with the reason on the record.' },
};

type StageFine = Pick<Fine, 'status' | 'notice_type' | 'issued_at' | 'due_date' | 'court_date'>;

/** Where a fine stands today. Mirrors fine_stage() (0058). */
export function fineStage(fine: StageFine, today: string = saDate(new Date())): FineStage {
  if (fine.status === 'Cancelled') return 'Cancelled';
  if (fine.status === 'Paid') return 'Paid';
  if (fine.status === 'Disputed') return 'Representation';
  if (fine.notice_type === 'AARTO 01') {
    const served = saDate(fine.issued_at);
    if (today <= addDays(served, AARTO_DISCOUNT_DAYS)) return 'Discount period';
    if (today <= addDays(served, AARTO_DISCOUNT_DAYS * 2)) return 'Courtesy letter';
    return 'Enforcement order';
  }
  if (fine.notice_type === 'Section 56') {
    return !fine.court_date || today <= fine.court_date ? 'Awaiting court' : 'Court date passed';
  }
  return !fine.due_date || today <= fine.due_date ? 'Open' : 'Overdue';
}

/** Open and past its pay-by date; a representation pauses the clock. Mirrors fine_is_overdue(). */
export function isOverdue(fine: Pick<Fine, 'status' | 'due_date'>, today: string = saDate(new Date())): boolean {
  return (fine.status === 'Unpaid' || fine.status === 'Partially Paid') && Boolean(fine.due_date) && today > (fine.due_date as string);
}

/** What check_fines_owing() (0058) returns: a summary, never names or addresses. */
export type OwingCheck = {
  id_checked: boolean;
  reg_checked: string | null;
  open_count: number;
  total_owing: number;
  overdue_count: number;
  overdue_owing: number;
  disputed_count: number;
  oldest_issued: string | null;
  fines: Array<{
    fine_number: string;
    notice_type: FineNoticeType;
    issued_at: string;
    offence: string;
    vehicle_reg: string | null;
    owing: number;
    due_date: string | null;
    stage: FineStage;
    overdue: boolean;
    matched_on: 'id' | 'reg' | 'both';
  }>;
};

/**
 * "R1 500.00". Built by hand rather than with toLocaleString: the en-ZA
 * locale prints a decimal comma on some runtimes and a point on others, and a
 * slip must read the same on the phone and on the console.
 */
export function rand(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  const [whole, cents] = Math.abs(n).toFixed(2).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}R${grouped}.${cents}`;
}

/** An ID number as a list shows it: the last four digits only. */
export function maskId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length <= 4 ? id : `•••• ${id.slice(-4)}`;
}

// ── The form ────────────────────────────────────────────────────────────

export type ChargeDraft = {
  offenceId?: string | null;
  description?: string;
  /** Only used when the charge book has no amount for the offence. */
  amount?: string;
  code?: string;
};

export type NoticeDraft = {
  noticeType: FineNoticeType;
  capturedFrom?: 'device' | 'paper';
  noticeNumber?: string;
  surname?: string;
  firstNames?: string;
  idType?: Fine['offender_id_type'];
  idNumber?: string;
  vehicleReg?: string;
  street?: string;
  place?: string;
  courtName?: string;
  courtDate?: string;
  officerSignature?: string | null;
  infringerSignature?: string | null;
  infringerRefused?: boolean;
  charges: ChargeDraft[];
};

export type DraftStep = 'notice' | 'infringer' | 'vehicle' | 'offence' | 'sign';

/**
 * Everything issue_fines() would refuse, by the step of the form that fixes
 * it. An empty list means the notice can be served.
 */
export function noticeProblems(
  d: NoticeDraft,
  catalogue: ReadonlyArray<Pick<FineOffence, 'id' | 'regime' | 'penalty_amount'>> = [],
  today: string = saDate(new Date()),
): Array<{ step: DraftStep; message: string }> {
  const out: Array<{ step: DraftStep; message: string }> = [];
  const info = noticeInfo(d.noticeType);
  const paper = d.capturedFrom === 'paper';

  if (paper && !d.noticeNumber?.trim()) out.push({ step: 'notice', message: 'Enter the notice number printed in the book.' });

  if (info.personPresent) {
    if (!d.surname?.trim()) out.push({ step: 'infringer', message: 'Enter the infringer’s surname.' });
    if (!d.idType || !d.idNumber?.trim()) out.push({ step: 'infringer', message: 'Enter the identification type and number.' });
  }
  if (d.idType === 'RSA ID' && d.idNumber?.trim() && !isValidRsaId(d.idNumber)) {
    out.push({ step: 'infringer', message: 'That South African ID number is not valid. Check the 13 digits.' });
  }

  if ((d.noticeType === 'AARTO 01' || d.noticeType === 'Section 341') && !normaliseReg(d.vehicleReg)) {
    out.push({ step: 'vehicle', message: 'Enter the vehicle registration.' });
  }

  if (!d.street?.trim() && !d.place?.trim()) out.push({ step: 'offence', message: 'Say where it happened.' });
  if (d.charges.length < 1) out.push({ step: 'offence', message: 'Add the offence.' });
  if (d.charges.length > MAX_CHARGES) out.push({ step: 'offence', message: `A notice carries at most ${MAX_CHARGES} charges.` });
  d.charges.forEach((c, i) => {
    const n = d.charges.length > 1 ? `Charge ${i + 1}: ` : '';
    const off = c.offenceId ? catalogue.find((o) => o.id === c.offenceId) : undefined;
    if (!off && !c.description?.trim()) out.push({ step: 'offence', message: `${n}choose or describe the offence.` });
    if (off && off.regime !== info.regime) {
      out.push({ step: 'offence', message: `${n}that is ${off.regime === 'AARTO' ? 'a road traffic' : 'a by-law'} offence; it goes on ${off.regime === 'AARTO' ? 'an AARTO 01' : 'a Section 56 or 341'} notice.` });
    }
    if (!off || off.penalty_amount === null) {
      const amount = Number(c.amount);
      if (!c.amount?.trim() || !Number.isFinite(amount) || amount <= 0) out.push({ step: 'offence', message: `${n}enter the penalty amount.` });
      else if (amount > 100_000) out.push({ step: 'offence', message: `${n}that amount is too large for a notice.` });
    }
  });

  if (d.noticeType === 'Section 56') {
    if (!d.courtName?.trim() || !d.courtDate) out.push({ step: 'offence', message: 'Give the court and the date to appear.' });
    else if (d.courtDate <= today) out.push({ step: 'offence', message: 'The court date must be after today.' });
  }

  if (!paper) {
    if (!d.officerSignature) out.push({ step: 'sign', message: 'Sign the notice.' });
    if (info.personPresent && !d.infringerSignature && !d.infringerRefused) {
      out.push({ step: 'sign', message: 'Ask the infringer to sign, or record that they refused.' });
    }
  }
  return out;
}

// ── Figures ─────────────────────────────────────────────────────────────

export type FineFigures = {
  total: number;
  today: number;
  thisMonth: number;
  /** Rand value issued this month (cancelled excluded). */
  valueThisMonth: number;
  /** Rand value of everything issued (cancelled excluded). */
  value: number;
  outstanding: number;
  paid: number;
  cancelled: number;
  disputed: number;
  /** Open past their pay-by date, and what they still owe. */
  overdue: number;
  overdueOwing: number;
  byType: Record<FineNoticeType, number>;
  byStatus: Record<FineStatus, number>;
};

/** The KPI figures for a list of fines; payments come from the ledger. */
export function fineFigures(
  fines: ReadonlyArray<Pick<Fine, 'id' | 'notice_type' | 'amount' | 'discount_amount' | 'issued_at' | 'status' | 'due_date'>>,
  paidByFine: ReadonlyMap<string, number> = new Map(),
  now: Date = new Date(),
): FineFigures {
  const today = saDate(now);
  const month = today.slice(0, 7);
  const f: FineFigures = {
    total: fines.length, today: 0, thisMonth: 0, valueThisMonth: 0, value: 0, outstanding: 0, paid: 0,
    cancelled: 0, disputed: 0, overdue: 0, overdueOwing: 0,
    byType: { 'AARTO 01': 0, 'Section 56': 0, 'Section 341': 0 },
    byStatus: { Unpaid: 0, 'Partially Paid': 0, Paid: 0, Disputed: 0, Cancelled: 0 },
  };
  for (const fine of fines) {
    const day = saDate(fine.issued_at);
    f.byType[fine.notice_type] = (f.byType[fine.notice_type] ?? 0) + 1;
    f.byStatus[fine.status] = (f.byStatus[fine.status] ?? 0) + 1;
    if (day === today) f.today++;
    if (day.startsWith(month)) f.thisMonth++;
    if (fine.status === 'Cancelled') { f.cancelled++; continue; }
    if (fine.status === 'Disputed') f.disputed++;
    const amount = Number(fine.amount);
    f.value += amount;
    if (day.startsWith(month)) f.valueThisMonth += amount;
    const paid = paidByFine.get(fine.id) ?? 0;
    f.paid += paid;
    const owing = fine.status === 'Paid' ? 0 : Math.max(0, amountDue(fine, now) - paid);
    f.outstanding += owing;
    if (isOverdue(fine, today)) { f.overdue++; f.overdueOwing += owing; }
  }
  return f;
}

// ── Payments from a file (0058) ─────────────────────────────────────────

export type PaymentField = 'reference' | 'amount' | 'paid_on' | 'receipt' | 'method' | 'note';

/** The payments template's columns, and the headings cashiers' and banks' files use. */
export const PAYMENT_COLUMNS: Array<{ field: PaymentField; header: string; required: boolean; help: string; aliases: string[]; example?: string }> = [
  { field: 'reference', header: 'Fine or notice number', required: true, help: 'The FN- number, or the notice number printed on the slip.', aliases: ['fine number', 'fine no', 'notice number', 'notice no', 'reference', 'ref', 'fine', 'infringement notice', 'payment reference'], example: 'FN-0042' },
  { field: 'amount', header: 'Amount', required: true, help: 'Rand paid, e.g. 250.00.', aliases: ['amount paid', 'paid', 'value', 'rand', 'amount r', 'payment amount'], example: '250.00' },
  { field: 'paid_on', header: 'Date paid', required: true, help: 'The date on the receipt: 2026-10-07 or 07/10/2026.', aliases: ['date', 'payment date', 'paid on', 'transaction date', 'receipt date', 'value date'], example: '2026-10-07' },
  { field: 'receipt', header: 'Receipt number', required: true, help: 'The receipt or bank transaction reference. A receipt already recorded on the fine is skipped.', aliases: ['receipt', 'receipt no', 'transaction reference', 'transaction id', 'bank reference', 'trans ref'], example: 'RCPT-118204' },
  { field: 'method', header: 'Method', required: false, help: 'Cash, Card, EFT or Other. EFT if empty.', aliases: ['payment method', 'channel', 'type'], example: 'EFT' },
  { field: 'note', header: 'Note', required: false, help: 'Anything the finance desk should see.', aliases: ['notes', 'comment', 'description'] },
];

/** "R1 234,50", "1 234.50", "1,234.50" → 1234.5; anything else → null. */
export function parseRandAmount(raw: string | null | undefined): number | null {
  let s = String(raw ?? '').replace(/[R\s ]/gi, '');
  if (!s) return null;
  // A comma as the decimal mark (1234,50), or as thousands (1,234.50).
  if (/,\d{1,2}$/.test(s) && !s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A receipt date as YYYY-MM-DD: ISO, DD/MM/YYYY (South African order),
 * "7 Oct 2026", or an Excel serial day number. Null when it is not a real date.
 */
export function parsePaymentDate(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let y: number; let m: number; let d: number;
  let hit: RegExpMatchArray | null;
  if ((hit = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
    [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  } else if ((hit = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    [d, m, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  } else if ((hit = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/))) {
    d = Number(hit[1]); m = MONTHS.indexOf(hit[2]!.toLowerCase()) + 1; y = Number(hit[3]);
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel counts days from 1899-12-30.
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400_000);
    return date.toISOString().slice(0, 10);
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

export type PaymentRow = {
  line: number;
  reference: string;
  amount: number;
  paid_on: string;
  receipt: string;
  method: 'Cash' | 'Card' | 'EFT' | 'Other';
  note: string;
};

/** Read the rows of a payments file; each row is either ready or says what is wrong with it. */
export function checkPaymentRows(
  rows: ReadonlyArray<{ line: number } & Partial<Record<PaymentField, string>>>,
  today: string = saDate(new Date()),
): Array<{ line: number; row: PaymentRow | null; problem: string | null; raw: Partial<Record<PaymentField, string>> }> {
  const seen = new Set<string>();
  return rows.map((r) => {
    const reference = (r.reference ?? '').replace(/\s/g, '').toUpperCase();
    const amount = parseRandAmount(r.amount);
    const paidOn = parsePaymentDate(r.paid_on);
    const receipt = (r.receipt ?? '').trim();
    const methodRaw = (r.method ?? '').trim().toLowerCase();
    const method = (['cash', 'card', 'eft', 'other'].includes(methodRaw)
      ? (methodRaw === 'eft' ? 'EFT' : methodRaw[0]!.toUpperCase() + methodRaw.slice(1))
      : methodRaw ? null : 'EFT') as PaymentRow['method'] | null;
    const key = `${reference}|${receipt.toUpperCase()}`;
    let problem: string | null = null;
    if (!reference) problem = 'No fine or notice number.';
    else if (amount === null || amount <= 0) problem = 'The amount is not a number above zero.';
    else if (!paidOn) problem = 'The date paid is not a date.';
    else if (paidOn > today) problem = 'The date paid is in the future.';
    else if (!receipt) problem = 'No receipt number.';
    else if (!method) problem = 'The method must be Cash, Card, EFT or Other.';
    else if (seen.has(key)) problem = 'The same receipt for the same fine appears twice in this file.';
    seen.add(key);
    return {
      line: r.line,
      raw: r,
      problem,
      row: problem ? null : { line: r.line, reference, amount: amount as number, paid_on: paidOn as string, receipt, method: method as PaymentRow['method'], note: (r.note ?? '').trim() },
    };
  });
}

/** What import_fine_payments() says about a row. */
export const IMPORT_OUTCOMES: Record<string, string> = {
  recorded: 'Recorded',
  no_match: 'No fine with that number',
  ambiguous: 'More than one fine has that number',
  cancelled: 'The fine is cancelled',
  duplicate: 'This receipt is already recorded on the fine',
  before_issue: 'Dated before the fine was issued',
  bad_amount: 'The amount is not above zero',
  bad_date: 'The date is missing or in the future',
  bad_value: 'The amount or date could not be read',
  bad_method: 'Unknown payment method',
  no_reference: 'No fine or notice number',
  no_receipt: 'No receipt number',
  failed: 'The database refused it',
};
