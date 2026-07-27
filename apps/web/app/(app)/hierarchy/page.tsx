import Link from 'next/link';
import { listPersonnel, listAllProfiles } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { Card, CardContent } from '@/components/ui/card';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Department Hierarchy · Criticom' };

const DEPARTMENTS: { silo: Exclude<Silo, 'Ethekwini'>; label: string; accent: string }[] = [
  { silo: 'MetroPolice', label: 'Metro Police', accent: 'text-severity-high' },
  { silo: 'MetroFire', label: 'Fire & Rescue', accent: 'text-severity-critical' },
  { silo: 'Medical', label: 'EMS / Medical', accent: 'text-severity-low' },
  { silo: 'EthekwiniDisaster', label: 'Disaster Mgmt', accent: 'text-accent' },
];

// Chain-of-command tiers. A person's tier is the strongest (lowest) match of role/rank.
const TIER_BY_KEY: Record<string, number> = {
  // 0 — Command
  Chief: 0, FireChief: 0, Captain: 0, Commander: 0, 'Station Commander': 0,
  SystemAdmin: 0, SuperAdmin: 0, Admin: 0, Doctor: 0,
  // 1 — Supervision
  Supervisor: 1, Sergeant: 1, 'Senior Sergeant': 1, Lieutenant: 1, Warrant: 1,
  // 2 — Operations & Dispatch
  Dispatcher: 2, ControlRoom: 2, Operator: 2, IncidentLogger: 2, CaseManager: 2, System: 2,
  // 3 — Field personnel
  Police: 3, Officer: 3, Metro: 3, Security: 3, Firefighter: 3, Paramedic: 3, Disaster: 3, Constable: 3,
};
const TIERS = ['Command', 'Supervision', 'Operations & Dispatch', 'Field Personnel'];
const tierOf = (...keys: (string | null | undefined)[]) => {
  let best = 3;
  for (const k of keys) {
    const t = k ? TIER_BY_KEY[k] : undefined;
    if (t !== undefined) best = Math.min(best, t);
  }
  return best;
};

type Member = {
  name: string; rank: string; role: string | null; badge: string | null;
  station: string | null; unit: string | null; onDuty: boolean; tier: number;
};

function PersonCard({ m }: { m: Member }) {
  const initials = m.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="flex w-52 items-center gap-3 rounded-xl border border-border bg-gradient-to-b from-bg-card to-bg-soft p-3">
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
        {initials || '?'}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg-card ${m.onDuty ? 'bg-severity-low' : 'bg-muted-foreground'}`}
          title={m.onDuty ? 'On duty' : 'Off duty'}
        />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{m.name}</p>
        <p className="truncate text-xs text-muted-foreground">{m.rank}{m.badge ? ` · ${m.badge}` : ''}</p>
        {(m.unit || m.station) && (
          <p className="truncate text-[11px] text-muted-foreground/80">{[m.unit, m.station].filter(Boolean).join(' · ')}</p>
        )}
      </div>
    </div>
  );
}

export default async function HierarchyPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const { supabase } = await getSession();
  const params = await searchParams;
  const dept = (DEPARTMENTS.find((d) => d.silo === params.dept)?.silo ?? 'MetroPolice') as Exclude<Silo, 'Ethekwini'>;

  const [personnel, profiles] = await Promise.all([
    listPersonnel(supabase, dept),
    listAllProfiles(supabase, dept),
  ]);

  // Merge profiles (login accounts) + personnel (operational staff), dedupe by name.
  const byName = new Map<string, Member>();
  for (const p of profiles) {
    const name = p.full_name ?? p.email ?? 'Unknown';
    byName.set(name.toLowerCase(), {
      name, rank: p.rank ?? p.role, role: p.role, badge: p.badge_number,
      station: p.station, unit: null, onDuty: p.is_on_duty, tier: tierOf(p.role, p.rank),
    });
  }
  for (const p of personnel) {
    const name = `${p.first_name} ${p.last_name}`.trim();
    const key = name.toLowerCase();
    if (byName.has(key)) continue;
    byName.set(key, {
      name, rank: p.rank, role: p.rank, badge: p.badge_number,
      station: p.station, unit: p.unit, onDuty: p.is_on_duty, tier: tierOf(p.rank),
    });
  }
  const members = [...byName.values()];
  const tiers = TIERS.map((_, t) => members.filter((m) => m.tier === t).sort((a, b) => a.name.localeCompare(b.name)));
  const current = DEPARTMENTS.find((d) => d.silo === dept)!;
  const onDuty = members.filter((m) => m.onDuty).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Department hierarchy</h1>
        <p className="text-muted-foreground">Chain of command and personnel structure per department.</p>
      </header>

      {/* Department tabs */}
      <nav className="flex flex-wrap gap-2">
        {DEPARTMENTS.map((d) => (
          <Link
            key={d.silo}
            href={`/hierarchy?dept=${d.silo}`}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
              d.silo === dept ? 'border-primary bg-primary/15 text-white' : 'border-border bg-bg-soft text-white/70 hover:bg-muted'
            }`}
          >
            {d.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap gap-6 text-sm">
        <span><span className={`text-lg font-bold ${current.accent}`}>{members.length}</span> <span className="text-muted-foreground">members</span></span>
        <span><span className="text-lg font-bold text-severity-low">{onDuty}</span> <span className="text-muted-foreground">on duty</span></span>
      </div>

      {/* Tiered org chart */}
      <div className="space-y-2">
        {tiers.map((tierMembers, t) => (
          tierMembers.length === 0 ? null : (
            <div key={TIERS[t]} className="relative">
              {t > 0 && <div className="mx-auto h-4 w-px bg-border" />}
              <Card>
                <CardContent className="p-4">
                  <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {TIERS[t]} <span className="text-muted-foreground/60">({tierMembers.length})</span>
                  </p>
                  <div className="flex flex-wrap justify-center gap-3">
                    {tierMembers.map((m) => <PersonCard key={m.name} m={m} />)}
                  </div>
                </CardContent>
              </Card>
            </div>
          )
        ))}
        {members.length === 0 && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">No personnel records for this department yet.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
