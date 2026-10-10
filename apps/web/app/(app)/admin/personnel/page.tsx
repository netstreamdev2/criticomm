import Link from 'next/link';
import { Download, FileUp, TriangleAlert, UserPlus } from 'lucide-react';
import {
  listRegister, listStaffImports, registerStatus, sharedBadges, type RegisterPerson, type StaffImport,
} from '@criticom/api';
import { ADMIN_ROLES, registerRolesFor, type Silo } from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { deliveryOptions } from '@/lib/onboarding/server';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { AddPersonForm } from './add-person-form';
import { RegisterTable, type StatusFilter } from './register-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Personnel · HikTech' };

const ALL_SILOS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini'];
const FILTERS: StatusFilter[] = ['current', 'to-confirm', 'no-role', 'ready', 'invited', 'active', 'not-listed', 'shared-badge', 'left', 'all'];

/**
 * The staff register (migration 0050): everyone who works here, with or
 * without an account. People arrive by HR's staff list or one at a time;
 * roles are confirmed here before invitations go out in bulk; leavers are
 * marked, never deleted.
 */
export default async function AdminPersonnelPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { supabase, role, silo } = await getSession();
  const { status, q } = await searchParams;
  const canManage = ADMIN_ROLES.includes(role);
  const canImport = role === 'SystemAdmin' || role === 'SuperAdmin';
  const departments = role === 'Admin' ? [silo] : ALL_SILOS;

  let people: RegisterPerson[] = [];
  let loadError: string | null = null;
  let latest: StaffImport | null = null;
  try {
    const [list, imports] = await Promise.all([
      listRegister(supabase, { silo: role === 'Admin' ? silo : undefined }),
      listStaffImports(supabase, 1).catch(() => [] as StaffImport[]),
    ]);
    people = list;
    latest = imports[0] ?? null;
  } catch (e) {
    loadError = invitationErrorMessage(e, 'The staff register could not be loaded.');
  }
  const delivery = deliveryOptions();
  const shared = sharedBadges(people);
  const current = people.filter((p) => !p.left_at);
  const tally = (key: string) => current.filter((p) => registerStatus(p).key === key).length;
  const initialFilter = FILTERS.includes(status as StatusFilter) ? (status as StatusFilter) : 'current';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Personnel</h1>
          <p className="max-w-2xl text-muted-foreground">
            The staff register: everyone who works here, with or without an account. Being in the register gives
            nobody access; only an invitation they accept does.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {canImport ? (
            <Link href="/admin/personnel/import" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary/90">
              <FileUp className="h-4 w-4" /> Import staff list
            </Link>
          ) : null}
          {canManage ? (
            <>
              <a href="/admin/personnel/template" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 hover:bg-muted">
                <Download className="h-4 w-4" /> Template for HR
              </a>
              <Link href="/admin/rollout" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Rollout</Link>
              <Link href="/admin/invitations" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Invitations</Link>
            </>
          ) : null}
        </div>
      </header>

      {loadError ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{loadError}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Current staff', current.length, 'current'],
              ['Have an account', tally('active'), 'active'],
              ['Invited', tally('invited'), 'invited'],
              ['Ready to invite', tally('ready'), 'ready'],
              ['Role to confirm', tally('suggested'), 'to-confirm'],
              ['Role not set', tally('no-role'), 'no-role'],
            ].map(([label, n, filter]) => (
              <Link key={String(filter)} href={`/admin/personnel?status=${filter}`} className="rounded-lg border border-border bg-bg-card px-3 py-2 hover:border-primary/50">
                <dd className="text-2xl font-bold tabular-nums">{n}</dd>
                <dt className="text-xs text-muted-foreground">{label}</dt>
              </Link>
            ))}
          </dl>

          {shared.length ? (
            <p className="flex items-start gap-2 rounded-lg border border-severity-medium/50 bg-severity-medium/10 px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-severity-medium-ink" aria-hidden />
              <span>
                <b>{shared.length} badge {shared.length === 1 ? 'number is' : 'numbers are'} used by more than one person</b>{' '}
                ({shared.slice(0, 3).map((g) => g[0]!.badge_number).join(', ')}{shared.length > 3 ? '…' : ''}). A badge number proves who
                someone is, so each should belong to one person: correct the badge, or mark the extra record as left.{' '}
                <Link href="/admin/personnel?status=shared-badge" className="font-semibold underline">Show them</Link>
              </span>
            </p>
          ) : null}

          {latest ? (
            <p className="text-sm text-muted-foreground">
              Last staff-list import: <b className="text-fg">{latest.file_name}</b>, {formatSaTime(latest.finished_at ?? latest.started_at)} by{' '}
              {latest.imported_by_name ?? 'an administrator'}. {latest.added} added, {latest.updated} updated
              {latest.status === 'in_progress' ? ' · not finished: import the file again to complete it' : ''}.
            </p>
          ) : canImport ? (
            <p className="text-sm text-muted-foreground">
              No staff list imported yet. Send HR the <a href="/admin/personnel/template" className="font-semibold text-primary hover:underline">template</a>, then
              import what they return.
            </p>
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
        </>
      )}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4" /> Add one person</CardTitle>
            <CardDescription>For someone joining between staff-list imports. Then invite them from the list above.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddPersonForm departments={departments} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
