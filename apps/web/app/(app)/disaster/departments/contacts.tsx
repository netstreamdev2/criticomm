'use client';

import { useState, useTransition } from 'react';
import { ChevronDown, Pencil, Plus } from 'lucide-react';
import { LINE_FUNCTIONS } from '@criticom/db/disaster-departments';
import { CallButton } from '@/components/disaster/call-button';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { saveContactAction } from '../desk/actions';

type Contact = { id: string; department: string; name: string; post: string | null; phone: string | null; email: string | null; docRep: boolean };

/** Each line function as a card: its role on an incident (folded), its contacts, add and change in place. */
export function DepartmentContacts({ contacts, canEdit }: { contacts: Contact[]; canEdit: boolean }) {
  const { t } = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [roles, setRoles] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const withRep = LINE_FUNCTIONS.filter((d) => contacts.some((c) => c.department === d.key && c.docRep)).length;
  return (
    <div className="space-y-5">
      <p className="text-sm font-medium">{t('{n} of {all} departments have a DOC representative recorded.', { n: withRep, all: LINE_FUNCTIONS.length })}</p>
      {error ? <p role="alert" className="rounded-lg border border-severity-critical bg-bg-card px-4 py-3 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
      <ul className="grid gap-5 lg:grid-cols-2">
        {LINE_FUNCTIONS.map((d) => {
          const mine = contacts.filter((c) => c.department === d.key);
          return (
            <li key={d.key} className="flex flex-col gap-3 rounded-xl border border-border bg-bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-semibold leading-tight">{d.name}</p>
                  <p className="text-sm text-muted-foreground">{d.head}</p>
                </div>
                {mine.some((c) => c.docRep) ? null : <span className="shrink-0 rounded-full border border-severity-medium px-2.5 py-0.5 text-xs font-semibold text-severity-medium-ink">{t('No DOC representative')}</span>}
              </div>
              <ul className="space-y-2">
                {mine.map((c) => editing === c.id ? (
                  <li key={c.id}><ContactForm department={d.key} contact={c} onDone={() => setEditing(null)} onError={setError} /></li>
                ) : (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{c.name}{c.docRep ? <span className="ml-2 text-xs font-semibold text-accent">{t('DOC representative')}</span> : null}</p>
                      <p className="text-muted-foreground">{[c.post, c.email].filter(Boolean).join(' · ')}</p>
                    </div>
                    <CallButton number={c.phone} size="sm" />
                    {canEdit ? <button type="button" onClick={() => setEditing(c.id)} aria-label={t('Change')} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Pencil className="h-4 w-4" aria-hidden /></button> : null}
                  </li>
                ))}
              </ul>
              {editing === `new:${d.key}` ? <ContactForm department={d.key} contact={null} onDone={() => setEditing(null)} onError={setError} /> : null}
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
                {canEdit && editing !== `new:${d.key}` ? (
                  <button type="button" onClick={() => setEditing(`new:${d.key}`)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">
                    <Plus className="h-4 w-4" aria-hidden />{t('Add a contact')}
                  </button>
                ) : null}
                <button type="button" onClick={() => setRoles(roles === d.key ? null : d.key)} aria-expanded={roles === d.key}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
                  {t('Role during disaster operations')}<ChevronDown className={cn('h-4 w-4 transition', roles === d.key && 'rotate-180')} aria-hidden />
                </button>
              </div>
              {roles === d.key ? (
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">{d.roles.map((r) => <li key={r}>{r}</li>)}</ol>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ContactForm({ department, contact, onDone, onError }: {
  department: string; contact: Contact | null; onDone: () => void; onError: (e: string | null) => void;
}) {
  const { t } = useT();
  const [v, setV] = useState({ name: contact?.name ?? '', post: contact?.post ?? '', phone: contact?.phone ?? '', email: contact?.email ?? '' });
  const [rep, setRep] = useState(contact?.docRep ?? false);
  const [active, setActive] = useState(true);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    onError(null);
    const res = await saveContactAction(contact?.id ?? null, { department, ...v, doc_rep: rep, is_active: active });
    if ('error' in res) onError(res.error);
    else onDone();
  });
  const field = 'mt-1 h-10 w-full rounded-md border border-border bg-bg-card px-3 text-sm';
  return (
    <div className="space-y-3 rounded-lg border border-accent bg-bg-soft p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">{t('Name')}<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={160} className={field} /></label>
        <label className="block text-sm font-medium">{t('Post')}<input value={v.post} onChange={(e) => setV({ ...v, post: e.target.value })} maxLength={120} placeholder={t('Head, Deputy Head or Senior Manager')} className={field} /></label>
        <label className="block text-sm font-medium">{t('Phone')}<input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} maxLength={60} inputMode="tel" className={field} /></label>
        <label className="block text-sm font-medium">{t('Email')}<input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} maxLength={160} inputMode="email" className={field} /></label>
      </div>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={rep} onChange={(e) => setRep(e.target.checked)} className="h-4 w-4" />{t('DOC representative')}</label>
        {contact ? <label className="flex items-center gap-2"><input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} className="h-4 w-4" />{t('No longer in this post')}</label> : null}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={pending || !v.name.trim()} className="h-10 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? t('Saving…') : t('Save')}</button>
        <button type="button" onClick={onDone} className="h-10 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
      </div>
    </div>
  );
}
