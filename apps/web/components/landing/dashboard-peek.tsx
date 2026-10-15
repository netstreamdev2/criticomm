/**
 * A look at the command dashboard and the responder app.
 *
 * Rebuilt in markup rather than screenshotted: it stays sharp at any size,
 * needs no image pipeline, and cannot go stale the way a PNG of a console
 * does. The data is invented and the panel says so — an emergency platform
 * is the last place to show made-up records without labelling them.
 */

const SHIFTS = [
  {
    name: 'Day shift', hours: '07:00–15:00', count: 84,
    members: [
      { name: 'Mthembu, T.R.', post: 'NR — North Region', state: 'Confirmed' },
      { name: 'Zungu, N.P.', post: 'W — Inner West', state: 'Confirmed' },
      { name: 'Govender, A.', post: 'DR — Central', state: 'On leave' },
    ],
  },
  {
    name: 'Afternoon', hours: '15:00–23:00', count: 72,
    members: [
      { name: 'Naidoo, P.', post: 'B — Beachfront', state: 'Confirmed' },
      { name: 'Pillay, R.K.', post: 'DR — Central', state: 'Absent' },
      { name: 'Sithole, B.M.', post: 'CH — Chatsworth', state: 'Pending' },
    ],
  },
] as const;

const STATE_TONE: Record<string, string> = {
  Confirmed: 'bg-[#22c55e]/15 text-[#4ade80]',
  'On leave': 'bg-[#f59e0b]/15 text-[#fbbf24]',
  Absent: 'bg-[#ef4444]/15 text-[#f87171]',
  Pending: 'bg-white/10 text-white/55',
};

const TASKS = [
  { title: 'Vehicle inspection — Unit 14', ref: 'DM-0041', due: 'Due 03 May', pct: 100 },
  { title: 'CCTV system check — Beachfront', ref: 'DM-0040', due: 'Due 04 May', pct: 45 },
  { title: 'Radio equipment calibration', ref: 'DM-0042', due: 'Due 05 May', pct: 60 },
];

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/40">{label}</p>
      <p className="mt-1 text-3xl font-bold leading-none" style={{ color: tone }}>{value}</p>
      <p className="mt-1.5 text-[11px] text-white/45">{sub}</p>
    </div>
  );
}

export function DashboardPeek() {
  return (
    <div className="hk-dark-demo lp-reveal mt-14 grid gap-6 lg:grid-cols-[1.55fr_1fr]">
      {/* ── Console ─────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-white/12 bg-[#080816] shadow-2xl shadow-black/50">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.04] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e]/70" />
          <span className="ml-3 truncate font-mono text-[11px] text-white/35">HikTech — command</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#4ade80]">
            <span className="lp-tick h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
            LIVE
          </span>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Responders on duty" value="196" sub="of 214 personnel" tone="#ffffff" />
            <Stat label="Leave for approval" value="11" sub="4 urgent" tone="#fbbf24" />
            <Stat label="Calls breaching" value="2" sub="past response target" tone="#f87171" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Duty allocation */}
            <div className="rounded-lg border border-white/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-white/70">Duty allocation</p>
              <div className="mt-3 space-y-3">
                {SHIFTS.map((s) => (
                  <div key={s.name}>
                    <div className="flex items-baseline justify-between rounded bg-white/[0.06] px-2.5 py-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide">{s.name} {s.hours}</span>
                      <span className="text-[10px] text-white/40">{s.count}</span>
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {s.members.map((m) => (
                        <li key={m.name} className="flex items-center justify-between gap-2 px-1 text-[11px]">
                          <span className="min-w-0 truncate">
                            <span className="font-medium">{m.name}</span>
                            <span className="ml-1.5 text-white/35">{m.post}</span>
                          </span>
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATE_TONE[m.state]}`}>
                            {m.state}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-white/10 pt-2.5">
                <div className="flex items-baseline justify-between text-[10px]">
                  <span className="text-white/45">Allocation coverage</span>
                  <span className="font-bold">91.6% · 196/214</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[#3b82f6]" style={{ width: '91.6%' }} />
                </div>
              </div>
            </div>

            {/* Duty maintenance */}
            <div className="rounded-lg border border-white/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-white/70">Duty maintenance</p>
              <div className="mt-3 space-y-2">
                {TASKS.map((t) => (
                  <div key={t.ref} className="rounded border border-white/10 p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[11px] font-semibold">{t.title}</span>
                      <span className="shrink-0 font-mono text-[9px] text-white/35">{t.ref}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-white/40">{t.due}</p>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${t.pct}%`, background: t.pct === 100 ? '#22c55e' : '#f59e0b' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-4 gap-1 border-t border-white/10 pt-2.5 text-center">
                {[['3', 'Overdue', '#f87171'], ['1', 'Active', '#fbbf24'], ['2', 'Pending', '#ffffff80'], ['1', 'Done', '#4ade80']].map(([n, l, c]) => (
                  <div key={l}>
                    <p className="text-base font-bold" style={{ color: c }}>{n}</p>
                    <p className="text-[8px] uppercase tracking-wide text-white/35">{l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Phone ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[2rem] border-[6px] border-white/15 bg-[#080816] shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between bg-white/[0.04] px-5 pb-1.5 pt-3 text-[10px] text-white/50">
            <span>19:43</span>
            <span className="flex items-center gap-1">
              <span className="lp-tick inline-block h-1.5 w-1.5 rounded-full bg-[#22c55e]" /> LTE
            </span>
          </div>

          <div className="space-y-3 p-4">
            {/* Assignment interrupt */}
            <div className="lp-notify rounded-xl border border-[#ef4444]/40 bg-[#ef4444]/10 p-3.5">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#f87171]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#ef4444]" />
                New assignment · Critical
              </p>
              <p className="mt-2 text-sm font-bold leading-snug">Taxi rollover — M4 nb, Umgeni</p>
              <p className="mt-1 text-[11px] text-white/55">MPFD-MD-20260429-0914-0114 · entrapment reported</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <span className="rounded-md bg-[#dc3545] py-1.5 text-center text-[11px] font-bold">Accept</span>
                <span className="rounded-md border border-white/20 py-1.5 text-center text-[11px] font-bold text-white/70">Details</span>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">Your status</p>
              <div className="relative mt-1.5 h-5">
                <span className="lp-swap-out absolute inset-0 text-sm font-bold text-[#fbbf24]">● Dispatched</span>
                <span className="lp-swap-in absolute inset-0 text-sm font-bold text-[#60a5fa]">● En Route</span>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <span className="text-base">📶</span>
              <p className="text-[10px] leading-snug text-white/55">
                <span className="font-semibold text-white/80">2 updates queued.</span> No signal — they
                send themselves when coverage returns.
              </p>
            </div>

            <div className="lp-alarm rounded-xl bg-[#dc3545] py-3 text-center text-sm font-bold tracking-wide">
              OFFICER DOWN
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] leading-relaxed text-white/35">
          Illustrative interface — demonstration data, not a real incident.
        </p>
      </div>
    </div>
  );
}
