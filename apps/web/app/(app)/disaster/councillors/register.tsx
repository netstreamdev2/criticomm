'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Pencil, Plus, Search } from 'lucide-react';
import { CallButton } from '@/components/disaster/call-button';
import { FieldProblem, problemBorder } from '@/components/disaster/field-problem';
import { useT } from '@/components/i18n';
import { councillorRows, type CouncillorRow } from '@/lib/councillors';
import { checkName, checkPhone, checkWard } from '@/lib/disaster-checks';
import { decodeText, parseCsv } from '@/lib/register/csv';
import { readXlsx } from '@/lib/register/xlsx';
import { cn } from '@/lib/utils';
import { importCouncillorsAction, saveCouncillorAction } from '../warnings/actions';

type Councillor = { id: string; ward: number | null; name: string; phone: string | null; email: string | null; active: boolean };

/** The councillors' list: search, add, change, take off, or load a spreadsheet. */
export function CouncillorRegister({ councillors }: { councillors: Councillor[] }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Councillor | 'new' | null>(null);
  const [showOff, setShowOff] = useState(false);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => councillors
    .filter((c) => showOff || c.active)
    .filter((c) => !needle || `${c.ward ?? 'pr'} ${c.name} ${c.phone ?? ''}`.toLowerCase().includes(needle)),
  [councillors, needle, showOff]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search: ward, name or number')}
            className="h-11 w-full rounded-md border border-border bg-bg-card pl-9 pr-3 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} className="h-5 w-5" />{t('Show those taken off')}</label>
        <div className="ml-auto flex flex-wrap gap-2">
          <ImportButton />
          <button type="button" onClick={() => setEditing('new')} className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            <Plus className="h-4 w-4" aria-hidden />{t('Add a councillor')}
          </button>
        </div>
      </div>

      {editing ? <CouncillorForm key={editing === 'new' ? 'new' : editing.id} councillor={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : null}

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-bg-card p-8 text-center text-muted-foreground">
          {councillors.length ? t('Nobody matches.') : t('No councillors yet. Load the City’s list from a spreadsheet, or add them one by one.')}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <li key={c.id} className={cn('flex items-center gap-3 rounded-xl border border-border bg-bg-card p-4 shadow-sm', !c.active && 'opacity-60')}>
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-accent/15 text-center text-xs font-bold text-accent">
                {c.ward != null ? <span>{t('Ward')}<br /><span className="text-base">{c.ward}</span></span> : t('PR')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="truncate text-sm text-muted-foreground">{c.phone ?? t('No cellphone')}{c.active ? '' : ` · ${t('Taken off the list')}`}</p>
              </div>
              {c.phone ? <CallButton number={c.phone} /> : null}
              <button type="button" onClick={() => setEditing(c)} aria-label={t('Change {name}', { name: c.name })}
                className="grid h-11 w-11 place-items-center rounded-md border border-border hover:bg-muted">
                <Pencil className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CouncillorForm({ councillor, onDone }: { councillor: Councillor | null; onDone: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({
    ward: councillor?.ward != null ? String(councillor.ward) : '', name: councillor?.name ?? '', phone: councillor?.phone ?? '',
    email: councillor?.email ?? '', active: councillor?.active ?? true,
  });
  const bad = { ward: checkWard(v.ward, 'eThekwini Metro'), name: checkName(v.name), phone: checkPhone(v.phone) };
  const save = () => start(async () => {
    setError(null);
    const res = await saveCouncillorAction(councillor?.id ?? null, { ward: v.ward, name: v.name, phone: v.phone, email: v.email, is_active: v.active });
    if ('error' in res) { setError(res.error); return; }
    router.refresh();
    onDone();
  });
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';
  return (
    <section className="space-y-4 rounded-xl border border-accent/40 bg-bg-card p-5 shadow-sm">
      <h2 className="font-semibold">{councillor ? t('Change {name}', { name: councillor.name }) : t('Add a councillor')}</h2>
      {error ? <p role="alert" className="text-sm font-medium text-severity-critical-ink">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm font-medium">{t('Ward (blank for PR)')}
          <input value={v.ward} onChange={(e) => setV({ ...v, ward: e.target.value })} inputMode="numeric" className={cn(field, problemBorder(bad.ward))} />
          <FieldProblem problem={bad.ward} />
        </label>
        <label className="block text-sm font-medium">{t('Name')}
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={160} className={cn(field, problemBorder(bad.name))} />
          <FieldProblem problem={bad.name} />
        </label>
        <label className="block text-sm font-medium">{t('Cellphone')}
          <input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} inputMode="tel" maxLength={30} className={cn(field, problemBorder(bad.phone))} />
          <FieldProblem problem={bad.phone} />
        </label>
        <label className="block text-sm font-medium">{t('Email (if known)')}
          <input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} inputMode="email" maxLength={200} className={field} />
        </label>
      </div>
      {councillor ? (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} className="h-5 w-5" />{t('On the list (gets the warning SMS)')}</label>
      ) : null}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={pending || !v.name.trim() || Boolean(bad.ward || bad.name || bad.phone)}
          className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? t('Saving…') : t('Save')}</button>
        <button type="button" onClick={onDone} className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
      </div>
    </section>
  );
}

/** Load the City's list from an Excel or CSV file: shown first, then added. */
function ImportButton() {
  const { t } = useT();
  const router = useRouter();
  const [rows, setRows] = useState<CouncillorRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const read = async (file: File) => {
    setNote(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      let table: string[][];
      if (/\.xlsx$/i.test(file.name)) {
        const sheets = (await readXlsx(bytes)).filter((s) => !s.hidden);
        table = sheets.length ? await sheets[0]!.read() : [];
      } else {
        table = parseCsv(decodeText(bytes));
      }
      const found = councillorRows(table);
      if (!found.rows.length) { setNote(t('No councillors found. The file needs a heading row with Ward, Councillor and Cell.')); return; }
      setRows(found.rows);
      if (found.missing.length) setNote(t('No {cols} column found; those stay blank.', { cols: found.missing.join(', ') }));
    } catch {
      setNote(t('That file could not be read. Save it as .xlsx or .csv and try again.'));
    }
  };
  const add = () => start(async () => {
    if (!rows) return;
    const res = await importCouncillorsAction(rows);
    if ('error' in res) { setNote(res.error); return; }
    setNote(t('{a} added, {c} changed, {s} skipped (check their ward or number).', { a: res.added, c: res.changed, s: res.skipped }));
    setRows(null);
    router.refresh();
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-bg-card px-4 text-sm font-semibold hover:bg-muted">
        <FileUp className="h-4 w-4" aria-hidden />{t('Load a spreadsheet')}
        <input type="file" accept=".xlsx,.csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
      </label>
      {rows ? (
        <button type="button" onClick={add} disabled={pending} className="h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-50">
          {pending ? t('Adding…') : t('Add {n} councillors', { n: rows.length })}
        </button>
      ) : null}
      {note ? <output className="block w-full text-sm text-muted-foreground">{note}</output> : null}
    </div>
  );
}
