'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Mail, Phone, Search, TriangleAlert } from 'lucide-react';
import { registerStatus, type RegisterPerson } from '@criticom/api';
import { DEPARTMENT_NAMES, inviteChannelFor, roleFitsDepartment, roleName, type Silo, type UserRole } from '@criticom/db';
import { inviteFromRegisterAction } from '@/app/(app)/admin/invitations/actions';
import { BulkRunDialog, type BulkItem } from '@/components/register/bulk-run';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { markLeftAction, moveDepartmentAction, restoreAction, setRolesAction } from './register-actions';
import { useT } from '@/components/i18n';

export type StatusFilter =
  | 'current' | 'to-confirm' | 'no-role' | 'ready' | 'invited' | 'active' | 'not-listed' | 'shared-badge' | 'left' | 'all';

const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'current', label: 'Everyone current' },
  { id: 'to-confirm', label: 'Role to confirm' },
  { id: 'no-role', label: 'Role not set' },
  { id: 'ready', label: 'Ready to invite' },
  { id: 'invited', label: 'Invited' },
  { id: 'active', label: 'Has an account' },
  { id: 'not-listed', label: 'Not in the latest staff list' },
  { id: 'shared-badge', label: 'Shared badge number' },
  { id: 'left', label: 'Left' },
  { id: 'all', label: 'Everyone, including leavers' },
];

const TONE = {
  ok: 'bg-success/15 text-success',
  info: 'bg-primary/15 text-primary',
  warn: 'bg-severity-medium/15 text-severity-medium-ink',
  crit: 'bg-severity-critical/15 text-severity-critical-ink',
  dim: 'bg-muted text-muted-foreground',
} as const;

const PAGE = 100;
const selectClass = 'h-9 rounded-md border border-border bg-bg-soft px-2 text-sm';

const fullName = (p: RegisterPerson) => `${p.first_name} ${p.last_name}`.trim();

/**
 * The staff register: everyone who works here, with or without an account.
 * Filter to a station, confirm roles in bulk, invite the ones who are ready,
 * and mark leavers, all with the rules of migration 0050 behind them.
 */
export function RegisterTable({
  people, canManage, canMove = false, roleOptions, delivery, latestImport, sharedBadgeIds, initialFilter, initialQuery = '',
}: {
  people: RegisterPerson[];
  canManage: boolean;
  roleOptions: UserRole[];
  delivery: { email: boolean; sms: boolean };
  latestImport: { id: string; departments: Silo[] } | null;
  sharedBadgeIds: string[];
  initialFilter: StatusFilter;
  /** SystemAdmin and SuperAdmin put a wrong department right (0067). */
  canMove?: boolean;
  /** Opened from a link that names someone, e.g. the invite page. */
  initialQuery?: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(initialQuery);
  const [silo, setSilo] = useState<Silo | 'all'>('all');
  const [station, setStation] = useState('all');
  const [filter, setFilter] = useState<StatusFilter>(initialFilter);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<UserRole | ''>('');
  const [inviting, setInviting] = useState<BulkItem[] | null>(null);
  const [leaving, setLeaving] = useState<{ person: RegisterPerson; mode: 'leave' | 'restore' } | null>(null);
  const [moving, setMoving] = useState<RegisterPerson | null>(null);

  const shared = useMemo(() => new Set(sharedBadgeIds), [sharedBadgeIds]);
  const silos = useMemo(() => [...new Set(people.map((p) => p.silo))].sort(), [people]);
  const stations = useMemo(
    () => [...new Set(people.filter((p) => silo === 'all' || p.silo === silo).map((p) => p.station?.trim()).filter((s): s is string => !!s))].sort(),
    [people, silo],
  );

  const visible = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return people.filter((p) => {
      if (silo !== 'all' && p.silo !== silo) return false;
      if (station !== 'all' && (p.station?.trim() ?? '') !== station) return false;
      if (words.length) {
        const hay = `${p.first_name} ${p.last_name} ${p.badge_number} ${p.rank} ${p.station ?? ''}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      const key = registerStatus(p).key;
      switch (filter) {
        case 'current': return !p.left_at;
        case 'to-confirm': return key === 'suggested';
        case 'no-role': return key === 'no-role';
        case 'ready': return key === 'ready';
        case 'invited': return key === 'invited';
        case 'active': return key === 'active' || key === 'deactivated';
        case 'not-listed': return !p.left_at && !!latestImport && latestImport.departments.includes(p.silo) && p.hr_import_id !== latestImport.id;
        case 'shared-badge': return shared.has(p.id);
        case 'left': return !!p.left_at;
        default: return true;
      }
    });
  }, [people, q, silo, station, filter, latestImport, shared]);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const shown = visible.slice(page * PAGE, page * PAGE + PAGE);
  const chosen = people.filter((p) => selected.has(p.id));
  const invitable = chosen.filter((p) => registerStatus(p).key === 'ready');
  // A field role belongs to one department: only roles that fit every chosen
  // person's department are offered (role_fits_department, 0067).
  const chosenDepartments = [...new Set(chosen.map((p) => p.silo))];
  const bulkOptions = roleOptions.filter((r) => chosenDepartments.every((d) => roleFitsDepartment(r, d)));
  const mixedDepartments = chosenDepartments.length > 1;
  // A role chosen before the selection changed may no longer fit it.
  const roleToSet = bulkRole && bulkOptions.includes(bulkRole) ? bulkRole : '';
  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.id));

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const resetPaging = () => { setPage(0); };

  const applyRole = () => {
    if (!roleToSet) return;
    const ids = chosen.map((p) => p.id);
    start(async () => {
      const res = await setRolesAction(ids, roleToSet);
      if (!res.ok) { toast.push({ title: 'Roles not set', body: res.error, tone: 'critical' }); return; }
      toast.push({
        title: `${roleName(roleToSet)} confirmed for ${res.set} ${res.set === 1 ? 'person' : 'people'}`,
        body: res.skipped ? `${res.skipped} skipped: they have an account or have left.` : undefined,
        tone: 'success',
      });
      setBulkRole('');
      router.refresh();
    });
  };

  const openInvite = () => setInviting(invitable.map((p) => {
    const channel = inviteChannelFor(p, delivery);
    return {
      key: p.id, name: fullName(p),
      detail: `${roleName(p.proposed_role)} · ${channel === 'email' ? `email ${p.work_email}` : channel === 'sms' ? `SMS ${p.work_cellphone}` : 'printed code'}`,
    };
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => { setQ(e.target.value); resetPaging(); }} placeholder={t('Name, badge, rank or station')}
            className="h-9 pl-9" aria-label={t('Search the register')} />
        </div>
        {silos.length > 1 ? (
          <select value={silo} onChange={(e) => { setSilo(e.target.value as Silo | 'all'); setStation('all'); resetPaging(); }} className={selectClass} aria-label={t('Department')}>
            <option value="all">{t('All departments')}</option>
            {silos.map((s) => <option key={s} value={s}>{DEPARTMENT_NAMES[s]}</option>)}
          </select>
        ) : null}
        <select value={station} onChange={(e) => { setStation(e.target.value); resetPaging(); }} className={selectClass} aria-label={t('Station')}>
          <option value="all">{t('All stations')}</option>
          {stations.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filter} onChange={(e) => { setFilter(e.target.value as StatusFilter); resetPaging(); }} className={selectClass} aria-label={t('Show')}>
          {FILTERS.filter((f) => f.id !== 'not-listed' || latestImport).filter((f) => f.id !== 'shared-badge' || shared.size).map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {visible.length === 0 ? 'Nobody matches.' : `Showing ${page * PAGE + 1}–${Math.min(visible.length, (page + 1) * PAGE)} of ${visible.length}`}
          {canManage && visible.length > shown.length && !visible.every((p) => selected.has(p.id)) ? (
            <> · <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>{t('Select all {length}', { length: visible.length })}</button></>
          ) : null}
        </span>
        {pages > 1 ? (
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('Previous')}</Button>
            <span>{t('Page {value} of {pages}', { value: page + 1, pages })}</span>
            <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{t('Next')}</Button>
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-bg-card">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              {canManage ? (
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" aria-label={t('Select everyone on this page')} checked={allShownSelected}
                    onChange={() => setSelected((s) => {
                      const n = new Set(s);
                      for (const p of shown) { if (allShownSelected) n.delete(p.id); else n.add(p.id); }
                      return n;
                    })} />
                </th>
              ) : null}
              <th className="px-3 py-2">{t('Person')}</th>
              <th className="px-3 py-2">{t('Department')}</th>
              <th className="px-3 py-2">{t('Contact')}</th>
              <th className="px-3 py-2">{t('Role for invitation')}</th>
              <th className="px-3 py-2">{t('Status')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const st = registerStatus(p);
              const canInvite = canManage && !p.left_at && !p.user_id && !p.invitation;
              return (
                <tr key={p.id} className={cn('border-b border-border last:border-0', p.left_at && 'opacity-60', selected.has(p.id) && 'bg-primary/5')}>
                  {canManage ? (
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${fullName(p)}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  ) : null}
                  <td className="px-3 py-2">
                    <span className="font-semibold">{fullName(p)}</span>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-mono">{p.badge_number}</span> · {p.rank}
                      {shared.has(p.id) ? (
                        <span className="inline-flex items-center gap-0.5 text-severity-medium-ink" title={t('Another current person has the same badge number')}>
                          <TriangleAlert className="h-3 w-3" aria-hidden /> {' '}{t('shared badge')}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {DEPARTMENT_NAMES[p.silo]}
                    <div className="text-xs text-muted-foreground">{p.station ?? '—'}</div>
                  </td>
                  <td className="max-w-[14rem] px-3 py-2 text-xs">
                    {p.work_email ? <div className="flex items-center gap-1 truncate"><Mail className="h-3 w-3 shrink-0" aria-hidden />{p.work_email}</div> : null}
                    {p.work_cellphone ? <div className="flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" aria-hidden />{p.work_cellphone}</div> : null}
                    {!p.work_email && !p.work_cellphone ? <span className="text-muted-foreground">{t('Printed code')}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {p.user_id ? (
                      <span className="text-muted-foreground">{p.account?.role ?? 'Has an account'}</span>
                    ) : p.proposed_role ? (
                      p.role_confirmed_at ? (
                        <span className="inline-flex items-center gap-1" title={`Confirmed by ${p.role_confirmed_by_name ?? 'an administrator'}`}>
                          {roleName(p.proposed_role)} <Check className="h-3.5 w-3.5 text-success" aria-label="confirmed" />
                        </span>
                      ) : (
                        <span className="text-severity-medium-ink" title={p.previous_role ? `Suggested from “${p.previous_role}”` : 'Suggested'}>{roleName(p.proposed_role)}?</span>
                      )
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', TONE[st.tone])}>{st.label}</span>
                    {p.left_at && p.left_reason ? <div className="mt-0.5 max-w-[14rem] truncate text-xs text-muted-foreground" title={p.left_reason}>{p.left_reason}</div> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {canInvite ? (
                      <Link href={`/admin/invitations/new?person=${p.id}`} className="text-sm font-semibold text-primary hover:underline">{t('Invite')}</Link>
                    ) : null}
                    {canMove && !p.left_at && !p.user_id ? (
                      <button type="button" className="ml-3 text-sm text-muted-foreground hover:text-fg" onClick={() => setMoving(p)}>{t('Change department')}</button>
                    ) : null}
                    {canManage && !p.left_at && !(p.user_id && p.account?.active !== false) ? (
                      <button type="button" className="ml-3 text-sm text-muted-foreground hover:text-fg" onClick={() => setLeaving({ person: p, mode: 'leave' })}>{t('Mark as left')}</button>
                    ) : null}
                    {canManage && p.left_at ? (
                      <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setLeaving({ person: p, mode: 'restore' })}>{t('Bring back')}</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 ? (
              <tr><td colSpan={canManage ? 7 : 6} className="px-3 py-10 text-center text-muted-foreground">{t('Nobody matches these filters.')}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {canManage && selected.size > 0 ? (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-bg-card px-4 py-3 shadow-xl">
          <span className="text-sm font-semibold">{t('{size} selected', { size: selected.size })}</span>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <select value={roleToSet} onChange={(e) => setBulkRole(e.target.value as UserRole)} className={selectClass} aria-label={t('Role to confirm')}>
            <option value="">{t('Set role for invitation…')}</option>
            {bulkOptions.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
          </select>
          {mixedDepartments ? (
            <span className="text-xs text-muted-foreground">{t('Field roles: choose people from one department.')}</span>
          ) : null}
          <Button size="sm" variant="outline" disabled={!roleToSet || pending} onClick={applyRole}>{pending ? 'Working…' : 'Confirm role'}</Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <Button size="sm" disabled={invitable.length === 0} onClick={openInvite}
            title={invitable.length < selected.size ? 'Only people with a confirmed role and no account or open invitation can be invited' : undefined}>
            {t('Invite {length}', { length: invitable.length })}
          </Button>
          {invitable.length < selected.size ? (
            <span className="text-xs text-muted-foreground">{t('{value} not ready (role, account or invitation)', { value: selected.size - invitable.length })}</span>
          ) : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>{t('Clear')}</Button>
        </div>
      ) : null}

      {inviting ? (
        <BulkRunDialog
          title={`Invite ${inviting.length} ${inviting.length === 1 ? 'person' : 'people'}`}
          intro={t('Each person gets their own invitation, as their confirmed role, by the route shown: email where HR gave an address, SMS where there is only a cellphone{value}, otherwise a printed code. Each link or code works once and expires after its set time.', { value: delivery.sms ? '' : ' (once SMS is set up; until then, a printed code)' })}
          items={inviting}
          confirmLabel={`Invite ${inviting.length}`}
          askReason
          askHrConfirm
          run={(chunk, reason) => inviteFromRegisterAction(chunk.map((c) => c.key), reason, true)}
          onClose={() => { setInviting(null); setSelected(new Set()); }}
        />
      ) : null}

      {leaving ? <LeaveDialog person={leaving.person} mode={leaving.mode} onClose={() => setLeaving(null)} /> : null}
      {moving ? <MoveDialog person={moving} onClose={() => setMoving(null)} /> : null}
    </div>
  );
}

const ALL_DEPARTMENTS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini'];

/** Move someone without an account to the department they work in, with a reason for the record. */
function MoveDialog({ person, onClose }: { person: RegisterPerson; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const toast = useToast();
  const [silo, setSilo] = useState<Silo | ''>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = fullName(person);

  const submit = () => {
    if (!silo) return;
    setError(null);
    start(async () => {
      const res = await moveDepartmentAction(person.id, silo, reason.trim());
      if (!res.ok) { setError(res.error); return; }
      toast.push({
        title: `${name} is now in ${DEPARTMENT_NAMES[silo]}`,
        body: res.invitationsCancelled ? 'Their open invitation was cancelled. Confirm their role there, then invite them.' : 'Confirm their role there, then invite them.',
        tone: 'success',
      });
      onClose();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-4 pt-[15vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="move-title">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-bg-card p-5 shadow-2xl">
        <h2 id="move-title" className="text-lg font-semibold">{t('Change {name}’s department', { name })}</h2>
        <p className="text-sm text-muted-foreground">
          {t('Now in {value}. Their role for invitation is cleared, and any open invitation is cancelled.', { value: DEPARTMENT_NAMES[person.silo] })}</p>
        <select value={silo} onChange={(e) => setSilo(e.target.value as Silo)} aria-label={t('New department')} className={`${selectClass} w-full`}>
          <option value="" disabled>{t('Choose the department')}</option>
          {ALL_DEPARTMENTS.filter((s) => s !== person.silo).map((s) => <option key={s} value={s}>{DEPARTMENT_NAMES[s]}</option>)}
        </select>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label={t('Reason')}
          placeholder={t('e.g. Works in Metro Police, per HR staff list 2026/10')} />
        {error ? <p role="alert" className="text-sm text-severity-critical-ink">{error}</p> : null}
        <div className="flex gap-2">
          <Button onClick={submit} disabled={!silo || reason.trim().length < 10 || pending}>{pending ? 'Working…' : 'Change department'}</Button>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('Cancel')}</Button>
        </div>
      </div>
    </div>
  );
}

/** Mark someone as left, or bring them back, with a reason for the record. */
function LeaveDialog({ person, mode, onClose }: { person: RegisterPerson; mode: 'leave' | 'restore'; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = fullName(person);

  const submit = () => {
    setError(null);
    start(async () => {
      const res = mode === 'leave' ? await markLeftAction(person.id, reason.trim()) : await restoreAction(person.id, reason.trim());
      if (!res.ok) { setError(res.error); return; }
      toast.push({
        title: mode === 'leave' ? `${name} marked as left` : `${name} is back in the register`,
        body: mode === 'leave' && 'invitationsCancelled' in res && res.invitationsCancelled ? 'Their open invitation was cancelled.' : undefined,
        tone: 'info',
      });
      onClose();
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-4 pt-[15vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="leave-title">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-bg-card p-5 shadow-2xl">
        <h2 id="leave-title" className="text-lg font-semibold">{mode === 'leave' ? `Mark ${name} as left` : `Bring ${name} back`}</h2>
        <p className="text-sm text-muted-foreground">
          {mode === 'leave'
            ? 'They stay in the register as a record, but cannot be invited, and any open invitation is cancelled.'
            : 'They return to the register as current staff.'}
        </p>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus aria-label={t('Reason')}
          placeholder={mode === 'leave' ? 'e.g. Resigned, HR notice 2026/77' : 'e.g. Marked as left by mistake, confirmed with HR'} />
        {error ? <p role="alert" className="text-sm text-severity-critical-ink">{error}</p> : null}
        <div className="flex gap-2">
          <Button onClick={submit} disabled={reason.trim().length < 10 || pending}>{pending ? 'Working…' : mode === 'leave' ? 'Mark as left' : 'Bring back'}</Button>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('Cancel')}</Button>
        </div>
      </div>
    </div>
  );
}
