'use client';

import { useCallback, useEffect, useState } from 'react';
import { Maximize2, MessageSquare, Minimize2, X } from 'lucide-react';
import { departmentName, roleName } from '@criticom/db';
import { cn } from '@/lib/utils';
import { CritiChat } from '@/components/criti/chat';
import { CritiMascot } from '@/components/criti/mascot';
import { CritiTiles } from '@/components/criti/insight-tiles';
import { ASK_EVENT, COUNT_EVENT, OPEN_EVENT, type DockTab } from '@/components/criti/shared';
import { useT } from '@/components/i18n';

const STORAGE_KEY = 'criticom:assistant-open';

/**
 * Criti, docked to the right edge of every console page.
 *
 * Two tabs: Chat, to ask and to have Criti prepare tasks, and Suggestions,
 * the same live tiles the dashboards show. It lives in the app shell so the
 * conversation survives moving between pages; /assistant is the full-page
 * view of the same conversation. Ctrl+J opens and closes it, and any tile's
 * "Ask Criti" opens it with the question already asked.
 */
export function AssistantDock({
  fullName, role, silo, tiles = true,
}: {
  fullName: string; role: string; silo: string;
  /** Whether the suggestion tiles are switched on for this organisation. */
  tiles?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [tab, setTab] = useState<DockTab>('chat');
  const [ask, setAsk] = useState<{ prompt: string; nonce: number } | null>(null);
  const [urgent, setUrgent] = useState(0);

  // Remember whether the person likes the dock open.
  useEffect(() => {
    try { if (localStorage.getItem(STORAGE_KEY) === '1') setOpen(true); } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch { /* private mode */ }
  }, [open]);

  // Ctrl/⌘ + J toggles; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Other screens open Criti, or hand it a question.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const t = (e as CustomEvent<{ tab?: DockTab }>).detail?.tab;
      setTab(t === 'suggestions' && tiles ? 'suggestions' : 'chat');
      setOpen(true);
    };
    const onAsk = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt?.trim();
      if (!prompt) return;
      setTab('chat');
      setOpen(true);
      setAsk({ prompt, nonce: Date.now() });
    };
    const onCount = (e: Event) => setUrgent(Number((e as CustomEvent<{ urgent?: number }>).detail?.urgent ?? 0));
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener(ASK_EVENT, onAsk);
    window.addEventListener(COUNT_EVENT, onCount);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener(ASK_EVENT, onAsk);
      window.removeEventListener(COUNT_EVENT, onCount);
    };
  }, [tiles]);

  const asked = useCallback(() => setAsk(null), []);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={urgent ? `Open Criti: ${urgent} urgent suggestion${urgent === 1 ? '' : 's'}` : 'Open Criti'}
          title={t('Ask Criti  (Ctrl+J)')}
          className="group fixed bottom-4 right-4 z-[65] flex h-16 w-16 items-center justify-center rounded-full border border-border bg-bg-card shadow-2xl transition-transform hover:scale-105 active:scale-95"
        >
          <CritiMascot className="h-14 w-14" />
          {urgent > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-severity-critical px-1 text-[11px] font-bold text-severity-critical-fg">
              {urgent > 9 ? '9+' : urgent}
            </span>
          ) : null}
          <span className="pointer-events-none absolute right-16 whitespace-nowrap rounded-lg border border-border bg-bg-card px-3 py-1.5 text-xs font-semibold text-fg opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
            {t('Ask Criti · Ctrl+J')}</span>
        </button>
      )}

      {open && (
        <>
          {/* Scrim only on small screens — on desktop the dock sits beside the work. */}
          <button
            type="button"
            aria-label={t('Close Criti')}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[75] cursor-default bg-black/50 backdrop-blur-sm lg:hidden"
          />
          <aside
            aria-label="Criti"
            className={cn(
              'dock-enter fixed inset-y-0 right-0 z-[80] flex w-full flex-col border-l border-border bg-bg-card shadow-2xl',
              wide ? 'sm:w-[38rem]' : 'sm:w-[26rem]',
            )}
          >
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-bg-soft">
                <CritiMascot className="h-8 w-8" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">Criti</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {departmentName(silo)} · {roleName(role)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWide((w) => !w)}
                aria-label={wide ? 'Narrow panel' : 'Widen panel'}
                title={wide ? 'Narrow panel' : 'Widen panel'}
                className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-fg sm:inline-flex"
              >
                {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('Close Criti')}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {tiles ? (
              <div role="tablist" aria-label="Criti" className="flex border-b border-border px-2">
                {([['chat', 'Chat'], ['suggestions', 'Suggestions']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={cn(
                      '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors',
                      tab === id ? 'border-accent text-fg' : 'border-transparent text-muted-foreground hover:text-fg',
                    )}
                  >
                    {id === 'chat' ? <MessageSquare className="h-3.5 w-3.5" /> : <CritiMascot className="h-4 w-4" />} {label}
                    {id === 'suggestions' && urgent > 0 ? (
                      <span className="rounded-full bg-severity-critical px-1.5 text-[10px] font-bold text-severity-critical-fg">{urgent}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}

            {tab === 'suggestions' && tiles ? (
              <div className="flex-1 overflow-y-auto p-3">
                <CritiTiles variant="dock" />
              </div>
            ) : (
              <CritiChat fullName={fullName} role={role} compact ask={ask} onAsked={asked} />
            )}
          </aside>
        </>
      )}
    </>
  );
}
