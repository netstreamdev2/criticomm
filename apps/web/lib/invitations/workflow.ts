import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const inputSchema = z.object({
  name: z.string().trim().min(1, 'Enter the administrator’s name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  tenantId: z.string().uuid('Select a tenant.'),
});

const invitationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.literal('SystemAdmin'),
  invitedBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});

export type Invitation = z.infer<typeof invitationSchema>;
export type InvitedAccount = {
  id: string;
  email?: string;
  email_confirmed_at?: string;
  app_metadata: Record<string, unknown>;
};
export type InvitationTenant = { id: string; name: string; active: boolean };

// Persist the intended assignment before sending mail, but do not activate it.
// No profiles row or SystemAdmin access is created in this milestone.
export function pendingMetadata(invitation: Invitation) {
  return {
    role: 'Viewer', silo: 'Ethekwini', tenant_id: invitation.tenantId,
    invitation_pending: true, system_admin_invitation: invitation,
  };
}

export function readInvitation(account: InvitedAccount): Invitation | null {
  const result = invitationSchema.safeParse(account.app_metadata.system_admin_invitation);
  if (!result.success || account.app_metadata.invitation_pending !== true) return null;
  const invitation = result.data;
  if (invitation.email !== account.email?.toLowerCase()
    || invitation.tenantId !== account.app_metadata.tenant_id
    || account.app_metadata.role !== 'Viewer') return null;
  return invitation;
}

export function invitationCallback(appUrl: string | undefined) {
  if (!appUrl) throw new Error('Set NEXT_PUBLIC_APP_URL before sending invitations.');
  const url = new URL(appUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_APP_URL must be an HTTPS origin, or HTTP localhost for development.');
  }
  return `${url.origin}/auth/invite`;
}

export type InvitationOperations = {
  getTenant: (id: string) => Promise<InvitationTenant | null>;
  findAccount: (email: string) => Promise<InvitedAccount | null>;
  createAccount: (invitation: Invitation) => Promise<InvitedAccount>;
  audit: (accountId: string, invitation: Invitation, event: 'requested' | 'sent' | 'failed') => Promise<void>;
  sendEmail: (email: string, callback: string) => Promise<string>;
};

export async function sendSystemAdminInvitation(
  actor: { id: string; role: string },
  rawInput: unknown,
  appUrl: string | undefined,
  operations: InvitationOperations,
) {
  if (actor.role !== 'SuperAdmin') throw new Error('Only a SuperAdmin can invite a tenant SystemAdmin.');
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the invitation fields.');
  const input = parsed.data;
  const callback = invitationCallback(appUrl);
  const tenant = await operations.getTenant(input.tenantId);
  if (!tenant?.active) throw new Error('Select an active tenant.');

  let account = await operations.findAccount(input.email);
  let invitation: Invitation;
  if (account) {
    const pending = readInvitation(account);
    if (account.email_confirmed_at || !pending || pending.tenantId !== tenant.id) {
      throw new Error('This email already belongs to an account or another invitation. Use a new email; existing accounts are not moved by this form.');
    }
    invitation = pending;
  } else {
    invitation = {
      id: randomUUID(), tenantId: tenant.id, email: input.email, name: input.name,
      role: 'SystemAdmin', invitedBy: actor.id, createdAt: new Date().toISOString(),
    };
    account = await operations.createAccount(invitation);
  }

  // An audit failure before sending must not result in an unrecorded email.
  await operations.audit(account.id, invitation, 'requested');
  try {
    const sentToId = await operations.sendEmail(invitation.email, callback);
    if (sentToId !== account.id) throw new Error('Invitation recipient changed. Check the account before retrying.');
  } catch (error) {
    await operations.audit(account.id, invitation, 'failed').catch(() => {});
    throw error;
  }

  let warning: string | undefined;
  try {
    await operations.audit(account.id, invitation, 'sent');
  } catch {
    warning = 'Email was sent, but the final audit entry could not be saved. The invitation request is recorded.';
  }
  return { email: invitation.email, tenantName: tenant.name, warning };
}
