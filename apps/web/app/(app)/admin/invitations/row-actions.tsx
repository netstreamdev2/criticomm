'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/toast';
import type { ActivationSlip as Slip } from '@/lib/onboarding/server';
import { cancelInvitationAction, sendInvitationAction } from './actions';
import { ActivationSlip, DevLink } from './slip';

/**
 * What an administrator can still do with one invitation: send it (or send
 * a fresh one, which stops the old link or code working), and cancel or
 * withdraw it. Anything that undoes something already sent asks first.
 */
export function InvitationRowActions({
  id, firstName, channel, send, sendLabel, firstSend, cancel, awaitingApproval, mine, approver, reinviteHref,
}: {
  id: string;
  firstName: string;
  channel: 'email' | 'sms' | 'code' | 'direct';
  send: boolean;
  sendLabel: string;
  /** Nothing has gone out yet, so sending replaces nothing. */
  firstSend: boolean;
  cancel: boolean;
  awaitingApproval: boolean;
  /** The viewer sent this invitation. */
  mine: boolean;
  /** The viewer may decide approvals. */
  approver: boolean;
  /** For a closed invitation: start a new one for the same person. */
  reinviteHref: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<'send' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [devLink, setDevLink] = useState<{ link: string; note: string } | null>(null);

  const thing = channel === 'code' ? 'printed code' : 'link';

  const doSend = () => {
    setError(null);
    setConfirming(null);
    start(async () => {
      const res = await sendInvitationAction(id);
      if (!res.ok) { setError(res.error); return; }
      const out = res.outcome;
      // A slip or link is shown once. The list refreshes only after it is
      // closed: refreshing first could move this row to another tab and
      // take the only copy of the code with it.
      if (out.status === 'slip') { setSlip(out.slip); return; }
      if (out.status === 'link') { setDevLink({ link: out.link, note: out.note }); return; }
      if (out.status === 'sent') {
        toast.push({ title: `Sent to ${firstName}`, body: `By ${out.channel === 'sms' ? 'SMS' : 'email'} to ${out.to}.`, tone: 'success', duration: 5000 });
      } else if (out.status === 'failed') setError(out.error);
      router.refresh();
    });
  };

  const doCancel = () => {
    setError(null);
    start(async () => {
      const res = await cancelInvitationAction(id, note.trim());
      if (!res.ok) { setError(res.error ?? 'It could not be cancelled.'); return; }
      setConfirming(null);
      toast.push({ title: mine && awaitingApproval ? 'Request withdrawn' : 'Invitation cancelled', tone: 'info', duration: 4000 });
      router.refresh();
    });
  };

  const close = () => { setSlip(null); setDevLink(null); router.refresh(); };

  if (confirming === 'send') {
    return (
      <div className="ml-auto max-w-[17rem] space-y-2 text-left text-xs">
        <p>Send a new {thing}? The one {firstName} has stops working.</p>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={doSend} disabled={pending}>{sendLabel}</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>Keep it</Button>
        </div>
      </div>
    );
  }
  if (confirming === 'cancel') {
    const withdraw = mine && awaitingApproval;
    return (
      <div className="ml-auto max-w-[17rem] space-y-2 text-left text-xs">
        <p>{withdraw ? 'Withdraw this request? Nothing has been sent.' : `Cancel for good? Any ${thing} already sent stops working.`}</p>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={300} className="h-8 text-xs" aria-label="Note" />
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="border-severity-critical/50 text-severity-critical-ink" onClick={doCancel} disabled={pending}>
            {withdraw ? 'Withdraw' : 'Cancel invitation'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>Keep it</Button>
        </div>
        {error ? <p role="alert" className="text-severity-critical-ink">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1.5">
        {awaitingApproval && !mine && approver ? (
          <Button asChild size="sm" variant="outline"><Link href="/admin/approvals">Review</Link></Button>
        ) : null}
        {send ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => (firstSend ? doSend() : setConfirming('send'))}>
            {pending ? 'Working…' : sendLabel}
          </Button>
        ) : null}
        {cancel && (!awaitingApproval || mine) ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming('cancel')}>
            {mine && awaitingApproval ? 'Withdraw' : 'Cancel'}
          </Button>
        ) : null}
        {reinviteHref ? (
          <Button asChild size="sm" variant="ghost"><Link href={reinviteHref}>Invite again</Link></Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="max-w-[17rem] text-right text-xs text-severity-critical-ink">{error}</p> : null}
      {slip ? <ActivationSlip slip={slip} onClose={close} /> : null}
      {devLink ? <DevLink link={devLink.link} note={devLink.note} onClose={close} /> : null}
    </div>
  );
}
