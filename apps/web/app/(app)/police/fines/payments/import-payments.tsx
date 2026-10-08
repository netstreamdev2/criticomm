'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileSpreadsheet, RotateCcw } from 'lucide-react';
import {
  checkPaymentRows, IMPORT_OUTCOMES, PAYMENT_COLUMNS, rand, type PaymentField, type PaymentRow,
} from '@criticom/db/fines';
import { findSheetHeaderRow, sheetRowsFromTable, type SheetColumn } from '@criticom/db/sheet';
import type { PaymentImportResult } from '@criticom/api';
import { readSpreadsheet } from '@/lib/register/file';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { importPaymentsAction, previewPaymentsAction, type PaymentMatch } from '../actions';

const COLUMNS = PAYMENT_COLUMNS as SheetColumn<PaymentField>[];

type Checked = ReturnType<typeof checkPaymentRows>[number] & { match: PaymentMatch | null; warn: string | null; problem: string | null };

/**
 * Payments from the cashier's or the bank's file. The file is read and
 * matched in this browser; nothing is recorded until "Record payments", and
 * the database checks every row again — a receipt already on a fine is
 * skipped, so the same file can be imported twice without paying twice.
 */
export function ImportPayments() {
  const [file, setFile] = useState<{ name: string; sha: string; sheet: string | null } | null>(null);
  const [rows, setRows] = useState<Checked[] | null>(null);
  const [busy, setBusy] = useState<'read' | 'record' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PaymentImportResult | null>(null);

  const ready = useMemo(() => (rows ?? []).filter((r) => r.row && r.match && !r.problem), [rows]);
  const total = ready.reduce((s, r) => s + (r.row?.amount ?? 0), 0);

  const reset = () => { setFile(null); setRows(null); setError(null); setResult(null); };

  const read = async (f: File) => {
    reset();
    setBusy('read');
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const sheet = await readSpreadsheet(bytes, f.name, {
        sheetName: /payment|receipt|bank|cashier/i,
        hasHeadings: (t) => findSheetHeaderRow(t, COLUMNS, 2) >= 0,
      });
      const parsed = sheetRowsFromTable(sheet.table, COLUMNS, 'payments');
      if (!parsed.ok) { setError(parsed.error); return; }
      if (parsed.rows.length > 2000) { setError('Import at most 2 000 payments at a time. Split the file.'); return; }
      const checked = checkPaymentRows(parsed.rows);
      const refs = checked.map((c) => c.row?.reference ?? (c.raw.reference ?? '').toUpperCase()).filter(Boolean);
      const preview = await previewPaymentsAction(refs);
      if (!preview.ok) { setError(preview.error); return; }
      setRows(checked.map((c) => {
        const ref = c.row?.reference ?? '';
        const found = preview.matches[ref] ?? [];
        let problem = c.problem;
        let warn: string | null = null;
        const match = found.length === 1 ? found[0]! : null;
        if (!problem && found.length === 0) problem = 'No fine with this number on the register.';
        if (!problem && found.length > 1) problem = 'More than one fine has this number.';
        if (!problem && match?.status === 'Cancelled') problem = 'This fine is cancelled.';
        if (!problem && match && c.row && c.row.paid_on < match.issuedOn) problem = 'Dated before the fine was issued.';
        if (!problem && match && c.row) {
          if (match.status === 'Paid') warn = 'Already paid in full — check this is not a duplicate.';
          else if (c.row.amount > match.dueNow + 0.005) warn = `More than the ${rand(match.dueNow)} owing today.`;
        }
        return { ...c, match, problem, warn };
      }));
      setFile({ name: f.name, sha: sheet.fingerprint, sheet: sheet.sheet });
    } catch (e) {
      setError((e as Error).message ?? 'The file could not be read.');
    } finally {
      setBusy(null);
    }
  };

  const record = async () => {
    if (!file || !ready.length) return;
    setBusy('record');
    setError(null);
    const res = await importPaymentsAction(ready.map((r) => r.row as PaymentRow), { fileName: file.name, fileSha256: file.sha });
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    setResult(res.result);
  };

  if (result) {
    const skipped = result.rows.filter((r) => r.outcome !== 'recorded');
    return (
      <Card>
        <CardHeader>
          <CardTitle>{result.recorded} payment{result.recorded === 1 ? '' : 's'} recorded · {rand(result.total)}</CardTitle>
          <CardDescription>{file?.name}. Each fine’s status was updated from its ledger.{skipped.length ? ` ${skipped.length} not recorded — see why below.` : ''}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="border-b border-border px-4 py-2">Line</th><th className="border-b border-border px-4 py-2">Fine</th>
                <th className="border-b border-border px-4 py-2">Receipt</th><th className="border-b border-border px-4 py-2 text-right">Amount</th>
                <th className="border-b border-border px-4 py-2">Result</th><th className="border-b border-border px-4 py-2">Status now</th>
              </tr></thead>
              <tbody>{result.rows.map((r, i) => (
                <tr key={`${r.line}-${i}`} className={r.outcome === 'recorded' ? '' : 'bg-severity-medium/5'}>
                  <td className="border-b border-border px-4 py-2 text-muted-foreground">{r.line}</td>
                  <td className="border-b border-border px-4 py-2 font-mono">
                    {r.fine_id ? <Link className="text-accent hover:underline" href={`/police/fines/${r.fine_id}`}>{r.fine_number}</Link> : r.reference}
                  </td>
                  <td className="border-b border-border px-4 py-2 font-mono text-xs">{r.receipt}</td>
                  <td className="border-b border-border px-4 py-2 text-right font-mono">{rand(r.amount ?? 0)}</td>
                  <td className={cn('border-b border-border px-4 py-2', r.outcome === 'recorded' ? 'text-severity-low-ink' : 'text-severity-medium-ink')}>
                    {IMPORT_OUTCOMES[r.outcome] ?? r.outcome}
                  </td>
                  <td className="border-b border-border px-4 py-2 text-xs">{r.status ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="px-6 pb-6">
            <button type="button" onClick={reset} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
              <RotateCcw className="h-4 w-4" /> Import another file
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>1 · Choose the file</CardTitle>
          <CardDescription>
            Excel (.xlsx) or CSV with these columns: {PAYMENT_COLUMNS.filter((c) => c.required).map((c) => c.header).join(', ')}
            {' '}(Method and Note are optional). Headings from most cashier and bank exports are recognised.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90">
            <FileSpreadsheet className="h-4 w-4" />
            {busy === 'read' ? 'Reading…' : 'Choose file'}
            <input
              type="file"
              accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f); }}
            />
          </label>
          <a href="/police/fines/payments/template" className="text-sm font-semibold text-accent hover:underline">Download the template</a>
          {file ? <span className="text-sm text-muted-foreground">{file.name}{file.sheet ? ` · sheet “${file.sheet}”` : ''}</span> : null}
        </CardContent>
      </Card>

      {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 p-3 text-sm font-semibold text-severity-critical-ink">{error}</p> : null}

      {rows ? (
        <Card>
          <CardHeader>
            <CardTitle>2 · Check the payments</CardTitle>
            <CardDescription>
              {ready.length} of {rows.length} ready to record ({rand(total)}).
              {rows.length - ready.length ? ` ${rows.length - ready.length} will be left out — fix them in the file and import it again.` : ''}
              {ready.some((r) => r.warn) ? ' Rows marked with a warning will be recorded; check them first.' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-0">
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg-card"><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="border-b border-border px-4 py-2">Line</th><th className="border-b border-border px-4 py-2">Number in file</th>
                  <th className="border-b border-border px-4 py-2">Fine</th><th className="border-b border-border px-4 py-2 text-right">Owing today</th>
                  <th className="border-b border-border px-4 py-2 text-right">Paying</th><th className="border-b border-border px-4 py-2">Date paid</th>
                  <th className="border-b border-border px-4 py-2">Receipt</th><th className="border-b border-border px-4 py-2">Check</th>
                </tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.line} className={r.problem ? 'bg-severity-critical/5' : r.warn ? 'bg-severity-medium/5' : ''}>
                    <td className="border-b border-border px-4 py-2 text-muted-foreground">{r.line}</td>
                    <td className="border-b border-border px-4 py-2 font-mono text-xs">{r.raw.reference ?? '—'}</td>
                    <td className="border-b border-border px-4 py-2">
                      {r.match ? (
                        <>
                          <span className="font-mono font-bold">{r.match.fineNumber}</span>
                          <div className="text-xs text-muted-foreground">{[r.match.who, r.match.vehicleReg, r.match.status].filter(Boolean).join(' · ')}</div>
                        </>
                      ) : '—'}
                    </td>
                    <td className="border-b border-border px-4 py-2 text-right font-mono">{r.match ? rand(r.match.dueNow) : '—'}</td>
                    <td className="border-b border-border px-4 py-2 text-right font-mono">{r.row ? rand(r.row.amount) : (r.raw.amount ?? '—')}</td>
                    <td className="border-b border-border px-4 py-2 text-xs">{r.row?.paid_on ?? r.raw.paid_on ?? '—'}</td>
                    <td className="border-b border-border px-4 py-2 font-mono text-xs">{r.raw.receipt ?? '—'}</td>
                    <td className={cn('border-b border-border px-4 py-2 text-xs font-semibold', r.problem ? 'text-severity-critical-ink' : r.warn ? 'text-severity-medium-ink' : 'text-severity-low-ink')}>
                      {r.problem ?? r.warn ?? 'Ready'}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 px-6 pb-6">
              <button type="button" onClick={reset} className="h-11 rounded-md border border-border px-5 text-sm font-semibold hover:bg-muted">Start again</button>
              <button
                type="button"
                disabled={busy !== null || ready.length === 0}
                onClick={() => {
                  if (!window.confirm(`Record ${ready.length} payment${ready.length === 1 ? '' : 's'} totalling ${rand(total)}?`)) return;
                  void record();
                }}
                className="h-11 rounded-md bg-primary px-6 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {busy === 'record' ? 'Recording…' : `Record ${ready.length} payment${ready.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
