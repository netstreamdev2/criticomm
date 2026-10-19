import 'server-only';
import { redirect } from 'next/navigation';
import { listPoliceReportRecords, REPORT_KINDS, REPORT_STANDINGS, type ReportFilters, type ReportStanding } from '@criticom/api';
import { mayViewPoliceReports } from '@criticom/db';
import { getSession } from './session';

/**
 * The police reporting pages' data: every police report the person may read,
 * with its call. Read with their own session, so the database decides what
 * is in it (metro_reports, 0081); the page itself opens only for police
 * dispatch, the captain, the case manager, the police administrator and the
 * system administrators.
 */
export async function loadReportCentre() {
  const session = await getSession();
  if (!mayViewPoliceReports(session.role, session.silo)) redirect('/403');
  const records = await listPoliceReportRecords(session.supabase, { limit: 5000 });
  return { ...session, records };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filters in a page's address, cleaned: an unknown value is no filter. */
export function readReportQuery(params: Record<string, string | string[] | undefined>): ReportFilters & { page: number } {
  const kinds = new Set(REPORT_KINDS.map((k) => k.id));
  const formsRaw = params.forms;
  // Ticked boxes (forms=a&forms=b) or a link's list (forms=a,b).
  const forms = [...new Set((Array.isArray(formsRaw) ? formsRaw : [formsRaw ?? '']).flatMap((v) => v.split(','))
    .map((f) => f.trim()).filter((f) => kinds.has(f)))];
  const form = one(params.form);
  const standing = one(params.standing);
  const period = one(params.period);
  const arrest = one(params.arrest);
  const from = one(params.from);
  const to = one(params.to);
  return {
    q: one(params.q)?.slice(0, 80) ?? null,
    form: form && kinds.has(form) ? form : null,
    forms: forms.length ? forms : null,
    standing: REPORT_STANDINGS.includes(standing as ReportStanding) ? (standing as ReportStanding) : null,
    period: period === 'today' || period === 'week' || period === 'month' ? period : null,
    from: from && DAY.test(from) ? from : null,
    to: to && DAY.test(to) ? to : null,
    station: one(params.station)?.slice(0, 60) ?? null,
    officer: one(params.officer)?.slice(0, 60) ?? null,
    arrest: arrest === 'Yes' || arrest === 'No' ? arrest : null,
    page: Math.max(1, Number.parseInt(one(params.page) ?? '1', 10) || 1),
  };
}

/** The filters back into an address, for links and exports; `page` left out unless given. */
export function reportQueryString(f: ReportFilters & { page?: number }, extra: Record<string, string | number | null> = {}): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string | number | null | undefined) => { if (v !== null && v !== undefined && v !== '') p.set(k, String(v)); };
  put('q', f.q); put('form', f.form); put('forms', f.forms?.join(',')); put('standing', f.standing); put('period', f.period);
  put('from', f.from); put('to', f.to); put('station', f.station); put('officer', f.officer); put('arrest', f.arrest);
  for (const [k, v] of Object.entries(extra)) put(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** In words, what a set of filters picks out (the specialised report's heading and PDF). */
export function describeFilters(f: ReportFilters): string {
  const parts: string[] = [];
  const names = (f.forms?.length ? f.forms : f.form ? [f.form] : []).map((id) => REPORT_KINDS.find((k) => k.id === id)?.label ?? id);
  parts.push(names.length ? names.join(', ') : 'All reports');
  if (f.standing) parts.push(f.standing);
  if (f.period) parts.push(f.period === 'today' ? 'today' : f.period === 'week' ? 'the last 7 days' : 'the last 30 days');
  if (f.from || f.to) parts.push(`${f.from ?? 'the start'} to ${f.to ?? 'today'}`);
  if (f.station) parts.push(`station "${f.station}"`);
  if (f.officer) parts.push(`officer "${f.officer}"`);
  if (f.arrest) parts.push(f.arrest === 'Yes' ? 'with an arrest' : 'without an arrest');
  if (f.q) parts.push(`matching "${f.q}"`);
  return parts.join(' · ');
}
