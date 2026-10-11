'use client';

import { CritiChat } from '@/components/criti/chat';

/** The full-page view of Criti: the same conversation as the dock, with more room. */
export function ChatClient({ fullName, role }: { fullName: string; role: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-bg-card">
      <CritiChat fullName={fullName} role={role} />
    </div>
  );
}
