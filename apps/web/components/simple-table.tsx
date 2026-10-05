import { cn } from '@/lib/utils';
import { Inbox } from 'lucide-react';

/**
 * Shared table shell used by every list page.
 * Sticky header, horizontal scroll on narrow screens, and a proper empty state.
 */
export function SimpleTable({
  headers, empty, children,
}: {
  headers: string[]; empty?: string; children: React.ReactNode;
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = !rows || (Array.isArray(rows) && rows.length === 0);

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            {headers.map((h, i) => (
              <th
                key={`${h}-${i}`}
                scope="col"
                className="whitespace-nowrap border-b border-border bg-bg-card/95 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={headers.length} className="px-4 py-14 text-center">
                <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{empty ?? 'Nothing here yet.'}</p>
              </td>
            </tr>
          ) : rows}
        </tbody>
      </table>
    </div>
  );
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn('transition-colors hover:bg-muted/40', className)}>{children}</tr>;
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={`border-b border-border/40 px-4 py-3 align-middle ${className ?? ''}`}>
      {children}
    </td>
  );
}
