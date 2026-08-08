import type { CriticomClient, Database } from '@criticom/db';

/**
 * Tenant administration (migration 0029).
 *
 * Reads are RLS-scoped: ordinary users resolve only their own tenant's row;
 * the platform tier (SuperAdmin/SystemAdmin) sees the register. Writes are
 * SuperAdmin-only at the policy level — these functions add nothing to that,
 * and must not, so the boundary lives in exactly one place.
 *
 * What is deliberately NOT here: assigning a user to a tenant. That rewrites
 * JWT app metadata, which only the service-role admin API can do, so it lives
 * in a server action beside the page that uses it — never in a package both
 * apps import.
 */

export type Tenant = Database['public']['Tables']['tenants']['Row'];

export async function listTenants(client: CriticomClient): Promise<Tenant[]> {
  const { data, error } = await client
    .from('tenants')
    .select('*')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function getMyTenant(client: CriticomClient): Promise<Tenant | null> {
  // RLS returns exactly the caller's tenant for non-platform roles, so with
  // no filter this resolves correctly for everyone; platform roles see the
  // register, so they pin to their own id via the JWT.
  const { data: { user } } = await client.auth.getUser();
  const tenantId = user?.app_metadata?.tenant_id as string | undefined;
  let q = client.from('tenants').select('*');
  if (tenantId) q = q.eq('id', tenantId);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createTenant(
  client: CriticomClient,
  args: { slug: string; name: string },
): Promise<Tenant> {
  const slug = args.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(slug)) {
    throw new Error('Slug must be 2–39 characters: lowercase letters, digits and hyphens.');
  }
  const { data, error } = await client
    .from('tenants')
    .insert({ slug, name: args.name.trim() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setTenantActive(
  client: CriticomClient,
  args: { id: string; active: boolean },
) {
  const { error } = await client
    .from('tenants')
    .update({ active: args.active, updated_at: new Date().toISOString() })
    .eq('id', args.id);
  if (error) throw error;
}
