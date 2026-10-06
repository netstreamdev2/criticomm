'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, KeyRound, Mail, MessageSquare, Printer, Search, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import {
  DEPARTMENT_NAMES, describeAccess, inviteChannelFor, needsSecondApproval, passwordChecklist, type Silo, type UserRole,
} from '@criticom/db';
import type { InvitationChannel, StaffForInvite } from '@criticom/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/toast';
import { formatDeadline } from '@/lib/onboarding/messages';
import type { ActivationSlip as Slip } from '@/lib/onboarding/server';
import { cn } from '@/lib/utils';
import { MIN_REASON } from '../../users/confirm-fields';
import { createAccountDirectlyAction, createInvitationAction, searchStaffAction } from '../actions';
import { ActivationSlip, DevLink } from '../slip';

const ROLE_GROUPS: Array<{ label: string; roles: UserRole[] }> = [
  { label: 'Field', roles: ['Police', 'Captain', 'Firefighter', 'FireChief', 'Paramedic', 'Doctor', 'Disaster'] },
  { label: 'Control room and desk', roles: ['Dispatcher', 'ControlRoom', 'IncidentLogger', 'Supervisor', 'CaseManager', 'Viewer', 'Staff'] },
  { label: 'Administration', roles: ['Admin', 'SystemController', 'SystemAdmin', 'SuperAdmin'] },
];

/** Where each field role normally sits, for a gentle hint when the department chosen differs. */
const USUAL_DEPARTMENT: Partial<Record<UserRole, Silo>> = {
  Police: 'MetroPolice', Captain: 'MetroPolice', Firefighter: 'MetroFire', FireChief: 'MetroFire',
  Paramedic: 'Medical', Doctor: 'Medical', Disaster: 'EthekwiniDisaster',
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const phoneOk = (phone: string) => {
  const digits = phone.replace(/\D/g, '').length;
  return digits >= 9 && digits <= 15;
};

const selectClass = 'mt-1.5 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

type Delivery = { email: boolean; emailIsLinkOnly: boolean; sms: boolean };

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-bg-card p-5" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="text-sm font-semibold">
        <span className="mr-2 text-muted-foreground">{n} ·</span>{title}
      </h2>
      {children}
    </section>
  );
}

function personLine(p: StaffForInvite) {
  return [p.badge_number, p.rank, DEPARTMENT_NAMES[p.silo], p.station].filter(Boolean).join(' · ');
}

/** Why someone on the register cannot be picked, or null when they can. */
function unavailable(p: StaffForInvite, departments: Silo[], actorRole: UserRole): string | null {
  if (p.left_at) return 'Has left';
  if (p.hasAccount) return 'Has an account';
  if (p.openInvitation) return 'Invitation open';
  if (!p.badge_number?.trim()) return 'No badge number';
  if (actorRole === 'Admin' && !departments.includes(p.silo)) return 'Another department';
  return null;
}

/**
 * Invite someone from the staff register. The administrator chooses who,
 * what access, how the invitation reaches them, and why; the person chooses
 * their own password later, so nobody ever handles it. Powerful roles go to
 * a second SystemAdmin before anything is sent.
 */
export function InviteForm({
  actorRole, roles, departments, delivery, ttlHours, initialPerson,
}: {
  actorRole: UserRole;
  roles: UserRole[];
  departments: Silo[];
  delivery: Delivery;
  ttlHours: number;
  initialPerson: StaffForInvite | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [person, setPerson] = useState<StaffForInvite | null>(initialPerson);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StaffForInvite[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  /** A role someone confirmed in the staff register, if this administrator may give it. */
  const confirmedRole = (p: StaffForInvite | null): UserRole | '' =>
    p?.proposed_role && p.role_confirmed_at && roles.includes(p.proposed_role) ? p.proposed_role : '';
  const [role, setRole] = useState<UserRole | ''>(confirmedRole(initialPerson));
  const [silo, setSilo] = useState<Silo>(
    initialPerson && departments.includes(initialPerson.silo) ? initialPerson.silo : departments[0]!,
  );
  const [channel, setChannel] = useState<InvitationChannel>(
    initialPerson ? inviteChannelFor(initialPerson, delivery) : delivery.email ? 'email' : 'code',
  );
  const [email, setEmail] = useState(initialPerson?.work_email ?? '');
  const [phone, setPhone] = useState(initialPerson?.work_cellphone ?? '');
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [devLink, setDevLink] = useState<{ link: string; note: string } | null>(null);
  // The deadline is worked out in the browser after it loads, so it is never stale.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  // Search the register as the administrator types; the newest answer wins.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); setSearchError(null); setSearching(false); return; }
    const ticket = ++latest.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await searchStaffAction(q);
      if (ticket !== latest.current) return;
      setSearching(false);
      if (res.ok) { setResults(res.people); setSearchError(null); } else { setResults(null); setSearchError(res.error); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = (p: StaffForInvite) => {
    setPerson(p);
    setQuery('');
    setResults(null);
    if (departments.includes(p.silo)) setSilo(p.silo);
    // Start from the staff register: their work contact details and confirmed role.
    setEmail(p.work_email ?? '');
    setPhone(p.work_cellphone ?? '');
    setChannel(inviteChannelFor(p, delivery));
    setRole(confirmedRole(p));
    setChecked(false);
  };

  // A department Admin is offered their own department's field roles only;
  // the rules would allow a Firefighter in Metro Police, but it is never meant.
  const offered = actorRole === 'Admin'
    ? roles.filter((r) => !USUAL_DEPARTMENT[r] || departments.includes(USUAL_DEPARTMENT[r]!))
    : roles;
  const first = person ? person.first_name.trim().split(/\s+/)[0] : 'them';
  const fullName = person ? `${person.first_name} ${person.last_name}`.trim() : '';
  const approval = role !== '' && needsSecondApproval(actorRole, role, role);
  const access = role ? describeAccess(role, silo) : [];
  const usual = role ? USUAL_DEPARTMENT[role] : undefined;
  const direct = channel === 'direct';
  // A powerful role needs a second SystemAdmin, which a direct account cannot wait for.
  const directBlocked = direct && approval;
  const emailOk = EMAIL_PATTERN.test(email.trim()) && !/\.internal$/i.test(email.trim());
  const rules = direct
    ? [...passwordChecklist(password, { name: fullName, badge: person?.badge_number }),
      { rule: 'Both passwords match', ok: password.length > 0 && password === confirmPassword }]
    : [];
  const contactOk = channel === 'email' || direct ? emailOk : channel === 'sms' ? phoneOk(phone) : true;
  const reasonLength = reason.trim().length;
  const ready = !!person && role !== '' && contactOk && (channel === 'code' || checked) && reasonLength >= MIN_REASON
    && !directBlocked && rules.every((r) => r.ok);
  const deadline = now ? formatDeadline(new Date(now + ttlHours * 3_600_000).toISOString()) : null;

  const done = () => {
    setSlip(null);
    setDevLink(null);
    router.push('/admin/invitations');
    router.refresh();
  };

  const submit = () => {
    if (!person || !role) return;
    setError(null);
    if (channel === 'direct') {
      start(async () => {
        const res = await createAccountDirectlyAction({
          personnelId: person.id, role, silo, email: email.trim(), password, confirmPassword,
          reason: reason.trim(), handOverAgreed: checked,
        });
        if (!res.ok) { setError(res.message); return; }
        setPassword('');
        setConfirmPassword('');
        toast.push({
          title: `Account created for ${first}`,
          body: `Active now as ${res.role}. They sign in with ${res.loginEmail} on the web or the phone app.`,
          tone: 'success', duration: 8000,
        });
        router.push('/admin/invitations?view=accepted');
        router.refresh();
      });
      return;
    }
    start(async () => {
      const res = await createInvitationAction({
        personnelId: person.id, role, silo, channel, email: email.trim(), phone: phone.trim(), reason: reason.trim(),
        checkedWithPerson: checked,
      });
      if (!res.ok) { setError(res.error); return; }
      const out = res.outcome;
      switch (out.status) {
        case 'awaiting_approval':
          toast.push({
            title: 'Sent for approval',
            body: `A second SystemAdmin has been asked. Nothing reaches ${first} until they approve.`,
            tone: 'info', duration: 7000,
          });
          done();
          return;
        case 'sent':
          toast.push({
            title: `Invitation sent to ${first}`,
            body: `By ${out.channel === 'sms' ? 'SMS' : 'email'} to ${out.to}.`,
            tone: 'success', duration: 6000,
          });
          done();
          return;
        case 'slip':
          setSlip(out.slip);
          return;
        case 'link':
          setDevLink({ link: out.link, note: out.note });
          return;
        case 'failed':
          toast.push({
            title: 'Invitation created, but not delivered',
            body: `${out.error} Send it again from the invitations list.`,
            tone: 'warning', duration: 10000,
          });
          done();
          return;
      }
    });
  };

  const channels: Array<{ id: InvitationChannel; label: string; icon: typeof Mail; note: string | null; enabled: boolean }> = [
    {
      id: 'email', label: 'Email', icon: Mail, enabled: delivery.email,
      note: !delivery.email ? 'Not set up yet' : delivery.emailIsLinkOnly ? 'Development: link shown to you' : null,
    },
    { id: 'sms', label: 'SMS', icon: MessageSquare, enabled: delivery.sms, note: delivery.sms ? null : 'Not set up yet' },
    { id: 'code', label: 'Printed code', icon: Printer, enabled: true, note: 'For staff without email or a phone' },
    // Migration 0055: only the top administrators, and the database checks it again.
    ...(actorRole === 'SystemAdmin' || actorRole === 'SuperAdmin'
      ? [{ id: 'direct' as const, label: 'Set a password', icon: KeyRound, enabled: true, note: 'Active at once · less safe' }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Step n={1} title="Who">
        {person ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/50 bg-primary/5 px-4 py-3">
            <div>
              <p className="font-semibold">{fullName}</p>
              <p className="text-sm text-muted-foreground">{personLine(person)}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPerson(null)}>
              <X className="h-4 w-4" /> Choose someone else
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="who">Search the staff register</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="who"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or badge number"
                autoComplete="off"
                spellCheck={false}
                className="pl-9"
                aria-describedby="who-status"
                autoFocus
              />
            </div>
            <p id="who-status" className="text-xs text-muted-foreground" aria-live="polite">
              {searchError ? <span className="text-severity-critical-ink">{searchError}</span>
                : searching ? 'Searching…'
                  : results ? (results.length === 0 ? 'Nobody on the register matches.' : `${results.length}${results.length === 12 ? '+' : ''} found`)
                    : 'Type at least two letters of a name, or a badge number.'}
            </p>
            {results && results.length > 0 ? (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {results.map((p) => {
                  const why = unavailable(p, departments, actorRole);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={!!why}
                        onClick={() => choose(p)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                      >
                        <span>
                          <span className="block text-sm font-semibold">{p.first_name} {p.last_name}</span>
                          <span className="block text-xs text-muted-foreground">{personLine(p)}</span>
                        </span>
                        <span className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                          why ? 'bg-muted text-muted-foreground' : 'bg-success/15 text-success',
                        )}>
                          {why ?? 'No account yet'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Someone with an account is not invited again: change their role on their account page.
              Not in the staff register?{' '}
              <Link href="/admin/personnel" className="font-semibold text-primary hover:underline">Add them first →</Link>
            </p>
          </div>
        )}
      </Step>

      <Step n={2} title="Access">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="role">Role</Label>
            <select id="role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={selectClass}>
              <option value="" disabled>Choose a role</option>
              {ROLE_GROUPS.map((g) => {
                const inGroup = g.roles.filter((r) => offered.includes(r));
                return inGroup.length ? (
                  <optgroup key={g.label} label={g.label}>
                    {inGroup.map((r) => <option key={r} value={r}>{r}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
          </div>
          <div>
            <Label htmlFor="silo">Department</Label>
            {departments.length > 1 ? (
              <select id="silo" value={silo} onChange={(e) => setSilo(e.target.value as Silo)} className={selectClass}>
                {departments.map((s) => <option key={s} value={s}>{DEPARTMENT_NAMES[s]}</option>)}
              </select>
            ) : (
              <p id="silo" className="mt-1.5 flex h-10 items-center rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground">
                {DEPARTMENT_NAMES[silo]}
              </p>
            )}
          </div>
        </div>

        {person && person.silo !== silo ? (
          <p className="text-xs text-muted-foreground">The staff register lists {first} in {DEPARTMENT_NAMES[person.silo]}.</p>
        ) : null}
        {usual && usual !== silo && departments.includes(usual) ? (
          <p className="text-xs text-severity-medium-ink">
            {role} usually sits in {DEPARTMENT_NAMES[usual]}.{' '}
            <button type="button" className="font-semibold underline" onClick={() => setSilo(usual)}>Use {DEPARTMENT_NAMES[usual]}</button>
          </p>
        ) : null}

        {role ? (
          <div className="rounded-lg border border-border bg-bg-soft p-4">
            <p className="text-sm font-semibold">{person ? `${first} will` : 'They will'} be able to open</p>
            {access.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Access">
                {access.map((a) => <li key={a} className="rounded-full border border-border bg-bg-card px-2.5 py-0.5 text-xs">{a}</li>)}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">The dashboard, leave, search and their own profile only.</p>
            )}
          </div>
        ) : null}

        {approval ? (
          <p className="flex items-start gap-2 rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-3 py-2.5 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-severity-medium-ink" aria-hidden />
            <span>
              <b>{role}</b> is a powerful role, so a second SystemAdmin must approve this invitation. Nothing reaches {first} until they do.
            </span>
          </p>
        ) : null}
      </Step>

      <Step n={3} title={direct ? 'Sign-in and password' : 'How they receive it'}>
        <fieldset className={cn('grid gap-2', channels.length > 3 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3')}>
          <legend className="sr-only">How they receive it</legend>
          {channels.map((c) => {
            const Icon = c.icon;
            const on = channel === c.id;
            return (
              <label
                key={c.id}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
                  on ? 'border-primary bg-primary/10' : 'border-border',
                  c.enabled ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-50',
                )}
              >
                <input
                  type="radio"
                  name="channel"
                  value={c.id}
                  checked={on}
                  disabled={!c.enabled}
                  onChange={() => { setChannel(c.id); setChecked(false); }}
                  className="sr-only"
                />
                <span className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" aria-hidden />{c.label}</span>
                {c.note ? <span className="text-xs text-muted-foreground">{c.note}</span> : null}
              </label>
            );
          })}
        </fieldset>

        {channel === 'email' ? (
          <div>
            <Label htmlFor="email">Email address</Label>
            <Input id="email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setChecked(false); }}
              placeholder="name@example.org" autoComplete="off" spellCheck={false} className="mt-1.5"
              aria-invalid={email.length > 0 && !contactOk} />
            <p className="mt-1 text-xs text-muted-foreground">{first === 'them' ? 'They' : first} will sign in with this address.</p>
          </div>
        ) : null}
        {channel === 'sms' ? (
          <div>
            <Label htmlFor="phone">Cellphone number</Label>
            <Input id="phone" type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setChecked(false); }}
              placeholder="082 123 4567" autoComplete="off" className="mt-1.5" aria-invalid={phone.length > 0 && !contactOk} />
            <p className="mt-1 text-xs text-muted-foreground">
              {first === 'them' ? 'They' : first} will sign in with {person ? `badge number ${person.badge_number}` : 'their badge number'}.
            </p>
          </div>
        ) : null}
        {channel === 'code' ? (
          <p className="rounded-lg border border-border bg-bg-soft px-3 py-2.5 text-sm">
            You will print a slip with a one-time code and hand it to {first} in person. They sign in with
            {person ? ` badge number ${person.badge_number}` : ' their badge number'}.
          </p>
        ) : null}

        {direct ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-3 py-2.5 text-sm">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-severity-medium-ink" aria-hidden />
              <span>
                The account is active as soon as you create it. You will know {first === 'them' ? 'their' : `${first}’s`} password,
                and they do not confirm their badge number or accept the POPIA notice. Use an invitation where you can.
              </span>
            </p>
            {directBlocked ? (
              <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-3 py-2.5 text-sm text-severity-critical-ink">
                {role} needs a second SystemAdmin’s approval, so it cannot be created with a password. Choose email, SMS or a printed code.
              </p>
            ) : null}
            <div>
              <Label htmlFor="direct-email">Email address (their sign-in)</Label>
              <Input id="direct-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setChecked(false); }}
                placeholder="name@example.org" autoComplete="off" spellCheck={false} className="mt-1.5"
                aria-invalid={email.length > 0 && !contactOk} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="direct-password">Password</Label>
                <div className="relative mt-1.5">
                  <Input id="direct-password" type={showPassword ? 'text' : 'password'} value={password}
                    onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="pr-10" />
                  <button type="button" onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-fg"
                    aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="direct-confirm">Confirm password</Label>
                <Input id="direct-confirm" type={showPassword ? 'text' : 'password'} value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className="mt-1.5"
                  aria-invalid={confirmPassword.length > 0 && password !== confirmPassword} />
              </div>
            </div>
            <ul className="space-y-1 text-xs" aria-label="Password rules">
              {rules.map((r) => (
                <li key={r.rule} className={r.ok ? 'text-success' : 'text-muted-foreground'}>{r.ok ? '✓' : '○'} {r.rule}</li>
              ))}
              <li className="text-muted-foreground">○ Not found in a known data breach (checked when you create it)</li>
            </ul>
          </div>
        ) : null}

        {channel !== 'code' ? (
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-primary))]" />
            <span>
              {direct
                ? `I have checked this address with ${first}, and I will give them the password myself, in person or by phone.`
                : `I have checked this ${channel === 'email' ? 'address' : 'number'} with ${first}, in person or by phone.`}
            </span>
          </label>
        ) : null}
      </Step>

      <Step n={4} title="Why">
        <div>
          <Label htmlFor="reason">Reason (kept on the permanent record)</Label>
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500}
            placeholder="e.g. New appointment, HR memo 2026/140" className="mt-1.5" />
          <p className={cn('mt-1 text-xs', reasonLength >= MIN_REASON ? 'text-muted-foreground' : 'text-severity-medium-ink')}>
            {reasonLength < MIN_REASON ? `At least ${MIN_REASON} characters (${reasonLength} so far).` : 'Recorded with the invitation and on the account it creates.'}
          </p>
        </div>
      </Step>

      {person && role ? (
        <div className="rounded-xl border border-primary/40 bg-primary/5 px-5 py-4 text-sm" aria-live="polite">
          {direct ? (
            <>
              <p>
                Creates an account for <b>{fullName}</b> ({person.badge_number}) as <b>{role}</b> in <b>{DEPARTMENT_NAMES[silo]}</b>,
                signing in with <b>{email.trim() || '…'}</b>.
              </p>
              <p className="mt-1 text-muted-foreground">
                Active at once on the web and the phone app. Nothing is emailed: give them the password yourself.
              </p>
            </>
          ) : (<>
          <p>
            Invites <b>{fullName}</b> ({person.badge_number}) as <b>{role}</b> in <b>{DEPARTMENT_NAMES[silo]}</b>,{' '}
            {channel === 'email' ? <>by email to <b>{email.trim() || '…'}</b>.</>
              : channel === 'sms' ? <>by SMS to <b>{phone.trim() || '…'}</b>.</>
                : <>with a printed activation code.</>}
          </p>
          <p className="mt-1 text-muted-foreground">
            {approval
              ? `A second SystemAdmin approves it first. Once sent, the ${channel === 'code' ? 'code' : 'link'} works once and expires after ${ttlHours} hours.`
              : deadline
                ? `The ${channel === 'code' ? 'code' : 'link'} works once and expires on ${deadline}.`
                : `The ${channel === 'code' ? 'code' : 'link'} works once and expires after ${ttlHours} hours.`}
            {channel === 'email' && delivery.emailIsLinkOnly && !approval ? ' Email is not set up here, so you will be shown the link to pass on.' : ''}
          </p>
          </>)}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={submit} disabled={!ready || pending}>
          {pending ? 'Working…' : direct ? 'Create account' : approval ? 'Send for approval' : channel === 'code' ? 'Create slip' : 'Send invitation'}
        </Button>
        <Button asChild variant="ghost"><Link href="/admin/invitations">Cancel</Link></Button>
      </div>

      {slip ? <ActivationSlip slip={slip} onClose={done} /> : null}
      {devLink ? <DevLink link={devLink.link} note={devLink.note} onClose={done} /> : null}
    </div>
  );
}
