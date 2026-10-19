import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import {
  listRegister, listStaffImports, registerStatus, sharedBadges, type RegisterPerson, type StaffImport,
} from '@criticom/api';
import { registerRolesFor, type Silo, type UserRole } from '@criticom/db';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { deliveryOptions } from '@/lib/onboarding/server';
import { formatSaTime } from '@/lib/utils';
import type { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { RegisterTable, type StatusFilter } from './register-table';

const FILTERS: StatusFilter[] = ['current', 'to-confirm', 'no-role', 'ready', 'invited', 'active', 'not-listed', 'shared-badge', 'left', 'all'];

/**
 * Staff Maintenance's Logins tab (what the Personnel page was, 0050): who has
 * a login, roles to confirm before invitations go out, HR's staff-list
 * imports, leavers and staff numbers used twice. Being on the register gives
 * nobody access; only an invitation they accept does.
 */
export async function LoginsView({
  supabase, role, target, status, q, canManage, canImport, deptQuery,
}: {
  supabase: Awaited<ReturnType<typeof getSession>>['supabase'];
  role: UserRole;
  target: Silo;
  status?: string;
  q?: string;
  canManage: boolean;
  canImport: boolean;
  /** "dept=…&" when the systems controller picked a department. */
  deptQuery: string;
}) {
  const { t } = await requestT();
  let people: RegisterPerson[] = [];
  let loadError: string | null = null;
  let latest: StaffImport | null = null;
  try {
    const [list, imports] = await Promise.all([
      listRegister(supabase, { silo: target }),
      listStaffImports(supabase, 1).catch(() => [] as StaffImport[]),
    ]);
    people = list;
    latest = imports[0] ?? null;
  } catch (e) {
    loadError = invitationErrorMessage(e, 'The staff register could not be loaded.');
  }
  if (loadError) {
    return <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{loadError}</p>;
  }
  const delivery = deliveryOptions();
  const shared = sharedBadges(people);
  const current = people.filter((p) => !p.left_at);
  const tally = (key: string) => current.filter((p) => registerStatus(p).key === key).length;
  const initialFilter = FILTERS.includes(status as StatusFilter) ? (status as StatusFilter) : 'current';
  const tiles: Array<[string, number, string]> = [
    [t('Current staff'), current.length, 'current'],
    [t('Have a login'), tally('active'), 'active'],
    [t('Invited'), tally('invited'), 'invited'],
    [t('Ready to invite'), tally('ready'), 'ready'],
    [t('Role to confirm'), tally('suggested'), 'to-confirm'],
    [t('Role not set'), tally('no-role'), 'no-role'],
  ];

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, n, filter]) => (
          <Link key={filter} href={`/modules/staff?${deptQuery}view=logins&status=${filter}`} className="rounded-lg border border-border bg-bg-card px-3 py-2 hover:border-primary/50">
            <dd className="text-2xl font-bold tabular-nums">{n}</dd>
            <dt className="text-xs text-muted-foreground">{label}</dt>
          </Link>
        ))}
      </dl>

      {shared.length ? (
        <p className="flex items-start gap-2 rounded-lg border border-severity-medium/50 bg-severity-medium/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-severity-medium-ink" aria-hidden />
          <span>
            <b>{t('{length} staff numbers used by more than one person', { length: shared.length })}</b>{' '}
            {t('({join}). A staff number proves who someone is, so each should belong to one person: correct it, or mark the extra record as left.', { join: shared.slice(0, 3).map((g) => g[0]!.badge_number).join(', ') + (shared.length > 3 ? '…' : '') })}{' '}
            <Link href={`/modules/staff?${deptQuery}view=logins&status=shared-badge`} className="font-semibold underline">{t('Show them')}</Link>
          </span>
        </p>
      ) : null}

      {latest ? (
        <p className="text-sm text-muted-foreground">
          {t('Last staff-list import:')}{' '}<b className="text-fg">{latest.file_name}</b>{t(', {saTime} by {value}. {added} added, {updated} updated{value2}.', { saTime: formatSaTime(latest.finished_at ?? latest.started_at), value: latest.imported_by_name ?? 'an administrator', added: latest.added, updated: latest.updated, value2: latest.status === 'in_progress' ? ' · not finished: import the file again to complete it' : '' })}</p>
      ) : canImport ? (
        <p className="text-sm text-muted-foreground">
          {t('No staff list imported yet. Send HR the')}{' '}<a href="/modules/staff/template" className="font-semibold text-primary hover:underline">{t('template')}</a>{t(', then import what they return.')}</p>
      ) : null}

      <RegisterTable
        people={people}
        canManage={canManage}
        roleOptions={registerRolesFor(role)}
        delivery={{ email: delivery.email, sms: delivery.sms }}
        latestImport={latest?.status === 'complete' ? { id: latest.id, departments: latest.departments } : null}
        sharedBadgeIds={shared.flat().map((p) => p.id)}
        initialFilter={initialFilter}
        canMove={role === 'SystemAdmin' || role === 'SuperAdmin'}
        initialQuery={(q ?? '').slice(0, 80)}
      />
    </div>
  );
}
