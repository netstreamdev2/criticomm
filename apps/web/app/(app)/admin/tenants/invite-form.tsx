'use client';

import { useState, useTransition } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { inviteSystemAdminAction } from './actions';

export function InviteSystemAdminForm({ tenants }: {
  tenants: { id: string; name: string; active: boolean }[];
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof inviteSystemAdminAction>> | null>(null);
  const activeTenants = tenants.filter((tenant) => tenant.active);
  const field = 'mt-1 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setResult(null);
    start(async () => {
      try { setResult(await inviteSystemAdminAction(data)); }
      catch { setResult({ error: 'The request could not be completed. Check your connection and try again.' }); }
    });
  }

  return (
    <section className="rounded-xl border border-primary/30 bg-bg-card p-5" aria-labelledby="invite-title">
      <div className="mb-4 flex items-start gap-3">
        <Mail className="mt-1 size-5 text-primary" aria-hidden="true" />
        <div>
          <h2 id="invite-title" className="font-semibold">Invite a SystemAdmin</h2>
          <p className="mt-1 text-sm text-muted-foreground">Invite the person who will manage the organisation. Their invitation is for the SystemAdmin role.</p>
        </div>
      </div>
      <form onSubmit={submit}>
        <fieldset disabled={pending || activeTenants.length === 0} className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="invite-tenant" className="text-xs font-semibold uppercase text-muted-foreground">Organisation</label>
            <select id="invite-tenant" name="tenant_id" className={field} required defaultValue="">
              <option value="" disabled>Select an organisation</option>
              {activeTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="invite-name" className="text-xs font-semibold uppercase text-muted-foreground">Full name</label>
            <input id="invite-name" name="name" className={field} required maxLength={120} autoComplete="name" />
          </div>
          <div>
            <label htmlFor="invite-email" className="text-xs font-semibold uppercase text-muted-foreground">Email address</label>
            <input id="invite-email" name="email" type="email" className={field} required maxLength={254} autoComplete="email" placeholder="administrator@gmail.com" />
          </div>
          <div className="sm:col-span-3">
            <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Mail className="size-4" aria-hidden="true" />}
              {pending ? 'Sending invitation…' : 'Send invitation'}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">To resend an unused invitation, submit the same email and organisation again.</p>
          </div>
        </fieldset>
        {activeTenants.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Create an active tenant first.</p>}
        {result && 'error' in result && <p role="alert" className="mt-4 rounded-md border border-severity-critical/40 bg-severity-critical/10 p-3 text-sm text-severity-critical-ink">{result.error}</p>}
        {result && 'ok' in result && (
          <output className="mt-4 block rounded-md border border-success/40 bg-success/10 p-3 text-sm">
            <span>Invitation sent to <strong>{result.email}</strong> for <strong>{result.tenantName}</strong>. Check the inbox and spam folder.</span>
            {result.warning && <span className="mt-2 block">{result.warning}</span>}
          </output>
        )}
      </form>
    </section>
  );
}
