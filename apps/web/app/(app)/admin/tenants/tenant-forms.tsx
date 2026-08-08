'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { assignUserTenantAction, createTenantAction } from './actions';
import { useToast } from '@/components/toast';

const input = 'h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const button = 'inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50';

export function TenantForms({ tenants }: { tenants: Array<{ id: string; name: string; active: boolean }> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');

  const create = () => {
    const fd = new FormData();
    fd.set('slug', slug);
    fd.set('name', name);
    start(async () => {
      const res = await createTenantAction(fd);
      if (res?.error) { toast.push({ title: res.error, tone: 'critical', duration: 6000 }); return; }
      toast.push({ title: `Tenant "${name}" created`, tone: 'success', duration: 4000 });
      setSlug(''); setName('');
      router.refresh();
    });
  };

  const assign = () => {
    const fd = new FormData();
    fd.set('email', email);
    fd.set('tenant_id', tenantId);
    start(async () => {
      const res = await assignUserTenantAction(fd);
      if (res?.error) { toast.push({ title: res.error, tone: 'critical', duration: 6000 }); return; }
      toast.push({
        title: 'User reassigned',
        body: res?.note,
        tone: 'success', duration: 8000,
      });
      setEmail('');
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <h2 className="mb-3 font-semibold">Create a tenant</h2>
        <div className="space-y-3">
          <div>
            <span className={label}>Name</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)}
              placeholder="City of uMhlathuze" />
          </div>
          <div>
            <span className={label}>Slug</span>
            <input className={input} value={slug} onChange={(e) => setSlug(e.target.value)}
              placeholder="umhlathuze" />
            <p className="mt-1 text-xs text-muted-foreground">
              Lowercase letters, digits and hyphens. Permanent once created.
            </p>
          </div>
          <button type="button" className={button} disabled={pending || !slug || !name} onClick={create}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Create tenant
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-bg-card p-4">
        <h2 className="mb-3 font-semibold">Assign a user to a tenant</h2>
        <div className="space-y-3">
          <div>
            <span className={label}>Account email</span>
            <input className={input} value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@municipality.gov.za" type="email" />
          </div>
          <div>
            <span className={label}>Tenant</span>
            <select className={input} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.active ? '' : ' (suspended)'}</option>
              ))}
            </select>
          </div>
          <button type="button" className={button} disabled={pending || !email || !tenantId} onClick={assign}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Reassign
          </button>
          <p className="text-xs text-muted-foreground">
            Takes effect on their next sign-in. Their existing records do not move — a person
            changes tenant; history stays where it happened.
          </p>
        </div>
      </div>
    </div>
  );
}
