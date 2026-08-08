import type { CriticomClient, Database } from '@criticom/db';

/**
 * Per-tenant module access rules (migration 0035).
 *
 * A rule is a DENIAL: (href, role='*') hides a module for the whole tenant,
 * (href, role='Dispatcher') removes it for that role. Nothing here can grant
 * access the code's route matrix refuses — the overlay only subtracts, so a
 * compromised or mistaken row can never escalate anyone.
 *
 * Reads run under the caller's session and RLS scopes them to their tenant.
 * The SuperAdmin's Access Control console administers OTHER tenants through
 * the service role, guarded in the server action — same pattern as tenant
 * administration.
 */

export type AccessRule = Database['public']['Tables']['access_rules']['Row'];

/** The caller's tenant's rules — what nav, middleware and launcher consult. */
export async function listAccessRules(client: CriticomClient): Promise<AccessRule[]> {
  const { data, error } = await client.from('access_rules').select('*');
  if (error) {
    // Fail open to "no denials": an outage on this table must never blank a
    // console. The route matrix and feature flags still stand underneath.
    return [];
  }
  return data ?? [];
}

/** Service-role read for the console: any tenant's rules by id. */
export async function listAccessRulesForTenant(
  service: CriticomClient,
  tenantId: string,
): Promise<AccessRule[]> {
  const { data, error } = await service
    .from('access_rules')
    .select('*')
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return data ?? [];
}

/** Write a denial (allowed=false) for a tenant. Service-role, console-only. */
export async function denyModule(
  service: CriticomClient,
  args: { tenantId: string; href: string; role?: string; byName?: string },
): Promise<void> {
  const { error } = await service.from('access_rules').upsert({
    tenant_id: args.tenantId,
    href: args.href,
    role: args.role ?? '*',
    allowed: false,
    updated_by: args.byName ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Remove a denial — the module returns to what the route matrix says. */
export async function allowModule(
  service: CriticomClient,
  args: { tenantId: string; href: string; role?: string },
): Promise<void> {
  const { error } = await service
    .from('access_rules')
    .delete()
    .eq('tenant_id', args.tenantId)
    .eq('href', args.href)
    .eq('role', args.role ?? '*');
  if (error) throw error;
}

/**
 * The hrefs denied to `role` under `rules`. SuperAdmin is exempt — the seat
 * that writes the rules must never be lockable by them.
 */
export function deniedHrefs(rules: AccessRule[], role: string): string[] {
  if (role === 'SuperAdmin') return [];
  return rules
    .filter((r) => !r.allowed && (r.role === '*' || r.role === role))
    .map((r) => r.href);
}

/** Longest-prefix test used by middleware: is this pathname under a denial? */
export function isDenied(rules: AccessRule[], role: string, pathname: string): boolean {
  return deniedHrefs(rules, role).some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}
