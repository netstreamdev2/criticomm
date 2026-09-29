'use server';

import { revalidatePath } from 'next/cache';
import { createTenant, deleteTenant, logAudit, setTenantActive } from '@criticom/api';
import { getSession } from '@/lib/session';
import { getServiceSupabase } from '@/lib/supabase';

/**
 * Tenant administration. SuperAdmin only, and every action audited.
 *
 * Assigning a user to a tenant is the one operation here that needs the
 * service role: it rewrites JWT app metadata, which no user session may do.
 * The role check therefore happens BEFORE the elevated client is created —
 * the service key must never be reachable from an unauthorised code path,
 * even one that would fail later.
 */

async function requireSuperAdmin() {
  const session = await getSession();
  if (session.role !== 'SuperAdmin') throw new Error('SuperAdmin only.');
  return session;
}

export async function createTenantAction(formData: FormData) {
  try {
    const { supabase, fullName } = await requireSuperAdmin();
    const tenant = await createTenant(supabase, {
      slug: String(formData.get('slug') ?? ''),
      name: String(formData.get('name') ?? ''),
    });
    await logAudit(supabase, {
      silo: 'Ethekwini', action_type: 'TenantCreated', entity_type: 'tenant',
      entity_id: tenant.id, user_name: fullName,
      details: `Created tenant "${tenant.name}" (${tenant.slug})`,
    }).catch(() => {});
    revalidatePath('/admin/tenants');
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setTenantActiveAction(formData: FormData) {
  try {
    const { supabase, fullName } = await requireSuperAdmin();
    const id = String(formData.get('id') ?? '');
    const active = String(formData.get('active') ?? '') === 'true';
    await setTenantActive(supabase, { id, active });
    await logAudit(supabase, {
      silo: 'Ethekwini', action_type: active ? 'TenantActivated' : 'TenantSuspended',
      entity_type: 'tenant', entity_id: id, user_name: fullName,
      details: active ? 'Tenant activated' : 'Tenant suspended',
    }).catch(() => {});
    revalidatePath('/admin/tenants');
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteTenantAction(formData: FormData) {
  try {
    const { supabase, fullName } = await requireSuperAdmin();

    const id = String(formData.get('id') ?? '');
    const confirmSlug = String(formData.get('confirm_slug') ?? '').trim().toLowerCase();
    if (!id) return { error: 'No tenant selected.' };

    // Deleting an organisation is the one action here with no undo, so the
    // caller must type the slug — a click can be a slip; a typed slug cannot.
    const service = getServiceSupabase();
    const { data: target } = await service.from('tenants').select('slug, name').eq('id', id).maybeSingle();
    if (!target) return { error: 'Tenant not found.' };
    if (confirmSlug !== target.slug) {
      return { error: `Type the tenant's slug ("${target.slug}") to confirm deletion.` };
    }

    const tenant = await deleteTenant(service, { id });

    await logAudit(supabase, {
      silo: 'Ethekwini', action_type: 'TenantDeleted', entity_type: 'tenant',
      entity_id: id, user_name: fullName,
      details: `Deleted tenant "${tenant.name}" (${tenant.slug})`,
    }).catch(() => {});

    revalidatePath('/admin/tenants');
    return { ok: true, name: tenant.name };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function assignUserTenantAction(formData: FormData) {
  try {
    const { supabase, fullName } = await requireSuperAdmin();

    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const tenantId = String(formData.get('tenant_id') ?? '');
    if (!email || !tenantId) return { error: 'Email and tenant are required.' };

    const admin = getServiceSupabase();

    // The admin API has no lookup-by-email; page through. Fine at this scale,
    // and it keeps us off undocumented endpoints.
    let user = null;
    for (let page = 1; page <= 10 && !user; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      user = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
      if (data.users.length < 200) break;
    }
    if (!user) return { error: `No account found for ${email}.` };

    const { error: ue } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, tenant_id: tenantId },
    });
    if (ue) throw ue;

    // The profile row must move too — require_role() and every people screen
    // read it, and a profile stranded in the old tenant would be invisible to
    // the new one's administrators.
    await admin.from('profiles').update({ tenant_id: tenantId }).eq('id', user.id);

    await logAudit(supabase, {
      silo: 'Ethekwini', action_type: 'UserTenantChanged', entity_type: 'user',
      entity_id: user.id, user_name: fullName,
      details: `${email} moved to tenant ${tenantId}. Takes effect on their next sign-in.`,
    }).catch(() => {});

    revalidatePath('/admin/tenants');
    return { ok: true, note: 'Takes effect when the user next signs in — their current session keeps its old tenant until then.' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
