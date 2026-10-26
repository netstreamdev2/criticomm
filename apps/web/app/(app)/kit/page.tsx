import Link from 'next/link';
import { HardHat, KeyRound } from 'lucide-react';
import { DEPARTMENT_LABELS, listKit, listKitHistory, listPersonnel, noKitRegister, type KitEntry } from '@criticom/api';
import type { UserRole } from '@criticom/db';
import { getSession, siloFilter } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { KitBoard } from './kit-board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hard hats & radios · HikTech' };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Who looks after the register (the database's can_manage_field_kit). */
const MANAGERS: UserRole[] = ['SystemAdmin', 'SuperAdmin', 'SystemController', 'Admin', 'System', 'Supervisor', 'Captain', 'FireChief'];

/**
 * Hard hats and radios (0101): every numbered item, who has it now and since
 * when, and what came back damaged or lost. Command adds them (one, or a run
 * of numbers), receives them back and takes them out of service; dispatch
 * and the control room see whose kit is whose.
 */
export default async function KitPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  let items: KitEntry[] = [];
  let missing = false;
  try {
    items = await listKit(supabase, { includeRetired: one(params.retired) === '1' });
  } catch (e) {
    missing = noKitRegister(e);
  }
  const picked = items.find((i) => i.id === one(params.item)) ?? null;
  const history = picked ? await listKitHistory(supabase, picked.id).catch(() => []) : [];
  const manages = MANAGERS.includes(role);
  // Who the armoury may issue to: the department's people with a sign-in.
  const people = manages
    ? (await listPersonnel(supabase, siloFilter(silo)).catch(() => []))
        .filter((p) => p.user_id)
        .map((p) => ({ id: p.id, label: `${[p.rank, p.first_name, p.last_name].filter(Boolean).join(' ')}${p.badge_number ? ` (${p.badge_number})` : ''}` }))
    : [];
  const departments = role === 'Admin' || role === 'Supervisor' || role === 'Captain' || role === 'FireChief'
    ? [silo]
    : Object.keys(DEPARTMENT_LABELS);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lg">
            <HardHat className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">{t('Hard hats & radios')}</h1>
            <p className="text-sm text-muted-foreground">{t('Who has what, right now.')}</p>
          </div>
        </div>
        {manages ? (
          <Link href="/kit/sign-in" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted">
            <KeyRound className="h-4 w-4" aria-hidden />{t('PIN sign-in')}
          </Link>
        ) : null}
      </header>

      {missing ? (
        <p className="frost rounded-xl border border-amber-500/40 p-4 text-sm">
          {t('The register is not set up yet. Run migration 0101 in Supabase, then reload.')}
        </p>
      ) : (
        <KitBoard
          items={items}
          picked={picked}
          history={history}
          manages={manages}
          showRetired={one(params.retired) === '1'}
          departments={departments.map((d) => ({ id: d, label: DEPARTMENT_LABELS[d] ?? d }))}
          defaultSilo={silo === 'Ethekwini' ? '' : silo}
          people={people}
        />
      )}
    </div>
  );
}
