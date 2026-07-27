'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Send, User } from 'lucide-react';
import { cn } from '@/lib/utils';

type Msg = { role: 'user' | 'assistant'; text: string };

const SUGGESTIONS = [
  'How do I dispatch a unit to a pending call?',
  'Walk me through the start-of-shift checks',
  'How do I file a fire incident report?',
  'Where do I approve leave requests?',
];

export function ChatClient() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text: string) => {
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
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      setMessages((cur) => [...cur, { role: 'assistant', text: data.reply ?? data.error ?? 'No response.' }]);
    } catch {
      setMessages((cur) => [...cur, { role: 'assistant', text: 'Network error — please try again.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-bg-card">
      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="py-8 text-center">
            <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Try one of these:</p>
            <div className="mx-auto mt-4 flex max-w-md flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-md border border-border bg-bg-soft px-3 py-2 text-sm hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
            <div className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              m.role === 'user' ? 'bg-primary/20 text-primary' : 'bg-accent/20 text-accent',
            )}>
              {m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div className={cn(
              'max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
              m.role === 'user' ? 'bg-primary/15' : 'bg-bg-soft border border-border/60',
            )}>
              {m.text}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-accent">
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-lg border border-border/60 bg-bg-soft px-3 py-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
        className="flex gap-2 border-t border-border p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Criti anything about the platform…"
          className="h-10 flex-1 rounded-md border border-border bg-bg-soft px-3 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> Send
        </button>
      </form>
    </div>
  );
}
