'use client';

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="h-10 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted"
    >
      🖨 Print
    </button>
  );
}
