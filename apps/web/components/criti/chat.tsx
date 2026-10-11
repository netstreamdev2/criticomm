'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronRight, Loader2, Send, Sparkles, User } from 'lucide-react';
import type { ProposalView } from '@criticom/api';
import { cn } from '@/lib/utils';
import { ProposalCard, type CardState } from './proposal-card';
import { RichText } from './shared';

type Card = { view: ProposalView; state: CardState };
export type CritiMessage = { role: 'user' | 'assistant'; text: string; cards?: Card[] };

const THREAD_KEY = 'criti:thread';

/** Starting questions for the work this role does. */
function startersFor(role: string): string[] {
  if (role === 'IncidentLogger' || role === 'ControlRoom') {
    return [
      'Log a call: Sipho Dlamini on 082 555 1234, house on fire at 12 Smith Road, Umbilo, two people inside',
      'What is waiting for dispatch right now?',
      'Which desks should get a gas leak at a school?',
      'Is anything on the board from 082 555 1234?',
    ];
  }
  if (role === 'Dispatcher') {
    return [
      'What needs my attention right now?',
      'Who is nearest to the oldest critical call?',
      'Which calls has nobody responded to?',
      'Who is free on duty?',
    ];
  }
  if (['Supervisor', 'Captain', 'FireChief', 'Admin', 'SystemAdmin', 'SuperAdmin', 'SystemController'].includes(role)) {
    return [
      'How is my department doing right now?',
      'Which calls are late or stuck?',
      'Who has been on duty too long?',
      'Who is on duty and who is free?',
    ];
  }
  if (['Police', 'Firefighter', 'Paramedic', 'Disaster', 'Doctor'].includes(role)) {
    return [
      'What calls do I have?',
      'How do I file the report for my call?',
      'Walk me through the start of shift',
      'What does each status mean?',
    ];
  }
  return [
    'What is happening on the board right now?',
    'Where do I find reports?',
    'What can my role open?',
    'How does a call move from logging to closing?',
  ];
}

function readThread(): CritiMessage[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(THREAD_KEY) ?? '[]') as CritiMessage[];
    return Array.isArray(raw) ? raw.slice(-30) : [];
  } catch {
    return [];
  }
}

/**
 * Talking to Criti. Each reply may carry cards: tasks Criti prepared, which
 * run only when confirmed. The thread is kept for this browser tab, so it
 * survives moving between pages and closing the dock.
 */
export function CritiChat({
  fullName, role, compact = false, ask, onAsked,
}: {
  fullName: string;
  role: string;
  compact?: boolean;
  /** A question handed over from elsewhere (a tile's "Ask Criti"). */
  ask?: { prompt: string; nonce: number } | null;
  onAsked?: () => void;
}) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<CritiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The saved thread is read after mounting (the page is rendered on the
  // server, which has none); nothing is sent or saved before it is in.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMessages(readThread());
    setReady(true);
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(THREAD_KEY, JSON.stringify(messages.slice(-30))); } catch { /* private mode */ }
  }, [messages, ready]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || busy || !ready) return;
    const next: CritiMessage[] = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: pathname,
          canConfirm: true,
          messages: next.slice(-12).map((m) => ({
            role: m.role,
            text: m.text,
            proposals: (m.cards ?? []).map((c) => ({ proposal: c.view.proposal, state: c.state })),
          })),
        }),
      });
      const data = (await res.json().catch(() => null)) as { reply?: string; error?: string; proposals?: ProposalView[] } | null;
      setMessages((cur) => [...cur, {
        role: 'assistant',
        text: data?.reply ?? data?.error ?? 'No answer came back. Try again.',
        cards: (data?.proposals ?? []).map((view) => ({ view, state: 'open' as const })),
      }]);
    } catch {
      setMessages((cur) => [...cur, { role: 'assistant', text: 'No connection. Check the network and try again.' }]);
      setInput(question);
    } finally {
      setBusy(false);
    }
  }, [busy, messages, pathname, ready]);

  // A question handed over by a tile: asked once, when Criti is free.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || !ask || busy || handled.current === ask.nonce) return;
    handled.current = ask.nonce;
    onAsked?.();
    void send(ask.prompt);
  }, [ready, ask, busy, send, onAsked]);

  const setCard = (mi: number, ci: number, state: CardState) => {
    setMessages((cur) => cur.map((m, i) => (i !== mi || !m.cards ? m : {
      ...m, cards: m.cards.map((c, j) => (j === ci ? { ...c, state } : c)),
    })));
  };

  const clear = () => {
    setMessages([]);
    try { sessionStorage.removeItem(THREAD_KEY); } catch { /* private mode */ }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className={cn('flex-1 space-y-4 overflow-y-auto', compact ? 'p-4' : 'p-5')}>
        {messages.length === 0 ? (
          <div className="py-4">
            <div className="text-center">
              <Sparkles className="mx-auto h-8 w-8 text-accent" />
              <p className="mt-3 text-sm font-semibold">Hello {fullName.split(' ')[0]}</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                I know how your department works and I can read the live board your role can see. Ask me anything,
                or tell me what to do. I prepare it, and nothing changes until you confirm.
              </p>
            </div>
            <div className={cn('mt-5 space-y-1.5', !compact && 'mx-auto max-w-xl')}>
              {startersFor(role).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border bg-bg-soft px-3 py-2 text-left text-xs transition-colors hover:border-accent/50 hover:bg-muted"
                >
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">{s}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button type="button" onClick={clear} className="text-[11px] font-semibold text-muted-foreground hover:text-fg">
              Start again
            </button>
          </div>
        )}

        {messages.map((m, mi) => (
          <div key={mi} className={cn('flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}>
            <span className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              m.role === 'user' ? 'bg-muted text-fg' : 'bg-primary text-primary-foreground',
            )}>
              {m.role === 'user' ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            </span>
            <div className={cn('min-w-0 space-y-2', compact ? 'max-w-[85%]' : 'max-w-[75%]')}>
              <div className={cn(
                'rounded-xl px-3 py-2 text-[13px] leading-relaxed',
                m.role === 'user' ? 'bg-muted' : 'border border-border bg-bg-soft',
              )}>
                {m.role === 'user' ? <p className="whitespace-pre-wrap break-words">{m.text}</p> : <RichText text={m.text} />}
              </div>
              {(m.cards ?? []).map((c, ci) => (
                <ProposalCard
                  key={`${mi}-${ci}`}
                  view={c.view}
                  state={c.state === 'working' ? 'open' : c.state}
                  onChange={(s) => { if (s !== 'working') setCard(mi, ci, s); }}
                />
              ))}
            </div>
          </div>
        ))}

        {busy ? (
          <div className="flex gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-soft px-3 py-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the board…
            </div>
          </div>
        ) : null}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={compact ? 1 : 2}
            maxLength={2000}
            placeholder="Ask about the board, or tell me what to do…"
            aria-label="Message to Criti"
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Criti sees only what your role may see. Nothing changes until you confirm.
        </p>
      </form>
    </div>
  );
}
