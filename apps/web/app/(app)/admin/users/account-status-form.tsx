'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';
import { setActiveAction } from './actions';
import { ConfirmFields, confirmReady, type ConfirmWord } from './confirm-fields';

/**
 * Deactivate an account (never delete it), or bring it back. Closed until
 * someone deliberately opens it, and it says plainly what will happen before
 * it asks for the reason and the confirmation.
 */
export function AccountStatusForm({
  userId, name, active, needsApproval, confirm,
}: {
  userId: string;
  name: string;
  active: boolean;
  /** A powerful role: a second SystemAdmin must approve. */
  needsApproval: boolean;
  confirm: ConfirmWord;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const first = name.split(' ')[0] || name;

  const close = () => { setOpen(false); setReason(''); setTyped(''); setError(null); };

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set('user_id', userId);
    fd.set('active', String(!active));
    fd.set('reason', reason);
    fd.set('confirm', typed);
    start(async () => {
      const res = await setActiveAction(fd);
      if (!res.ok) { setError(res.error); return; }
      toast.push(res.status === 'pending'
        ? { title: 'Sent for approval', body: 'A second SystemAdmin has been asked. Nothing changes until they approve.', tone: 'info', duration: 6000 }
        : { title: active ? `${name} deactivated` : `${name} reactivated`, tone: active ? 'warning' : 'success', duration: 4000 });
      close();
      router.refresh();
    });
  };

  if (!open) {
    return active ? (
      <Button variant="outline" onClick={() => setOpen(true)} className="border-severity-critical/50 text-severity-critical-ink">
        <UserX className="h-4 w-4" /> Deactivate account…
      </Button>
    ) : (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserCheck className="h-4 w-4" /> Reactivate account…
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <p className="font-semibold">{active ? `Deactivate ${name}` : `Reactivate ${name}`}</p>
      {active ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{first} is signed out everywhere and can no longer sign in.</li>
          <li>They come off duty and off rosters straight away.</li>
          <li>Everything they recorded stays: incidents, reports and their history.</li>
          <li>The account can be reactivated later, with a reason.</li>
        </ul>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{first} can sign in again with their existing password, in the same role.</li>
          <li>They go back on rosters, and on duty only after their next start of shift.</li>
        </ul>
      )}

      {needsApproval ? (
        <p className="flex items-start gap-2 rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-3 py-2.5 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-severity-medium-ink" aria-hidden />
          <span>This account holds a powerful role, so a second SystemAdmin must approve. Nothing changes until they do.</span>
        </p>
      ) : null}

      <ConfirmFields
        id="status"
        reason={reason}
        onReason={setReason}
        typed={typed}
        onTyped={setTyped}
        confirm={confirm}
        reasonHint={active ? 'e.g. Resigned with effect from 31 October 2026' : 'e.g. Returned from suspension per HR memo 2026/131'}
      />

      {error ? (
        <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant={active ? 'destructive' : 'default'}
          onClick={submit}
          disabled={!confirmReady(reason, typed, confirm) || pending}
        >
          {pending ? 'Working…' : needsApproval ? 'Send for approval' : active ? 'Deactivate' : 'Reactivate'}
        </Button>
        <Button variant="ghost" onClick={close} disabled={pending}>Cancel</Button>
      </div>
    </div>
  );
}
