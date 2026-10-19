'use client';

import { createPortal } from 'react-dom';
import { Copy, Printer, X } from 'lucide-react';
import type { ActivationSlip as Slip } from '@/lib/onboarding/server';
import { formatDeadline } from '@/lib/onboarding/messages';
import { Button } from '@/components/ui/button';
import { useT } from '@/components/i18n';
import { T } from '@/components/i18n';

/** On paper, only the slips: the rest of the page is left out entirely. Slips never split across sheets. */
const PRINT_CSS = `@media print {
  body > *:not(#slip-print-root) { display: none !important; }
  #slip-print-root { position: static !important; display: block !important; padding: 0 !important; background: none !important; backdrop-filter: none !important; overflow: visible !important; }
  #slip-print-root .slip-controls { display: none !important; }
  #slip-print-root .slip-stack { max-width: none !important; }
  .activation-slip { box-shadow: none !important; margin: 0 auto 10mm; max-width: 120mm; break-inside: avoid; page-break-inside: avoid; }
}`;

/** One slip, as printed. */
export function SlipCard({ slip, titleId }: { slip: Slip; titleId?: string }) {
  const { t } = useT();
  return (
    <div className="activation-slip space-y-3 rounded border-2 border-dashed border-slate-400 bg-white p-5 text-[14px] text-slate-900 shadow-2xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-slate-900 pb-2 font-bold">
        <span id={titleId}>{t('HikTech account activation')}</span>
        <span className="text-xs font-medium text-slate-500">{slip.organisation}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-slate-500">{t('Name')}</dt><dd className="font-semibold">{slip.fullName}</dd>
        <dt className="text-slate-500">{t('Badge')}</dt><dd className="font-semibold">{slip.badge}</dd>
        <dt className="text-slate-500">{t('Role')}</dt><dd className="font-semibold">{slip.role}, {slip.department}</dd>
        <dt className="text-slate-500">{t('Valid until')}</dt><dd className="font-semibold">{formatDeadline(slip.expiresAt)}</dd>
      </dl>
      <p className="rounded-md border-2 border-slate-900 py-2 text-center font-mono text-3xl font-semibold tracking-[0.15em]"
        aria-label={`Activation code ${slip.code.split('').join(' ')}`}>
        {slip.code}
      </p>
      <ol className="list-decimal space-y-0.5 pl-5">
        <li>{t('Open the HikTech app and tap “I have an activation code”.')}</li>
        <li>{t('Enter this code and your badge number.')}</li>
        <li>{t('Choose your password.')}</li>
      </ol>
      <p className="text-xs text-slate-500">
        {t('Works once. Issued by {issuedBy}. Hand only to the person named above. Destroy after use.', { issuedBy: slip.issuedBy })}</p>
    </div>
  );
}

/**
 * The printed activation slip, for staff with neither email nor a phone on
 * record. Shown once, at the moment the code is issued: it is never stored,
 * so it cannot be shown again. A new slip cancels this one.
 */
export function ActivationSlip({ slip, onClose }: { slip: Slip; onClose: () => void }) {
  const first = slip.fullName.trim().split(/\s+/)[0] ?? slip.fullName;
  return createPortal(
    <div id="slip-print-root" className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-labelledby="slip-title">
      <style>{PRINT_CSS}</style>
      <div className="w-full max-w-md space-y-4">
        <SlipCard slip={slip} titleId="slip-title" />
        <div className="slip-controls space-y-3 rounded-xl border border-border bg-bg-card p-4 text-sm">
          <p className="text-muted-foreground">
            <T s="This code is shown" />{' '}<b className="text-fg"><T s="once" /></b> {' '}<T s="and is not stored anywhere. Print it now and hand it to {first} in person. If it is lost, issue a new slip from the invitations list; that cancels this one." first={first} /></p>
          <div className="flex gap-2">
            <Button onClick={() => window.print()} autoFocus><Printer className="h-4 w-4" /> {' '}<T s="Print slip" /></Button>
            <Button variant="ghost" onClick={onClose}><X className="h-4 w-4" /> {' '}<T s="Done" /></Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Several slips at once, for a shift briefing: printed together, each on its
 * own part of the page. Like a single slip, shown once and never stored.
 */
export function SlipBatch({ slips, onClose }: { slips: Slip[]; onClose: () => void }) {
  const { t } = useT();
  return createPortal(
    <div id="slip-print-root" className="fixed inset-0 z-[80] overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label={`${slips.length} activation slips`}>
      <style>{PRINT_CSS}</style>
      <div className="slip-stack mx-auto w-full max-w-md space-y-4">
        <div className="slip-controls sticky top-0 z-10 space-y-3 rounded-xl border border-border bg-bg-card p-4 text-sm shadow-lg">
          <p className="text-muted-foreground">
            <b className="text-fg">{t('{length} activation {value}', { length: slips.length, value: slips.length === 1 ? 'code' : 'codes' })}</b>{t(', shown once and not stored anywhere. Print them now and hand each to the person named on it. A lost slip is replaced from the invitations list; that cancels the old one.')}</p>
          <div className="flex gap-2">
            <Button onClick={() => window.print()} autoFocus><Printer className="h-4 w-4" /> {' '}{t('Print {length} {value}', { length: slips.length, value: slips.length === 1 ? 'slip' : 'slips' })}</Button>
            <Button variant="ghost" onClick={onClose}><X className="h-4 w-4" /> {' '}{t('Done')}</Button>
          </div>
        </div>
        {slips.map((slip) => <SlipCard key={slip.code} slip={slip} />)}
      </div>
    </div>,
    document.body,
  );
}

/** Development only: email is not set up, so the administrator passes the link on by hand. */
export function DevLink({ link, note, onClose }: { link: string; note: string; onClose: () => void }) {
  const { t } = useT();
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true"
      aria-labelledby="dev-link-title">
      <div className="w-full max-w-lg space-y-3 rounded-xl border border-severity-medium/50 bg-bg-card p-5 text-sm">
        <p id="dev-link-title" className="font-semibold">{t('Invitation link (development only)')}</p>
        <p className="text-muted-foreground">{note}</p>
        <p className="break-all rounded-md border border-border bg-bg-soft p-3 font-mono text-xs">{link}</p>
        <div className="flex gap-2">
          <Button onClick={() => { void navigator.clipboard?.writeText(link).catch(() => {}); }} autoFocus>
            <Copy className="h-4 w-4" /> {' '}{t('Copy link')}</Button>
          <Button variant="ghost" onClick={onClose}>{t('Done')}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
