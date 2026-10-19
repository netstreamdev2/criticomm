import Link from 'next/link';
import { listPersonnel, listAllProfiles, listReportingLines } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { Card, CardContent } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import {
  DEPARTMENTS, TIER_LABEL, keyOf, buildMembers, buildForest, type OrgNode,
} from '@/lib/org';
import { HierarchyToolbar } from './toolbar';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Department Hierarchy · HikTech' };

async function PersonNode({ node }: { node: OrgNode }) {
  const { t } = await requestT();
  const m = node.m;
  const initials = m.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const tierTone = ['border-primary/50', 'border-severity-medium/50', 'border-accent/50', 'border-border'][m.tier];
  return (
    <li>
      <Link
        href={`/hierarchy/person?kind=${m.kind}&id=${m.id}`}
        className={`inline-flex w-48 flex-col items-center gap-1 rounded-xl border ${tierTone} bg-gradient-to-b from-bg-card to-bg-soft p-3 transition-all hover:-translate-y-0.5 hover:border-accent`}
      >
        <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
          {initials || '?'}
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg-card ${m.onDuty ? 'bg-severity-low' : 'bg-muted-foreground'}`}
            title={m.onDuty ? 'On duty' : 'Off duty'}
          />
        </span>
        <span className="mt-1 line-clamp-1 text-sm font-semibold text-fg">{m.name}</span>
        <span className="line-clamp-1 text-xs text-muted-foreground">{m.rank}</span>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
          {TIER_LABEL[m.tier]}{m.pinned && <span title={t('Reporting line pinned')}> · 📌</span>}
        </span>
      </Link>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => <PersonNode key={`${c.m.kind}:${c.m.id}`} node={c} />)}
        </ul>
      )}
    </li>
  );
}

export default async function HierarchyPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const params = await searchParams;
  const dept = (DEPARTMENTS.find((d) => d.silo === params.dept)?.silo ?? 'MetroPolice') as Exclude<Silo, 'Ethekwini'>;

  const [personnel, profiles, reportingLines] = await Promise.all([
    listPersonnel(supabase, dept),
    listAllProfiles(supabase, dept),
    listReportingLines(supabase, dept).catch(() => []),
  ]);

  const overrides = new Map<string, string | null>();
  for (const r of reportingLines) {
    overrides.set(
      keyOf(r.member_kind, r.member_id),
      r.manager_kind && r.manager_id ? keyOf(r.manager_kind, r.manager_id) : null,
    );
  }

  const members = buildMembers(profiles, personnel, overrides);
  const roots = buildForest(members, overrides);
  const current = DEPARTMENTS.find((d) => d.silo === dept)!;
  const onDuty = members.filter((m) => m.onDuty).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Department hierarchy')}</h1>
          <p className="text-muted-foreground">
            {t('Chain of command with reporting lines. Click any member for their HR record; pinned lines override the inferred chain.')}</p>
        </div>
        <HierarchyToolbar dept={dept} deptLabel={current.label} />
      </header>

      <nav className="no-print flex flex-wrap gap-2">
        {DEPARTMENTS.map((d) => (
          <Link
            key={d.silo}
            href={`/hierarchy?dept=${d.silo}`}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
              d.silo === dept ? 'border-primary bg-primary/15 text-fg' : 'border-border bg-bg-soft text-fg/70 hover:bg-muted'
            }`}
          >
            {d.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap gap-6 text-sm">
        <span className="hidden text-lg font-bold print:inline">{current.label} — </span>
        <span><span className={`text-lg font-bold ${current.accent}`}>{members.length}</span> <span className="text-muted-foreground">{t('members')}</span></span>
        <span><span className="text-lg font-bold text-severity-low-ink">{onDuty}</span> <span className="text-muted-foreground">{t('on duty')}</span></span>
      </div>

      <Card>
        <CardContent className="p-6">
          {roots.length > 0 ? (
            <div className="org-tree" id="org-chart">
              <ul>
                {roots.map((r) => <PersonNode key={`${r.m.kind}:${r.m.id}`} node={r} />)}
              </ul>
            </div>
          ) : (
            <p className="py-8 text-center text-muted-foreground">{t('No personnel records for this department yet.')}</p>
          )}
        </CardContent>
      </Card>

      <div className="no-print flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-severity-low" /> {' '}{t('On duty')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" /> {' '}{t('Off duty')}</span>
        <span>{t('📌 = pinned reporting line · Border colour = tier (Command · Supervision · Operations · Field)')}</span>
      </div>
    </div>
  );
}
