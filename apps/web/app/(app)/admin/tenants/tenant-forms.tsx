'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { assignUserTenantAction, createTenantAction, deleteTenantAction } from './actions';
import { useToast } from '@/components/toast';

const input = 'h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const button = 'inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50';

export function TenantForms({ tenants }: { tenants: Array<{ id: string; name: string; slug: string; active: boolean }> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');
  const [deleteId, setDeleteId] = useState('');
  const [confirmSlug, setConfirmSlug] = useState('');

  const deletable = tenants.filter((t) => t.slug !== 'ethekwini');
  const deleteTarget = deletable.find((t) => t.id === deleteId);

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

  const remove = () => {
    const fd = new FormData();
    fd.set('id', deleteId);
    fd.set('confirm_slug', confirmSlug);
    start(async () => {
      const res = await deleteTenantAction(fd);
      if (res?.error) { toast.push({ title: res.error, tone: 'critical', duration: 8000 }); return; }
      toast.push({ title: `Tenant "${res?.name}" deleted`, tone: 'success', duration: 5000 });
      setDeleteId(''); setConfirmSlug('');
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

      <div className="rounded-xl border border-severity-critical/40 bg-bg-card p-4 lg:col-span-2">
        <h2 className="mb-1 font-semibold text-severity-critical-ink">Delete a tenant</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          No undo. Refused while users are still assigned, and the founding tenant can never be
          deleted. To switch a customer off reversibly, suspend them instead.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <span className={label}>Tenant</span>
            <select
              className={input}
              value={deleteId}
              onChange={(e) => { setDeleteId(e.target.value); setConfirmSlug(''); }}
            >
              <option value="">Select…</option>
              {deletable.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.active ? '' : ' (suspended)'}</option>
              ))}
            </select>
          </div>
          <div>
            <span className={label}>Type the slug to confirm</span>
            <input
              className={input}
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
              placeholder={deleteTarget ? deleteTarget.slug : 'slug'}
              disabled={!deleteId}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-severity-critical/85 px-4 text-sm font-semibold text-white disabled:opacity-50"
              disabled={pending || !deleteTarget || confirmSlug.trim().toLowerCase() !== deleteTarget.slug}
              onClick={remove}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Delete permanently
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
