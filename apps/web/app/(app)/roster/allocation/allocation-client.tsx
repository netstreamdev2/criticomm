'use client';

import { useState, useTransition } from 'react';
import {
  AlertTriangle, CalendarDays, Check, CircleSlash, Copy, Plus, Send, UserPlus, Users, X,
} from 'lucide-react';
import { shiftState, stateWords, needsAttention, type DutyBoard, type PersonRow, type PostCoverage, type ScheduleSettings } from '@criticom/api';
import { useToast } from '@/components/toast';
import {
  assignAction, copyForwardAction, publishDayAction, savePostAction, unassignAction,
} from './actions';

const btn = 'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold';
const input = 'h-9 rounded-md border border-border bg-bg-soft px-2 text-sm';
const label = 'text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground';

/** Colour language: red is unmanned, amber short, green manned. */
const STATE_STYLE: Record<PostCoverage['state'], { dot: string; ring: string; text: string }> = {
  unmanned: { dot: 'bg-danger', ring: 'border-danger/50', text: 'text-danger' },
  short: { dot: 'bg-warning', ring: 'border-warning/50', text: 'text-warning' },
  manned: { dot: 'bg-success', ring: 'border-border', text: 'text-success' },
};

type TemplateOption = { id: string; name: string; start: string };

export function AllocationBoard({
  board, people, date, silo, canManage, prevDate, templates, settings, isToday,
}: {
  board: DutyBoard;
  people: PersonRow[];
  date: string;
  silo: string;
  canManage: boolean;
  prevDate: string;
  templates: TemplateOption[];
  settings: ScheduleSettings;
  isToday: boolean;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<'posts' | 'people'>('posts');
  const [assigning, setAssigning] = useState<PostCoverage | null>(null);
  const [pending, start] = useTransition();

  const s = board.summary;
  const coverPct = s.slotsRequired > 0 ? Math.round((s.slotsFilled / s.slotsRequired) * 100) : 100;

  const go = (fn: () => Promise<{ error?: string; ok?: boolean; skipped?: number } | void>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res && 'error' in res && res.error) toast.push({ title: 'Not done', body: res.error, tone: 'critical' });
      else if (res && 'skipped' in res && res.skipped) toast.push({ title: ok, body: `${res.skipped} not copied: already on, or unavailable that day.`, tone: 'warning' });
      else toast.push({ title: ok, tone: 'success' });
    });

  /** Started, late or not started, on today's board, for those who run it. */
  const attendance = (a: PostCoverage['allocations'][number]) => {
    if (!canManage || !isToday || !a.published || !a.start_at || !a.end_at) return null;
    const state = shiftState({ start_at: a.start_at, end_at: a.end_at, status: a.status, cancelled_at: a.cancelled_at }, a.attendance ?? null, settings);
    if (state === 'upcoming' || state === 'leave' || state === 'cancelled') return null;
    return (
      <span className={`font-semibold ${needsAttention(state) ? 'text-danger' : state === 'started_late' ? 'text-warning' : 'text-success'}`}>
        {stateWords(state, a.attendance ?? null)}
      </span>
    );
  };

  const setDate = (d: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set('date', d);
    window.location.href = u.toString();
  };

  return (
    <div className="space-y-4">
      {/* Day + coverage summary */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={label} htmlFor="d">Duty date</label>
            <input id="d" type="date" className={`${input} mt-1`} value={date}
              onChange={(e) => setDate(e.target.value)} />
          </div>
          <Stat label="Posts" value={`${s.postsTotal}`} />
          <Stat label="Unmanned" value={`${s.postsUnmanned}`} tone={s.postsUnmanned ? 'danger' : undefined} />
          <Stat label="Short-crewed" value={`${s.postsShort}`} tone={s.postsShort ? 'warning' : undefined} />
          <Stat label="Coverage" value={`${coverPct}%`} tone={coverPct < 100 ? 'warning' : 'success'} />
          {s.conflicts > 0 ? <Stat label="On leave" value={`${s.conflicts}`} tone="danger" /> : null}
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <form action={(fd) => go(() => copyForwardAction(fd), 'Copied forward as drafts')}>
              <input type="hidden" name="from" value={prevDate} />
              <input type="hidden" name="to" value={date} />
              <input type="hidden" name="silo" value={silo} />
              <button type="submit" disabled={pending}
                className={`${btn} border border-border hover:bg-muted disabled:opacity-60`}>
                <Copy className="h-4 w-4" /> Copy {prevDate.slice(5)} forward
              </button>
            </form>
            {s.drafts > 0 ? (
              <form action={(fd) => go(() => publishDayAction(fd), 'Duty board issued to staff')}>
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="silo" value={silo} />
                <button type="submit" disabled={pending} className={`${btn} bg-primary disabled:opacity-60`}>
                  <Send className="h-4 w-4" /> Publish {s.drafts} draft{s.drafts === 1 ? '' : 's'}
                </button>
              </form>
            ) : (
              <span className="text-xs text-muted-foreground">
                {s.unacknowledged > 0 ? `${s.unacknowledged} not yet acknowledged` : 'All allocations issued'}
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([['posts', 'By post', Users], ['people', 'By person', UserPlus]] as const).map(([k, lbl, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === k ? 'border-accent text-fg' : 'border-transparent text-muted-foreground hover:text-fg'}`}>
            <Icon className="h-4 w-4" /> {lbl}
          </button>
        ))}
      </div>

      {tab === 'posts' ? (
        <div className="space-y-2">
          {board.posts.length === 0 ? (
            <Empty>No posts defined for this department yet. Add one below to start the board.</Empty>
          ) : board.posts.map((c) => {
            const st = STATE_STYLE[c.state];
            return (
              <div key={c.post.id} className={`rounded-lg border bg-bg-card p-3 ${st.ring}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${st.dot}`} />
                    <div>
                      <p className="font-semibold">{c.post.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[c.post.station, c.post.sector, c.post.vehicle, c.post.call_sign]
                          .filter(Boolean).join(' · ') || 'No location set'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${st.text}`}>
                      {c.state === 'unmanned' ? 'UNMANNED'
                        : c.state === 'short' ? `SHORT ${c.assigned}/${c.required}`
                        : `${c.assigned}/${c.required}`}
                    </span>
                    {canManage ? (
                      <button type="button" onClick={() => setAssigning(c)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted">
                        <Plus className="h-3 w-3" /> Assign
                      </button>
                    ) : null}
                  </div>
                </div>

                {c.allocations.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                    {c.allocations.map((a) => (
                      <li key={a.id}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                          a.leaveConflict ? 'border-danger/50 bg-danger/10'
                            : a.published ? 'border-border bg-bg-soft' : 'border-accent/50 bg-accent/10'}`}>
                        <span className="font-semibold">{a.user_name}</span>
                        {a.badge_number ? <span className="text-muted-foreground">{a.badge_number}</span> : null}
                        {a.start_at && a.end_at ? (
                          <span className="text-muted-foreground">
                            {new Date(a.start_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })}
                          </span>
                        ) : null}
                        {a.leaveConflict ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-danger"
                            title={canManage ? `On ${a.leaveConflict.absence} from ${a.leaveConflict.from} to ${a.leaveConflict.to}` : 'On leave'}>
                            <AlertTriangle className="h-3 w-3" /> on leave
                          </span>
                        ) : !a.published ? (
                          <span className="text-accent">draft</span>
                        ) : attendance(a) ?? (a.acknowledged_at ? (
                          <Check className="h-3 w-3 text-success" />
                        ) : null)}
                        {canManage ? (
                          <form action={(fd) => go(() => unassignAction(fd), `${a.user_name} taken off ${c.post.name}`)} className="contents">
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="silo" value={silo} />
                            <button type="submit" aria-label={`Remove ${a.user_name}`}
                              className="ml-0.5 text-muted-foreground hover:text-danger">
                              <X className="h-3 w-3" />
                            </button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                    Nobody allocated.
                  </p>
                )}
              </div>
            );
          })}

          {board.adHoc.length > 0 ? (
            <div className="rounded-lg border border-border bg-bg-card p-3">
              <p className={label}>Ad-hoc duties (no standing post)</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {board.adHoc.map((a) => (
                  <li key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-soft px-2.5 py-1 text-xs">
                    <span className="font-semibold">{a.user_name}</span>
                    <span className="text-muted-foreground">{a.activity_type || 'General'}</span>
                    {a.leaveConflict ? <span className="font-semibold text-danger">on leave</span> : !a.published ? <span className="text-accent">draft</span> : attendance(a)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <PersonList people={people} />
      )}

      {canManage ? <PostEditor silo={silo} /> : null}

      {assigning ? (
        <AssignDialog
          post={assigning} people={people} date={date} silo={silo} templates={templates}
          onClose={() => setAssigning(null)}
          onDone={(msg) => { setAssigning(null); toast.push({ title: msg, tone: 'success' }); }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label: l, value, tone }: { label: string; value: string; tone?: 'danger' | 'warning' | 'success' }) {
  const c = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-fg';
  return (
    <div>
      <p className={label}>{l}</p>
      <p className={`text-xl font-bold leading-tight ${c}`}>{value}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/* ── By person ────────────────────────────────────────────────────── */

function PersonList({ people }: { people: PersonRow[] }) {
  const [onlyFree, setOnlyFree] = useState(false);
  const shown = onlyFree ? people.filter((p) => p.allocations.length === 0 && !p.onLeave) : people;
  const free = people.filter((p) => p.allocations.length === 0 && !p.onLeave).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {people.length} members · <span className="font-semibold text-fg">{free}</span> available to allocate
        </p>
        <label className="inline-flex items-center gap-2 text-xs">
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
          Show only unallocated
        </label>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-bg-card">
        <table className="w-full min-w-max text-sm">
          <thead className="border-b border-border bg-bg-soft/60">
            <tr>
              {['Member', 'Badge', 'Rank', 'Station', 'Duty today'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.userId} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-1.5 font-medium">{p.name}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{p.badge ?? '—'}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{p.rank ?? '—'}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{p.station ?? '—'}</td>
                <td className="px-3 py-1.5">
                  {p.onLeave ? (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <CircleSlash className="h-3.5 w-3.5" /> On {p.onLeave.absence}
                    </span>
                  ) : p.allocations.length === 0 ? (
                    <span className="text-muted-foreground">Unallocated</span>
                  ) : (
                    p.allocations.map((a) => (
                      <span key={a.id} className="mr-1.5 inline-flex items-center gap-1 rounded-full bg-bg-soft px-2 py-0.5 text-xs">
                        {a.activity_type || 'Duty'}{a.published ? '' : ' (draft)'}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Everyone is allocated.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Assign dialog ────────────────────────────────────────────────── */

function AssignDialog({
  post, people, date, silo, templates, onClose, onDone,
}: {
  post: PostCoverage; people: PersonRow[]; date: string; silo: string; templates: TemplateOption[];
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [q, setQ] = useState('');
  const [pending, start] = useTransition();
  // For someone with no shift that day: which shift they work on this post.
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');

  const already = new Set(post.allocations.map((a) => a.user_id));
  const candidates = people
    .filter((p) => !already.has(p.userId))
    .filter((p) => !q || `${p.name} ${p.badge ?? ''} ${p.rank ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    // Those rostered that day first, then those who would need a shift, then
    // anyone on leave — the order a duty officer wants when filling a post.
    .sort((a, b) => {
      const rank = (p: PersonRow) => (p.onLeave ? 2 : p.allocations.length ? 0 : 1);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });

  const assign = (p: PersonRow) => {
    const fd = new FormData();
    fd.set('date', date);
    fd.set('silo', silo);
    fd.set('postId', post.post.id);
    fd.set('userId', p.userId);
    if (!p.allocations.length) fd.set('templateId', templateId);
    start(async () => {
      const res = await assignAction(fd);
      if (res?.error) onDone(res.error);
      else onDone(`${p.name} allocated to ${post.post.name}`);
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="font-semibold">Assign to {post.post.name}</p>
            <p className="text-xs text-muted-foreground">
              {post.assigned}/{post.required} crewed · {date}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-3">
          {/* biome-ignore lint/a11y/noAutofocus: this input only exists inside
              the just-opened member picker, so focus is already the user's
              intent — they opened it to type a name. */}
          <input autoFocus className={`${input} w-full`} placeholder="Search name, badge or rank…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          {templates.length ? (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              Shift for anyone not on the roster that day
              <select className={`${input} h-8`} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.start})</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <ul className="max-h-[45vh] overflow-y-auto px-2 pb-3">
          {candidates.map((p) => (
            <li key={p.userId}>
              <button type="button" disabled={pending} onClick={() => assign(p)}
                className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-50">
                <span>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{[p.rank, p.badge].filter(Boolean).join(' · ')}</span>
                </span>
                {p.onLeave ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger">
                    <AlertTriangle className="h-3 w-3" /> on {p.onLeave.absence}
                  </span>
                ) : p.allocations.length ? (
                  <span className="text-xs text-success">on the roster</span>
                ) : (
                  <span className="text-xs text-muted-foreground">not rostered: adds a shift</span>
                )}
              </button>
            </li>
          ))}
          {candidates.length === 0 ? (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">Nobody matches.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

/* ── Establishment editor ─────────────────────────────────────────── */

function PostEditor({ silo }: { silo: string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
        <Plus className="h-4 w-4" /> Add a duty post
      </button>
    );
  }

  return (
    <form
      action={(fd) => start(async () => {
        const res = await savePostAction(fd);
        if (res?.error) toast.push({ title: 'Not saved', body: res.error, tone: 'critical' });
        else { toast.push({ title: 'Post added', tone: 'success' }); setOpen(false); }
      })}
      className="grid gap-2 rounded-lg border border-border bg-bg-card p-3 sm:grid-cols-3 lg:grid-cols-4"
    >
      <input type="hidden" name="silo" value={silo} />
      <div className="sm:col-span-2">
        <label className={label} htmlFor="pname">Post name</label>
        <input id="pname" name="name" required className={`${input} mt-1 w-full`} placeholder="e.g. Sector 1 Patrol Vehicle" />
      </div>
      <div><label className={label} htmlFor="pst">Station</label><input id="pst" name="station" className={`${input} mt-1 w-full`} /></div>
      <div><label className={label} htmlFor="psec">Sector</label><input id="psec" name="sector" className={`${input} mt-1 w-full`} /></div>
      <div><label className={label} htmlFor="pveh">Vehicle</label><input id="pveh" name="vehicle" className={`${input} mt-1 w-full`} /></div>
      <div><label className={label} htmlFor="pcs">Call sign</label><input id="pcs" name="callSign" className={`${input} mt-1 w-full`} /></div>
      <div><label className={label} htmlFor="pact">Duty type</label><input id="pact" name="activity" className={`${input} mt-1 w-full`} placeholder="Patrol" /></div>
      <div>
        <label className={label} htmlFor="pmin">Crew needed</label>
        <input id="pmin" name="minStaff" type="number" min={1} max={50} defaultValue={1} className={`${input} mt-1 w-full`} />
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" disabled={pending} className={`${btn} bg-primary disabled:opacity-60`}>Save post</button>
        <button type="button" onClick={() => setOpen(false)} className={`${btn} border border-border hover:bg-muted`}>Cancel</button>
      </div>
    </form>
  );
}
