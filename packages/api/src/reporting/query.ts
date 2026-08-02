import type { CriticomClient, Silo, UserRole } from '@criticom/db';
import {
  type DatasetDef,
  type FieldDef,
  type FieldType,
  canQueryDataset,
  getDataset,
  getField,
} from './registry.ts';

/**
 * The report query builder.
 *
 * Turns a saved report definition into a Supabase query. Two rules hold
 * throughout, and everything else here exists to enforce them:
 *
 *   1. Identifiers (table and column names) come only from the registry.
 *      A field key that is not in the dataset's field list is dropped, not
 *      passed through. So a crafted definition cannot name an arbitrary column.
 *   2. Values are never concatenated into a query string. They go through
 *      supabase-js as bound parameters.
 *
 * Silo scoping is applied server-side from the caller's own session, never
 * from the definition — a saved report cannot be edited to read another
 * department's data.
 */

export type FilterOperator =
  | 'eq' | 'neq' | 'contains' | 'startsWith' | 'endsWith'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'in' | 'isEmpty' | 'notEmpty'
  | 'isTrue' | 'isFalse'
  | 'lastDays';

export type ReportFilter = {
  field: string;
  op: FilterOperator;
  /** Single value, or the low bound for `between`. */
  value?: string | number | null;
  /** High bound for `between`. */
  value2?: string | number | null;
  /** For `in`. */
  values?: string[];
};

export type Aggregation = 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max';

export type ReportDefinition = {
  dataset: string;
  columns: string[];
  filters: ReportFilter[];
  /** Group rows by these fields; when set, `metrics` decide the output columns. */
  groupBy?: string[];
  metrics?: Array<{ field: string; agg: Aggregation; label?: string }>;
  sort?: { field: string; dir: 'asc' | 'desc' };
  limit?: number;
  /** Restrict to one department. Ignored unless the caller may see that silo. */
  silo?: Silo | null;
};

/** Operators each field type supports. The UI reads this to build its menus. */
export const OPERATORS_BY_TYPE: Record<FieldType, FilterOperator[]> = {
  text: ['contains', 'eq', 'neq', 'startsWith', 'endsWith', 'in', 'isEmpty', 'notEmpty'],
  enum: ['eq', 'neq', 'in', 'isEmpty', 'notEmpty'],
  uuid: ['eq', 'neq', 'in', 'isEmpty', 'notEmpty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'notEmpty'],
  date: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'lastDays', 'isEmpty', 'notEmpty'],
  timestamp: ['gte', 'lte', 'between', 'lastDays', 'isEmpty', 'notEmpty'],
  boolean: ['isTrue', 'isFalse', 'isEmpty'],
};

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: 'is', neq: 'is not', contains: 'contains',
  startsWith: 'starts with', endsWith: 'ends with',
  gt: 'greater than', gte: 'on or after', lt: 'less than', lte: 'on or before',
  between: 'between', in: 'is any of', isEmpty: 'is empty', notEmpty: 'is not empty',
  isTrue: 'is yes', isFalse: 'is no', lastDays: 'in the last (days)',
};

export type ReportResult = {
  columns: Array<{ key: string; label: string; type: FieldType | 'number' }>;
  rows: Array<Record<string, unknown>>;
  /** Rows actually returned. */
  count: number;
  /**
   * True when the row cap was reached, so the numbers below are computed over
   * a partial set. Surfaced in the UI — a report someone makes a decision on
   * must never quietly under-report.
   */
  truncated: boolean;
  limit: number;
  /** Grouped output carries the aggregate definitions used. */
  grouped: boolean;
};

/** Hard ceiling regardless of what a definition asks for. */
const MAX_ROWS = 5000;
const DEFAULT_ROWS = 1000;

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

/**
 * Keep only filters that name a real field and use an operator that field's
 * type supports, with the operands that operator needs. Anything else is
 * discarded rather than guessed at.
 */
export function sanitizeFilters(dataset: DatasetDef, filters: ReportFilter[] | undefined): ReportFilter[] {
  if (!Array.isArray(filters)) return [];
  const out: ReportFilter[] = [];
  for (const f of filters) {
    const field = getField(dataset, f?.field);
    if (!field) continue;
    if (!OPERATORS_BY_TYPE[field.type].includes(f.op)) continue;

    switch (f.op) {
      case 'isEmpty':
      case 'notEmpty':
      case 'isTrue':
      case 'isFalse':
        out.push({ field: field.key, op: f.op });
        break;
      case 'between':
        if (isBlank(f.value) || isBlank(f.value2)) continue;
        out.push({ field: field.key, op: f.op, value: f.value, value2: f.value2 });
        break;
      case 'in': {
        const vals = (f.values ?? []).filter((v) => !isBlank(v));
        if (!vals.length) continue;
        // Enum fields may only be filtered to values the enum actually has.
        if (field.options) {
          const allowed = vals.filter((v) => field.options!.includes(v));
          if (!allowed.length) continue;
          out.push({ field: field.key, op: 'in', values: allowed });
        } else {
          out.push({ field: field.key, op: 'in', values: vals });
        }
        break;
      }
      case 'lastDays': {
        const n = Number(f.value);
        if (!Number.isFinite(n) || n <= 0 || n > 3650) continue;
        out.push({ field: field.key, op: 'lastDays', value: n });
        break;
      }
      default:
        if (isBlank(f.value)) continue;
        if (field.options && !field.options.includes(String(f.value))) continue;
        out.push({ field: field.key, op: f.op, value: f.value });
    }
  }
  return out;
}

/** Escape the PostgREST `like` metacharacters so user text stays literal. */
function likeSafe(v: unknown): string {
  return String(v).replace(/[%_\\]/g, (m) => `\\${m}`);
}

type AnyQuery = {
  eq: (c: string, v: unknown) => AnyQuery;
  neq: (c: string, v: unknown) => AnyQuery;
  gt: (c: string, v: unknown) => AnyQuery;
  gte: (c: string, v: unknown) => AnyQuery;
  lt: (c: string, v: unknown) => AnyQuery;
  lte: (c: string, v: unknown) => AnyQuery;
  ilike: (c: string, v: string) => AnyQuery;
  in: (c: string, v: readonly unknown[]) => AnyQuery;
  is: (c: string, v: unknown) => AnyQuery;
  not: (c: string, op: string, v: unknown) => AnyQuery;
  order: (c: string, o: { ascending: boolean; nullsFirst?: boolean }) => AnyQuery;
  limit: (n: number) => AnyQuery;
};

function applyFilter(q: AnyQuery, f: ReportFilter): AnyQuery {
  const c = f.field; // registry-sourced, never user text
  switch (f.op) {
    case 'eq': return q.eq(c, f.value);
    case 'neq': return q.neq(c, f.value);
    case 'gt': return q.gt(c, f.value);
    case 'gte': return q.gte(c, f.value);
    case 'lt': return q.lt(c, f.value);
    case 'lte': return q.lte(c, f.value);
    case 'contains': return q.ilike(c, `%${likeSafe(f.value)}%`);
    case 'startsWith': return q.ilike(c, `${likeSafe(f.value)}%`);
    case 'endsWith': return q.ilike(c, `%${likeSafe(f.value)}`);
    case 'in': return q.in(c, f.values ?? []);
    case 'between': return q.gte(c, f.value).lte(c, f.value2);
    case 'isTrue': return q.is(c, true);
    case 'isFalse': return q.is(c, false);
    case 'isEmpty': return q.is(c, null);
    case 'notEmpty': return q.not(c, 'is', null);
    case 'lastDays': {
      const since = new Date(Date.now() - Number(f.value) * 86_400_000).toISOString();
      return q.gte(c, since);
    }
    default: return q;
  }
}

export class ReportError extends Error {}

/**
 * Run a report definition and return rows ready to render.
 *
 * `role` and `silo` come from the server session. `silo` is the caller's own
 * department; global roles pass `null` to mean "all departments".
 */
export async function runReport(
  supabase: CriticomClient,
  def: ReportDefinition,
  ctx: { role: UserRole; silo: Silo | null },
): Promise<ReportResult> {
  const dataset = getDataset(def.dataset);
  if (!dataset) throw new ReportError(`Unknown dataset: ${def.dataset}`);
  if (!canQueryDataset(dataset, ctx.role)) {
    throw new ReportError(`Your role may not report on ${dataset.label}.`);
  }

  const filters = sanitizeFilters(dataset, def.filters);

  // Columns: registry-validated, de-duplicated, falling back to the dataset's
  // own defaults if the definition asks for nothing usable.
  const wanted = (Array.isArray(def.columns) ? def.columns : [])
    .map((k) => getField(dataset, k))
    .filter((f): f is FieldDef => Boolean(f));
  const columns = wanted.length
    ? wanted.filter((f, i, a) => a.findIndex((x) => x.key === f.key) === i)
    : dataset.defaultColumns
        .map((k) => getField(dataset, k))
        .filter((f): f is FieldDef => Boolean(f));

  const groupBy = (def.groupBy ?? [])
    .map((k) => getField(dataset, k))
    .filter((f): f is FieldDef => Boolean(f?.groupable));

  const metrics = (def.metrics ?? []).filter((m) => {
    if (m.agg === 'count') return true;
    const f = getField(dataset, m.field);
    if (!f) return false;
    if (m.agg === 'countDistinct' || m.agg === 'min' || m.agg === 'max') return true;
    return Boolean(f.aggregatable);
  });

  const limit = Math.min(Math.max(1, def.limit ?? DEFAULT_ROWS), MAX_ROWS);

  // Fetch only what's needed: grouped reports need the grouping and metric
  // fields, flat reports need their columns.
  const selectKeys = groupBy.length
    ? [...new Set([...groupBy.map((f) => f.key), ...metrics.map((m) => m.field).filter((k) => getField(dataset, k))])]
    : columns.map((f) => f.key);
  if (!selectKeys.length) selectKeys.push(...dataset.defaultColumns);

  let q = supabase.from(dataset.table).select(selectKeys.join(',')) as unknown as AnyQuery;

  // Department scoping is applied from the session, not the definition.
  if (dataset.siloColumn) {
    if (ctx.silo) {
      q = q.eq(dataset.siloColumn, ctx.silo);
    } else if (def.silo) {
      q = q.eq(dataset.siloColumn, def.silo);
    }
  }

  for (const f of filters) q = applyFilter(q, f);

  const sortField = def.sort && getField(dataset, def.sort.field);
  if (!groupBy.length) {
    const s = sortField ?? getField(dataset, dataset.defaultSort.field);
    if (s) q = q.order(s.key, { ascending: (def.sort?.dir ?? dataset.defaultSort.dir) === 'asc', nullsFirst: false });
  }
  // Fetch one extra row so we can tell "exactly at the cap" from "truncated".
  q = q.limit(limit + 1);

  const { data, error } = await (q as unknown as PromiseLike<{ data: unknown; error: { message: string } | null }>);
  if (error) throw new ReportError(error.message);

  const all = (data ?? []) as Array<Record<string, unknown>>;
  const truncated = all.length > limit;
  const rows = truncated ? all.slice(0, limit) : all;

  if (!groupBy.length) {
    return {
      columns: columns.map((f) => ({ key: f.key, label: f.label, type: f.type })),
      rows,
      count: rows.length,
      truncated,
      limit,
      grouped: false,
    };
  }

  return {
    ...aggregate(rows, groupBy, metrics, dataset, def.sort),
    count: rows.length,
    truncated,
    limit,
    grouped: true,
  };
}

/**
 * Group and aggregate in memory.
 *
 * Deliberate trade-off: PostgREST cannot express GROUP BY, and the alternative
 * — a SECURITY DEFINER function assembling dynamic SQL — is exactly the
 * pattern that produced this system's worst vulnerability. Municipal volumes
 * fit comfortably in the row cap, and `truncated` tells the reader when they
 * do not, rather than quietly showing a wrong total.
 */
function aggregate(
  rows: Array<Record<string, unknown>>,
  groupBy: FieldDef[],
  metrics: Array<{ field: string; agg: Aggregation; label?: string }>,
  dataset: DatasetDef,
  sort?: { field: string; dir: 'asc' | 'desc' },
): Pick<ReportResult, 'columns' | 'rows'> {
  const buckets = new Map<string, { keys: Record<string, unknown>; rows: Array<Record<string, unknown>> }>();

  for (const r of rows) {
    const keyParts = groupBy.map((f) => (r[f.key] === null || r[f.key] === undefined ? '—' : String(r[f.key])));
    const k = keyParts.join(' ');
    let b = buckets.get(k);
    if (!b) {
      b = { keys: Object.fromEntries(groupBy.map((f, i) => [f.key, keyParts[i]])), rows: [] };
      buckets.set(k, b);
    }
    b.rows.push(r);
  }

  // A grouped report always yields at least a count, so the output is never
  // an empty set of columns when the author has only chosen a grouping.
  const effMetrics: Array<{ field: string; agg: Aggregation; label?: string }> =
    metrics.length ? metrics : [{ field: '*', agg: 'count', label: 'Count' }];
  const firstMetric = effMetrics[0]!;

  const metricKey = (m: { field: string; agg: Aggregation }) => `${m.agg}__${m.field}`;
  const metricLabel = (m: { field: string; agg: Aggregation; label?: string }) => {
    if (m.label) return m.label;
    if (m.agg === 'count') return 'Count';
    const f = getField(dataset, m.field);
    const name = f?.label ?? m.field;
    return {
      countDistinct: `Distinct ${name}`, sum: `Total ${name}`, avg: `Average ${name}`,
      min: `Min ${name}`, max: `Max ${name}`, count: 'Count',
    }[m.agg];
  };

  const out = [...buckets.values()].map((b) => {
    const row: Record<string, unknown> = { ...b.keys };
    for (const m of effMetrics) {
      const vals = b.rows.map((r) => r[m.field]).filter((v) => v !== null && v !== undefined);
      const nums = vals.map(Number).filter((n) => Number.isFinite(n));
      let v: unknown;
      switch (m.agg) {
        case 'count': v = b.rows.length; break;
        case 'countDistinct': v = new Set(vals.map(String)).size; break;
        case 'sum': v = nums.reduce((a, n) => a + n, 0); break;
        case 'avg': v = nums.length ? Math.round((nums.reduce((a, n) => a + n, 0) / nums.length) * 100) / 100 : null; break;
        case 'min': v = nums.length ? Math.min(...nums) : null; break;
        case 'max': v = nums.length ? Math.max(...nums) : null; break;
      }
      row[metricKey(m)] = v;
    }
    return row;
  });

  // Sort by a chosen metric if the definition names one, else by the first
  // metric descending — the useful default for a "top N by count" report.
  const sortMetric = sort && effMetrics.find((m) => metricKey(m) === sort.field);
  const primary = sortMetric ? metricKey(sortMetric) : metricKey(firstMetric);
  const dir = sort?.dir === 'asc' ? 1 : -1;
  const groupSort = sort && groupBy.find((f) => f.key === sort.field);
  out.sort((a, b) => {
    if (groupSort) {
      return String(a[groupSort.key]).localeCompare(String(b[groupSort.key])) * (sort!.dir === 'asc' ? 1 : -1);
    }
    return ((Number(b[primary]) || 0) - (Number(a[primary]) || 0)) * (dir === 1 ? -1 : 1);
  });

  return {
    columns: [
      ...groupBy.map((f) => ({ key: f.key, label: f.label, type: f.type })),
      ...effMetrics.map((m) => ({ key: metricKey(m), label: metricLabel(m), type: 'number' as const })),
    ],
    rows: out,
  };
}
