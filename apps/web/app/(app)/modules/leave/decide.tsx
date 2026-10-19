'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/office/action-form';
import { ox } from '@/components/office/styles';
import { useT } from '@/components/i18n';
import { decideLeaveAction } from './actions';

/** Approve, or reject with a reason (the member is told the reason). */
export function LeaveDecision({ id }: { id: string }) {
  const { t } = useT();
  const [rejecting, setRejecting] = useState(false);
  if (rejecting) {
    return (
      <ActionForm action={decideLeaveAction} success={t('Leave rejected')} onDone={() => setRejecting(false)} className="flex items-center gap-1.5">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="approve" value="0" />
        <input name="comment" required minLength={3} placeholder={t('Reason')} className={`${ox.input} h-8 w-40`} />
        <button type="submit" className={`${ox.danger} h-8`}>{t('Reject')}</button>
        <button type="button" onClick={() => setRejecting(false)} className="text-xs text-muted-foreground hover:underline">{t('Cancel')}</button>
      </ActionForm>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <ActionForm action={decideLeaveAction} success={t('Leave approved')}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="approve" value="1" />
        <button type="submit" className="inline-flex h-8 items-center rounded-md bg-severity-low px-3 text-xs font-bold uppercase text-white hover:opacity-90">{t('Approve')}</button>
      </ActionForm>
      <button type="button" onClick={() => setRejecting(true)} className={`${ox.danger} h-8 text-xs uppercase`}>{t('Reject')}</button>
    </div>
  );
}
