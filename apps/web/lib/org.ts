/**
 * Shared department-hierarchy logic used by the hierarchy page and the CSV
 * export route, so both render the exact same chain of command.
 */
import type { Silo } from '@criticom/db';

export const TIER_BY_KEY: Record<string, number> = {
  Chief: 0, FireChief: 0, Captain: 0, Commander: 0, 'Station Commander': 0,
  SystemAdmin: 0, SuperAdmin: 0, Admin: 0, Doctor: 0,
  Supervisor: 1, Sergeant: 1, 'Senior Sergeant': 1, Lieutenant: 1, Warrant: 1,
  Dispatcher: 2, ControlRoom: 2, Operator: 2, IncidentLogger: 2, CaseManager: 2, System: 2,
  Police: 3, Officer: 3, Metro: 3, Security: 3, Firefighter: 3, Paramedic: 3, Disaster: 3, Constable: 3,
};
export const TIER_LABEL = ['Command', 'Supervision', 'Operations & Dispatch', 'Field'];

export function tierOf(...keys: (string | null | undefined)[]) {
  let best = 3;
  for (const k of keys) {
    const t = k ? TIER_BY_KEY[k] : undefined;
    if (t !== undefined) best = Math.min(best, t);
  }
  return best;
}

export type Member = {
  kind: 'user' | 'staff'; id: string;
  name: string; rank: string; badge: string | null;
  station: string | null; unit: string | null; onDuty: boolean; tier: number;
  pinned?: boolean;
};
export type OrgNode = { m: Member; children: OrgNode[] };
export const keyOf = (kind: string, id: string) => `${kind}:${id}`;

type ProfileRow = {
  id: string; full_name: string | null; email: string | null; role: string;
  rank: string | null; badge_number: string | null; station: string | null; is_on_duty: boolean;
};
type PersonnelRow = {
  id: string; first_name: string; last_name: string; rank: string;
  badge_number: string; station: string | null; unit: string | null; is_on_duty: boolean;
};

/** Merge login users + operational staff into one deduped member list. */
export function buildMembers(
  profiles: ProfileRow[], personnel: PersonnelRow[], overrides: Map<string, string | null>,
): Member[] {
  const byName = new Map<string, Member>();
  for (const p of profiles) {
    const name = p.full_name ?? p.email ?? 'Unknown';
    byName.set(name.toLowerCase(), {
      kind: 'user', id: p.id, name, rank: p.rank ?? p.role, badge: p.badge_number,
      station: p.station, unit: null, onDuty: p.is_on_duty, tier: tierOf(p.role, p.rank),
      pinned: overrides.has(keyOf('user', p.id)),
    });
  }
  for (const p of personnel) {
    const name = `${p.first_name} ${p.last_name}`.trim();
    const key = name.toLowerCase();
    if (byName.has(key)) continue;
    byName.set(key, {
      kind: 'staff', id: p.id, name, rank: p.rank, badge: p.badge_number,
      station: p.station, unit: p.unit, onDuty: p.is_on_duty, tier: tierOf(p.rank),
      pinned: overrides.has(keyOf('staff', p.id)),
    });
  }
  return [...byName.values()];
}

/** memberKey → parentKey|null (null = top of chain). Override wins over inferred. */
export function resolveParents(members: Member[], overrides: Map<string, string | null>): Map<string, string | null> {
  const memberByKey = new Map(members.map((m) => [keyOf(m.kind, m.id), m]));
  const inferred = new Map<string, string | null>();
  if (members.length) {
    const byTier = (t: number) => members.filter((m) => m.tier === t);
    const head = (byTier(0)[0] ?? byTier(1)[0] ?? byTier(2)[0] ?? members[0])!;
    const headKey = keyOf(head.kind, head.id);
    inferred.set(headKey, null);
    const rest = members.filter((m) => keyOf(m.kind, m.id) !== headKey);
    const t0 = rest.filter((m) => m.tier === 0);
    const t1 = rest.filter((m) => m.tier === 1);
    const t2 = rest.filter((m) => m.tier === 2);
    const t3 = rest.filter((m) => m.tier === 3);
    const rr = <T,>(arr: T[], i: number) => arr[i % arr.length]!;
    const commandKeys = [headKey, ...t0.map((m) => keyOf(m.kind, m.id))];
    t0.forEach((m) => inferred.set(keyOf(m.kind, m.id), headKey));
    [...t1, ...t2].forEach((m, i) => inferred.set(keyOf(m.kind, m.id), rr(commandKeys, i)));
    const fieldParentKeys = t1.length ? t1.map((m) => keyOf(m.kind, m.id)) : commandKeys;
    t3.forEach((m, i) => inferred.set(keyOf(m.kind, m.id), rr(fieldParentKeys, i)));
  }

  const parentOf = new Map<string, string | null>();
  for (const m of members) {
    const mk = keyOf(m.kind, m.id);
    let parent = overrides.has(mk) ? overrides.get(mk)! : (inferred.get(mk) ?? null);
    if (parent && (!memberByKey.has(parent) || parent === mk)) parent = null;
    parentOf.set(mk, parent);
  }
  // Break cycles.
  for (const m of members) {
    const seen = new Set<string>();
    let cur: string | null = keyOf(m.kind, m.id);
    while (cur) {
      if (seen.has(cur)) { parentOf.set(keyOf(m.kind, m.id), null); break; }
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }
  return parentOf;
}

export function buildForest(members: Member[], overrides: Map<string, string | null>): OrgNode[] {
  const parentOf = resolveParents(members, overrides);
  const nodeOf = new Map<string, OrgNode>(members.map((m) => [keyOf(m.kind, m.id), { m, children: [] }]));
  const roots: OrgNode[] = [];
  for (const m of members) {
    const mk = keyOf(m.kind, m.id);
    const pk = parentOf.get(mk) ?? null;
    if (pk && nodeOf.has(pk)) nodeOf.get(pk)!.children.push(nodeOf.get(mk)!);
    else roots.push(nodeOf.get(mk)!);
  }
  return roots;
}

export type Dept = { silo: Exclude<Silo, 'Ethekwini'>; label: string; accent: string };
export const DEPARTMENTS: Dept[] = [
  { silo: 'MetroPolice', label: 'Metro Police', accent: 'text-severity-high' },
  { silo: 'MetroFire', label: 'Fire & Rescue', accent: 'text-severity-critical' },
  { silo: 'Medical', label: 'EMS / Medical', accent: 'text-severity-low' },
  { silo: 'EthekwiniDisaster', label: 'Disaster Mgmt', accent: 'text-accent' },
];
