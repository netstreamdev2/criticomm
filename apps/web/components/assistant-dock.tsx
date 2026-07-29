'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Bot, ChevronRight, Loader2, Maximize2, Minimize2, RotateCcw, Send, Sparkles, User, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Msg = { role: 'user' | 'assistant'; text: string; actions?: number };

const STORAGE_KEY = 'criticom:assistant-open';

/** Prompts tuned to what the person in front of the screen actually does. */
const SUGGESTIONS_BY_ROLE: Record<string, string[]> = {
  dispatch: [
    'What is still pending dispatch right now?',
    'Which units are available in Fire & Rescue?',
    'Summarise the last hour of critical calls',
    'Set INC-… to En Route',
  ],
  responder: [
    'What is assigned to my unit?',
    'Walk me through the start-of-shift checks',
    'How do I upload scene evidence?',
    'How do I mark an incident resolved?',
  ],
  command: [
    'How are we tracking against response-time targets today?',
    'Which department has the most open calls?',
    'Show me today’s critical incidents',
    'Who is on duty right now?',
  ],
  default: [
    'What is happening across the city right now?',
    'How do I log an incoming call?',
    'Where do I find incident reports?',
    'Explain what my role can access',
  ],
};

function suggestionsFor(role: string): string[] {
  if (/Dispatcher|ControlRoom|Operator|IncidentLogger/.test(role)) return SUGGESTIONS_BY_ROLE.dispatch!;
  if (/Firefighter|Paramedic|Police|Metro|Officer|Security|Doctor|Disaster/.test(role)) {
    return SUGGESTIONS_BY_ROLE.responder!;
  }
  if (/Chief|Captain|Supervisor|Admin|CaseManager/.test(role)) return SUGGESTIONS_BY_ROLE.command!;
  return SUGGESTIONS_BY_ROLE.default!;
}

/**
 * Criti — the assistant, docked to the right edge of every page.
 *
 * It lives in the app shell rather than on a route so the conversation survives
 * navigation: ask about a call, walk over to it, and the thread is still there.
 * The full-page view at /assistant remains for longer sessions.
 */
export function AssistantDock({
  fullName, role, silo,
}: {
  fullName: string; role: string; silo: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Remember whether the operator likes the dock open.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setOpen(true);
    } catch { /* private mode */ }
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

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const next: Msg[] = [...messages, { role: 'user', text: trimmed }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `page` lets Criti answer "how do I do this here?" without being told.
        body: JSON.stringify({ messages: next, page: pathname }),
      });
      const data = (await res.json()) as { reply?: string; error?: string; actionsExecuted?: number };
      setMessages((cur) => [...cur, {
        role: 'assistant',
        text: data.reply ?? data.error ?? 'No response.',
        actions: data.actionsExecuted,
      }]);
    } catch {
      setMessages((cur) => [...cur, { role: 'assistant', text: 'Network error — please try again.' }]);
    } finally {
      setBusy(false);
    }
  }, [busy, messages, pathname]);

  const suggestions = suggestionsFor(role);

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Criti assistant"
          title="Ask Criti  (Ctrl+J)"
          className="group fixed bottom-4 right-4 z-[65] flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-2xl transition-transform hover:scale-105 active:scale-95"
        >
          <Sparkles className="h-6 w-6" />
          <span className="pointer-events-none absolute right-16 whitespace-nowrap rounded-lg border border-border bg-bg-card px-3 py-1.5 text-xs font-semibold opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
            Ask Criti · Ctrl+J
          </span>
        </button>
      )}

      {/* Dock */}
      {open && (
        <>
          {/* Scrim only on small screens — on desktop the dock sits beside the work. */}
          <button
            type="button"
            aria-label="Close assistant"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[75] cursor-default bg-black/50 backdrop-blur-sm lg:hidden"
          />
          <aside
            aria-label="Criti assistant"
            className={cn(
              'dock-enter fixed inset-y-0 right-0 z-[80] flex w-full flex-col border-l border-border bg-bg-card shadow-2xl',
              wide ? 'sm:w-[38rem]' : 'sm:w-[26rem]',
            )}
          >
            {/* Header */}
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">Criti</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  Live data · {silo} · {role}
                </p>
              </div>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMessages([])}
                  aria-label="Clear conversation"
                  title="Clear conversation"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-fg"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
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
                aria-label="Close assistant"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {/* Thread */}
            <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="py-6">
                  <div className="text-center">
                    <Bot className="mx-auto h-9 w-9 text-muted-foreground" />
                    <p className="mt-3 text-sm font-semibold">Hello {fullName.split(' ')[0]}</p>
                    <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                      I can read the live incident board and act on it — change a status,
                      fill a report field, or just explain where something lives.
                    </p>
                  </div>
                  <div className="mt-5 space-y-1.5">
                    {suggestions.map((s) => (
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
              ) : null}

              {messages.map((m, i) => (
                <div key={i} className={cn('flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}>
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                      m.role === 'user' ? 'bg-muted text-fg' : 'bg-primary',
                    )}
                  >
                    {m.role === 'user' ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                  </span>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed',
                      m.role === 'user'
                        ? 'bg-muted'
                        : 'border border-border bg-bg-soft',
                    )}
                  >
                    <RichText text={m.text} />
                    {m.actions ? (
                      <p className="mt-2 border-t border-border pt-1.5 text-[11px] font-semibold text-severity-low-ink">
                        {m.actions} action{m.actions === 1 ? '' : 's'} carried out
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}

              {busy ? (
                <div className="flex gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-soft px-3 py-2 text-[13px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the board…
                  </div>
                </div>
              ) : null}
            </div>

            {/* Composer */}
            <form
              onSubmit={(e) => { e.preventDefault(); void send(input); }}
              className="border-t border-border p-3"
            >
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends; Shift+Enter is a newline — the convention
                    // people already have from every other chat box.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  rows={1}
                  placeholder="Ask about the board, or tell me what to do…"
                  className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus:border-accent focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  aria-label="Send"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary transition-opacity disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Criti only sees records your role is cleared for.
              </p>
            </form>
          </aside>
        </>
      )}
    </>
  );
}

/**
 * Minimal Markdown for assistant replies: **bold**, `code`, and `- ` bullets.
 * Rendered as React nodes rather than injected HTML — the model's output is
 * never trusted as markup.
 */
function RichText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line);
        const content = bullet ? line.replace(/^\s*[-*•]\s+/, '') : line;
        if (!content.trim()) return <div key={i} className="h-1.5" />;
        return (
          <p key={i} className={cn('break-words', bullet && 'flex gap-1.5 pl-1')}>
            {bullet ? <span className="text-muted-foreground">•</span> : null}
            <span>{inline(content)}</span>
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={key++} className="font-semibold text-fg">{m[1]}</strong>);
    } else {
      out.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{m[2]}</code>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
