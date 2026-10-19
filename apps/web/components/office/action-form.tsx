'use client';

import type * as React from 'react';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/toast';
import { useT } from '@/components/i18n';
import { notify } from './notice';

export type ActionResult = { ok?: true; error?: string; message?: string; detail?: string; goTo?: string };

/**
 * A duty office form: sends to a server action, says what happened (the
 * frosted banner when done, a toast when refused), and refreshes the page or
 * opens the page the action names. The database's own words come back when it
 * refuses (leave, court, no access …).
 */
export function ActionForm({
  action, success, reset = false, confirm, className, children, onDone,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  /** The banner when it worked (unless the action says better). */
  success: string;
  /** Clear the fields afterwards (for "add" forms). */
  reset?: boolean;
  /** Ask first, for changes that are hard to undo. */
  confirm?: string;
  className?: string;
  children: React.ReactNode;
  onDone?: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const res = await action(fd);
          if (res.error) {
            toast.push({ title: t('Not done'), body: res.error, tone: 'critical' });
            return;
          }
          notify(res.message ?? success, res.detail);
          if (reset) form.reset();
          onDone?.();
          if (res.goTo) router.push(res.goTo);
          else router.refresh();
        });
      }}
    >
      <fieldset disabled={pending} className="contents">{children}</fieldset>
    </form>
  );
}
