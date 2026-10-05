'use client';

import { useState, useTransition } from 'react';
import { Check, Eye, EyeOff, Smartphone } from 'lucide-react';
import {
  DEPARTMENT_NAMES, formatActivationCode, INVITATION_ATTEMPTS, passwordChecklist, POPIA_NOTICE_VERSION,
  RESPONDER_ROLES, type Silo, type UserRole,
} from '@criticom/db';
import type { Activation, BadgeCheck, PersonPreview } from '@/lib/onboarding/server';
import { formatDeadline } from '@/lib/onboarding/messages';
import { activateAction, confirmBadgeAction, reportAction } from '@/app/invite/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type Kind = 'link' | 'code';
type Step = 'intro' | 'badge' | 'code' | 'password' | 'terms' | 'done' | 'report' | 'reported';
type Identity = Extract<BadgeCheck, { ok: true }>;
type Done = Extract<Activation, { ok: true }> & { signedIn?: boolean };

const STEPS: Record<Kind, Array<{ id: Step; label: string }>> = {
  link: [
    { id: 'intro', label: 'Your invitation' },
    { id: 'badge', label: 'Confirm it’s you' },
    { id: 'password', label: 'Choose a password' },
    { id: 'terms', label: 'Before you start' },
  ],
  code: [
    { id: 'code', label: 'Your code' },
    { id: 'password', label: 'Choose a password' },
    { id: 'terms', label: 'Before you start' },
  ],
};

/** States that end the journey: nothing the person can retry. */
const FINAL = new Set(['expired', 'used', 'locked', 'closed']);

/**
 * Accepting an invitation, from a link or a printed code. Opening it changes
 * nothing; each step is the person's own deliberate press. The account is
 * created only at the very end, once they have proven who they are, chosen
 * their password and accepted the POPIA notice.
 */
export function AcceptFlow({
  kind, secret, preview, signedInAs,
}: {
  kind: Kind;
  /** The link token (links only; a code is typed on the page). */
  secret?: string;
  /** What the link offers (links only). */
  preview?: PersonPreview;
  /** Someone already signed in on this browser, who activating will sign out. */
  signedInAs?: string | null;
}) {
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>(kind === 'link' ? 'intro' : 'code');
  const [code, setCode] = useState('');
  const [badge, setBadge] = useState('');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [readNotice, setReadNotice] = useState(false);
  const [agreeUse, setAgreeUse] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<{ message: string; used: boolean } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [reported, setReported] = useState('');

  const details = identity?.preview ?? preview;
  const first = (identity?.fullName ?? '').split(' ')[0] || details?.first_name || '';
  const theSecret = kind === 'link' ? (secret ?? '') : code;
  const checklist = [
    ...passwordChecklist(password, { name: identity?.fullName, badge }),
    { rule: 'Both entries match', ok: password.length > 0 && password === again },
  ];
  const steps = STEPS[kind];
  const index = steps.findIndex((s) => s.id === step);

  const submitBadge = () => {
    setError(null);
    start(async () => {
      const res = await confirmBadgeAction(kind, theSecret, badge);
      if (res.ok) { setIdentity(res); setStep('password'); return; }
      // A mistyped code can be retyped; anything else final ends here.
      if (FINAL.has(res.state)) setEnded({ message: res.message, used: res.state === 'used' });
      else setError(res.message);
    });
  };

  const activate = () => {
    setError(null);
    start(async () => {
      const res = await activateAction({ kind, secret: theSecret, badge, password, accepted: readNotice && agreeUse });
      if (res.ok) { setDone(res); setStep('done'); return; }
      if (res.state && FINAL.has(res.state)) setEnded({ message: res.message, used: res.state === 'used' });
      else setError(res.message);
    });
  };

  const report = () => {
    setError(null);
    start(async () => {
      const res = await reportAction(theSecret, note);
      if (res.ok) { setReported(res.message); setStep('reported'); }
      else setError(res.message);
    });
  };

  if (ended) {
    return (
      <div className="space-y-4" role="status">
        <h1 className="text-2xl font-bold">This invitation can’t be used</h1>
        <p className="text-muted-foreground">{ended.message}</p>
        {ended.used ? (
          <a href="/login" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Sign in
          </a>
        ) : null}
      </div>
    );
  }

  if (step === 'reported') {
    return (
      <div className="space-y-3" role="status">
        <h1 className="text-2xl font-bold">Reported</h1>
        <p className="text-muted-foreground">{reported}</p>
      </div>
    );
  }

  if (step === 'done' && done) {
    const field = RESPONDER_ROLES.includes(done.role);
    const download = process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL;
    return (
      <div className="space-y-5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
          <Check className="h-3.5 w-3.5" aria-hidden /> Account active
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">You’re in, {done.fullName.split(' ')[0]}</h1>
          <p className="text-muted-foreground">
            From now on, sign in with your {done.signIn === 'badge' ? 'badge number' : 'email address'}{' '}
            <b className="font-mono text-fg">{done.signInAs}</b> and the password you just chose.
          </p>
        </div>
        {field ? (
          <div className="space-y-2 rounded-xl border border-border bg-bg-soft p-4">
            <p className="flex items-center gap-2 font-semibold"><Smartphone className="h-4 w-4 text-primary" aria-hidden /> Get the HikTech app</p>
            <p className="text-sm text-muted-foreground">
              Field work happens in the HikTech phone app. {download
                ? 'Install it from the link below, then sign in.'
                : 'If it is not on your phone yet, your supervisor or station commander will help you install it.'}
            </p>
            {download ? <a href={download} className="text-sm font-semibold text-primary hover:underline">Download HikTech →</a> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <a href={done.signedIn ? '/dashboard' : '/login'}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            {done.signedIn ? (field ? 'Open the web console' : 'Go to my dashboard') : 'Sign in'}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {index >= 0 ? (
        <ol className="flex gap-1.5" aria-label={`Step ${index + 1} of ${steps.length}: ${steps[index]!.label}`}>
          {steps.map((s, i) => (
            <li key={s.id} className={cn('h-1.5 flex-1 rounded-full', i <= index ? 'bg-primary' : 'bg-border')} />
          ))}
        </ol>
      ) : null}

      {step === 'intro' && details ? (
        <div className="space-y-5">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step 1 of {steps.length}</p>
            <h1 className="text-2xl font-bold">You’ve been invited{details.first_name ? `, ${details.first_name}` : ''}</h1>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl border border-border p-4 text-sm">
            <dt className="text-muted-foreground">Organisation</dt><dd className="font-medium">{details.organisation}</dd>
            <dt className="text-muted-foreground">Role</dt><dd className="font-medium">{details.role}</dd>
            <dt className="text-muted-foreground">Department</dt><dd className="font-medium">{details.silo ? DEPARTMENT_NAMES[details.silo as Silo] : ''}</dd>
            <dt className="text-muted-foreground">Invited by</dt><dd className="font-medium">{details.invited_by_name}</dd>
            <dt className="text-muted-foreground">Expires</dt><dd className="font-medium">{details.expires_at ? formatDeadline(details.expires_at) : ''}</dd>
          </dl>
          {signedInAs ? (
            <p className="rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-3 py-2 text-sm">
              You’re signed in on this browser as <b>{signedInAs}</b>. Activating this invitation signs that account out here.
            </p>
          ) : null}
          <Button className="w-full" onClick={() => setStep('badge')}>Continue</Button>
          <p className="text-center text-sm">
            <button type="button" onClick={() => setStep('report')} className="text-muted-foreground underline-offset-4 hover:text-fg hover:underline">
              This isn’t me, report it
            </button>
          </p>
        </div>
      ) : null}

      {step === 'badge' ? (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submitBadge(); }}>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step 2 of {steps.length}</p>
            <h1 className="text-2xl font-bold">Confirm it’s you</h1>
            <p className="text-muted-foreground">
              Type the badge number on your appointment letter or ID card. {INVITATION_ATTEMPTS} wrong tries lock the invitation.
            </p>
          </div>
          <div>
            <Label htmlFor="badge">Badge number</Label>
            <Input id="badge" value={badge} onChange={(e) => setBadge(e.target.value)} autoComplete="off"
              autoCapitalize="characters" spellCheck={false} className="mt-2 font-mono uppercase" autoFocus />
          </div>
          <ErrorLine error={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={!badge.trim() || pending}>{pending ? 'Checking…' : 'Next'}</Button>
            <Button type="button" variant="ghost" onClick={() => { setError(null); setStep('intro'); }}>Back</Button>
          </div>
        </form>
      ) : null}

      {step === 'code' ? (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submitBadge(); }}>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step 1 of {steps.length}</p>
            <h1 className="text-2xl font-bold">Activate your account</h1>
            <p className="text-muted-foreground">Enter the code from your activation slip, and your badge number.</p>
          </div>
          <div>
            <Label htmlFor="code">Activation code</Label>
            <Input id="code" value={code} onChange={(e) => setCode(formatActivationCode(e.target.value))}
              placeholder="XXXX-XXXX" maxLength={9} autoComplete="one-time-code" autoCapitalize="characters"
              spellCheck={false} className="mt-2 font-mono text-lg tracking-[0.2em] uppercase" autoFocus />
          </div>
          <div>
            <Label htmlFor="code-badge">Badge number</Label>
            <Input id="code-badge" value={badge} onChange={(e) => setBadge(e.target.value)} autoComplete="off"
              autoCapitalize="characters" spellCheck={false} className="mt-2 font-mono uppercase" />
          </div>
          <ErrorLine error={error} />
          <Button type="submit" disabled={code.replace('-', '').length < 8 || !badge.trim() || pending}>
            {pending ? 'Checking…' : 'Next'}
          </Button>
        </form>
      ) : null}

      {step === 'password' ? (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (checklist.every((c) => c.ok)) setStep('terms'); }}>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step {index + 1} of {steps.length}</p>
            <h1 className="text-2xl font-bold">Choose a password</h1>
            <p className="text-muted-foreground">Only you will know it. Administrators never see or set passwords.</p>
          </div>
          {identity && kind === 'code' && details ? (
            <p className="rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm">
              For <b>{identity.fullName}</b>: {details.role}, {details.silo ? DEPARTMENT_NAMES[details.silo as Silo] : ''}.
              Invited by {details.invited_by_name}.
            </p>
          ) : null}
          <div className="space-y-3">
            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative mt-2">
                <Input id="password" type={show ? 'text' : 'password'} value={password} autoFocus
                  onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="pr-10" />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-fg">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <Label htmlFor="password-again">Type it again</Label>
              <Input id="password-again" type={show ? 'text' : 'password'} value={again}
                onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" className="mt-2" />
            </div>
          </div>
          <ul className="space-y-1 text-sm" aria-label="Password rules">
            {checklist.map((c) => (
              <li key={c.rule} className={cn('flex items-center gap-2', c.ok ? 'text-success' : 'text-muted-foreground')}>
                <span className={cn('grid h-4 w-4 place-items-center rounded-full border', c.ok ? 'border-success bg-success/15' : 'border-border')}>
                  {c.ok ? <Check className="h-3 w-3" aria-hidden /> : null}
                </span>
                {c.rule}
              </li>
            ))}
            <li className="pl-6 text-xs text-muted-foreground">Passwords known from data breaches elsewhere are refused.</li>
          </ul>
          <Button type="submit" disabled={!checklist.every((c) => c.ok)}>Next</Button>
        </form>
      ) : null}

      {step === 'terms' ? (
        <div className="space-y-5">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step {index + 1} of {steps.length}</p>
            <h1 className="text-2xl font-bold">Before you start</h1>
          </div>
          <p className="rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-3 py-2.5 text-sm">
            HikTech holds personal information about members of the public and about staff. The{' '}
            <a href="/legal/popia" target="_blank" rel="noreferrer noopener" className="font-semibold underline underline-offset-4">POPIA notice</a>{' '}
            explains what is kept, why, who can see it and for how long.
          </p>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={readNotice} onChange={(e) => setReadNotice(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-primary))]" />
            <span>I have read the POPIA notice (version {POPIA_NOTICE_VERSION})</span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={agreeUse} onChange={(e) => setAgreeUse(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-primary))]" />
            <span>I will use HikTech only for official duties and keep my password private</span>
          </label>
          <ErrorLine error={error} />
          <div className="flex gap-2">
            <Button onClick={activate} disabled={!readNotice || !agreeUse || pending}>
              {pending ? 'Activating…' : 'Activate my account'}
            </Button>
            <Button variant="ghost" onClick={() => setStep('password')} disabled={pending}>Back</Button>
          </div>
        </div>
      ) : null}

      {step === 'report' ? (
        <div className="space-y-5">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Not you?</h1>
            <p className="text-muted-foreground">
              If you weren’t expecting this invitation, report it. It closes at once, and the administrator who sent it is told.
            </p>
          </div>
          <div>
            <Label htmlFor="note">Anything they should know (optional)</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} className="mt-2" />
          </div>
          <ErrorLine error={error} />
          <div className="flex gap-2">
            <Button variant="destructive" onClick={report} disabled={pending}>{pending ? 'Reporting…' : 'Report it'}</Button>
            <Button variant="ghost" onClick={() => setStep('intro')} disabled={pending}>Back</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">
      {error}
    </p>
  );
}
