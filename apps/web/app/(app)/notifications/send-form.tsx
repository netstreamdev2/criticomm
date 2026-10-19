'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Undo2 } from 'lucide-react';
import {
  audienceLabel, NOTIFIABLE_ROLES, NOTIFICATION_DEPARTMENTS, rolePlural, type NotificationReach,
} from '@criticom/api';
import type { Silo } from '@criticom/db';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { sendNotificationAction, withdrawNotificationAction, type SendState } from './actions';

export type Person = { id: string; name: string; silo: string };
type Audience = 'person' | 'people' | 'role' | 'department' | 'organisation';

const field = 'h-10 w-full rounded-xl border border-border bg-bg-soft/70 px-3 text-sm';

/**
 * Send a notification. It offers only what the database allows this person
 * (notification_reach): one person for everyone; a few people, a role or the
 * department for administrators, command and the desks; everyone for the
 * organisation's administrators.
 */
export function SendNotificationForm({ reach, people, meId }: { reach: NotificationReach; people: Person[]; meId: string }) {
  const { t } = useT();
  const [state, action, pending] = useActionState<SendState, FormData>(sendNotificationAction, null);
  const form = useRef<HTMLFormElement>(null);
  const [audience, setAudience] = useState<Audience>('person');
  const [silo, setSilo] = useState<string>(reach.silo ?? 'MetroPolice');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<Set<string>>(new Set());
  const [everyDept, setEveryDept] = useState(false);
  const [find, setFind] = useState('');

  useEffect(() => {
    if (!state?.ok) return;
    form.current?.reset();
    setPicked(new Set());
    setRoles(new Set());
    setEveryDept(false);
    setFind('');
  }, [state]);

  const options: Array<{ key: Audience; label: string }> = [
    { key: 'person', label: 'One person' },
    ...(reach.groups ? [
      { key: 'people' as const, label: 'A few people' },
      { key: 'role' as const, label: 'A role' },
      { key: 'department' as const, label: reach.anyDepartment ? 'A department' : 'My department' },
    ] : []),
    ...(reach.organisation ? [{ key: 'organisation' as const, label: 'Everyone' }] : []),
  ];

  // A few people: your own department, unless you may reach any.
  const reachable = useMemo(
    () => people.filter((p) => p.id !== meId && (audience === 'person' || reach.anyDepartment || p.silo === reach.silo)),
    [people, meId, audience, reach],
  );
  const found = reachable.filter((p) => !find || p.name.toLowerCase().includes(find.toLowerCase())).slice(0, 80);

  const toggle = (set: Set<string>, v: string, max = Number.POSITIVE_INFINITY) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else if (next.size < max) next.add(v);
    return next;
  };

  const goesTo = (() => {
    if (audience === 'person') return null;
    if (audience === 'people') return picked.size ? t('{n} people', { n: picked.size }) : null;
    const row = { silo, target_user_id: null, target_users: null, all_departments: everyDept, target_roles: [...roles] };
    if (audience === 'role') return roles.size ? audienceLabel({ ...row, audience }) : null;
    return audienceLabel({ ...row, audience });
  })();

  const pickDepartment = reach.anyDepartment && (audience === 'department' || (audience === 'role' && !everyDept));

  return (
    <form ref={form} action={action} className="space-y-3.5">
      <input type="hidden" name="audience" value={audience} />
      {audience === 'department' || audience === 'role' ? <input type="hidden" name="silo" value={silo} /> : null}

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('To')}</p>
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setAudience(o.key)}
              className={cn(
                'h-8 rounded-full border px-3 text-xs font-semibold transition-colors',
                audience === o.key ? 'chip-on' : 'border-border text-muted-foreground hover:text-fg',
              )}
            >
              {t(o.label)}
            </button>
          ))}
        </div>
      </div>

      {audience === 'person' ? (
        <select name="user" required className={field} defaultValue="">
          <option value="" disabled>{t('Choose the person')}</option>
          {reachable.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {NOTIFICATION_DEPARTMENTS[p.silo] ?? p.silo}</option>
          ))}
        </select>
      ) : null}

      {audience === 'people' ? (
        <div className="space-y-2">
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('Find a name')} className={field} />
          <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1">
            {found.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-fg/5">
                  <input
                    type="checkbox"
                    name="users"
                    value={p.id}
                    checked={picked.has(p.id)}
                    onChange={() => setPicked((cur) => toggle(cur, p.id, 50))}
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-[11px] text-muted-foreground">{NOTIFICATION_DEPARTMENTS[p.silo] ?? p.silo}</span>
                </label>
              </li>
            ))}
            {found.length === 0 ? <li className="px-2 py-3 text-center text-xs text-muted-foreground">{t('No one by that name.')}</li> : null}
          </ul>
          {/* Picked people hidden by the search still go. */}
          {[...picked].filter((id) => !found.some((p) => p.id === id)).map((id) => (
            <input key={id} type="hidden" name="users" value={id} />
          ))}
        </div>
      ) : null}

      {audience === 'role' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {NOTIFIABLE_ROLES.map((r) => (
              <label
                key={r}
                className={cn(
                  'cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  roles.has(r) ? 'chip-on' : 'border-border text-muted-foreground hover:text-fg',
                )}
              >
                <input type="checkbox" name="roles" value={r} className="sr-only" checked={roles.has(r)} onChange={() => setRoles((cur) => toggle(cur, r, 12))} />
                {t(rolePlural(r))}
              </label>
            ))}
          </div>
          {reach.organisation ? (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="all_departments" checked={everyDept} onChange={(e) => setEveryDept(e.target.checked)} />
              {t('In every department')}
            </label>
          ) : null}
        </div>
      ) : null}

      {pickDepartment ? (
        <select value={silo} onChange={(e) => setSilo(e.target.value as Silo)} className={field} aria-label={t('Department')}>
          {Object.entries(NOTIFICATION_DEPARTMENTS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
        </select>
      ) : null}

      <input name="title" required maxLength={140} placeholder={t('Title')} className={field} />
      <textarea name="body" rows={3} maxLength={1000} placeholder={t('Message (optional)')} className="w-full rounded-xl border border-border bg-bg-soft/70 px-3 py-2 text-sm" />

      <div className="flex flex-wrap items-center gap-3">
        <fieldset className="flex gap-1">
          <legend className="sr-only">{t('Priority')}</legend>
          {(['Low', 'Medium', 'High'] as const).map((s) => (
            <label key={s} className="cursor-pointer">
              <input type="radio" name="severity" value={s} defaultChecked={s === 'Low'} className="peer sr-only" />
              <span className="inline-block rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground peer-checked:chip-on">
                {t(s)}
              </span>
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          {pending ? t('Sending…') : t('Send')}
        </button>
      </div>

      {goesTo ? <p className="text-xs text-muted-foreground">{t('Goes to: {who}', { who: goesTo })}</p> : null}
      {state?.error ? <p className="text-xs font-medium text-severity-critical-ink">{t(state.error)}</p> : null}
      {state?.ok ? <p className="text-xs font-medium text-severity-low-ink">{t('Sent.')}</p> : null}
    </form>
  );
}

/** Take back a notification you sent. */
export function WithdrawButton({ id }: { id: string }) {
  const { t } = useT();
  return (
    <form
      action={withdrawNotificationAction}
      onSubmit={(e) => { if (!window.confirm(t('Take this notification back? It disappears for everyone it went to.'))) e.preventDefault(); }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-fg/5 hover:text-fg">
        <Undo2 className="h-3 w-3" /> {t('Take back')}
      </button>
    </form>
  );
}
