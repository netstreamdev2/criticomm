/** Shared table shell used by every list page. */
export function SimpleTable({
  headers, empty, children,
}: {
  headers: string[]; empty?: string; children: React.ReactNode;
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = !rows || (Array.isArray(rows) && rows.length === 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-border">
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 text-left">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-center text-muted-foreground">
                {empty ?? 'Nothing here yet.'}
              </td>
            </tr>
          ) : rows}
        </tbody>
      </table>
    </div>
  );
}

export function Tr({ children }: { children: React.ReactNode }) {
  return <tr className="border-b border-border/50 hover:bg-muted/40">{children}</tr>;
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className ?? ''}`}>{children}</td>;
}
