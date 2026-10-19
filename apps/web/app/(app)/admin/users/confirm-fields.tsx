'use client';

import { Check } from 'lucide-react';
import { normaliseConfirm } from '@criticom/db';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';

/** The database refuses a shorter reason (0048). */
export const MIN_REASON = 10;

export type ConfirmWord = { word: string; kind: 'badge number' | 'full name' | 'account id' };

/** Whether the typed reason and confirmation would pass the database's checks. */
export function confirmReady(reason: string, typed: string, confirm: ConfirmWord) {
  return reason.trim().length >= MIN_REASON && normaliseConfirm(typed) === normaliseConfirm(confirm.word);
}

/**
 * The two deliberate steps every account change takes: a reason for the
 * permanent record, and the account's badge number (or name) typed back.
 * Typing it is what stops a change landing on the wrong person.
 */
export function ConfirmFields({
  id, reason, onReason, typed, onTyped, confirm, reasonHint,
}: {
  id: string;
  reason: string;
  onReason: (v: string) => void;
  typed: string;
  onTyped: (v: string) => void;
  confirm: ConfirmWord;
  /** An example of a good reason for this kind of change. */
  reasonHint: string;
}) {
  const { t } = useT();
  const length = reason.trim().length;
  const matches = typed.length > 0 && normaliseConfirm(typed) === normaliseConfirm(confirm.word);

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={`${id}-reason`}>{t('Reason')}</Label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder={reasonHint}
          className="mt-1.5"
          rows={2}
          maxLength={500}
        />
        <p className={cn('mt-1 text-xs', length >= MIN_REASON ? 'text-muted-foreground' : 'text-severity-medium-ink')}>
          {length < MIN_REASON
            ? `At least ${MIN_REASON} characters (${length} so far).`
            : 'Kept on the permanent record. The person can read it in their own history.'}
        </p>
      </div>
      <div>
        <Label htmlFor={`${id}-confirm`}>
          {t('To confirm, type the {kind}', { kind: confirm.kind })}{' '}
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">{confirm.word}</span>
        </Label>
        <div className="relative mt-1.5">
          <Input
            id={`${id}-confirm`}
            value={typed}
            onChange={(e) => onTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={typed.length > 0 && !matches}
            className={cn('pr-9 font-mono', matches && 'border-success')}
          />
          {matches ? (
            <Check className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-success" aria-label={t('Matches')} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
