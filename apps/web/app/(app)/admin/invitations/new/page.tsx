import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getStaffForInvite } from '@criticom/api';
import { departmentsInvitableBy, rolesInvitableBy } from '@criticom/db';
import { deliveryOptions, invitationTtlHours } from '@/lib/onboarding/server';
import { getSession } from '@/lib/session';
import { InviteForm } from './invite-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invite someone · HikTech' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Invite someone from the staff register (migration 0049). Accounts are
 * created by invitation only, and the person chooses their own password.
 * `?person=` starts from one register entry, as "Invite again" does.
 */
export default async function NewInvitationPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const { supabase, role, silo } = await getSession();
  const roles = rolesInvitableBy(role);
  if (roles.length === 0) redirect('/admin');

  const { person } = await searchParams;
  const initialPerson = person && UUID.test(person) ? await getStaffForInvite(supabase, person).catch(() => null) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <Link href="/admin/invitations" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Invitations
        </Link>
        <h1 className="text-2xl font-bold">Invite someone</h1>
        <p className="text-muted-foreground">
          {role === 'SystemAdmin' || role === 'SuperAdmin'
            ? 'By invitation the person chooses their own password and you never see it. You can also set a password and create the account at once, which is less safe.'
            : 'Accounts are created by invitation only. The person chooses their own password; you never see it.'}
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
