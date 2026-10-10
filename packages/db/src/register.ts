/**
 * The staff register and the staff-list import (migration 0050): the rules
 * the import page, the register screens and the database agree on. Pure
 * functions only, so the whole check runs in the administrator's browser and
 * in tests alike.
 *
 * Design: apps/web/handbook/staff-onboarding.html, "Bringing eThekwini's
 * staff across".
 */

import type { Silo, UserRole } from './types.generated';
import { DEPARTMENT_NAMES, normaliseBadge, roleDepartmentProblem, rolesInvitableBy } from './onboarding.ts';
import { POWERFUL_ROLES } from './roles.ts';
import { normaliseHeader } from './sheet.ts';

// ── The staff list's columns ────────────────────────────────────────────

export type StaffField =
  | 'first_name' | 'last_name' | 'full_name' | 'badge_number' | 'force_number' | 'rank'
  | 'department' | 'station' | 'work_email' | 'work_cellphone' | 'previous_role';

export type StaffColumn = {
  field: StaffField;
  /** The heading in our template. */
  header: string;
  required: boolean;
  /** What HR should put in it, for the template's instructions. */
  help: string;
  /** Other headings HR's own spreadsheets use for the same thing. */
  aliases: string[];
  /** Recognised in HR's own files, but not a column of our template. */
  extra?: boolean;
};

/**
 * The seven things we ask for (name split in two), plus the role each person
 * holds in the current system so a role can be suggested. Nothing else: no ID
 * numbers, home addresses or salaries.
 */
export const STAFF_LIST_COLUMNS: StaffColumn[] = [
  { field: 'first_name', header: 'First names', required: true,
    help: 'As on the HR record.',
    aliases: ['first name', 'first names', 'firstname', 'firstnames', 'given name', 'given names', 'forename', 'forenames', 'name'] },
  { field: 'last_name', header: 'Surname', required: true,
    help: 'As on the HR record.',
    aliases: ['surname', 'last name', 'lastname', 'family name'] },
  { field: 'badge_number', header: 'Badge number', required: true,
    help: 'Or force number, exactly as on their appointment letter or ID card: it is how they prove who they are.',
    aliases: ['badge number', 'badge no', 'badge nr', 'badge'] },
  { field: 'rank', header: 'Rank', required: true,
    help: 'Their rank or post, e.g. Constable, Station Officer, Paramedic.',
    aliases: ['rank', 'job title', 'post', 'designation', 'position'] },
  { field: 'department', header: 'Department', required: true,
    help: 'Metro Police, Fire & Rescue, EMS / Medical, Disaster Management or Control Room.',
    aliases: ['department', 'dept', 'directorate', 'division', 'service'] },
  { field: 'station', header: 'Station', required: false,
    help: 'Where they report for duty, e.g. Durban Central.',
    aliases: ['station', 'base', 'depot', 'office', 'work station', 'location'] },
  { field: 'work_email', header: 'Work email', required: false,
    help: 'Their municipal email, if they have one. Their invitation goes here, and they sign in with it.',
    aliases: ['work email', 'email', 'e mail', 'email address', 'e mail address', 'work e mail'] },
  { field: 'work_cellphone', header: 'Work cellphone', required: false,
    help: 'Used for an SMS invitation when there is no email. Leave blank if unknown.',
    aliases: ['work cellphone', 'cellphone', 'cell', 'cell number', 'cell phone', 'cellphone number', 'mobile', 'mobile number', 'phone', 'phone number', 'contact number'] },
  { field: 'previous_role', header: 'Role in current system', required: false,
    help: 'Their role in today\'s Criticomm system, e.g. Officer or Operator. Optional: it is used to suggest their new role.',
    aliases: ['role in current system', 'current system role', 'criticomm role', 'system role', 'current role', 'old role', 'role'] },
  { field: 'force_number', header: 'Force number', required: false, extra: true,
    help: '', aliases: ['force number', 'force no', 'force nr'] },
  { field: 'full_name', header: 'Full name', required: false, extra: true,
    help: '', aliases: ['full name', 'full names', 'name and surname', 'names'] },
];

export { normaliseHeader };

export type HeaderMap = {
  /** Column index for each field found. */
  columns: Partial<Record<StaffField, number>>;
  /** Headings we did not recognise (their columns are ignored). */
  ignored: string[];
  /** Required fields with no column. */
  missing: StaffField[];
  /** One "Name" column holding the whole name, split at the last space. */
  fullNameOnly: boolean;
  /** The badge column is really a force-number column. */
  badgeFromForceNumber: boolean;
};

/** Which column holds what. Each field takes the first column that matches. */
export function mapHeaders(headers: string[]): HeaderMap {
  const found = new Map<StaffField, number>();
  const ignored: string[] = [];
  headers.forEach((raw, i) => {
    const h = normaliseHeader(raw ?? '');
    if (!h) return;
    const col = STAFF_LIST_COLUMNS.find((c) => normaliseHeader(c.header) === h || c.aliases.includes(h));
    if (col && !found.has(col.field)) found.set(col.field, i);
    else ignored.push(String(raw).trim());
  });

  let fullNameOnly = false;
  if (!found.has('last_name')) {
    const first = found.get('first_name');
    if (found.has('full_name')) {
      fullNameOnly = true;
      found.delete('first_name');
    } else if (first !== undefined && normaliseHeader(headers[first] ?? '') === 'name') {
      // A lone "Name" column is the whole name.
      found.set('full_name', first);
      found.delete('first_name');
      fullNameOnly = true;
    }
  }
  let badgeFromForceNumber = false;
  const force = found.get('force_number');
  if (!found.has('badge_number') && force !== undefined) {
    found.set('badge_number', force);
    found.delete('force_number');
    badgeFromForceNumber = true;
  }

  const missing = STAFF_LIST_COLUMNS
    .filter((c) => c.required && !found.has(c.field))
    .filter((c) => !(fullNameOnly && (c.field === 'first_name' || c.field === 'last_name')))
    .map((c) => c.field);
  const columns = Object.fromEntries(found) as Partial<Record<StaffField, number>>;
  return { columns, ignored, missing, fullNameOnly, badgeFromForceNumber };
}

/** HR files often start with a title or a blank line: the headings are the first row we can read. */
export function findHeaderRow(table: string[][], within = 10): number {
  for (let i = 0; i < Math.min(within, table.length); i++) {
    const m = mapHeaders(table[i] ?? []);
    if (Object.keys(m.columns).length >= 3) return i;
  }
  return -1;
}

/**
 * A spreadsheet's grid as staff rows. Each row keeps the number Excel shows
 * for it, so "row 57" on screen is row 57 in the file. Blank rows are skipped.
 */
export function staffRowsFromTable(
  table: string[][],
): { ok: true; headerRow: number; header: HeaderMap; rows: RawStaffRow[] } | { ok: false; error: string } {
  const headerRow = findHeaderRow(table);
  if (headerRow < 0) {
    return { ok: false, error: 'No column headings found. The first rows should name the columns, as in the template: First names, Surname, Badge number, Rank, Department.' };
  }
  const header = mapHeaders(table[headerRow] ?? []);
  if (header.missing.length) {
    const names = header.missing.map((f) => STAFF_LIST_COLUMNS.find((c) => c.field === f)?.header ?? f);
    return { ok: false, error: `These columns are missing: ${names.join(', ')}. Use the template, or rename the columns to match it.` };
  }
  const rows: RawStaffRow[] = [];
  for (let i = headerRow + 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    if (!cells.some((c) => String(c ?? '').trim())) continue;
    const row: RawStaffRow = { line: i + 1 };
    for (const [field, col] of Object.entries(header.columns) as Array<[StaffField, number]>) {
      const v = cells[col];
      if (v !== undefined && v !== null && String(v).trim()) row[field] = String(v);
    }
    rows.push(row);
  }
  return { ok: true, headerRow, header, rows };
}

// ── Tidying single values ───────────────────────────────────────────────

const tidySpaces = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

const PARTICLES = new Set(['van', 'der', 'den', 'de', 'du', 'le', 'la', 'von', 'da', 'dos', 'das', 'te', 'ter']);

/**
 * Names and ranks typed in capitals ("THANDEKA DLAMINI") read as names do
 * ("Thandeka Dlamini"). Anything already in mixed case is left exactly as
 * HR typed it.
 */
export function tidyName(value: unknown): string {
  const v = tidySpaces(value);
  if (!onlyOneCase(v)) return v;
  return v.toLowerCase().split(' ').map((word, i) => (i > 0 && PARTICLES.has(word) ? word : capitalise(word))).join(' ');
}

/**
 * Ranks and stations in capitals read as words, but short words stay as they
 * are: "ALS PARAMEDIC" → "ALS Paramedic", "DURBAN CBD" → "Durban CBD".
 */
export function tidyLabel(value: unknown): string {
  const v = tidySpaces(value);
  if (!onlyOneCase(v)) return v;
  return v.split(' ').map((word) => (word.length <= 3 ? word : capitalise(word.toLowerCase()))).join(' ');
}

/** All capitals or all lower case, with at least one letter: the only text worth tidying. */
const onlyOneCase = (v: string) => /\p{L}/u.test(v) && (v === v.toUpperCase() || v === v.toLowerCase());

const capitalise = (word: string) => word.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());

/** Split a whole name at the last space: "Thandeka Precious Dlamini" → Thandeka Precious / Dlamini. */
export function splitFullName(value: unknown): { first: string; last: string } {
  const v = tidySpaces(value);
  const at = v.lastIndexOf(' ');
  return at < 0 ? { first: '', last: v } : { first: v.slice(0, at), last: v.slice(at + 1) };
}

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normaliseWorkEmail(value: unknown): { value: string | null; ok: boolean } {
  const v = tidySpaces(value).toLowerCase();
  if (!v) return { value: null, ok: true };
  return EMAIL_PATTERN.test(v) ? { value: v, ok: true } : { value: v, ok: false };
}

/**
 * South African cellphone numbers in one form, +27 and nine digits. Forgives
 * spaces and dashes, a leading 0 or 27, and the leading zero Excel drops from
 * numbers it thinks are numeric. Mirrors normalizeSaPhone() in apps/web/lib/sms.ts.
 */
export function normaliseCellphone(value: unknown): { value: string | null; ok: boolean } {
  const raw = tidySpaces(value);
  if (!raw) return { value: null, ok: true };
  let s = raw.replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^0\d{9}$/.test(s)) s = `+27${s.slice(1)}`;
  else if (/^27\d{9}$/.test(s)) s = `+${s}`;
  else if (/^\d{9}$/.test(s)) s = `+27${s}`;
  return /^\+\d{9,15}$/.test(s) ? { value: s, ok: true } : { value: raw, ok: false };
}

const plain = (v: string) => v.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

const DEPARTMENT_ALIASES: Record<Silo, string[]> = {
  MetroPolice: ['metro police', 'metropolice', 'police', 'metro', 'mp', 'ethekwini metro police', 'durban metro police',
    'metro police service', 'metro police department'],
  MetroFire: ['fire', 'fire and rescue', 'fire rescue', 'fire department', 'fire service', 'fire services', 'metrofire',
    'metro fire', 'fire and emergency services', 'ethekwini fire', 'fire and rescue services'],
  Medical: ['ems', 'ems medical', 'medical', 'emergency medical services', 'emergency medical', 'ambulance',
    'ambulance services', 'ambulance service'],
  EthekwiniDisaster: ['disaster', 'disaster management', 'ethekwinidisaster', 'ethekwini disaster', 'disaster management centre',
    'disaster management unit', 'dmc'],
  Ethekwini: ['control room', 'controlroom', 'ethekwini', 'control', 'call centre', 'communications',
    'communications centre', 'emergency control room', 'joc'],
};

/** A department as HR writes it ("Fire & Rescue", "EMS", "metro police") → the platform's department. */
export function departmentFrom(value: unknown): Silo | null {
  const v = plain(tidySpaces(value));
  if (!v) return null;
  for (const [silo, aliases] of Object.entries(DEPARTMENT_ALIASES) as Array<[Silo, string[]]>) {
    if (aliases.includes(v) || plain(DEPARTMENT_NAMES[silo]) === v || silo.toLowerCase() === v.replace(/ /g, '')) return silo;
  }
  return null;
}

// ── Suggested roles (the handbook's table) ──────────────────────────────

const FIELD_ROLE: Partial<Record<Silo, UserRole>> = {
  MetroPolice: 'Police', MetroFire: 'Firefighter', Medical: 'Paramedic', EthekwiniDisaster: 'Disaster',
};

/**
 * The role someone is invited as, suggested from the one they hold in the
 * current system. A starting point only: department Admins confirm every
 * person before invitations go out, and administrator roles are never
 * carried over.
 */
export function suggestRole(previousRole: unknown, silo: Silo | null): { role: UserRole | null; note: string | null } {
  const r = plain(tidySpaces(previousRole)).replace(/ /g, '');
  if (!r) return { role: null, note: null };
  const same: Record<string, UserRole> = {
    police: 'Police', officer: 'Police', metro: 'Police', metropolice: 'Police', constable: 'Police',
    security: 'Staff', staff: 'Staff',
    captain: 'Captain',
    chief: 'FireChief', firechief: 'FireChief',
    firefighter: 'Firefighter', paramedic: 'Paramedic', doctor: 'Doctor', disaster: 'Disaster',
    operator: 'ControlRoom', controlroom: 'ControlRoom',
    dispatcher: 'Dispatcher', incidentlogger: 'IncidentLogger', casemanager: 'CaseManager',
    supervisor: 'Supervisor', viewer: 'Viewer',
  };
  if (r in same) {
    const role = same[r]!;
    // A field role is only ever suggested in its own department.
    const mismatch = silo ? roleDepartmentProblem(role, silo) : null;
    if (mismatch) return { role: null, note: mismatch };
    return { role, note: r === 'security' ? 'Security becomes Staff: confirm with the department.' : null };
  }
  if (r === 'responder') {
    const role = silo ? FIELD_ROLE[silo] ?? null : null;
    return { role, note: role ? null : 'Responder: choose their department\'s field role.' };
  }
  if (['admin', 'systemadmin', 'superadmin', 'systemcontroller'].includes(r)) {
    return { role: null, note: 'Administrators are not carried over: appoint them by invitation.' };
  }
  if (r === 'citizen') return { role: null, note: 'Members of the public do not hold accounts.' };
  return { role: null, note: null };
}

/**
 * Roles an administrator may set for invitation in the register. Mirrors
 * set_register_roles() (0050): what they may invite, less the powerful roles,
 * which are always invited one at a time with a second SystemAdmin's approval.
 */
export function registerRolesFor(actor: UserRole): UserRole[] {
  return rolesInvitableBy(actor).filter((r) => !POWERFUL_ROLES.includes(r));
}

// ── Checking a staff list against the register ─────────────────────────

/** One row of the file, as typed. */
export type RawStaffRow = { line: number } & Partial<Record<StaffField, string>>;

/** Someone already in the register, as the check needs them. */
export type RegisterEntry = {
  id: string; first_name: string; last_name: string; badge_number: string; rank: string; silo: Silo;
  station: string | null; work_email: string | null; work_cellphone: string | null; previous_role: string | null;
  force_number: string | null; user_id: string | null; left_at: string | null;
  proposed_role: UserRole | null; role_confirmed_at: string | null;
};

/** What an administrator decided about a row on screen. */
export type RowFix = { skip?: boolean; silo?: Silo; rank?: string; dropEmail?: boolean; dropPhone?: boolean; acceptMatch?: boolean };

export type FixKind = 'skip' | 'department' | 'rank' | 'drop-email' | 'drop-phone' | 'accept-match';

export type RowIssue = {
  code: 'no-badge' | 'no-name' | 'no-rank' | 'no-department' | 'unknown-department' | 'bad-email' | 'bad-phone'
    | 'name-mismatch' | 'register-duplicate' | 'file-duplicate';
  message: string;
  fixes: FixKind[];
};

/** A row's values after tidying and the administrator's fixes. */
export type StaffPerson = {
  first_name: string; last_name: string; badge_number: string; force_number: string | null; rank: string;
  silo: Silo | null; station: string | null; work_email: string | null; work_cellphone: string | null;
  previous_role: string | null;
};

export type FieldChange = { field: keyof StaffPerson; label: string; from: string; to: string };

export type CheckedRow = {
  line: number;
  person: StaffPerson;
  outcome: 'add' | 'update' | 'unchanged' | 'merged' | 'attention' | 'skipped';
  issues: RowIssue[];
  changes: FieldChange[];
  notes: string[];
  match: RegisterEntry | null;
  /** For a merged row: the line it is a copy of. */
  mergedInto: number | null;
  suggestedRole: UserRole | null;
};

/** One row as sent to the database (import_staff_rows, 0050). */
export type ImportRow = StaffPerson & { line: number; silo: Silo; proposed_role: UserRole | null };

export type StaffListCheck = {
  rows: CheckedRow[];
  counts: Record<CheckedRow['outcome'], number>;
  /** Departments this list covers; people in them who are missing from it are "not listed". */
  departments: Silo[];
  /** In the register, in a department the list covers, but not in the list: shown for review only. */
  notListed: RegisterEntry[];
  /** Rows the import will send: added, updated and unchanged (so the register knows HR still lists them). */
  toImport: ImportRow[];
};

const FIELD_LABELS: Record<keyof StaffPerson, string> = {
  first_name: 'First names', last_name: 'Surname', badge_number: 'Badge', force_number: 'Force number', rank: 'Rank',
  silo: 'Department', station: 'Station', work_email: 'Work email', work_cellphone: 'Work cellphone',
  previous_role: 'Role in current system',
};

/** Tidy one row and apply the administrator's fixes. */
export function cleanStaffRow(raw: RawStaffRow, fix: RowFix = {}): { person: StaffPerson; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  let first = tidyName(raw.first_name);
  let last = tidyName(raw.last_name);
  if (raw.full_name && !first && !last) {
    const split = splitFullName(tidyName(raw.full_name));
    first = split.first;
    last = split.last;
  }
  const badge = tidySpaces(raw.badge_number);
  const rank = tidyLabel(fix.rank ?? raw.rank);
  const deptRaw = tidySpaces(raw.department);
  const silo = fix.silo ?? departmentFrom(deptRaw);
  const email = fix.dropEmail ? { value: null, ok: true } : normaliseWorkEmail(raw.work_email);
  const phone = fix.dropPhone ? { value: null, ok: true } : normaliseCellphone(raw.work_cellphone);

  if (!normaliseBadge(badge)) issues.push({ code: 'no-badge', message: 'No badge or force number', fixes: ['skip'] });
  if (!first || !last) issues.push({ code: 'no-name', message: 'First names or surname missing', fixes: ['skip'] });
  if (!rank) issues.push({ code: 'no-rank', message: 'No rank', fixes: ['rank', 'skip'] });
  if (!silo) {
    issues.push(deptRaw
      ? { code: 'unknown-department', message: `Department “${deptRaw}” not recognised`, fixes: ['department', 'skip'] }
      : { code: 'no-department', message: 'No department given', fixes: ['department', 'skip'] });
  }
  if (!email.ok) issues.push({ code: 'bad-email', message: `“${email.value}” is not an email address`, fixes: ['drop-email', 'skip'] });
  if (!phone.ok) issues.push({ code: 'bad-phone', message: `“${phone.value}” is not a cellphone number`, fixes: ['drop-phone', 'skip'] });

  return {
    person: {
      first_name: first, last_name: last, badge_number: badge,
      force_number: tidySpaces(raw.force_number) || null, rank, silo,
      station: tidyLabel(raw.station) || null,
      work_email: email.ok ? email.value : null, work_cellphone: phone.ok ? phone.value : null,
      previous_role: tidySpaces(raw.previous_role) || null,
    },
    issues,
  };
}

const nameKey = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Could these be the same person? Surnames must agree; first names must not
 * clearly differ ("N." and "Nomsa" agree, "Anele" and "Nomsa" do not).
 */
export function sameName(a: { first_name: string; last_name: string }, b: { first_name: string; last_name: string }): boolean {
  if (nameKey(a.last_name) !== nameKey(b.last_name)) return false;
  const fa = nameKey(a.first_name).split(' ')[0] ?? '';
  const fb = nameKey(b.first_name).split(' ')[0] ?? '';
  if (!fa || !fb) return true;
  return fa.startsWith(fb) || fb.startsWith(fa);
}

const samePerson = (a: StaffPerson, b: StaffPerson) =>
  (Object.keys(FIELD_LABELS) as Array<keyof StaffPerson>).every((k) => (k === 'badge_number'
    ? normaliseBadge(a[k]) === normaliseBadge(b[k])
    : (a[k] ?? '') === (b[k] ?? '')));

/**
 * Sort every row of a staff list: new, changed, unchanged, a copy of another
 * row, or needing attention; and find who in the register the list leaves
 * out. Rows needing attention never block the rest, and nothing here
 * changes anything.
 */
export function checkStaffList(
  raws: RawStaffRow[],
  register: RegisterEntry[],
  fixes: Record<number, RowFix> = {},
): StaffListCheck {
  const rows: CheckedRow[] = raws.map((raw) => {
    const fix = fixes[raw.line] ?? {};
    const { person, issues } = cleanStaffRow(raw, fix);
    return {
      line: raw.line, person, outcome: fix.skip ? 'skipped' : issues.length ? 'attention' : 'add',
      issues: fix.skip ? [] : issues, changes: [], notes: [], match: null, mergedInto: null, suggestedRole: null,
    };
  });

  // The same badge twice in the file: identical copies merge, anything else needs a person to choose.
  const byBadge = new Map<string, CheckedRow[]>();
  for (const r of rows) {
    const key = normaliseBadge(r.person.badge_number);
    if (r.outcome === 'skipped' || !key) continue;
    byBadge.set(key, [...(byBadge.get(key) ?? []), r]);
  }
  for (const group of byBadge.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group as [CheckedRow, ...CheckedRow[]];
    if (rest.every((r) => samePerson(r.person, first.person))) {
      for (const r of rest) { r.outcome = 'merged'; r.mergedInto = first.line; r.issues = []; }
    } else {
      for (const r of group) {
        const others = group.filter((o) => o !== r).map((o) => o.line).join(', ');
        r.outcome = 'attention';
        r.issues.push({ code: 'file-duplicate', message: `Badge ${r.person.badge_number} is also on row ${others} with different details`, fixes: ['skip'] });
      }
    }
  }

  // Against the register.
  const registerByBadge = new Map<string, RegisterEntry[]>();
  for (const e of register) {
    const key = normaliseBadge(e.badge_number);
    if (key) registerByBadge.set(key, [...(registerByBadge.get(key) ?? []), e]);
  }
  for (const r of rows) {
    if (r.outcome === 'skipped' || r.outcome === 'merged') continue;
    const fix = fixes[r.line] ?? {};
    const matches = registerByBadge.get(normaliseBadge(r.person.badge_number)) ?? [];
    if (matches.length > 1) {
      r.outcome = 'attention';
      r.issues.push({
        code: 'register-duplicate',
        message: `Badge ${r.person.badge_number} belongs to ${matches.length} people in the register already: fix the register first`,
        fixes: ['skip'],
      });
      continue;
    }
    const match = matches[0] ?? null;
    r.match = match;
    if (match && !fix.acceptMatch && r.person.first_name && r.person.last_name && !sameName(match, r.person)) {
      r.outcome = 'attention';
      r.issues.push({
        code: 'name-mismatch',
        message: `Badge ${r.person.badge_number} already belongs to ${match.first_name} ${match.last_name}`,
        fixes: ['accept-match', 'skip'],
      });
    }
    if (r.outcome === 'attention') continue;

    if (!match) {
      r.outcome = 'add';
    } else {
      for (const k of Object.keys(FIELD_LABELS) as Array<keyof StaffPerson>) {
        // Matched on the badge, so it is the same badge, however it was typed.
        if (k === 'badge_number') continue;
        const to = r.person[k];
        const from = match[k as keyof RegisterEntry] as string | null;
        // A blank cell never erases what the register holds.
        if (to === null || to === '' || to === (from ?? '')) continue;
        if (k === 'silo' && match.user_id) {
          r.notes.push(`Department differs from their account (${DEPARTMENT_NAMES[match.silo]}): change it on their account page.`);
          continue;
        }
        r.changes.push({
          field: k, label: FIELD_LABELS[k],
          from: k === 'silo' ? DEPARTMENT_NAMES[match.silo] : (from ?? '—'),
          to: k === 'silo' ? DEPARTMENT_NAMES[to as Silo] : String(to),
        });
      }
      if (match.left_at) r.notes.push('Marked as left: importing brings them back to the register.');
      r.outcome = r.changes.length || match.left_at ? 'update' : 'unchanged';
    }
    // A suggestion only for people without an account or a confirmed role.
    if (!match || (!match.user_id && !match.role_confirmed_at)) {
      const s = suggestRole(r.person.previous_role, r.person.silo);
      r.suggestedRole = s.role;
      if (s.note) r.notes.push(s.note);
    }
  }

  const counts = { add: 0, update: 0, unchanged: 0, merged: 0, attention: 0, skipped: 0 };
  for (const r of rows) counts[r.outcome]++;

  const kept = rows.filter((r) => r.outcome === 'add' || r.outcome === 'update' || r.outcome === 'unchanged' || r.outcome === 'merged');
  const departments = [...new Set(kept.map((r) => r.person.silo).filter((s): s is Silo => !!s))];
  const listed = new Set(rows.map((r) => normaliseBadge(r.person.badge_number)).filter(Boolean));
  const notListed = register.filter((e) => !e.left_at && departments.includes(e.silo) && !listed.has(normaliseBadge(e.badge_number)));

  const toImport: ImportRow[] = rows
    .filter((r) => r.outcome === 'add' || r.outcome === 'update' || r.outcome === 'unchanged')
    .map((r) => ({ ...r.person, line: r.line, silo: r.person.silo as Silo, proposed_role: r.suggestedRole }));

  return { rows, counts, departments, notListed, toImport };
}

// ── The register's own screens ─────────────────────────────────────────

/** How an invitation would reach someone, from what the register holds about them. */
export function inviteChannelFor(
  person: { work_email: string | null; work_cellphone: string | null },
  available: { email: boolean; sms: boolean },
): 'email' | 'sms' | 'code' {
  if (person.work_email && available.email) return 'email';
  if (person.work_cellphone && available.sms) return 'sms';
  return 'code';
}
