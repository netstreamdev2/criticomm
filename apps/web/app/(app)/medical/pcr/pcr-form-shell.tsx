'use client';

import { useState, useTransition } from 'react';
import { validatePcr } from '@criticom/db/pcr';
import { answersFrom } from '@/lib/pcr-record';

/**
 * Checks the ePCR with the shared rules before it is sent, and keeps what was
 * typed when the server refuses it.
 */
export function PcrFormShell({ action, submitLabel, children }: {
  action: (fd: FormData) => Promise<{ error: string } | undefined>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const found = validatePcr(answersFrom(fd));
    setProblems(found);
    if (found.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    start(async () => {
      const res = await action(fd);
      if (res?.error) { setProblems([res.error]); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {problems.length ? (
        <div role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">
          <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ) : null}
      {children}
      <button type="submit" disabled={pending} className="h-11 w-full rounded-md bg-primary text-sm font-semibold disabled:opacity-60">
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
