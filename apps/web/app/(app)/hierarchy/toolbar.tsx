'use client';

import { Printer, Download } from 'lucide-react';

/** Print + CSV export controls for the org chart (hidden on the printed page). */
export function HierarchyToolbar({ dept, deptLabel }: { dept: string; deptLabel: string }) {
  return (
    <div className="no-print flex gap-2">
      <a
        href={`/api/hierarchy/export.csv?dept=${dept}`}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-bg-soft px-4 text-sm font-semibold text-fg/80 hover:bg-muted"
      >
        <Download className="h-4 w-4" /> Export CSV
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        title={`Print ${deptLabel} org chart`}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold hover:opacity-90"
      >
        <Printer className="h-4 w-4" /> Print
      </button>
    </div>
  );
}
