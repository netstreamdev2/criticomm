'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet, Lock, RotateCcw } from 'lucide-react';
import {
  checkStaffList, DEPARTMENT_NAMES, staffRowsFromTable, STAFF_LIST_COLUMNS, type CheckedRow, type HeaderMap,
  type RawStaffRow, type RegisterEntry, type RowFix, type Silo,
} from '@criticom/db';
import { readStaffFile, type StaffFile } from '@/lib/register/file';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { finishImportAction, importRowsAction, registerSnapshotAction, startImportAction } from '../actions';

const BATCH = 500;
const LIST_LIMIT = 200;
const SILOS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini'];
const fieldName = (f: string) => STAFF_LIST_COLUMNS.find((c) => c.field === f)?.header ?? f;
const name = (r: CheckedRow) => `${r.person.first_name} ${r.person.last_name}`.trim() || '(no name)';

type Parsed = { file: File; staff: StaffFile; headerRow: number; header: HeaderMap; rows: RawStaffRow[] };
type Done = { added: number; updated: number; unchanged: number; skipped: number; not_listed: number };

/**
 * Importing HR's staff list. The file is read and checked here, in the
 * administrator's browser; nothing is sent until they confirm, and then only
 * the rows they confirmed. The database checks every row again.
 */
export function ImportWizard() {
  const [register, setRegister] = useState<RegisterEntry[] | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [fixes, setFixes] = useState<Record<number, RowFix>>({});
  const [reason, setReason] = useState('');
  const [phase, setPhase] = useState<'check' | 'importing' | 'done' | 'failed'>('check');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<Done | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    registerSnapshotAction().then((res) => (res.ok ? setRegister(res.register) : setRegisterError(res.error)));
  }, []);

  const check = useMemo(
    () => (parsed && register ? checkStaffList(parsed.rows, register, fixes) : null),
    [parsed, register, fixes],
  );

  const open = async (file: File) => {
    setFileError(null);
    setParsed(null);
    setFixes({});
    setReading(true);
    try {
      const staff = await readStaffFile(new Uint8Array(await file.arrayBuffer()), file.name);
      const rows = staffRowsFromTable(staff.table);
      if (!rows.ok) { setFileError(rows.error); return; }
      if (!rows.rows.length) { setFileError('The file has headings but no people in it.'); return; }
      setParsed({ file, staff, headerRow: rows.headerRow, header: rows.header, rows: rows.rows });
      setPhase('check');
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setReading(false);
    }
  };

  const fix = (line: number, change: Partial<RowFix> | null) =>
    setFixes((f) => ({ ...f, [line]: change === null ? {} : { ...f[line], ...change } }));

  const runImport = async () => {
    if (!check || !parsed) return;
    setPhase('importing');
    setImportError(null);
    const rows = check.toImport;
    setProgress({ done: 0, total: rows.length });
    const started = await startImportAction({
      fileName: parsed.file.name, fileSha256: parsed.staff.fingerprint, reason: reason.trim(),
      departments: check.departments, rowCount: parsed.rows.length, skipped: check.counts.attention + check.counts.skipped,
    });
    if (!started.ok) { setImportError(started.error); setPhase('failed'); return; }
    for (let i = 0; i < rows.length; i += BATCH) {
      const res = await importRowsAction(started.importId, rows.slice(i, i + BATCH));
      if (!res.ok) {
        setImportError(`${res.error}${i > 0 ? ` The first ${i} people are in; importing the same file again finishes the job without duplicating anyone.` : ' Nothing was imported.'}`);
        setPhase('failed');
        return;
      }
      setProgress({ done: Math.min(i + BATCH, rows.length), total: rows.length });
    }
    const finished = await finishImportAction(started.importId);
    if (!finished.ok) { setImportError(finished.error); setPhase('failed'); return; }
    setResult(finished);
    setPhase('done');
  };

  // ── Done ──
  if (phase === 'done' && result) {
    return (
      <div className="space-y-5 rounded-xl border border-success/40 bg-bg-card p-6">
        <div>
          <p className="text-lg font-semibold">Imported</p>
          <p className="text-sm text-muted-foreground">
            {result.added} added, {result.updated} updated, {result.unchanged} unchanged, {result.skipped} not imported.
            Nobody has any new access: invitations come next.
          </p>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li><Link href="/admin/personnel?status=to-confirm" className="font-semibold text-primary hover:underline">Confirm suggested roles</Link>, and set roles for people without one.</li>
          {result.not_listed ? (
            <li><Link href="/admin/personnel?status=not-listed" className="font-semibold text-primary hover:underline">Review {result.not_listed} {result.not_listed === 1 ? 'person' : 'people'} not in this list</Link>: they may have left.</li>
          ) : null}
          <li>Invite people who are ready, station by station, and follow progress on the <Link href="/admin/rollout" className="font-semibold text-primary hover:underline">rollout page</Link>.</li>
        </ol>
        <Button variant="outline" onClick={() => { setParsed(null); setResult(null); setReason(''); setFixes({}); setPhase('check'); registerSnapshotAction().then((r) => r.ok && setRegister(r.register)); }}>
          Import another file
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {registerError ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{registerError}</p>
      ) : null}

      {/* ── 1 · The file ── */}
      {!parsed ? (
        <section className="space-y-3">
          <label
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void open(f); }}
            className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40')}
          >
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" aria-hidden />
            <span className="font-semibold">{reading ? 'Reading…' : 'Choose HR’s staff list, or drop it here'}</span>
            <span className="text-sm text-muted-foreground">Excel (.xlsx) or CSV, up to 20 MB</span>
            <input ref={input} type="file" accept=".xlsx,.xlsm,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ''; }} />
          </label>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>The file is read on this computer. Nothing reaches HikTech until you confirm, and then only the rows you confirm. The file itself is never stored.</span>
          </p>
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <a href="/admin/personnel/template" className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
              <Download className="h-4 w-4" /> Download the template for HR
            </a>
            <Link href="/admin/handbook/staff-list-request" className="font-semibold text-primary hover:underline">
              The request to send with it
            </Link>
          </p>
          {fileError ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{fileError}</p> : null}
        </section>
      ) : null}

      {parsed && !register && !registerError ? <p className="text-sm text-muted-foreground">Loading the register to compare against…</p> : null}

      {/* ── 2 · The check ── */}
      {parsed && check ? (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-card px-4 py-3 text-sm">
            <div className="space-y-0.5">
              <p className="font-semibold">{parsed.file.name}</p>
              <p className="text-muted-foreground">
                {parsed.rows.length} {parsed.rows.length === 1 ? 'row' : 'rows'}
                {parsed.staff.sheet ? ` · sheet “${parsed.staff.sheet}”` : ''}
                {parsed.staff.sheets.length > 1 ? ` of ${parsed.staff.sheets.length}` : ''}
                {' · '}headings on row {parsed.headerRow + 1}
                {' · '}fingerprint <span className="font-mono">{parsed.staff.fingerprint.slice(0, 8)}…</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Read: {Object.keys(parsed.header.columns).map(fieldName).join(', ')}
                {parsed.header.fullNameOnly ? ' (names split at the last space)' : ''}
                {parsed.header.badgeFromForceNumber ? ' (force numbers used as badge numbers)' : ''}
                {parsed.header.ignored.length ? `. Ignored: ${parsed.header.ignored.join(', ')}` : ''}
              </p>
            </div>
            {phase === 'check' ? (
              <Button variant="ghost" size="sm" onClick={() => { setParsed(null); setFixes({}); }}><RotateCcw className="h-4 w-4" /> Choose another file</Button>
            ) : null}
          </section>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Tile n={check.counts.add} label="Ready to add" sub="new to the register" tone="ok" />
            <Tile n={check.counts.update} label="Will update" sub="matched by badge" tone="info" />
            <Tile n={check.counts.unchanged} label="Unchanged" sub="already up to date" tone="dim" />
            <Tile n={check.counts.merged} label="Copies merged" sub="same person twice" tone="dim" />
            <Tile n={check.counts.attention} label="Need attention" sub="fix or skip below" tone={check.counts.attention ? 'warn' : 'dim'} />
            <Tile n={check.counts.skipped} label="Skipped" sub="by you" tone="dim" />
            <Tile n={check.notListed.length} label="Not in this list" sub="shown for review" tone={check.notListed.length ? 'crit' : 'dim'} />
          </dl>
          {check.departments.length ? (
            <p className="text-sm text-muted-foreground">
              This list covers {check.departments.map((d) => DEPARTMENT_NAMES[d]).join(', ')}. People in those departments it leaves out are
              shown for review; nobody is removed.
            </p>
          ) : null}

          {check.rows.some((r) => r.outcome === 'attention' || r.outcome === 'skipped') ? (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Rows that need attention</h2>
              <p className="text-sm text-muted-foreground">Fix them here, or skip them. They never hold up the rest.</p>
              <div className="overflow-x-auto rounded-xl border border-border bg-bg-card">
                <table className="w-full min-w-[48rem] text-sm">
                  <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Row</th><th className="px-3 py-2">Person</th><th className="px-3 py-2">Problem</th><th className="px-3 py-2">Fix</th>
                  </tr></thead>
                  <tbody>
                    {check.rows.filter((r) => r.outcome === 'attention' || r.outcome === 'skipped').slice(0, 500).map((r) => (
                      <AttentionRow key={r.line} row={r} fix={fixes[r.line] ?? {}} onFix={(c) => fix(r.line, c)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {check.counts.update ? (
            <Collapsible title={`${check.counts.update} will be updated`}>
              <ul className="divide-y divide-border">
                {check.rows.filter((r) => r.outcome === 'update').slice(0, LIST_LIMIT).map((r) => (
                  <li key={r.line} className="px-3 py-2">
                    <span className="font-medium">{name(r)}</span> <span className="font-mono text-xs text-muted-foreground">{r.person.badge_number}</span>
                    <span className="text-xs text-muted-foreground"> · row {r.line}</span>
                    <ul className="mt-0.5 text-xs text-muted-foreground">
                      {r.changes.map((c) => <li key={c.field}>{c.label}: <s>{c.from}</s> → <span className="text-fg">{c.to}</span></li>)}
                      {r.notes.map((n) => <li key={n} className="text-severity-medium-ink">{n}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
              <More total={check.counts.update} />
            </Collapsible>
          ) : null}

          {check.counts.add ? (
            <Collapsible title={`${check.counts.add} new to the register`}>
              <ul className="divide-y divide-border">
                {check.rows.filter((r) => r.outcome === 'add').slice(0, LIST_LIMIT).map((r) => (
                  <li key={r.line} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                    <span className="font-medium">{name(r)}</span>
                    <span className="font-mono text-xs text-muted-foreground">{r.person.badge_number}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.person.rank} · {r.person.silo ? DEPARTMENT_NAMES[r.person.silo] : ''}{r.person.station ? ` · ${r.person.station}` : ''}
                      {r.suggestedRole ? ` · suggested ${r.suggestedRole}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <More total={check.counts.add} />
            </Collapsible>
          ) : null}

          {check.notListed.length ? (
            <Collapsible title={`${check.notListed.length} in the register but not in this list`}>
              <p className="px-3 pt-2 text-sm text-muted-foreground">This import changes nothing about them. They may have left: review them on the Personnel page afterwards.</p>
              <ul className="divide-y divide-border">
                {check.notListed.slice(0, LIST_LIMIT).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                    <span className="font-medium">{e.first_name} {e.last_name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{e.badge_number}</span>
                    <span className="text-xs text-muted-foreground">{DEPARTMENT_NAMES[e.silo]}{e.user_id ? ' · has an account' : ''}</span>
                  </li>
                ))}
              </ul>
              <More total={check.notListed.length} />
            </Collapsible>
          ) : null}

          {/* ── 3 · Confirm ── */}
          {phase === 'check' ? (
            <section className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
              <div>
                <Label htmlFor="import-reason">Reason (kept on the permanent record)</Label>
                <Input id="import-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
                  placeholder="e.g. Go-live preparation, HR staff list of 1 October 2026" className="mt-1.5" />
              </div>
              <p className="text-sm text-muted-foreground">
                {check.counts.attention ? `${check.counts.attention} ${check.counts.attention === 1 ? 'row needs' : 'rows need'} attention and will not be imported unless fixed. ` : ''}
                Importing gives nobody access. It is recorded with your name, the reason and the file’s fingerprint.
              </p>
              <Button onClick={runImport} disabled={reason.trim().length < 10 || check.toImport.length === 0 || !check.departments.length}>
                {check.counts.add || check.counts.update
                  ? `Add ${check.counts.add} and update ${check.counts.update}`
                  : `Confirm ${check.counts.unchanged} unchanged`}
              </Button>
            </section>
          ) : null}

          {phase === 'importing' ? (
            <section className="space-y-2 rounded-xl border border-border bg-bg-card p-4" aria-live="polite">
              <p className="text-sm">Importing… {progress.done} of {progress.total}</p>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
              </div>
            </section>
          ) : null}

          {phase === 'failed' && importError ? (
            <section role="alert" className="space-y-2 rounded-xl border border-severity-critical/40 bg-severity-critical/10 p-4 text-sm text-severity-critical-ink">
              <p>{importError}</p>
              <Button variant="outline" size="sm" onClick={() => setPhase('check')}>Back to the check</Button>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AttentionRow({ row, fix, onFix }: { row: CheckedRow; fix: RowFix; onFix: (change: Partial<RowFix> | null) => void }) {
  const [rank, setRank] = useState(fix.rank ?? '');
  const can = new Set(row.issues.flatMap((i) => i.fixes));
  return (
    <tr className={cn('border-b border-border align-top last:border-0', row.outcome === 'skipped' && 'opacity-60')}>
      <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.line}</td>
      <td className="px-3 py-2">
        <span className="font-medium">{name(row)}</span>
        <div className="font-mono text-xs text-muted-foreground">{row.person.badge_number || 'no badge'}</div>
      </td>
      <td className="px-3 py-2">
        {row.outcome === 'skipped' ? <span className="text-muted-foreground">Skipped</span> : (
          <ul className="space-y-0.5">{row.issues.map((i) => <li key={i.code}>{i.message}</li>)}</ul>
        )}
      </td>
      <td className="px-3 py-2">
        {row.outcome === 'skipped' ? (
          <Button size="sm" variant="ghost" onClick={() => onFix(null)}>Undo skip</Button>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {can.has('department') ? (
              <select aria-label={`Department for row ${row.line}`} defaultValue="" className="h-8 rounded-md border border-border bg-bg-soft px-2 text-xs"
                onChange={(e) => e.target.value && onFix({ silo: e.target.value as Silo })}>
                <option value="" disabled>Choose department</option>
                {SILOS.map((s) => <option key={s} value={s}>{DEPARTMENT_NAMES[s]}</option>)}
              </select>
            ) : null}
            {can.has('rank') ? (
              <Input value={rank} onChange={(e) => setRank(e.target.value)} onBlur={() => rank.trim() && onFix({ rank: rank.trim() })}
                onKeyDown={(e) => { if (e.key === 'Enter' && rank.trim()) onFix({ rank: rank.trim() }); }}
                placeholder="Rank" aria-label={`Rank for row ${row.line}`} className="h-8 w-28 text-xs" />
            ) : null}
            {can.has('drop-email') ? <Button size="sm" variant="outline" onClick={() => onFix({ dropEmail: true })}>Import without email</Button> : null}
            {can.has('drop-phone') ? <Button size="sm" variant="outline" onClick={() => onFix({ dropPhone: true })}>Import without number</Button> : null}
            {can.has('accept-match') ? <Button size="sm" variant="outline" onClick={() => onFix({ acceptMatch: true })}>Same person: update</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => onFix({ skip: true })}>Skip row</Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function Tile({ n, label, sub, tone }: { n: number; label: string; sub: string; tone: 'ok' | 'info' | 'warn' | 'crit' | 'dim' }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card px-3 py-2">
      <dd className={cn('text-2xl font-bold tabular-nums', tone === 'ok' && 'text-success', tone === 'info' && 'text-primary',
        tone === 'warn' && 'text-severity-medium-ink', tone === 'crit' && 'text-severity-critical-ink', tone === 'dim' && 'text-muted-foreground')}>{n}</dd>
      <dt className="text-xs font-semibold">{label}</dt>
      <dt className="text-[11px] text-muted-foreground">{sub}</dt>
    </div>
  );
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-border bg-bg-card text-sm">
      <summary className="cursor-pointer select-none px-4 py-3 font-semibold">{title}</summary>
      <div className="border-t border-border">{children}</div>
    </details>
  );
}

function More({ total }: { total: number }) {
  return total > LIST_LIMIT ? <p className="px-3 py-2 text-xs text-muted-foreground">and {total - LIST_LIMIT} more</p> : null;
}
