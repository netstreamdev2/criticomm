/**
 * The phone's offline outbox ends every timeline entry it files with a
 * marker: a zero-width space and the outbox entry's id (apps/mobile/lib/
 * sync.tsx). That is how a replay after a dead zone is recognised and not
 * filed twice, so the database keeps it. The space is invisible but the id is
 * not, so it is taken off wherever a timeline entry is read.
 */
const OUTBOX_MARKER = /\u200B[0-9A-Za-z-]+\s*$/;

export function noteText(message: string | null | undefined): string {
  return (message ?? '').replace(OUTBOX_MARKER, '').trimEnd();
}
