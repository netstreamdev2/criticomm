import { redirect } from 'next/navigation';
import { listTenants } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { TenantForms } from './tenant-forms';
import { InviteSystemAdminForm } from './invite-form';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tenants · HikTech' };

/**
 * The tenant register. SuperAdmin only — this is the platform tier, above any
 * single organisation.
 */
export default async function TenantsPage() {
  const { t } = await requestT();
  const { supabase, role } = await getSession();
  if (role !== 'SuperAdmin') redirect('/dashboard');

  const tenants = await listTenants(supabase);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Tenants')}</h1>
        <p className="text-muted-foreground">
          {t('Every organisation on this deployment. Each tenant’s data, users, configuration and feature switches are isolated at the database — a row in one tenant does not exist for another, on any screen, in any export, in any search.')}</p>
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left">{t('Tenant')}</th>
                <th className="px-4 py-3 text-left">{t('Slug')}</th>
                <th className="px-4 py-3 text-left">{t('Status')}</th>
                <th className="px-4 py-3 text-left">{t('Created')}</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{t.slug}</td>
                  <td className="px-4 py-3">
                    <span className={t.active
                      ? 'rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-bold text-success'
                      : 'rounded-full border border-border bg-bg-soft px-2 py-0.5 text-xs font-bold text-muted-foreground'}>
                      {t.active ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(t.created_at).toLocaleDateString('en-ZA')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Provisioning an organisation')}</CardTitle>
          <CardDescription>
            {t('Create the tenant, then invite its first SystemAdmin using their email address. Existing accounts can be reassigned using the separate form below.')}</CardDescription>
        </CardHeader>
      </Card>

      <InviteSystemAdminForm tenants={tenants.map((t) => ({ id: t.id, name: t.name, active: t.active }))} />
      <TenantForms tenants={tenants.map((t) => ({ id: t.id, name: t.name, slug: t.slug, active: t.active }))} />
    </div>
  );
}
