'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useT } from '@/components/i18n';

/**
 * A plain modal: dimmed page, a card, a title and a close button. It always
 * fits the screen: the title stays at the top, `footer` (the window's
 * buttons) stays at the bottom, and what is between scrolls on its own, with
 * a scroll bar wide enough to find.
 *
 * `confirmClose`: a window that holds work asks first when it is closed by
 * the dimmed page, Escape or the ✕ ("Close the description?"); its own
 * buttons (Done, Cancel) close it at once. Without it, Escape and the ✕
 * close, and the dimmed page does nothing. `busy` holds it open.
 */
export function Modal({ title, onClose, busy, children, footer, confirmClose, wide, large }: {
  title: string; onClose: () => void; busy?: boolean; children: React.ReactNode; wide?: boolean;
  /** The window's buttons, kept in view at the bottom. */
  footer?: React.ReactNode;
  /** Ask before closing: what closing means for the work in it. */
  confirmClose?: { title: string; body: string } | null;
  /** Room to work in, e.g. the call description. */
  large?: boolean;
}) {
  const { t } = useT();
  const id = useId();
  const [asking, setAsking] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  /** A close that was not one of the window's own buttons. */
  const requestClose = useCallback(() => {
    if (busy) return;
    if (confirmClose) setAsking(true);
    else onClose();
  }, [busy, confirmClose, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (asking) { setAsking(false); return; }
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asking, requestClose]);

  useEffect(() => { if (asking) keepRef.current?.focus(); }, [asking]);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-labelledby={id}
      // Only a click on the dimmed page itself, not one that ends there after a drag from the card.
      onMouseDown={(e) => { if (e.target === e.currentTarget && confirmClose) requestClose(); }}
    >
      <div className={`relative flex max-h-[calc(100dvh-2rem)] w-full ${large ? 'max-w-4xl' : wide ? 'max-w-2xl' : 'max-w-lg'} flex-col rounded-xl border border-border bg-bg-card shadow-2xl`}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={id} className="text-lg font-semibold">{title}</h2>
          {!busy ? (
            <button type="button" onClick={requestClose} aria-label={t('Close')} className="rounded p-1 text-muted-foreground hover:text-fg">
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        <div className="modal-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer ? <div className="shrink-0 border-t border-border px-5 py-3">{footer}</div> : null}

        {asking && confirmClose ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/55 p-4" role="alertdialog" aria-modal="true"
            aria-labelledby={`${id}-ask`} aria-describedby={`${id}-ask-body`}>
            <div className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-bg-card p-5 shadow-2xl">
              <p id={`${id}-ask`} className="text-base font-semibold">{confirmClose.title}</p>
              <p id={`${id}-ask-body`} className="text-sm text-muted-foreground">{confirmClose.body}</p>
              <div className="flex justify-end gap-2 pt-1">
                <button ref={keepRef} type="button" onClick={() => setAsking(false)}
                  className="h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent/90">
                  {t('Keep working')}
                </button>
                <button type="button" onClick={() => { setAsking(false); onClose(); }}
                  className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted">
                  {t('Close')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
