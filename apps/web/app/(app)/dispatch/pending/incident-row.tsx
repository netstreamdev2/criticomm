'use client';

import { useRouter } from 'next/navigation';

/**
 * Clickable queue row — opens the incident's full lifecycle view.
 * Keyboard accessible (Enter/Space); nested controls stop propagation so the
 * "Assign" action still works without triggering navigation.
 */
export function IncidentRow({
  incidentId,
  children,
}: {
  incidentId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const open = () => router.push(`/incidents/${incidentId}`);

  return (
    <tr
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      tabIndex={0}
      role="link"
      aria-label="View incident lifecycle"
      className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
    >
      {children}
    </tr>
  );
}

/** Wrapper for interactive cells that must not trigger the row navigation. */
export function StopClick({ children }: { children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: purely stops bubbling; inner control owns behaviour
    <span onClick={(e) => e.stopPropagation()}>{children}</span>
  );
}
