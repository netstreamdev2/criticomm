import Link from 'next/link';
import { History, PhoneCall, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { readable } from '@/lib/readable';
import { cn, formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Log History · HikTech' };

/**
 * Log history: every call this person logged, newest first, and where each
 * one is now, in plain words. Their own calls only (the query asks for the
 * calls they created; the page is the call takers' — CALL_LOGGER_PAGES).
 * Filters: words, where it is, severity, and the days it was logged.
 */

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const WAITING = ['New', 'Pending', 'Pending Dispatch', 'Pending Analysis'];
const SENT = ['Dispatched', 'En Route'];
const THERE = ['Arrived', 'On Scene', 'Transporting', 'Active'];

/** Where a call is now, as the call logger says it. */
const STAGES = [
  { id: 'all', label: 'All' },
  { id: 'unfinished', label: 'Not finished' },
  { id: 'waiting', label: 'Waiting for dispatch' },
  { id: 'sent', label: 'Sent to crews' },
  { id: 'there', label: 'Crew on scene' },
  { id: 'done', label: 'Done' },
] as const;
type Stage = (typeof STAGES)[number]['id'];

type Row = {
  id: string; incident_number: string; incident_type: string; incident_severity: string; location_address: string | null;
  status: string; intake_complete: boolean; incident_created_at: string; call_timestamp: string | null;
};

function stageOf(r: Row): Exclude<Stage, 'all'> {
  if (!r.intake_complete && r.status !== 'Resolved' && r.status !== 'Closed') return 'unfinished';
  if (WAITING.includes(r.status)) return 'waiting';
  if (SENT.includes(r.status)) return 'sent';
  if (THERE.includes(r.status)) return 'there';
  return 'done';
}

const STAGE_LOOK: Record<Exclude<Stage, 'all'>, string> = {
  unfinished: 'bg-severity-high/15 text-severity-high-ink',
  waiting: 'bg-severity-medium/15 text-severity-medium-ink',
  sent: 'bg-accent/15 text-accent',
  there: 'bg-accent/15 text-accent',
  done: 'bg-severity-low/15 text-severity-low-ink',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function LogHistoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { t } = await requestT();
  const { supabase, userId } = await getSession();
  const params = await searchParams;
  const q = one(params.q).trim().slice(0, 80);
  const stage = (STAGES.some((s) => s.id === one(params.stage)) ? one(params.stage) : 'all') as Stage;
  const severity = ['Critical', 'High', 'Medium', 'Low'].includes(one(params.severity)) ? one(params.severity) : '';
  const from = DAY.test(one(params.from)) ? one(params.from) : '';
  const to = DAY.test(one(params.to)) ? one(params.to) : '';

  // Only the calls this person logged.
  let query = supabase
    .from('incidents')
    .select('id, incident_number, incident_type, incident_severity, location_address, status, intake_complete, incident_created_at, call_timestamp')
    .eq('created_by', userId)
    .order('incident_created_at', { ascending: false })
    .limit(300);
  if (severity) query = query.eq('incident_severity', severity as never);
  // The days in South African time.
  if (from) query = query.gte('incident_created_at', `${from}T00:00:00+02:00`);
  if (to) query = query.lte('incident_created_at', `${to}T23:59:59+02:00`);
  if (q) {
    const safe = q.replace(/[%,()*\\]/g, ' ').trim();
    if (safe) query = query.or(`incident_number.ilike.%${safe}%,incident_type.ilike.%${safe}%,location_address.ilike.%${safe}%`);
  }
  const { data } = await query;
  const all = (data ?? []) as Row[];
  const counts = Object.fromEntries(STAGES.map((s) => [s.id, s.id === 'all' ? all.length : all.filter((r) => stageOf(r) === s.id).length]));
  const rows = stage === 'all' ? all : all.filter((r) => stageOf(r) === stage);
  const now = Date.now();

  const link = (next: Partial<Record<'q' | 'stage' | 'severity' | 'from' | 'to', string>>) => {
    const p = new URLSearchParams();
    const merged = { q, stage, severity, from, to, ...next };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === 'stage' && v === 'all')) p.set(k, v);
    const s = p.toString();
    return s ? `/dispatch/log-history?${s}` : '/dispatch/log-history';
  };
  const field = 'h-10 rounded-lg border border-border bg-bg-soft px-3 text-sm';

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 text-2xl font-bold">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white"><History className="h-6 w-6" aria-hidden /></span>
          {t('Log History')}
        </h1>
        <Link href="/dispatch/log-call" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-white">
          <PhoneCall className="h-4 w-4" /> {t('Log Incoming Call')}
        </Link>
      </header>

      {/* Where my calls are: one tap each. */}
      <nav aria-label={t('Where the call is')} className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <Link
            key={s.id} href={link({ stage: s.id })} aria-current={stage === s.id ? 'page' : undefined}
            className={cn('inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold',
              stage === s.id ? 'border-primary bg-primary/15 text-fg' : 'border-border text-muted-foreground hover:text-fg')}
          >
            {t(s.label)} <span className="tabular-nums opacity-70">{counts[s.id]}</span>
          </Link>
        ))}
      </nav>

      <form className="flex flex-wrap items-end gap-2" action="/dispatch/log-history">
        {stage !== 'all' ? <input type="hidden" name="stage" value={stage} /> : null}
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">{t('Search')}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input name="q" defaultValue={q} placeholder={t('Call number, place or type')} className={cn(field, 'w-full pl-9')} />
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {t('Severity')}
          <select name="severity" defaultValue={severity} className={cn(field, 'mt-1 block')}>
            <option value="">{t('All')}</option>
            {['Critical', 'High', 'Medium', 'Low'].map((s) => <option key={s} value={s}>{t(s)}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {t('From')}
          <input type="date" name="from" defaultValue={from} className={cn(field, 'mt-1 block')} />
        </label>
        <label className="text-xs font-semibold text-muted-foreground">
          {t('To')}
          <input type="date" name="to" defaultValue={to} className={cn(field, 'mt-1 block')} />
        </label>
        <button type="submit" className="h-10 rounded-lg bg-primary px-5 text-sm font-bold text-white">{t('Filter')}</button>
        {q || severity || from || to ? (
          <Link href={link({ q: '', severity: '', from: '', to: '' })} className="h-10 px-2 text-sm font-semibold leading-10 text-muted-foreground underline">{t('Clear')}</Link>
        ) : null}
      </form>

      <Card>
        <CardContent className="p-0">
          <SimpleTable headers={['Logged', 'Call', 'What', 'Where', 'Severity', 'Now']} empty={t('No calls here.')}>
            {rows.map((r) => {
              const st = stageOf(r);
              const waited = st === 'waiting' ? readable((now - Date.parse(r.call_timestamp ?? r.incident_created_at)) / 60_000) : null;
              return (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatSaTime(r.incident_created_at)}</Td>
                  <Td className="whitespace-nowrap font-mono font-semibold">{r.incident_number}</Td>
                  <Td>{r.incident_type}</Td>
                  <Td className="max-w-xs truncate">{r.location_address ?? '—'}</Td>
                  <Td><span className="severity-pill" data-sev={r.incident_severity}>{r.incident_severity}</span></Td>
                  <Td className="whitespace-nowrap">
                    {st === 'unfinished' ? (
                      <Link href={`/dispatch/log-call?resume=${r.id}`} className={cn('rounded-full px-2.5 py-1 text-xs font-bold underline', STAGE_LOOK[st])}>
                        {t('Not finished — finish it')}
                      </Link>
                    ) : (
                      <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold', STAGE_LOOK[st])}>
                        {t(STAGES.find((s) => s.id === st)!.label)}{waited ? ` · ${waited}` : ''}
                      </span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
      {all.length === 300 ? <p className="text-xs text-muted-foreground">{t('Showing the latest 300. Use the dates to look further back.')}</p> : null}
    </div>
  );
}
