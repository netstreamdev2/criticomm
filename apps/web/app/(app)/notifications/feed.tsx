'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight, Bell, CalendarClock, CheckCircle2, ClipboardCheck, Clock, Info, Mail, Megaphone, Plane, Radio, Repeat, Siren,
} from 'lucide-react';
import { markAlertRead, type AudienceGroup } from '@criticom/api';
import type { AlertKind } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useT } from '@/components/i18n';
import { cn, timeAgo } from '@/lib/utils';

export type FeedItem = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  kind: AlertKind;
  severity: string;
  createdAt: string;
  from: string | null;
  read: boolean;
  acknowledged: boolean;
  audience: string;
  group: AudienceGroup;
  accent: string;
};

const KIND_META: Record<AlertKind, { label: string; icon: typeof Info }> = {
  assignment: { label: 'Dispatch', icon: Radio },
  incident_new: { label: 'New call', icon: Siren },
  incident_update: { label: 'Update', icon: Info },
  broadcast: { label: 'Broadcast', icon: Megaphone },
  system: { label: 'System', icon: Bell },
  info: { label: 'Note', icon: Bell },
  mail: { label: 'Mail', icon: Mail },
  task: { label: 'Task', icon: ClipboardCheck },
  dispatch: { label: 'Dispatch', icon: Radio },
  accepted: { label: 'Accepted', icon: CheckCircle2 },
  resolved: { label: 'Resolved', icon: CheckCircle2 },
  responding: { label: 'Responding', icon: Radio },
  reassigned: { label: 'Reassigned', icon: Info },
  backup: { label: 'Backup', icon: Radio },
  sos: { label: 'SOS', icon: Siren },
  shift_published: { label: 'Roster', icon: CalendarClock },
  shift_changed: { label: 'Shift', icon: CalendarClock },
  shift_confirm: { label: 'Shift', icon: CalendarClock },
  shift_late: { label: 'Late', icon: Clock },
  shift_noshow: { label: 'Not started', icon: Clock },
  shift_team_late: { label: 'Late', icon: Clock },
  shift_team_noshow: { label: 'Not started', icon: Clock },
  shift_started_late: { label: 'Started', icon: CheckCircle2 },
  shift_outcome: { label: 'Shift', icon: Info },
  leave_request: { label: 'Leave', icon: Plane },
  leave_decision: { label: 'Leave', icon: Plane },
  swap: { label: 'Swap', icon: Repeat },
  swap_waiting: { label: 'Swap', icon: Repeat },
  report_filed: { label: 'Report filed', icon: CheckCircle2 },
  stood_down: { label: 'Not needed', icon: Info },
  stand_down: { label: 'Stand down', icon: Info },
  officer_closed: { label: 'Closed on scene', icon: CheckCircle2 },
};

/** The calls and crews: new calls, dispatches, crews en route, on scene, SOS… */
const CALL_KINDS = new Set<AlertKind>([
  'incident_new', 'incident_update', 'assignment', 'dispatch', 'accepted', 'responding', 'resolved', 'reassigned',
  'backup', 'sos', 'report_filed', 'stood_down', 'stand_down', 'officer_closed',
]);

type Tab = 'all' | 'unread' | 'calls' | AudienceGroup;
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'calls', label: 'Calls' },
  { key: 'mine', label: 'Just me' },
  { key: 'shared', label: 'Shared' },
  { key: 'department', label: 'My department' },
  { key: 'everyone', label: 'Everyone' },
];

const dayKey = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayName = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short' });
const clock = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' });

/** The inbox: white frosted bubbles, a chip on each saying whom it was for. */
export function NotificationFeed({ items }: { items: FeedItem[] }) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('all');
  const [readNow, setReadNow] = useState<Set<string>>(new Set());

  const isRead = (i: FeedItem) => i.read || readNow.has(i.id);
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: items.length, unread: 0, calls: 0, mine: 0, shared: 0, department: 0, everyone: 0 };
    for (const i of items) {
      c[i.group] += 1;
      if (!i.read) c.unread += 1;
      if (CALL_KINDS.has(i.kind)) c.calls += 1;
    }
    return c;
  }, [items]);

  const shown = items.filter((i) => (
    tab === 'all' ? true : tab === 'unread' ? !isRead(i) : tab === 'calls' ? CALL_KINDS.has(i.kind) : i.group === tab
  ));

  // Today, Yesterday, then the date.
  const today = dayKey.format(new Date());
  const yesterday = dayKey.format(new Date(Date.now() - 86_400_000));
  const days: Array<{ label: string; items: FeedItem[] }> = [];
  for (const i of shown) {
    const k = dayKey.format(new Date(i.createdAt));
    const label = k === today ? t('Today') : k === yesterday ? t('Yesterday') : dayName.format(new Date(i.createdAt));
    const last = days.at(-1);
    if (last && last.label === label) last.items.push(i);
    else days.push({ label, items: [i] });
  }

  const read = (id: string) => {
    setReadNow((cur) => new Set(cur).add(id));
    void markAlertRead(getBrowserSupabase(), id).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label={t('Show')}>
        {TABS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => setTab(x.key)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors',
              // The chosen one is a white pill; the rest stay frosted (the
              // frost sets its own background, so it is left off the chosen).
              tab === x.key ? 'chip-on shadow-sm' : 'frost-pill border-border/60 text-muted-foreground hover:text-fg',
            )}
          >
            {t(x.label)}
            {counts[x.key] > 0 ? (
              <span className={cn('rounded-full px-1.5 text-[10px]', x.key === 'unread' ? 'bg-accent text-accent-foreground' : tab === x.key ? 'opacity-70' : 'bg-fg/10')}>
                {counts[x.key]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="frost-white rounded-[22px] px-6 py-14 text-center">
          <Bell className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {tab === 'unread' ? t('All caught up.') : t('Nothing here yet.')}
          </p>
        </div>
      ) : (
        days.map((d) => (
          <section key={d.label} className="space-y-2">
            <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{d.label}</h2>
            <ul className="space-y-2">
              {d.items.map((i) => <Bubble key={i.id} item={i} read={isRead(i)} onRead={read} />)}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function Bubble({ item, read, onRead }: { item: FeedItem; read: boolean; onRead: (id: string) => void }) {
  const { t } = useT();
  const meta = KIND_META[item.kind] ?? KIND_META.info;
  const Icon = meta.icon;
  const recent = Date.now() - new Date(item.createdAt).getTime() < 86_400_000;

  const inner = (
    <div className="flex items-start gap-3.5">
      <span
        className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${item.accent}24`, color: item.accent }}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span
            className="rounded-full px-2 py-0.5 font-semibold"
            style={{ backgroundColor: `${item.accent}1f`, color: item.accent }}
          >
            {item.audience}
          </span>
          <span>{t(meta.label)}</span>
          <span aria-hidden>·</span>
          <span suppressHydrationWarning>{recent ? timeAgo(item.createdAt) : clock.format(new Date(item.createdAt))}</span>
          {!read ? <span className="ml-auto h-2 w-2 rounded-full bg-accent" aria-label={t('Unread')} /> : null}
        </div>
        <p className={cn('mt-1.5 break-words text-sm leading-snug', read ? 'font-medium' : 'font-semibold')}>{item.title}</p>
        {item.body ? <p className="mt-1 break-words text-[13px] leading-relaxed text-muted-foreground">{item.body}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {item.from ? <span>{t('From {name}', { name: item.from })}</span> : null}
          {item.severity !== 'Low' ? <span className="severity-pill" data-sev={item.severity}>{item.severity}</span> : null}
          {item.acknowledged ? <span className="text-severity-low-ink">{t('Acknowledged')}</span> : null}
          {item.link ? (
            <span className="ml-auto inline-flex items-center gap-0.5 font-semibold text-fg/80">
              {t('Open')} <ArrowUpRight className="h-3 w-3" />
            </span>
          ) : !read ? (
            <button
              type="button"
              onClick={() => onRead(item.id)}
              className="ml-auto rounded-full px-2 py-0.5 font-semibold text-fg/80 hover:bg-fg/10"
            >
              {t('Mark read')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <li className="frost-white relative overflow-hidden rounded-[20px] transition-transform duration-150 hover:-translate-y-px">
      {!read ? <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-accent" aria-hidden /> : null}
      {item.link ? (
        <Link href={item.link} onClick={() => { if (!read) onRead(item.id); }} className="block rounded-[20px] p-4">
          {inner}
        </Link>
      ) : (
        <div className="p-4">{inner}</div>
      )}
    </li>
  );
}
