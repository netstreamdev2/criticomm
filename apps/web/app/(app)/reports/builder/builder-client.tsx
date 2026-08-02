'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  BarChart3, ChevronDown, Download, Loader2, Plus, Save, Trash2, X,
} from 'lucide-react';
import {
  type Aggregation, type ChartSpec, type DatasetDef, type FieldDef,
  type FilterOperator, type ReportDefinition, type ReportResult,
  OPERATORS_BY_TYPE, OPERATOR_LABELS,
} from '@criticom/api/reporting';
import { CHART_COLORS, SeverityDonut, SimpleBarChart } from '@/components/charts';
import { useToast } from '@/components/toast';
import { exportCsvAction, runReportAction, saveReportAction } from './actions';

type SavedSummary = {
  id: string;
  name: string;
  description: string | null;
  dataset: string;
  visibility: string;
  created_by_name: string | null;
  mine: boolean;
};

const AGGS: Array<{ key: Aggregation; label: string }> = [
  { key: 'count', label: 'Count of rows' },
  { key: 'countDistinct', label: 'Distinct values' },
  { key: 'sum', label: 'Sum' },
  { key: 'avg', label: 'Average' },
  { key: 'min', label: 'Minimum' },
  { key: 'max', label: 'Maximum' },
];

const input = 'h-9 rounded-md border border-border bg-bg-soft px-2 text-sm';
const label = 'text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground';

/** Operators that need no value box, and the one that needs two. */
const NO_VALUE: FilterOperator[] = ['isEmpty', 'notEmpty', 'isTrue', 'isFalse'];

export function ReportBuilder({
  datasets,
  saved,
  initial,
  initialChart,
  initialMeta,
}: {
  datasets: DatasetDef[];
  saved: SavedSummary[];
  initial: ReportDefinition;
  initialChart: ChartSpec;
  initialMeta: { id?: string; name: string; description: string; visibility: string };
}) {
  const toast = useToast();
  const [spec, setSpec] = useState<ReportDefinition>(initial);
  const [chart, setChart] = useState<ChartSpec>(initialChart);
  const [meta, setMeta] = useState(initialMeta);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, startSaving] = useTransition();

  const dataset = useMemo(
    () => datasets.find((d) => d.key === spec.dataset) ?? datasets[0],
    [datasets, spec.dataset],
  );

  const fields = useMemo(
    () => (dataset?.fields ?? []).filter((f) => showAdvanced || !f.advanced),
    [dataset, showAdvanced],
  );

  /* ── Running ───────────────────────────────────────────────────── */

  // A monotonic token so a slow earlier run can never overwrite a newer one —
  // otherwise tweaking filters quickly leaves stale numbers on screen, which
  // on an operational report is worse than showing nothing.
  const runToken = useRef(0);

  const run = useCallback(async (s: ReportDefinition) => {
    const token = ++runToken.current;
    setRunning(true);
    const outcome = await runReportAction(JSON.stringify(s));
    if (token !== runToken.current) return;
    setRunning(false);
    if (outcome.ok) {
      setResult(outcome.result);
      setError(null);
    } else {
      setError(outcome.error);
    }
  }, []);

  // Debounced auto-run: the builder is only useful if you can see the effect
  // of a change immediately.
  useEffect(() => {
    const t = setTimeout(() => { void run(spec); }, 500);
    return () => clearTimeout(t);
  }, [spec, run]);

  /* ── Spec editing ──────────────────────────────────────────────── */

  const patch = (p: Partial<ReportDefinition>) => setSpec((s) => ({ ...s, ...p }));

  const changeDataset = (key: string) => {
    const d = datasets.find((x) => x.key === key);
    if (!d) return;
    // Columns and filters are field-specific, so a dataset change resets them
    // to that dataset's defaults rather than silently dropping everything.
    setSpec({
      dataset: d.key,
      columns: [...d.defaultColumns],
      filters: [],
      groupBy: [],
      metrics: [],
      sort: { ...d.defaultSort },
      limit: spec.limit,
    });
    setChart({ type: 'none' });
  };

  const toggleColumn = (key: string) =>
    patch({
      columns: spec.columns.includes(key)
        ? spec.columns.filter((c) => c !== key)
        : [...spec.columns, key],
    });

  const moveColumn = (key: string, dir: -1 | 1) => {
    const i = spec.columns.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= spec.columns.length) return;
    const next = [...spec.columns];
    [next[i], next[j]] = [next[j]!, next[i]!];
    patch({ columns: next });
  };

  const addFilter = () => {
    const f = fields[0];
    if (!f) return;
    patch({ filters: [...spec.filters, { field: f.key, op: OPERATORS_BY_TYPE[f.type][0]!, value: '' }] });
  };

  const updateFilter = (i: number, next: Partial<ReportDefinition['filters'][number]>) => {
    const filters = [...spec.filters];
    filters[i] = { ...filters[i]!, ...next };
    patch({ filters });
  };

  const removeFilter = (i: number) => patch({ filters: spec.filters.filter((_, x) => x !== i) });

  const toggleGroup = (key: string) => {
    const g = spec.groupBy ?? [];
    const next = g.includes(key) ? g.filter((k) => k !== key) : [...g, key];
    // Entering grouped mode with no metric yields a bare count, which is the
    // report people actually want ("how many per suburb").
    patch({ groupBy: next, metrics: next.length ? (spec.metrics?.length ? spec.metrics : []) : [] });
  };

  const grouped = (spec.groupBy ?? []).length > 0;

  /* ── Save / export ─────────────────────────────────────────────── */

  const onSave = (asNew: boolean) => {
    const fd = new FormData();
    if (!asNew && meta.id) fd.set('id', meta.id);
    fd.set('name', meta.name);
    fd.set('description', meta.description);
    fd.set('visibility', meta.visibility);
    fd.set('spec', JSON.stringify(spec));
    fd.set('chart', JSON.stringify(chart));
    startSaving(async () => {
      const res = await saveReportAction(fd);
      if (res?.error) toast.push({ title: 'Not saved', body: res.error, tone: 'critical' });
      else toast.push({ title: 'Report saved', body: meta.name, tone: 'success' });
    });
  };

  const onExport = async () => {
    const res = await exportCsvAction(JSON.stringify(spec));
    if (!res.ok) {
      toast.push({ title: 'Export failed', body: res.error, tone: 'critical' });
      return;
    }
    const blob = new Blob([`﻿${res.csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!dataset) {
    return <p className="text-muted-foreground">No datasets are available to your role.</p>;
  }

  const chartData = result && chart.type !== 'none' && chart.xField && chart.yField
    ? result.rows.slice(0, 25).map((r) => ({
        name: String(r[chart.xField!] ?? '—'),
        value: Number(r[chart.yField!]) || 0,
      }))
    : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-64 flex-1">
          <label className={label} htmlFor="rname">Report name</label>
          <input
            id="rname" className={`${input} mt-1 w-full text-base font-semibold`}
            value={meta.name} placeholder="Untitled report"
            onChange={(e) => setMeta({ ...meta, name: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={input} value={meta.visibility} aria-label="Sharing"
            onChange={(e) => setMeta({ ...meta, visibility: e.target.value })}
          >
            <option value="private">Only me</option>
            <option value="department">My department</option>
            <option value="global">Everyone</option>
          </select>
          <button type="button" onClick={() => onSave(false)} disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {meta.id ? 'Save' : 'Save report'}
          </button>
          {meta.id ? (
            <button type="button" onClick={() => onSave(true)} disabled={saving}
              className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">
              Save as new
            </button>
          ) : null}
          <button type="button" onClick={onExport}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        {/* ── Left: dataset + fields ── */}
        <aside className="space-y-3">
          <div className="rounded-lg border border-border bg-bg-card p-3">
            <label className={label} htmlFor="dataset">Data source</label>
            <select
              id="dataset" className={`${input} mt-1 w-full`} value={dataset.key}
              onChange={(e) => changeDataset(e.target.value)}
            >
              {datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{dataset.description}</p>
          </div>

          <div className="rounded-lg border border-border bg-bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className={label}>Fields</span>
              <button
                type="button" onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs text-accent hover:underline"
              >
                {showAdvanced ? 'Fewer' : 'All fields'}
              </button>
            </div>
            <ul className="max-h-[26rem] overflow-y-auto p-1">
              {fields.map((f) => {
                const on = spec.columns.includes(f.key);
                return (
                  <li key={f.key}>
                    <button
                      type="button" onClick={() => toggleColumn(f.key)}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted ${on ? 'font-semibold text-fg' : 'text-muted-foreground'}`}
                    >
                      <span className="truncate">{f.label}</span>
                      <span className="ml-2 shrink-0 text-[0.6rem] uppercase opacity-60">{on ? '✓' : f.type}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* ── Right: builder + results ── */}
        <div className="space-y-4">
          {/* Filters */}
          <section className="rounded-lg border border-border bg-bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className={label}>Filters</span>
              <button type="button" onClick={addFilter}
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                <Plus className="h-3 w-3" /> Add filter
              </button>
            </div>
            {spec.filters.length === 0 ? (
              <p className="text-xs text-muted-foreground">No filters — every row in {dataset.label.toLowerCase()}.</p>
            ) : (
              <div className="space-y-2">
                {spec.filters.map((f, i) => {
                  const fd = dataset.fields.find((x) => x.key === f.field);
                  const ops = fd ? OPERATORS_BY_TYPE[fd.type] : [];
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <select
                        className={`${input} min-w-40`} value={f.field} aria-label="Field"
                        onChange={(e) => {
                          const nf = dataset.fields.find((x) => x.key === e.target.value)!;
                          updateFilter(i, { field: nf.key, op: OPERATORS_BY_TYPE[nf.type][0]!, value: '', values: [] });
                        }}
                      >
                        {dataset.fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                      <select
                        className={`${input} min-w-36`} value={f.op} aria-label="Condition"
                        onChange={(e) => updateFilter(i, { op: e.target.value as FilterOperator })}
                      >
                        {ops.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
                      </select>
                      <FilterValue field={fd} filter={f} onChange={(v) => updateFilter(i, v)} />
                      <button type="button" onClick={() => removeFilter(i)}
                        aria-label="Remove filter" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-danger">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Group & summarise */}
          <section className="rounded-lg border border-border bg-bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className={label}>Group &amp; summarise</span>
              <span className="text-xs text-muted-foreground">
                {grouped ? 'Showing one row per group' : 'Off — showing individual records'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {dataset.fields.filter((f) => f.groupable).map((f) => {
                const on = (spec.groupBy ?? []).includes(f.key);
                return (
                  <button
                    key={f.key} type="button" onClick={() => toggleGroup(f.key)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-accent bg-accent/15 font-semibold text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            {grouped ? (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <span className={label}>Measures</span>
                  <button
                    type="button"
                    onClick={() => patch({ metrics: [...(spec.metrics ?? []), { field: '*', agg: 'count' }] })}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Add measure
                  </button>
                </div>
                {(spec.metrics ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Counting rows in each group.</p>
                ) : (
                  (spec.metrics ?? []).map((m, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <select
                        className={`${input} min-w-40`} value={m.agg} aria-label="Measure"
                        onChange={(e) => {
                          const metrics = [...(spec.metrics ?? [])];
                          metrics[i] = { ...m, agg: e.target.value as Aggregation };
                          patch({ metrics });
                        }}
                      >
                        {AGGS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                      </select>
                      {m.agg !== 'count' ? (
                        <select
                          className={`${input} min-w-40`} value={m.field} aria-label="Measure field"
                          onChange={(e) => {
                            const metrics = [...(spec.metrics ?? [])];
                            metrics[i] = { ...m, field: e.target.value };
                            patch({ metrics });
                          }}
                        >
                          {dataset.fields
                            .filter((f) => (m.agg === 'countDistinct' ? true : f.aggregatable))
                            .map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                      ) : null}
                      <button type="button" aria-label="Remove measure"
                        onClick={() => patch({ metrics: (spec.metrics ?? []).filter((_, x) => x !== i) })}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-danger">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </section>

          {/* Chart + limit */}
          <section className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-bg-card p-3">
            <div>
              <label className={label} htmlFor="charttype">Chart</label>
              <select
                id="charttype" className={`${input} mt-1`} value={chart.type}
                onChange={(e) => {
                  const type = e.target.value as ChartSpec['type'];
                  const x = result?.columns[0]?.key;
                  const y = result?.columns.find((c) => c.type === 'number')?.key;
                  setChart({ type, xField: chart.xField ?? x, yField: chart.yField ?? y });
                }}
              >
                <option value="none">None</option>
                <option value="bar">Bar</option>
                <option value="donut">Donut</option>
              </select>
            </div>
            {chart.type !== 'none' && result ? (
              <>
                <div>
                  <label className={label} htmlFor="cx">Category</label>
                  <select id="cx" className={`${input} mt-1`} value={chart.xField ?? ''}
                    onChange={(e) => setChart({ ...chart, xField: e.target.value })}>
                    {result.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="cy">Value</label>
                  <select id="cy" className={`${input} mt-1`} value={chart.yField ?? ''}
                    onChange={(e) => setChart({ ...chart, yField: e.target.value })}>
                    {result.columns.filter((c) => c.type === 'number').map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
            <div>
              <label className={label} htmlFor="limit">Row limit</label>
              <select id="limit" className={`${input} mt-1`} value={spec.limit ?? 1000}
                onChange={(e) => patch({ limit: Number(e.target.value) })}>
                {[100, 500, 1000, 2500, 5000].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
              </select>
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              {running ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</> : result ? `${result.count.toLocaleString()} rows` : null}
            </div>
          </section>

          {/* Results */}
          {error ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
          ) : null}

          {result?.truncated ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              Showing the first {result.limit.toLocaleString()} rows — there are more. Totals below cover
              only what is shown, so narrow the filters or raise the row limit before relying on them.
            </div>
          ) : null}

          {chart.type !== 'none' && chartData.length > 0 ? (
            <div className="rounded-lg border border-border bg-bg-card p-3">
              {chart.type === 'donut'
                ? <SeverityDonut data={chartData} />
                : <SimpleBarChart data={chartData} xKey="name" yKey="value" color={CHART_COLORS[0]} />}
            </div>
          ) : null}

          <ResultTable result={result} running={running} />
        </div>
      </div>

      {saved.length > 0 ? (
        <section className="rounded-lg border border-border bg-bg-card p-3">
          <span className={label}>Saved reports</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {saved.map((s) => (
              <a key={s.id} href={`/reports/builder?id=${s.id}`}
                className="group inline-flex items-center gap-2 rounded-md border border-border bg-bg-soft px-3 py-1.5 text-xs hover:bg-muted">
                <BarChart3 className="h-3.5 w-3.5 text-accent" />
                <span className="font-semibold">{s.name}</span>
                <span className="text-muted-foreground">
                  {s.visibility === 'private' ? 'private' : s.visibility === 'department' ? 'department' : 'shared'}
                  {!s.mine && s.created_by_name ? ` · ${s.created_by_name}` : ''}
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ── Value editor, shaped by the field's type ─────────────────────── */

function FilterValue({
  field, filter, onChange,
}: {
  field: FieldDef | undefined;
  filter: ReportDefinition['filters'][number];
  onChange: (v: Partial<ReportDefinition['filters'][number]>) => void;
}) {
  if (!field || NO_VALUE.includes(filter.op)) return null;

  if (filter.op === 'between') {
    const t = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'datetime-local';
    return (
      <div className="flex items-center gap-1.5">
        <input type={t} className={`${input} w-40`} value={String(filter.value ?? '')}
          onChange={(e) => onChange({ value: e.target.value })} aria-label="From" />
        <span className="text-xs text-muted-foreground">and</span>
        <input type={t} className={`${input} w-40`} value={String(filter.value2 ?? '')}
          onChange={(e) => onChange({ value2: e.target.value })} aria-label="To" />
      </div>
    );
  }

  if (filter.op === 'in') {
    if (field.options) {
      const sel = filter.values ?? [];
      return (
        <div className="flex flex-wrap gap-1">
          {field.options.map((o) => {
            const on = sel.includes(o);
            return (
              <button key={o} type="button"
                onClick={() => onChange({ values: on ? sel.filter((x) => x !== o) : [...sel, o] })}
                className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <input className={`${input} w-56`} placeholder="value, value, value"
        value={(filter.values ?? []).join(', ')} aria-label="Values"
        onChange={(e) => onChange({ values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} />
    );
  }

  if (field.options) {
    return (
      <select className={`${input} min-w-40`} value={String(filter.value ?? '')} aria-label="Value"
        onChange={(e) => onChange({ value: e.target.value })}>
        <option value="">Choose…</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (filter.op === 'lastDays') {
    return (
      <input type="number" min={1} max={3650} className={`${input} w-24`} value={String(filter.value ?? '')}
        aria-label="Days" onChange={(e) => onChange({ value: e.target.value })} />
    );
  }

  const type = field.type === 'number' ? 'number'
    : field.type === 'date' ? 'date'
    : field.type === 'timestamp' ? 'datetime-local'
    : 'text';

  return (
    <input type={type} className={`${input} w-56`} value={String(filter.value ?? '')} aria-label="Value"
      onChange={(e) => onChange({ value: e.target.value })} />
  );
}

/* ── Results table ────────────────────────────────────────────────── */

function ResultTable({ result, running }: { result: ReportResult | null; running: boolean }) {
  if (!result) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-8 text-center text-sm text-muted-foreground">
        {running ? 'Running…' : 'Choose a data source to begin.'}
      </div>
    );
  }
  if (result.rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-8 text-center text-sm text-muted-foreground">
        No records match these filters.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-bg-card">
      <table className="w-full min-w-max text-sm">
        <thead className="border-b border-border bg-bg-soft/60">
          <tr>
            {result.columns.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
              {result.columns.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-3 py-1.5">{formatCell(r[c.key], c.type)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v: unknown, type: string) {
  if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">—</span>;
  if (type === 'boolean') return v ? 'Yes' : 'No';
  if (type === 'timestamp' || type === 'date') {
    const d = new Date(String(v));
    if (!Number.isNaN(d.getTime())) {
      return type === 'date'
        ? d.toLocaleDateString('en-ZA')
        : d.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false });
    }
  }
  if (type === 'number' && typeof v === 'number') return v.toLocaleString();
  const s = String(v);
  return s.length > 80 ? <span title={s}>{s.slice(0, 80)}…</span> : s;
}
