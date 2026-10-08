import 'server-only';
import type { FineFilters } from '@criticom/api';
import { amountDue, FINE_STATUSES, fineStage, NOTICE_TYPES, maskId, rand, saDate, type Fine, type FineStatus } from '@criticom/db';
import type { FineNoticeType } from '@criticom/db';

/**
 * The fines register's filters, read from and written to the URL so a
 * filtered view can be bookmarked, shared and exported exactly as shown.
 */

export type FineQuery = {
  q?: string;
  type?: FineNoticeType;
  status?: FineStatus;
  /** Open past the pay-by date (0058); chosen as the "Overdue" status. */
  overdue?: boolean;
  from?: string;
  to?: string;
  /** Only the fines I issued. */
  mine?: boolean;
  /** today | 7d | 30d | month — a quick period, overridden by from/to. */
  period?: 'today' | '7d' | '30d' | 'month';
  officer?: string;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readFineQuery(params: Params, prefix = ''): FineQuery {
  const type = one(params[`${prefix}type`]);
  const status = one(params[`${prefix}status`]);
  const from = one(params[`${prefix}from`]);
  const to = one(params[`${prefix}to`]);
  const period = one(params[`${prefix}period`]);
  return {
    q: one(params[`${prefix}q`])?.slice(0, 60),
    type: NOTICE_TYPES.some((n) => n.type === type) ? (type as FineNoticeType) : undefined,
    status: FINE_STATUSES.includes(status as FineStatus) ? (status as FineStatus) : undefined,
    overdue: status === 'Overdue',
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
    mine: one(params[`${prefix}mine`]) === '1',
    period: period === 'today' || period === '7d' || period === '30d' || period === 'month' ? period : undefined,
    officer: one(params[`${prefix}officer`])?.slice(0, 80),
  };
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The API filters for a query: a period becomes dates; "mine" becomes the issuer. */
export function toFineFilters(q: FineQuery, userId: string, limit = 1000): FineFilters {
  const today = saDate(new Date());
  let from = q.from;
  let to = q.to;
  if (!from && !to && q.period) {
    to = today;
    from = q.period === 'today' ? today
      : q.period === '7d' ? addDays(today, -6)
      : q.period === '30d' ? addDays(today, -29)
      : `${today.slice(0, 7)}-01`;
  }
  return {
    search: q.q, noticeType: q.type, status: q.status, overdue: q.overdue, from, to,
    issuedBy: q.mine ? userId : undefined, limit,
  };
}

export function fineQueryString(q: FineQuery, prefix = '', extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string | undefined) => { if (v) p.set(`${prefix}${k}`, v); };
  put('q', q.q); put('type', q.type); put('status', q.overdue ? 'Overdue' : q.status); put('from', q.from); put('to', q.to);
  put('period', q.period); put('officer', q.officer);
  if (q.mine) p.set(`${prefix}mine`, '1');
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The officer filter is applied after the query: it matches the issuing officer's name. */
export function byOfficer(rows: Fine[], officer?: string): Fine[] {
  if (!officer) return rows;
  return rows.filter((r) => (r.issued_by_name ?? '') === officer);
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // A leading = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * The register as CSV. ID numbers are masked unless the reader may see them
 * in full; the export is for reporting, and the record itself stays in the
 * system.
 */
export function finesCsv(rows: Fine[], paid: Map<string, number>, opts: { fullIds: boolean }): string {
  const head = [
    'Fine number', 'Notice type', 'Notice number', 'Served (SAST)', 'Status', 'Infringer', 'ID type', 'ID number',
    'Vehicle', 'Offence code', 'Offence', 'Amount', 'Discount', 'Paid', 'Pay by', 'Court', 'Court date',
    'Street', 'Suburb', 'Latitude', 'Longitude', 'Officer', 'Infrastructure no.', 'Amount source',
    'Cancelled by', 'Cancel reason', 'Captured from', 'Stage', 'Owing now',
  ];
  const lines = rows.map((r) => [
    r.fine_number, r.notice_type, r.notice_number,
    new Date(r.issued_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }),
    r.status, r.offender_name, r.offender_id_type, opts.fullIds ? r.offender_id_number : maskId(r.offender_id_number),
    r.vehicle_reg, r.offence_code, r.offence_description, Number(r.amount).toFixed(2), Number(r.discount_amount).toFixed(2),
    (paid.get(r.id) ?? 0).toFixed(2), r.due_date, r.court_name, r.court_date, r.street_a, r.suburb, r.latitude, r.longitude,
    r.issued_by_name, r.officer_infrastructure_no, r.amount_source, r.cancelled_by_name, r.cancel_reason, r.captured_from,
    fineStage(r), r.status === 'Paid' || r.status === 'Cancelled' ? '0.00' : Math.max(0, amountDue(r) - (paid.get(r.id) ?? 0)).toFixed(2),
  ].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...lines].join('\r\n');
}

export { rand };

/* ── One person's or one vehicle's account (0058) ─────────────────────── */

export type AccountKey = { id?: string; reg?: string };

export function readAccountKey(params: Record<string, string | string[] | undefined>): AccountKey | null {
  const id = one(params.id)?.replace(/\s/g, '').toUpperCase();
  const reg = one(params.reg)?.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if ((!id || id.length < 6) && (!reg || reg.length < 3)) return null;
  return { id: id && id.length >= 6 ? id : undefined, reg: reg && reg.length >= 3 ? reg : undefined };
}

export function accountQueryString(key: AccountKey): string {
  const p = new URLSearchParams();
  if (key.id) p.set('id', key.id);
  if (key.reg) p.set('reg', key.reg);
  return `?${p.toString()}`;
}
