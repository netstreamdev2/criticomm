'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet, Lock, RotateCcw } from 'lucide-react';
import {
  BODYCAM_COLUMNS, checkBodycamList, checkFirearmList, checkVehicleList, FIREARM_COLUMNS, FIREARM_TYPES, VEHICLE_COLUMNS,
  type AssetFix, type AssetListCheck, type BodycamEntry, type BodycamItem, type CheckedAsset, type FirearmEntry,
  type FirearmItem, type FirearmType, type VehicleEntry, type VehicleItem,
} from '@criticom/db/assets';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import { findSheetHeaderRow, sheetRowsFromTable, type SheetColumn, type SheetRow } from '@criticom/db/sheet';
import type { Silo } from '@criticom/db/types';
import { armourySnapshotAction, importFirearmsAction } from '@/app/(app)/police/armoury/actions';
import { fleetSnapshotAction, importVehiclesAction } from '@/app/(app)/admin/vehicles/actions';
import { bodycamSnapshotAction, importBodycamsAction } from '@/app/(app)/police/bodycams/actions';
import { readSpreadsheet, type StaffFile } from '@/lib/register/file';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type AnyItem = FirearmItem | VehicleItem | BodycamItem;
type AssetKind = 'firearms' | 'vehicles' | 'bodycams';
type Done = { added: number; updated: number; unchanged: number };
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

type KindConfig = {
  noun: string;
  what: string;
  columns: SheetColumn<string>[];
  sheetName: RegExp;
  template: string;
  back: { href: string; label: string };
  snapshot: () => Promise<Result<{ register: unknown[] }>>;
  check: (rows: SheetRow<string>[], register: unknown[], fixes: Record<number, AssetFix>) => AssetListCheck<AnyItem>;
  run: (rows: Array<AnyItem & { line: number }>, meta: { fileName: string; fileSha256: string; reason: string }) => Promise<Result<Done>>;
  reasonHint: string;
  /** What an import never touches. */
  untouched: string;
};

const KINDS: Record<AssetKind, KindConfig> = {
  firearms: {
    noun: 'firearm', what: 'armoury', columns: FIREARM_COLUMNS as SheetColumn<string>[], sheetName: /firearm|armou?ry|weapon/i,
    template: '/police/armoury/template', back: { href: '/police/armoury', label: 'Armoury' },
    snapshot: armourySnapshotAction,
    check: (rows, register, fixes) => checkFirearmList(rows as never, register as FirearmEntry[], fixes),
    run: (rows, meta) => importFirearmsAction(rows as Array<FirearmItem & { line: number }>, meta),
    reasonHint: 'e.g. Armoury stocktake, October 2026',
    untouched: 'who holds a firearm never changes by import',
  },
  vehicles: {
    noun: 'vehicle', what: 'fleet', columns: VEHICLE_COLUMNS as SheetColumn<string>[], sheetName: /vehicle|fleet|transport/i,
    template: '/admin/vehicles/template', back: { href: '/admin/vehicles', label: 'Fleet' },
    snapshot: fleetSnapshotAction,
    check: (rows, register, fixes) => checkVehicleList(rows as never, register as VehicleEntry[], fixes),
    run: (rows, meta) => importVehiclesAction(rows as Array<VehicleItem & { line: number }>, meta),
    reasonHint: 'e.g. Fleet register from Transport, October 2026',
    untouched: 'whether a vehicle is on the road never changes by import',
  },
  bodycams: {
    noun: 'bodycam', what: 'bodycam', columns: BODYCAM_COLUMNS as SheetColumn<string>[], sheetName: /body ?cam|camera|bwc/i,
    template: '/police/bodycams/template', back: { href: '/police/bodycams', label: 'Bodycams' },
    snapshot: bodycamSnapshotAction,
    check: (rows, register, fixes) => checkBodycamList(rows as never, register as BodycamEntry[], fixes),
    run: (rows, meta) => importBodycamsAction(rows as Array<BodycamItem & { line: number }>, meta),
    reasonHint: 'e.g. Bodycams delivered by Hikvision, October 2026',
    untouched: 'who has a bodycam and its status never change by import',
  },
};

const SILOS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini'];
const LIST_LIMIT = 200;

/**
 * Importing the armoury, the fleet or the bodycams from a spreadsheet. The file is read and
 * checked in this browser; nothing is sent until the administrator confirms,
 * and the database checks every row again.
 */
export function AssetImportWizard({ kind }: { kind: AssetKind }) {
  const k = KINDS[kind];
  const [register, setRegister] = useState<unknown[] | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; staff: StaffFile; headerRow: number; ignored: string[]; rows: SheetRow<string>[] } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [fixes, setFixes] = useState<Record<number, AssetFix>>({});
  const [reason, setReason] = useState('');
  const [phase, setPhase] = useState<'check' | 'importing' | 'done' | 'failed'>('check');
  const [result, setResult] = useState<Done | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    k.snapshot().then((r) => (r.ok ? setRegister(r.register) : setRegisterError(r.error)));
  }, [k]);

  const check = useMemo(() => (file && register ? k.check(file.rows, register, fixes) : null), [file, register, fixes, k]);

  const open = async (f: File) => {
    setFileError(null); setFile(null); setFixes({}); setReading(true);
    try {
      const staff = await readSpreadsheet(new Uint8Array(await f.arrayBuffer()), f.name, {
        sheetName: k.sheetName, hasHeadings: (t) => findSheetHeaderRow(t, k.columns) >= 0,
      });
      const parsed = sheetRowsFromTable(staff.table, k.columns, k.what);
      if (!parsed.ok) { setFileError(parsed.error); return; }
      if (!parsed.rows.length) { setFileError('The file has headings but nothing under them.'); return; }
      setFile({ name: f.name, staff, headerRow: parsed.headerRow, ignored: parsed.header.ignored, rows: parsed.rows });
      setPhase('check');
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setReading(false);
    }
  };

  const fix = (line: number, change: Partial<AssetFix> | null) =>
    setFixes((f) => ({ ...f, [line]: change === null ? {} : { ...f[line], ...change } }));

  const runImport = async () => {
    if (!check || !file) return;
    setPhase('importing'); setImportError(null);
    const res = await k.run(check.toImport, { fileName: file.name, fileSha256: file.staff.fingerprint, reason: reason.trim() });
    if (!res.ok) { setImportError(res.error); setPhase('failed'); return; }
    setResult(res); setPhase('done');
  };

  if (phase === 'done' && result) {
    return (
      <div className="space-y-4 rounded-xl border border-success/40 bg-bg-card p-6">
        <p className="text-lg font-semibold">Imported</p>
        <p className="text-sm text-muted-foreground">{result.added} added, {result.updated} updated, {result.unchanged} unchanged. It is on the permanent record with your reason.</p>
        <div className="flex gap-2">
          <Button asChild><Link href={k.back.href}>Back to the {k.back.label.toLowerCase()}</Link></Button>
          <Button variant="outline" onClick={() => { setFile(null); setResult(null); setReason(''); setFixes({}); setPhase('check'); k.snapshot().then((r) => r.ok && setRegister(r.register)); }}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {registerError ? <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{registerError}</p> : null}

      {!file ? (
        <section className="space-y-3">
          <label
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void open(f); }}
            className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40')}
          >
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" aria-hidden />
            <span className="font-semibold">{reading ? 'Reading…' : `Choose the ${k.what} spreadsheet, or drop it here`}</span>
            <span className="text-sm text-muted-foreground">Excel (.xlsx) or CSV</span>
            <input type="file" accept=".xlsx,.xlsm,.csv,.txt" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ''; }} />
          </label>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>The file is read on this computer. Nothing is saved until you confirm, and the file itself is never stored.</span>
          </p>
          <a href={k.template} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            <Download className="h-4 w-4" /> Download the {k.what} template
          </a>
          {fileError ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{fileError}</p> : null}
        </section>
      ) : null}

      {file && !register && !registerError ? <p className="text-sm text-muted-foreground">Loading the register to compare against…</p> : null}

      {file && check ? (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-card px-4 py-3 text-sm">
            <div>
              <p className="font-semibold">{file.name}</p>
              <p className="text-muted-foreground">
                {file.rows.length} rows{file.staff.sheet ? ` · sheet “${file.staff.sheet}”` : ''} · headings on row {file.headerRow + 1}
                {file.ignored.length ? ` · ignored: ${file.ignored.join(', ')}` : ''}
              </p>
            </div>
            {phase === 'check' ? <Button variant="ghost" size="sm" onClick={() => { setFile(null); setFixes({}); }}><RotateCcw className="h-4 w-4" /> Choose another file</Button> : null}
          </section>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Tile n={check.counts.add} label="New" tone="ok" />
            <Tile n={check.counts.update} label="Will update" tone="info" />
            <Tile n={check.counts.unchanged} label="Unchanged" tone="dim" />
            <Tile n={check.counts.merged} label="Copies merged" tone="dim" />
            <Tile n={check.counts.attention} label="Need attention" tone={check.counts.attention ? 'warn' : 'dim'} />
            <Tile n={check.counts.skipped} label="Skipped" tone="dim" />
          </dl>

          {check.rows.some((r) => r.outcome === 'attention' || r.outcome === 'skipped') ? (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Rows that need attention</h2>
              <p className="text-sm text-muted-foreground">Fix them here, or skip them. They never hold up the rest.</p>
              <div className="overflow-x-auto rounded-xl border border-border bg-bg-card">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Row</th><th className="px-3 py-2">{k.noun[0]!.toUpperCase() + k.noun.slice(1)}</th><th className="px-3 py-2">Problem</th><th className="px-3 py-2">Fix</th>
                  </tr></thead>
                  <tbody>
                    {check.rows.filter((r) => r.outcome === 'attention' || r.outcome === 'skipped').slice(0, 500).map((r) => (
                      <AttentionRow key={r.line} row={r} onFix={(c) => fix(r.line, c)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {check.counts.update ? (
            <Details title={`${check.counts.update} will be updated`}>
              {check.rows.filter((r) => r.outcome === 'update').slice(0, LIST_LIMIT).map((r) => (
                <li key={r.line} className="px-3 py-2">
                  <span className="font-medium">{r.label}</span> <span className="text-xs text-muted-foreground">· row {r.line}</span>
                  <ul className="mt-0.5 text-xs text-muted-foreground">
                    {r.changes.map((c) => <li key={c.label}>{c.label}: <s>{c.from}</s> → <span className="text-fg">{c.to}</span></li>)}
                    {r.notes.map((n) => <li key={n} className="text-severity-medium-ink">{n}</li>)}
                  </ul>
                </li>
              ))}
            </Details>
          ) : null}
          {check.counts.add ? (
            <Details title={`${check.counts.add} new`}>
              {check.rows.filter((r) => r.outcome === 'add').slice(0, LIST_LIMIT).map((r) => (
                <li key={r.line} className="px-3 py-1.5"><span className="font-medium">{r.label}</span>
                  <span className="text-xs text-muted-foreground"> · {r.item.silo ? DEPARTMENT_NAMES[r.item.silo] : ''}</span></li>
              ))}
            </Details>
          ) : null}

          {phase === 'check' ? (
            <section className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
              <div>
                <Label htmlFor="asset-reason">Reason (kept on the permanent record)</Label>
                <Input id="asset-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={k.reasonHint} className="mt-1.5" />
              </div>
              <p className="text-sm text-muted-foreground">
                {check.counts.attention ? `${check.counts.attention} ${check.counts.attention === 1 ? 'row needs' : 'rows need'} attention and will not be imported unless fixed. ` : ''}
                Details are updated; {k.untouched}.
              </p>
              <Button onClick={runImport} disabled={reason.trim().length < 10 || check.toImport.length === 0}>
                {check.counts.add || check.counts.update ? `Add ${check.counts.add} and update ${check.counts.update}` : `Confirm ${check.counts.unchanged} unchanged`}
              </Button>
            </section>
          ) : null}
          {phase === 'importing' ? <p className="text-sm text-muted-foreground" aria-live="polite">Importing…</p> : null}
          {phase === 'failed' && importError ? (
            <section role="alert" className="space-y-2 rounded-xl border border-severity-critical/40 bg-severity-critical/10 p-4 text-sm text-severity-critical-ink">
              <p>{importError} Nothing was imported.</p>
              <Button variant="outline" size="sm" onClick={() => setPhase('check')}>Back to the check</Button>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AttentionRow({ row, onFix }: { row: CheckedAsset<AnyItem>; onFix: (change: Partial<AssetFix> | null) => void }) {
  const can = new Set(row.issues.flatMap((i) => i.fixes));
  return (
    <tr className={cn('border-b border-border align-top last:border-0', row.outcome === 'skipped' && 'opacity-60')}>
      <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.line}</td>
      <td className="px-3 py-2 font-medium">{row.label}</td>
      <td className="px-3 py-2">{row.outcome === 'skipped' ? <span className="text-muted-foreground">Skipped</span> : <ul className="space-y-0.5">{row.issues.map((i) => <li key={i.code}>{i.message}</li>)}</ul>}</td>
      <td className="px-3 py-2">
        {row.outcome === 'skipped' ? <Button size="sm" variant="ghost" onClick={() => onFix(null)}>Undo skip</Button> : (
          <div className="flex flex-wrap items-center gap-1.5">
            {can.has('department') ? (
              <select aria-label={`Department for row ${row.line}`} defaultValue="" onChange={(e) => e.target.value && onFix({ silo: e.target.value as Silo })}
                className="h-8 rounded-md border border-border bg-bg-soft px-2 text-xs">
                <option value="" disabled>Choose department</option>
                {SILOS.map((s) => <option key={s} value={s}>{DEPARTMENT_NAMES[s]}</option>)}
              </select>
            ) : null}
            {can.has('firearm-type') ? (
              <select aria-label={`Type for row ${row.line}`} defaultValue="" onChange={(e) => e.target.value && onFix({ firearmType: e.target.value as FirearmType })}
                className="h-8 rounded-md border border-border bg-bg-soft px-2 text-xs">
                <option value="" disabled>Choose type</option>
                {FIREARM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : null}
            {can.has('drop-value') ? <Button size="sm" variant="outline" onClick={() => onFix({ dropValue: true })}>Import without it</Button> : null}
            {can.has('accept-match') ? <Button size="sm" variant="outline" onClick={() => onFix({ acceptMatch: true })}>Same one: update</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => onFix({ skip: true })}>Skip row</Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function Tile({ n, label, tone }: { n: number; label: string; tone: 'ok' | 'info' | 'warn' | 'dim' }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2">
      <dd className={cn('text-2xl font-bold tabular-nums', tone === 'ok' && 'text-success', tone === 'info' && 'text-primary',
        tone === 'warn' && 'text-severity-medium-ink', tone === 'dim' && 'text-muted-foreground')}>{n}</dd>
      <dt className="text-xs font-semibold">{label}</dt>
    </div>
  );
}

function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-border bg-bg-card text-sm">
      <summary className="cursor-pointer select-none px-4 py-3 font-semibold">{title}</summary>
      <ul className="divide-y divide-border border-t border-border">{children}</ul>
    </details>
  );
}
