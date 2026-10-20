import type { CriticomClient, Database, Silo, UserRole } from '@criticom/db';
import type { ImportRow, RegisterEntry } from '@criticom/db/register';
import { OPEN_INVITATION_STATUSES, type InvitationChannel, type InvitationStatus } from './invitations.ts';
import { selectAll } from './paging.ts';

/**
 * The staff register (migration 0050): importing HR's staff list, role
 * review before bulk invitations, and leavers. Everything that changes the
 * register goes through a database function that checks who may, and keeps
 * the record; these only carry the request across.
 */

type Tables = Database['public']['Tables'];
export type StaffImport = Tables['staff_imports']['Row'];

const REGISTER_COLUMNS = [
  'id', 'first_name', 'last_name', 'badge_number', 'rank', 'silo', 'station', 'work_email', 'work_cellphone',
  'previous_role', 'force_number', 'user_id', 'left_at', 'left_reason', 'left_by_name', 'proposed_role',
  'role_confirmed_at', 'role_confirmed_by_name', 'hr_import_id', 'hr_seen_at', 'created_at',
].join(', ');

export type RegisterRow = RegisterEntry & {
  left_reason: string | null; left_by_name: string | null; role_confirmed_by_name: string | null;
  hr_import_id: string | null; hr_seen_at: string | null; created_at: string;
};

export type RegisterPerson = RegisterRow & {
  /** Their latest invitation that is still open, expired or locked. */
  invitation: { id: string; status: InvitationStatus; channel: InvitationChannel; expires_at: string | null; delivery_error: string | null } | null;
  /** Their account, if they have one. */
  account: { role: UserRole; active: boolean } | null;
};

/** Everyone in the register this administrator can see, with where each stands. */
export async function listRegister(client: CriticomClient, opts: { silo?: Silo } = {}): Promise<RegisterPerson[]> {
  const [people, invitations, profiles] = await Promise.all([
    selectAll<RegisterRow>((from, to) => {
      let q = client.from('personnel').select(REGISTER_COLUMNS);
      if (opts.silo) q = q.eq('silo', opts.silo);
      return q.order('id').range(from, to) as unknown as PromiseLike<{ data: RegisterRow[] | null; error: unknown }>;
    }),
    selectAll<{ id: string; personnel_id: string | null; status: InvitationStatus; channel: InvitationChannel; expires_at: string | null; delivery_error: string | null; created_at: string }>((from, to) =>
      client.from('account_invitations')
        .select('id, personnel_id, status, channel, expires_at, delivery_error, created_at')
        .in('status', [...OPEN_INVITATION_STATUSES, 'expired', 'locked'])
        .order('id').range(from, to)),
    selectAll<{ id: string; role: UserRole; deactivated_at: string | null }>((from, to) =>
      client.from('profiles').select('id, role, deactivated_at').order('id').range(from, to)),
  ]);
  const latest = new Map<string, (typeof invitations)[number]>();
  for (const inv of invitations) {
    if (!inv.personnel_id) continue;
    const seen = latest.get(inv.personnel_id);
    if (!seen || seen.created_at < inv.created_at) latest.set(inv.personnel_id, inv);
  }
  const accounts = new Map(profiles.map((p) => [p.id, p]));
  return people
    .map((p) => {
      const inv = latest.get(p.id);
      const acc = p.user_id ? accounts.get(p.user_id) : undefined;
      return {
        ...p,
        invitation: inv ? { id: inv.id, status: inv.status, channel: inv.channel, expires_at: inv.expires_at, delivery_error: inv.delivery_error } : null,
        account: acc ? { role: acc.role, active: acc.deactivated_at === null } : null,
      };
    })
    .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
}

/** The register as the import check needs it: everyone, including people marked as left. */
export async function registerForImport(client: CriticomClient): Promise<RegisterEntry[]> {
  return selectAll<RegisterEntry>((from, to) =>
    client.from('personnel')
      .select('id, first_name, last_name, badge_number, rank, silo, station, work_email, work_cellphone, previous_role, force_number, user_id, left_at, proposed_role, role_confirmed_at')
      .order('id').range(from, to) as unknown as PromiseLike<{ data: RegisterEntry[] | null; error: unknown }>);
}

/** A few people, for actions that work on a chosen set (bulk invitations). */
export async function getRegisterPeople(client: CriticomClient, ids: string[]): Promise<RegisterRow[]> {
  const out: RegisterRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await client.from('personnel').select(REGISTER_COLUMNS).in('id', ids.slice(i, i + 100));
    if (error) throw error;
    out.push(...((data ?? []) as unknown as RegisterRow[]));
  }
  return out;
}

export async function listStaffImports(client: CriticomClient, limit = 10): Promise<StaffImport[]> {
  const { data, error } = await client.from('staff_imports').select('*').order('started_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function startStaffImport(
  client: CriticomClient,
  args: { fileName: string; fileSha256: string; reason: string; departments: Silo[]; rowCount: number; skipped: number },
): Promise<string> {
  const { data, error } = await client.rpc('start_staff_import', {
    p_file_name: args.fileName, p_file_sha256: args.fileSha256, p_reason: args.reason,
    p_departments: args.departments, p_row_count: args.rowCount, p_skipped: args.skipped,
  });
  if (error) throw error;
  return data as string;
}

export async function importStaffRows(client: CriticomClient, importId: string, rows: ImportRow[]) {
  const { data, error } = await client.rpc('import_staff_rows', { p_import: importId, p_rows: rows as unknown as Array<Record<string, unknown>> });
  if (error) throw error;
  return data as { added: number; updated: number; unchanged: number };
}

export async function finishStaffImport(client: CriticomClient, importId: string) {
  const { data, error } = await client.rpc('finish_staff_import', { p_import: importId });
  if (error) throw error;
  return data as { added: number; updated: number; unchanged: number; skipped: number; not_listed: number };
}

export async function setRegisterRoles(client: CriticomClient, personnelIds: string[], role: UserRole) {
  const { data, error } = await client.rpc('set_register_roles', { p_personnel: personnelIds, p_role: role });
  if (error) throw error;
  return data as { set: number; skipped: number };
}

export async function markRegisterLeft(client: CriticomClient, personnelId: string, reason: string) {
  const { data, error } = await client.rpc('mark_register_left', { p_personnel: personnelId, p_reason: reason });
  if (error) throw error;
  return data as { status: 'left'; invitations_cancelled: number };
}

/** Put a wrong department right before inviting someone (0067): SystemAdmin and SuperAdmin only. */
export async function moveRegisterPerson(client: CriticomClient, personnelId: string, silo: Silo, reason: string) {
  const { data, error } = await client.rpc('move_register_person', { p_personnel: personnelId, p_silo: silo, p_reason: reason });
  if (error) throw error;
  return data as { status: 'moved'; invitations_cancelled: number };
}

export async function restoreRegisterPerson(client: CriticomClient, personnelId: string, reason: string) {
  const { data, error } = await client.rpc('restore_register_person', { p_personnel: personnelId, p_reason: reason });
  if (error) throw error;
  return data as { status: 'restored' };
}

// ── Words and sums for screens ────────────────────────────────────────

export type RegisterStatusKey = 'left' | 'active' | 'deactivated' | 'invited' | 'ready' | 'suggested' | 'no-role';

/** Where someone stands, in one chip. */
export function registerStatus(p: Pick<RegisterPerson, 'left_at' | 'user_id' | 'account' | 'invitation' | 'proposed_role' | 'role_confirmed_at'>): {
  key: RegisterStatusKey; label: string; tone: 'ok' | 'info' | 'warn' | 'crit' | 'dim';
} {
  if (p.left_at) return { key: 'left', label: 'Left', tone: 'dim' };
  if (p.user_id) {
    return p.account?.active === false
      ? { key: 'deactivated', label: 'Login switched off', tone: 'dim' }
      : { key: 'active', label: 'Has a login', tone: 'ok' };
  }
  if (p.invitation) {
    const s = p.invitation.status;
    if (s === 'locked') return { key: 'invited', label: 'Invitation locked', tone: 'crit' };
    if (s === 'expired') return { key: 'invited', label: 'Invitation expired', tone: 'warn' };
    if (s === 'awaiting_approval') return { key: 'invited', label: 'Waiting for approval', tone: 'warn' };
    if (s === 'ready') return { key: 'invited', label: p.invitation.delivery_error ? 'Not delivered' : 'Invitation ready', tone: p.invitation.delivery_error ? 'crit' : 'warn' };
    return { key: 'invited', label: s === 'opened' ? 'Invitation opened' : 'Invited', tone: 'info' };
  }
  if (p.proposed_role && p.role_confirmed_at) return { key: 'ready', label: 'Ready for a login', tone: 'info' };
  if (p.proposed_role) return { key: 'suggested', label: 'Check the role', tone: 'warn' };
  return { key: 'no-role', label: 'No role yet', tone: 'dim' };
}

/** Badge numbers shared by more than one current person: to clean up before the rule becomes permanent. */
export function sharedBadges(people: Array<Pick<RegisterEntry, 'id' | 'badge_number' | 'first_name' | 'last_name' | 'left_at'>>) {
  const by = new Map<string, typeof people>();
  for (const p of people) {
    if (p.left_at) continue;
    const key = p.badge_number.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!key) continue;
    by.set(key, [...(by.get(key) ?? []), p]);
  }
  return [...by.values()].filter((g) => g.length > 1);
}

export type RolloutGroup = {
  silo: Silo; station: string;
  /** Current staff (not left). */
  total: number; active: number; invited: number; notInvited: number;
};

/** Progress by department and station: who has an account, who is invited, who has not been reached yet. */
export function rolloutGroups(people: RegisterPerson[]): RolloutGroup[] {
  const groups = new Map<string, RolloutGroup>();
  for (const p of people) {
    if (p.left_at) continue;
    const station = p.station?.trim() || 'No station';
    const key = `${p.silo}|${station}`;
    const g = groups.get(key) ?? { silo: p.silo, station, total: 0, active: 0, invited: 0, notInvited: 0 };
    g.total++;
    if (p.user_id) g.active++;
    else if (p.invitation) g.invited++;
    else g.notInvited++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.silo.localeCompare(b.silo) || a.station.localeCompare(b.station));
}
