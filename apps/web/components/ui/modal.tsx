'use client';

import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * A plain modal: dimmed page, a card, a title and a close button. Escape and
 * the close button call onClose unless `busy` holds it open.
 */
export function Modal({ title, onClose, busy, children, wide, large }: {
  title: string; onClose: () => void; busy?: boolean; children: React.ReactNode; wide?: boolean;
  /** Room to work in, e.g. the call description. */
  large?: boolean;
}) {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className={`w-full ${large ? 'max-w-4xl' : wide ? 'max-w-2xl' : 'max-w-lg'} space-y-4 rounded-xl border border-border bg-bg-card p-5 shadow-2xl`}>
        <div className="flex items-start justify-between gap-3">
          <h2 id={id} className="text-lg font-semibold">{title}</h2>
          {!busy ? (
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:text-fg">
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
