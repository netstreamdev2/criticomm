'use client';

import { useState, useTransition } from 'react';
import { Radio, Send, Volume2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

type Audio = { id: number; time: string; play_url: string };

export function PttConsole({ units }: { units: Array<{ label: string; account: string }> }) {
  const [account, setAccount] = useState(units[0]?.account ?? '');
  const [customAccount, setCustomAccount] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [audios, setAudios] = useState<Audio[] | null>(null);
  const [pending, start] = useTransition();

  const target = customAccount.trim() || account;

  const send = () => {
    if (!target || !text.trim()) return;
    setStatus(null);
    start(async () => {
      try {
        const res = await fetch('/api/ptt/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: target, text: text.trim() }),
        });
        const data = (await res.json()) as { success?: boolean; error?: string; message?: string };
        if (data.success) {
          setStatus(`✓ Message delivered to ${target}`);
          setText('');
        } else {
          setStatus(data.error ?? data.message ?? 'Send failed.');
        }
      } catch (e) {
        setStatus((e as Error).message);
      }
    });
  };

  const loadAudio = () => {
    if (!target) return;
    setAudios(null);
    setStatus(null);
    start(async () => {
      try {
        const res = await fetch(`/api/ptt/audio?account=${encodeURIComponent(target)}`);
        const data = (await res.json()) as { success?: boolean; audios?: Audio[]; error?: string; message?: string };
        if (data.success) setAudios(data.audios ?? []);
        else setStatus(data.error ?? data.message ?? 'Audio query failed.');
      } catch (e) {
        setStatus((e as Error).message);
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Radio className="h-4 w-4" /> Target unit</CardTitle>
          <CardDescription>Pick a unit or type a RealPTT account directly.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm"
          >
            {units.length === 0 && <option value="">No personnel</option>}
            {units.map((u) => <option key={u.account} value={u.account}>{u.label}</option>)}
          </select>
          <input
            value={customAccount}
            onChange={(e) => setCustomAccount(e.target.value)}
            placeholder="…or custom PTT account"
            className="h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Text to radio</CardTitle>
          <CardDescription>Delivered as “[YOURNAME]: message” on the unit's handset.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              placeholder="Message to the unit…"
              className="h-10 flex-1 rounded-md border border-border bg-bg-soft px-3 text-sm"
            />
            <button
              type="button" onClick={send} disabled={pending || !text.trim() || !target}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Send
            </button>
            <button
              type="button" onClick={loadAudio} disabled={pending || !target}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm hover:bg-muted disabled:opacity-50"
            >
              <Volume2 className="h-4 w-4" /> Audio log
            </button>
          </div>
          {status && <p className="text-sm text-muted-foreground">{status}</p>}
        </CardContent>
      </Card>

      {audios !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Voice traffic — last 2 hours ({audios.length})</CardTitle>
            <CardDescription>Newest first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {audios.length === 0 && <p className="text-sm text-muted-foreground">No recordings in the window.</p>}
            {audios.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-bg-soft p-3">
                <span className="font-mono text-xs text-muted-foreground">{a.time}</span>
                {/* biome-ignore lint/a11y/useMediaCaption: PTT radio traffic has no captions */}
                <audio controls preload="none" src={a.play_url} className="h-9 max-w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
