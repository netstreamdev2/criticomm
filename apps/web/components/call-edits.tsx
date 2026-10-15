import { History } from 'lucide-react';
import { editKindName, editLines, type IncidentEdit } from '@criticom/db';
import { formatSaTime } from '@/lib/utils';

/**
 * Every change to a call after it was sent (0079), oldest first: who made it
 * and in which role, when, why, and each field as it was and as it became.
 * Shown on the dispatch page and the call page; the case PDF prints the same.
 */
export function CallEdits({ edits, loggedBy }: { edits: IncidentEdit[]; loggedBy: string | null }) {
  if (!edits.length) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-bg-card">
      <h2 className="flex items-center justify-center gap-2 border-b border-border bg-bg-soft px-5 py-3 text-xs font-bold uppercase tracking-[0.18em]">
        <History className="h-3.5 w-3.5" aria-hidden /> Changes since it was logged
      </h2>
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">
          Logged by <span className="font-semibold text-fg">{loggedBy ?? 'the call taker'}</span>. Each change below keeps what the
          call said before it.
        </p>
        <ol className="space-y-3">
          {edits.map((e) => (
            <li key={e.id} className="rounded-xl border border-border">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-bg-soft/60 px-3 py-2 text-xs">
                <span>
                  <span className={e.kind === 'dispatch' ? 'font-bold text-accent' : 'font-bold'}>{editKindName(e.kind)}</span>
                  {' · '}<span className="font-semibold text-fg">{e.edited_by_name ?? 'Unknown'}</span>
                  {e.edited_by_role ? <span className="text-muted-foreground"> ({e.edited_by_role})</span> : null}
                </span>
                <span className="font-mono text-muted-foreground">{formatSaTime(e.edited_at)}</span>
              </div>
              {e.reason ? <p className="px-3 pt-2 text-xs"><span className="font-semibold">Why:</span> {e.reason}</p> : null}
              <div className="overflow-x-auto p-3">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr><th className="w-36 pb-1.5 pr-3 font-bold">Field</th><th className="pb-1.5 pr-3 font-bold">Before</th><th className="pb-1.5 font-bold">After</th></tr>
                  </thead>
                  <tbody className="align-top">
                    {editLines(e.changes).map((l) => (
                      <tr key={l.field} className="border-t border-border/60">
                        <td className="py-1.5 pr-3 font-semibold">{l.label}</td>
                        <td className="whitespace-pre-wrap break-words py-1.5 pr-3 text-muted-foreground line-through decoration-muted-foreground/40">{l.before}</td>
                        <td className="whitespace-pre-wrap break-words py-1.5">{l.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
