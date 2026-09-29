import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { logAudit } from '@criticom/api';
import { getServiceSupabase } from '@/lib/supabase';
import { pendingMetadata, readInvitation, sendSystemAdminInvitation } from './workflow';
import { createInvitationReceipt, readInvitationReceipt } from './receipt';

function signingKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  return key;
}

function emailError(error: { message: string; code?: string }) {
  if (error.code === 'email_address_not_authorized' || /not authorized|authorized addresses/i.test(error.message)) {
    return new Error('Supabase only permits team email addresses with its default sender. Use your Supabase team email for this test, or configure custom SMTP.');
  }
  if (/rate.limit|too many|security purposes/i.test(error.message)) {
    return new Error('Supabase’s email limit was reached. Wait before resending, or check Authentication → Rate Limits.');
  }
  return new Error(`Email could not be sent: ${error.message}. Check Supabase SMTP and Auth logs, then retry this same pending invitation.`);
}

export async function inviteTenantAdmin(
  actor: { id: string; role: string; name: string },
  input: { name: string; email: string; tenantId: string },
) {
  // Keep the privileged client out of the path for unauthorized callers.
  if (actor.role !== 'SuperAdmin') throw new Error('SuperAdmin only.');
  const service = getServiceSupabase();
  return sendSystemAdminInvitation(actor, input, process.env.NEXT_PUBLIC_APP_URL, {
    async getTenant(id) {
      const { data, error } = await service.from('tenants').select('id, name, active').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
    async findAccount(email) {
      for (let page = 1; ; page += 1) {
        const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const found = data.users.find((user) => user.email?.toLowerCase() === email);
        if (found) return found;
        if (data.users.length < 200) return null;
      }
    },
    async createAccount(invitation) {
      // createUser does not send mail. Provision the pending metadata first so
      // a fast click cannot arrive before its tenant assignment is recorded.
      const { data, error } = await service.auth.admin.createUser({
        email: invitation.email, email_confirm: false,
        app_metadata: pendingMetadata(invitation),
        user_metadata: { full_name: invitation.name },
      });
      if (error) throw error;
      if (!data.user) throw new Error('Could not prepare the invited account.');
      return data.user;
    },
    async audit(accountId, invitation, event) {
      await logAudit(service, {
        tenant_id: invitation.tenantId, silo: 'Ethekwini', user_id: actor.id, user_name: actor.name,
        action_type: `SystemAdminInvitation_${event}`, entity_type: 'user', entity_id: accountId,
        details: `${invitation.email}; intended role SystemAdmin; invitation ${invitation.id}`,
      });
    },
    async sendEmail(email, callback) {
      const { data, error } = await service.auth.admin.inviteUserByEmail(email, { redirectTo: callback });
      if (error) throw emailError(error);
      if (!data.user) throw new Error('Supabase did not return an invitation recipient.');
      return data.user.id;
    },
  });
}

export async function verifyInvitation(tokenHash: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured.');
  // A separate, stateless client preserves the existing SuperAdmin cookie.
  // Neither the returned access token nor refresh token goes to the browser.
  const verifier = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' });
  if (error || !data.user || !data.session) return null;
  const { error: signOutError } = await verifier.auth.signOut({ scope: 'local' });
  if (signOutError) throw signOutError;
  const invitation = readInvitation(data.user);
  if (!invitation) return null;

  const service = getServiceSupabase();
  const { data: tenant, error: tenantError } = await service.from('tenants')
    .select('id, active').eq('id', invitation.tenantId).maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant?.active) return null;
  await logAudit(service, {
    tenant_id: invitation.tenantId, silo: 'Ethekwini', user_id: data.user.id,
    user_name: invitation.name, action_type: 'SystemAdminInvitation_verified',
    entity_type: 'user', entity_id: data.user.id, details: `Invitation ${invitation.id}; password setup pending`,
  });
  return createInvitationReceipt(data.user.id, invitation.id, signingKey());
}

export async function getVerifiedInvitation(cookie: string | undefined) {
  if (!cookie) return null;
  const receipt = readInvitationReceipt(cookie, signingKey());
  if (!receipt) return null;
  const service = getServiceSupabase();
  const { data, error } = await service.auth.admin.getUserById(receipt.userId);
  if (error) throw error;
  if (!data.user?.email_confirmed_at) return null;
  const invitation = readInvitation(data.user);
  if (!invitation || invitation.id !== receipt.invitationId) return null;
  const { data: tenant, error: tenantError } = await service.from('tenants')
    .select('name, active').eq('id', invitation.tenantId).maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant?.active) return null;
  return { email: invitation.email, name: invitation.name, tenantName: tenant.name, role: invitation.role };
}
