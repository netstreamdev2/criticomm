'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CallDraft, Proposal } from '@criticom/api';
import { cn } from '@/lib/utils';
import { readable } from '@/lib/readable';

/**
 * What Criti's tiles, cards and conversation share on the console.
 *
 * Any screen can open Criti or hand it a question through two window events,
 * so a tile's "Ask Criti" reaches the dock without the two knowing about
 * each other.
 */

export const ASK_EVENT = 'criti:ask';
export const OPEN_EVENT = 'criti:open';
export const COUNT_EVENT = 'criti:urgent';
const CALL_DRAFT_KEY = 'criti:call-draft';

export type DockTab = 'chat' | 'suggestions';

/**
 * Criti's strips fold to one thin line (the most urgent item still shows) and
 * open again with one click. Folded unless this person opened it; their
 * choice is kept in this browser.
 */
export function useFolded(where: 'page' | 'call'): [boolean, (folded: boolean) => void] {
  const key = `criti:folded:${where}`;
  const [folded, setFolded] = useState(true);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) setFolded(saved === '1');
    } catch { /* private mode: folded */ }
  }, [key]);
  const set = (next: boolean) => {
    setFolded(next);
    try { localStorage.setItem(key, next ? '1' : '0'); } catch { /* kept until reload */ }
  };
  return [folded, set];
}

/** The arrow that folds or opens a Criti strip. */
export function FoldButton({ folded, onToggle, openLabel, foldLabel }: {
  folded: boolean;
  onToggle: () => void;
  openLabel: string;
  foldLabel: string;
}) {
  const label = folded ? openLabel : foldLabel;
  return (
    <button
      type="button" onClick={onToggle} aria-expanded={!folded} aria-label={label} title={label}
      className="shrink-0 rounded p-0.5 text-white/60 hover:bg-white/10 hover:text-white"
    >
      {folded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
    </button>
  );
}

/** Open Criti's dock, on a tab. */
export function openCriti(tab: DockTab = 'chat') {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { tab } }));
}

/** Open the dock and ask Criti this. */
export function askCriti(prompt: string) {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { prompt } }));
}

export type ActResult =
  | { ok: true; message: string; href?: string; push?: { userId?: string; silos?: string[] } }
  | { ok: false; error: string };

/** Carry out a confirmed task. The server checks everything again. */
export async function runProposal(proposal: Proposal, incidentId?: string): Promise<ActResult> {
  try {
    const res = await fetch('/api/criti/act', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposal }),
    });
    const data = (await res.json().catch(() => null)) as ActResult | { error?: string } | null;
    if (!data || !('ok' in data)) return { ok: false, error: (data as { error?: string } | null)?.error ?? 'That could not be done.' };
    if (data.ok && data.push && incidentId) {
      // Reach locked phones, as the dispatch forms do. Best effort: a push
      // failure is not a dispatch failure.
      void fetch('/api/push/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId, ...data.push }),
      }).catch(() => {});
    }
    return data;
  } catch {
    return { ok: false, error: 'No connection. Check the network and try again.' };
  }
}

/** Hand a call Criti started to the intake form. */
export function saveCallDraft(call: CallDraft) {
  try { sessionStorage.setItem(CALL_DRAFT_KEY, JSON.stringify(call)); } catch { /* private mode: the form opens empty */ }
}

/** The call Criti handed over, once. */
export function takeCallDraft(): CallDraft | null {
  try {
    const raw = sessionStorage.getItem(CALL_DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(CALL_DRAFT_KEY);
    const draft = JSON.parse(raw) as CallDraft;
    return draft && typeof draft === 'object' ? draft : null;
  } catch {
    return null;
  }
}

/** "4 min", "1 h 12 min": how long something has stood. */
export function standing(since: string | null, now: number): string {
  if (!since) return '';
  const m = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  if (m < 1) return 'now';
  return readable(m);
}

/**
 * Criti's replies: **bold**, `code` and "- " bullets. Rendered as React
 * nodes, never injected HTML: the model's output is not trusted as markup.
 */
export function RichText({ text }: { text: string }) {
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
      out.push(<code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{m[2]}</code>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
