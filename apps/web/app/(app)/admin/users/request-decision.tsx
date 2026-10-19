'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/toast';
import { cancelRequestAction, decideRequestAction } from './actions';
import { useT } from '@/components/i18n';

/**
 * What the viewer can do with an open request: decide it (a second
 * SystemAdmin), withdraw it (the person who asked), or nothing (it is about
 * them, or they are not an approver) — in which case it says why.
 */
export function RequestDecision({
  requestId, userId, mode, approveLabel = 'Approve',
}: {
  requestId: string;
  userId: string;
  mode: 'decide' | 'withdraw' | 'about-you' | 'view';
  /** What approving does, in the button's words: "Approve and send" for an invitation. */
  approveLabel?: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = (action: typeof decideRequestAction, fields: Record<string, string>, done: string) => {
    setError(null);
    const fd = new FormData();
    fd.set('request_id', requestId);
    fd.set('user_id', userId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    start(async () => {
      const res = await action(fd);
      if (!res.ok) { setError(res.error); return; }
      toast.push({
        title: res.status === 'expired' ? 'This request had expired, and is now closed' : (res.message ?? done),
        tone: res.status === 'approved' ? 'success' : 'info',
        duration: 4000,
      });
      router.refresh();
    });
  };

  if (mode === 'about-you') {
    return <p className="text-sm text-muted-foreground">{t('This request is about your account, so another SystemAdmin decides it.')}</p>;
  }
  if (mode === 'view') {
    return <p className="text-sm text-muted-foreground">{t('Waiting for a SystemAdmin to decide.')}</p>;
  }
  if (mode === 'withdraw') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('You made this request, so a second SystemAdmin decides it. You can withdraw it.')}</p>
        <Button variant="outline" size="sm" disabled={pending}
          onClick={() => run(cancelRequestAction, {}, 'Request withdrawn')}>
          {t('Withdraw request')}</Button>
        {error ? <p role="alert" className="text-sm text-severity-critical-ink">{error}</p> : null}
      </div>
    );
  }

  const rejectReady = note.trim().length >= 5;
  return (
    <div className="space-y-2">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('Note (required to reject; the requester is told)')}
        rows={2}
        maxLength={500}
        aria-label={t('Decision note')}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending}
          onClick={() => run(decideRequestAction, { approve: 'true', note }, 'Approved and applied')}>
          {approveLabel}
        </Button>
        <Button size="sm" variant="outline" disabled={pending || !rejectReady}
          className="border-severity-critical/50 text-severity-critical-ink"
          onClick={() => run(decideRequestAction, { approve: 'false', note }, 'Rejected; the requester has been told')}>
          {t('Reject')}</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-severity-critical-ink">{error}</p> : null}
    </div>
  );
}
