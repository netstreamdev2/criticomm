'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus, ShieldCheck } from 'lucide-react';
import {
  accessChanges, needsSecondApproval, roleFitsDepartment, roleName, rolesForDepartment, type Silo, type UserRole,
} from '@criticom/db';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/toast';
import { changeRoleAction } from './actions';
import { ConfirmFields, confirmReady, type ConfirmWord } from './confirm-fields';
import { useT } from '@/components/i18n';

const SILO_LABELS: Record<Silo, string> = {
  Ethekwini: 'Control Room (all departments)',
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS',
  EthekwiniDisaster: 'Disaster Management',
};

const selectClass = 'mt-1.5 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

/**
 * Change a person's role, and department where the administrator may move
 * people. Only roles that fit the department are offered: a field role
 * belongs to one department (role_fits_department, 0067). Before anything is
 * sent it shows exactly what the person will gain and lose, and whether a
 * second SystemAdmin must approve it.
 */
export function ChangeRoleForm({
  userId, name, actorRole, currentRole, currentSilo, roleOptions, departments, confirm,
}: {
  userId: string;
  name: string;
  actorRole: UserRole;
  currentRole: UserRole;
  currentSilo: Silo;
  roleOptions: UserRole[];
  /** Departments they may be moved to; null when this administrator cannot move people. */
  departments: Silo[] | null;
  confirm: ConfirmWord;
}) {
  const { t } = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [role, setRole] = useState<UserRole | ''>(currentRole);
  const [silo, setSilo] = useState<Silo>(currentSilo);
  // The current role stays on the list while it still fits the department.
  const offered = rolesForDepartment(roleOptions.includes(currentRole) ? roleOptions : [currentRole, ...roleOptions], silo);
  const chooseDepartment = (next: Silo) => {
    setSilo(next);
    if (role && !roleFitsDepartment(role, next)) setRole('');
  };
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const changed = role !== '' && (role !== currentRole || silo !== currentSilo);
  const diff = useMemo(
    () => (role ? accessChanges({ role: currentRole, silo: currentSilo }, { role, silo }) : { gains: [], losses: [] }),
    [currentRole, currentSilo, role, silo],
  );
  const approval = changed && needsSecondApproval(actorRole, currentRole, role);
  const ready = changed && confirmReady(reason, typed, confirm);
  const first = name.split(' ')[0] || name;

  const submit = () => {
    if (!role) return;
    setError(null);
    const fd = new FormData();
    fd.set('user_id', userId);
    fd.set('role', role);
    if (silo !== currentSilo) fd.set('silo', silo);
    fd.set('reason', reason);
    fd.set('confirm', typed);
    start(async () => {
      const res = await changeRoleAction(fd);
      if (!res.ok) { setError(res.error); return; }
      toast.push(res.status === 'pending'
        ? { title: 'Sent for approval', body: 'A second SystemAdmin has been asked. Nothing changes until they approve.', tone: 'info', duration: 6000 }
        : { title: `${name} is now ${roleName(role)}`, tone: 'success', duration: 4000 });
      setReason('');
      setTyped('');
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="new-silo">{t('Department')}</Label>
          {departments ? (
            <select id="new-silo" value={silo} onChange={(e) => chooseDepartment(e.target.value as Silo)} className={selectClass}>
              {departments.map((s) => (
                <option key={s} value={s}>{SILO_LABELS[s]}{s === currentSilo ? ' (current)' : ''}</option>
              ))}
            </select>
          ) : (
            <p className="mt-1.5 flex h-10 items-center rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground">
              {SILO_LABELS[currentSilo]}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="new-role">{t('New role')}</Label>
          <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={selectClass}>
            {role === '' ? <option value="" disabled>{t('Choose a role')}</option> : null}
            {offered.map((r) => (
              <option key={r} value={r}>{roleName(r)}{r === currentRole ? ' (current)' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {changed ? (
        <div className="rounded-lg border border-border bg-bg-soft p-4">
          <p className="text-sm font-semibold">{t('What changes for {first}', { first })}</p>
          {diff.gains.length === 0 && diff.losses.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('The same screens and powers as now.')}</p>
          ) : (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <ul className="space-y-1.5 text-sm" aria-label={t('Gains')}>
                {diff.gains.length === 0 ? <li className="text-muted-foreground">{t('Gains nothing')}</li> : null}
                {diff.gains.map((g) => (
                  <li key={g} className="flex items-start gap-2">
                    <Plus className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />{g}
                  </li>
                ))}
              </ul>
              <ul className="space-y-1.5 text-sm" aria-label={t('Losses')}>
                {diff.losses.length === 0 ? <li className="text-muted-foreground">{t('Loses nothing')}</li> : null}
                {diff.losses.map((l) => (
                  <li key={l} className="flex items-start gap-2">
                    <Minus className="mt-0.5 h-4 w-4 shrink-0 text-severity-critical" aria-hidden />{l}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {approval ? (
        <p className="flex items-start gap-2 rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-3 py-2.5 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-severity-medium-ink" aria-hidden />
          <span>
            <b>{roleName(role)}</b> {' '}{t('is a powerful role, so a second SystemAdmin must approve this. Nothing changes until they do, and you can withdraw it meanwhile.')}</span>
        </p>
      ) : null}

      {changed ? (
        <ConfirmFields
          id="role"
          reason={reason}
          onReason={setReason}
          typed={typed}
          onTyped={setTyped}
          confirm={confirm}
          reasonHint="e.g. Promoted to Captain per HR memo 2026/114"
        />
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">
          {error}
        </p>
      ) : null}

      <Button type="button" onClick={submit} disabled={!ready || pending}>
        {pending ? 'Working…' : approval ? 'Send for approval' : 'Change role'}
      </Button>
    </div>
  );
}
