'use client';

import { useState, useTransition } from 'react';
import type { PublicHoliday, Rotation, ScheduleSettings, ShiftTemplate, TeamMember } from '@criticom/api';
import { useToast } from '@/components/toast';
import { setTeamAction } from '../actions';
import {
  removeHolidayAction, saveHolidayAction, saveRotationAction, saveSettingsAction, saveTemplateAction,
} from './actions';

const btn = 'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-60';
const input = 'h-9 rounded-md border border-border bg-bg-soft px-2 text-sm';
const label = 'text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground';
const card = 'space-y-3 rounded-lg border border-border bg-bg-card p-4';

type Result = { ok?: true; error?: string };

function useSave() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const save = (fn: (fd: FormData) => Promise<Result>, fd: FormData, ok: string, after?: () => void) =>
    start(async () => {
      const res = await fn(fd);
      if (res.error) toast.push({ title: 'Not saved', body: res.error, tone: 'critical' });
      else { toast.push({ title: ok, tone: 'success' }); after?.(); }
    });
  return { pending, save };
}

export function SetupClient({ silo, canAdmin, isHr, templates, rotations, settings, people, holidays }: {
  silo: string;
  canAdmin: boolean;
  isHr: boolean;
  templates: ShiftTemplate[];
  rotations: Rotation[];
  settings: ScheduleSettings;
  people: TeamMember[];
  holidays: PublicHoliday[];
}) {
  const codeOf = new Map(templates.map((t) => [t.id, t.code]));
  const teamNames = [...new Set(rotations.flatMap((r) => r.teams))];
  return (
    <div className="space-y-4">
      {!canAdmin ? (
        <p className="rounded-md border border-border bg-bg-soft p-3 text-sm text-muted-foreground">
          The department administrator sets shift types, rotations and the late minutes. You can put people in teams.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Settings silo={silo} settings={settings} disabled={!canAdmin} />
        <Templates silo={silo} templates={templates} disabled={!canAdmin} />
      </div>

      <Rotations silo={silo} rotations={rotations} codeOf={codeOf} codes={templates.filter((t) => t.active).map((t) => t.code)} disabled={!canAdmin} />

      <Teams silo={silo} people={people} teamNames={teamNames} />

      {isHr ? <Holidays holidays={holidays} /> : null}
    </div>
  );
}

function Settings({ silo, settings, disabled }: { silo: string; settings: ScheduleSettings; disabled: boolean }) {
  const { pending, save } = useSave();
  return (
    <form className={card} action={(fd) => { fd.set('silo', silo); save(saveSettingsAction, fd, 'Saved'); }}>
      <p className="font-semibold">Late and not started</p>
      <p className="text-xs text-muted-foreground">
        Someone not started this many minutes after their shift begins is told they are late, and so is whoever oversees them. After the second number, command is told as well.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="grace">Late after (minutes)</label>
          <input id="grace" name="grace" type="number" min={0} max={120} defaultValue={settings.grace} disabled={disabled} className={`${input} mt-1 w-full`} />
        </div>
        <div>
          <label className={label} htmlFor="noshow">Not started after (minutes)</label>
          <input id="noshow" name="noshow" type="number" min={15} max={480} defaultValue={settings.noshow} disabled={disabled} className={`${input} mt-1 w-full`} />
        </div>
      </div>
      {!disabled ? <button type="submit" disabled={pending} className={`${btn} bg-primary text-primary-foreground`}>Save</button> : null}
    </form>
  );
}

function Templates({ silo, templates, disabled }: { silo: string; templates: ShiftTemplate[]; disabled: boolean }) {
  const { pending, save } = useSave();
  const [editing, setEditing] = useState<ShiftTemplate | 'new' | null>(null);
  const t = editing && editing !== 'new' ? editing : null;
  return (
    <div className={card}>
      <p className="font-semibold">Shift types</p>
      <ul className="space-y-1.5 text-sm">
        {templates.map((x) => (
          <li key={x.id} className={`flex items-center justify-between gap-2 rounded-md border border-border p-2 ${x.active ? '' : 'opacity-60'}`}>
            <span className="flex items-center gap-2">
              <span className="rounded px-1.5 text-xs font-bold" style={{ background: `${x.colour}33`, color: x.colour }}>{x.code}</span>
              {x.name} · {x.start_time.slice(0, 5)} for {Math.round(x.minutes / 6) / 10} h{x.active ? '' : ' · not in use'}
            </span>
            {!disabled ? <button type="button" onClick={() => setEditing(x)} className="rounded px-2 py-1 text-xs hover:bg-muted">Change</button> : null}
          </li>
        ))}
      </ul>
      {!disabled && !editing ? <button type="button" onClick={() => setEditing('new')} className={`${btn} border border-border hover:bg-muted`}>Add a shift type</button> : null}
      {editing ? (
        <form key={t?.id ?? 'new'} className="grid gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-3"
          action={(fd) => { fd.set('silo', silo); if (t) fd.set('id', t.id); save(saveTemplateAction, fd, 'Saved', () => setEditing(null)); }}>
          <input name="name" required placeholder="Name, e.g. Day shift" defaultValue={t?.name} className={`${input} sm:col-span-2`} />
          <input name="code" required maxLength={4} placeholder="Code, e.g. D" defaultValue={t?.code} className={input} />
          <input name="start" required type="time" defaultValue={t?.start_time.slice(0, 5) ?? '06:00'} className={input} aria-label="Starts" />
          <input name="hours" required type="number" step="0.5" min={0.5} max={26} defaultValue={t ? t.minutes / 60 : 12} className={input} aria-label="Hours" />
          <input name="colour" type="color" defaultValue={t?.colour ?? '#3b82f6'} className={`${input} p-1`} aria-label="Colour" />
          {t ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <select name="active" defaultValue={t.active ? 'on' : 'off'} className={input}>
                <option value="on">In use</option>
                <option value="off">Not in use</option>
              </select>
            </label>
          ) : null}
          <div className="flex gap-2 sm:col-span-3">
            <button type="submit" disabled={pending} className={`${btn} bg-primary text-primary-foreground`}>Save</button>
            <button type="button" onClick={() => setEditing(null)} className={`${btn} border border-border`}>Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Rotations({ silo, rotations, codeOf, codes, disabled }: {
  silo: string; rotations: Rotation[]; codeOf: Map<string, string>; codes: string[]; disabled: boolean;
}) {
  const { pending, save } = useSave();
  const [editing, setEditing] = useState<Rotation | 'new' | null>(null);
  const r = editing && editing !== 'new' ? editing : null;
  const cycleText = (x: Rotation) => x.cycle.map((c) => (c ? codeOf.get(c) ?? '?' : '-')).join(' ');
  return (
    <div className={card}>
      <p className="font-semibold">Rotations</p>
      <p className="text-xs text-muted-foreground">
        The cycle every team works, a day at a time: shift codes ({codes.join(', ') || 'none yet'}) and a dash for a day off. Each team starts its cycle on a different day.
      </p>
      <ul className="space-y-1.5 text-sm">
        {rotations.map((x) => (
          <li key={x.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 ${x.active ? '' : 'opacity-60'}`}>
            <span>
              <span className="font-medium">{x.name}</span>
              <span className="ml-2 font-mono text-xs">{cycleText(x)}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                Teams {x.teams.map((t, i) => `${t} (+${x.offsets[i]})`).join(', ')} · from {x.anchor}{x.skip_public_holidays ? ' · off on public holidays' : ''}
              </span>
            </span>
            {!disabled ? <button type="button" onClick={() => setEditing(x)} className="rounded px-2 py-1 text-xs hover:bg-muted">Change</button> : null}
          </li>
        ))}
      </ul>
      {!disabled && !editing ? <button type="button" onClick={() => setEditing('new')} className={`${btn} border border-border hover:bg-muted`}>Add a rotation</button> : null}
      {editing ? (
        <form key={r?.id ?? 'new'} className="grid gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-2"
          action={(fd) => { fd.set('silo', silo); if (r) fd.set('id', r.id); save(saveRotationAction, fd, 'Saved', () => setEditing(null)); }}>
          <input name="name" required placeholder="Name, e.g. 224" defaultValue={r?.name} className={input} />
          <div>
            <input name="anchor" required type="date" defaultValue={r?.anchor ?? '2026-01-01'} className={`${input} w-full`} aria-label="Day the cycle starts" />
            <p className="text-[10px] text-muted-foreground">The day the first team is on day one of the cycle.</p>
          </div>
          <input name="cycle" required placeholder="D D N N - - - -" defaultValue={r ? cycleText(r) : ''} className={`${input} font-mono sm:col-span-2`} aria-label="Cycle" />
          <input name="teams" required placeholder="Teams: A B C D" defaultValue={r?.teams.join(' ')} className={input} aria-label="Teams" />
          <input name="offsets" required placeholder="Starts: 0 2 4 6" defaultValue={r?.offsets.join(' ')} className={input} aria-label="Day each team starts on" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="holidays" defaultChecked={r?.skip_public_holidays ?? false} /> Off on public holidays
          </label>
          {r ? (
            <select name="active" defaultValue={r.active ? 'on' : 'off'} className={input}>
              <option value="on">In use</option>
              <option value="off">Not in use</option>
            </select>
          ) : <span />}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={pending} className={`${btn} bg-primary text-primary-foreground`}>Save</button>
            <button type="button" onClick={() => setEditing(null)} className={`${btn} border border-border`}>Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Teams({ silo, people, teamNames }: { silo: string; people: TeamMember[]; teamNames: string[] }) {
  const { pending, save } = useSave();
  const [q, setQ] = useState('');
  const shown = people.filter((p) => !q || `${p.name} ${p.badge ?? ''} ${p.team ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Teams</p>
        <input className={input} placeholder="Find someone…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">A rotation rosters everyone in its teams. Someone in no team is rostered by hand.</p>
      <datalist id="team-names">{teamNames.map((t) => <option key={t} value={t} />)}</datalist>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((p) => (
          <form key={p.userId} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm"
            action={(fd) => { fd.set('silo', silo); fd.set('userId', p.userId); save(setTeamAction, fd, `${p.name}: team saved`); }}>
            <span className="min-w-0 flex-1 truncate">{p.name}<span className="ml-1 text-xs text-muted-foreground">{p.rank ?? ''}</span></span>
            <input name="team" list="team-names" defaultValue={p.team ?? ''} maxLength={20} placeholder="No team" className={`${input} h-8 w-24`} aria-label={`Team for ${p.name}`} />
            <button type="submit" disabled={pending} className="rounded px-2 py-1 text-xs font-semibold hover:bg-muted">Save</button>
          </form>
        ))}
      </div>
    </div>
  );
}

function Holidays({ holidays }: { holidays: PublicHoliday[] }) {
  const { pending, save } = useSave();
  const [key, setKey] = useState(0);
  return (
    <div className={card}>
      <p className="font-semibold">Public holidays</p>
      <p className="text-xs text-muted-foreground">For the whole organisation. Office-hours rotations skip them, and they are not counted as leave days.</p>
      <form key={key} className="flex flex-wrap gap-2" action={(fd) => save(saveHolidayAction, fd, 'Saved', () => setKey((k) => k + 1))}>
        <input name="day" type="date" required className={input} aria-label="Day" />
        <input name="name" required placeholder="Name" className={input} />
        <button type="submit" disabled={pending} className={`${btn} bg-primary text-primary-foreground`}>Add</button>
      </form>
      <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {holidays.map((h) => (
          <li key={h.day} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span><span className="font-mono text-xs">{h.day}</span> {h.name}</span>
            <button type="button" disabled={pending}
              onClick={() => { if (window.confirm(`Remove ${h.name}?`)) { const fd = new FormData(); fd.set('day', h.day); save(removeHolidayAction, fd, 'Removed'); } }}
              className="rounded px-1.5 text-xs hover:bg-muted">Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
