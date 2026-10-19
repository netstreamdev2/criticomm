'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/office/action-form';
import { ox } from '@/components/office/styles';
import { useT } from '@/components/i18n';
import { changeDutyAction } from './actions';

/**
 * Edit one duty record: its call sign, member or hours. A duty that has
 * started only changes call sign; the database refuses the rest.
 */
export function EditDuty({
  line, signs, people, started,
}: {
  line: { id: string; postId: string | null; userId: string | null; day: string; start: string; end: string };
  signs: Array<{ id: string; callSign: string }>;
  people: Array<{ userId: string; label: string }>;
  started: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [times, setTimes] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-primary hover:underline">{t('Edit')}</button>;
  return (
    <ActionForm action={changeDutyAction} success={t('Duty changed')} onDone={() => setOpen(false)} className="flex min-w-[18rem] flex-col gap-2">
      <input type="hidden" name="id" value={line.id} />
      <input type="hidden" name="day" value={line.day} />
      <input type="hidden" name="times" value={times ? 'changed' : ''} />
      <select name="post" defaultValue={line.postId ?? ''} className={ox.input} aria-label={t('Call sign')}>
        {signs.map((s) => <option key={s.id} value={s.id}>{s.callSign}</option>)}
      </select>
      {started ? null : (
        <>
          <select name="user" defaultValue={line.userId ?? ''} className={ox.input} aria-label={t('Staff member')}>
            {people.map((p) => <option key={p.userId} value={p.userId}>{p.label}</option>)}
          </select>
          <div className="flex gap-2">
            <input name="start" type="time" defaultValue={line.start} onChange={() => setTimes(true)} className={ox.input} aria-label={t('Start time')} />
            <input name="end" type="time" defaultValue={line.end} onChange={() => setTimes(true)} className={ox.input} aria-label={t('End time')} />
          </div>
        </>
      )}
      <div className="flex gap-2">
        <button type="submit" className={`${ox.primary} h-8`}>{t('Save')}</button>
        <button type="button" onClick={() => setOpen(false)} className={`${ox.secondary} h-8`}>{t('Cancel')}</button>
      </div>
    </ActionForm>
  );
}
