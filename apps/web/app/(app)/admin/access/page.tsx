import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listAccessRulesForTenant, listTenants } from '@criticom/api';
import { ASSIGNABLE_ROLES } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { NAV_GROUPS } from '@/lib/nav';
import { getSession } from '@/lib/session';
import { getServiceSupabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { setModuleAccessAction } from './actions';
import { requestT } from '@/lib/i18n';
import { T } from '@/components/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Access Control · HikTech' };

/**
 * The SuperAdmin's per-tenant access console: hide any module for a whole
 * tenant, or deny it to specific roles within that tenant. Deny-only — a rule
 * can subtract from what the route matrix grants, never add to it.
 */

// Surfaces that must never be hideable: the platform desk itself, and the
// two destinations every account needs (a home and a way to sign out).
const NOT_CONFIGURABLE = ['/dashboard', '/profile', '/admin/access', '/admin/tenants', '/admin/features'];

// SuperAdmin is exempt from rules; System never signs in here.
const DENIABLE_ROLES = ASSIGNABLE_ROLES.filter((r) => r !== 'SuperAdmin');

export default async function AccessControlPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { t } = await requestT();
  const { supabase, role } = await getSession();
  if (role !== 'SuperAdmin') redirect('/dashboard');

  const tenants = await listTenants(supabase);
  const params = await searchParams;
  const tenant = tenants.find((t) => t.id === params.tenant) ?? tenants[0];
  if (!tenant) redirect('/admin/tenants');

  // Cross-tenant read needs the service role; the SuperAdmin gate above ran first.
  const rules = await listAccessRulesForTenant(getServiceSupabase(), tenant.id);
  const denials = rules.filter((r) => !r.allowed);
  const tenantWide = new Set(denials.filter((r) => r.role === '*').map((r) => r.href));
  const roleDenials = (href: string) => denials.filter((r) => r.href === href && r.role !== '*');

  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => !NOT_CONFIGURABLE.includes(i.href)) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Access Control')}</h1>
        <p className="text-muted-foreground">
          {t('What each tenant\'s portal offers, module by module — hide one for the whole organisation or deny it to specific roles. Rules only ever subtract from the built-in role matrix, and take effect everywhere within a minute.')}</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {tenants.map((t) => (
          <Link
            key={t.id}
            href={`/admin/access?tenant=${t.id}`}
            className={cn(
              'inline-flex h-9 items-center rounded-md border px-3 text-sm font-semibold transition-colors',
              t.id === tenant.id
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-border bg-bg-soft hover:bg-muted',
            )}
          >
            {t.name}
            {!t.active && <span className="ml-2 text-[10px] uppercase text-muted-foreground"><T s="inactive" /></span>}
          </Link>
        ))}
      </div>

      {groups.map((g) => (
        <Card key={g.id}>
          <CardHeader>
            <CardTitle>{g.label}</CardTitle>
            {g.id === 'overview' && (
              <CardDescription>{t('The command dashboard\'s launcher honours these rules too.')}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {g.items.map((item) => {
              const hiddenForAll = tenantWide.has(item.href);
              const perRole = roleDenials(item.href);
              return (
                <div key={item.href} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {item.label}
                      <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">{item.href}</span>
                    </p>
                    {perRole.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {perRole.map((r) => (
                          <form key={r.role} action={setModuleAccessAction} className="inline-flex">
                            <input type="hidden" name="tenant_id" value={tenant.id} />
                            <input type="hidden" name="href" value={item.href} />
                            <input type="hidden" name="role" value={r.role} />
                            <input type="hidden" name="deny" value="false" />
                            <button
                              type="submit"
                              title={`Restore ${item.label} for ${r.role}`}
                              className="inline-flex items-center gap-1 rounded-full bg-severity-critical/15 px-2 py-0.5 text-[11px] font-semibold text-severity-critical-ink hover:bg-severity-critical/25"
                            >
                              {r.role} ✕
                            </button>
                          </form>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {/* Per-role denial */}
                    {!hiddenForAll && (
                      <form action={setModuleAccessAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="tenant_id" value={tenant.id} />
                        <input type="hidden" name="href" value={item.href} />
                        <input type="hidden" name="deny" value="true" />
                        <select
                          name="role"
                          aria-label={`Deny ${item.label} for role`}
                          className="h-8 rounded-md border border-border bg-bg-soft px-1.5 text-xs"
                        >
                          {DENIABLE_ROLES.filter((r) => !perRole.some((d) => d.role === r)).map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                        <button type="submit" className="h-8 rounded-md bg-muted px-2.5 text-xs font-semibold hover:bg-severity-critical/20">
                          {t('Deny role')}</button>
                      </form>
                    )}

                    {/* Tenant-wide switch */}
                    <form action={setModuleAccessAction}>
                      <input type="hidden" name="tenant_id" value={tenant.id} />
                      <input type="hidden" name="href" value={item.href} />
                      <input type="hidden" name="role" value="*" />
                      <input type="hidden" name="deny" value={hiddenForAll ? 'false' : 'true'} />
                      <button
                        type="submit"
                        className={cn(
                          'h-8 rounded-md px-3 text-xs font-bold uppercase tracking-wide',
                          hiddenForAll
                            ? 'bg-severity-critical/15 text-severity-critical-ink hover:bg-severity-critical/25'
                            : 'bg-severity-low/15 text-severity-low-ink hover:bg-severity-low/25',
                        )}
                      >
                        {hiddenForAll ? 'Hidden — restore' : 'Visible'}
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
