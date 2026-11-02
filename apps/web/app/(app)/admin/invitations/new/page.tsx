import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getStaffForInvite } from '@criticom/api';
import { departmentsInvitableBy, rolesInvitableBy } from '@criticom/db';
import { deliveryOptions, invitationTtlHours } from '@/lib/onboarding/server';
import { getSession } from '@/lib/session';
import { InviteForm } from './invite-form';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invite / Create login · HikTech' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Invite someone from the staff register (migration 0049). Accounts are
 * created by invitation only, and the person chooses their own password.
 * `?person=` starts from one register entry, as "Invite again" does.
 */
export default async function NewInvitationPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const roles = rolesInvitableBy(role);
  if (roles.length === 0) redirect('/admin');

  const { person } = await searchParams;
  const initialPerson = person && UUID.test(person) ? await getStaffForInvite(supabase, person).catch(() => null) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1 rounded-xl border border-border bg-bg-card p-5 shadow-sm">
        <Link href="/admin/invitations" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> {' '}{t('Invites / Create logins')}</Link>
        <h1 className="text-2xl font-bold">{t('Invite / Create login')}</h1>
        <p className="text-muted-foreground">
          {role === 'SystemAdmin' || role === 'SuperAdmin' || role === 'SystemController' || role === 'Admin'
            ? t('Send an invitation and the person chooses their own password. Or create the login now and give them the password yourself.')
            : t('Send an invitation and the person chooses their own password. You never see it.')}
        </p>
      </header>
      <InviteForm
        actorRole={role}
        roles={roles}
        departments={departmentsInvitableBy({ role, silo })}
        delivery={deliveryOptions()}
        ttlHours={invitationTtlHours()}
        initialPerson={initialPerson && !initialPerson.hasAccount && !initialPerson.openInvitation ? initialPerson : null}
      />
    </div>
  );
}
