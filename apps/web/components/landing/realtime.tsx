/**
 * "Realtime" demonstrated rather than asserted.
 *
 * Each panel is a working animation of a behaviour the platform genuinely has,
 * driven entirely by CSS so the page keeps shipping no client JavaScript. Every
 * animation here is switched off under prefers-reduced-motion (see globals.css)
 * — the panels stay legible, they simply stop moving.
 */

import { CityMap } from '@/components/landing/city-map';

function Panel({
  title, body, children, wide = false,
}: {
  title: string; body: string; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className={`lp-card overflow-hidden ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="hk-dark-demo border-b border-white/10 bg-[#080816] p-5">{children}</div>
      <div className="p-5">
        <h3 className="font-bold">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{body}</p>
      </div>
    </div>
  );
}

export function Realtime() {
  return (
    <div className="lp-stagger mt-14 grid gap-5 lg:grid-cols-2">
      {/* ── Live map ──────────────────────────────────────────────── */}
      <Panel
        wide
        title="Every unit, live on one map"
        body="Crews report their position as they move, so the control room is looking at where everyone actually is — not where they said they were going twenty minutes ago. The nearest unit to the next call is a fact on the screen rather than a guess over the radio."
      >
        <CityMap />
      </Panel>

      {/* ── Response clock ────────────────────────────────────────── */}
      <Panel
        title="Clocks that escalate themselves"
        body="Every waiting call runs against a response target. As it approaches the limit it changes colour, and when it breaches, the platform raises it to command on its own — a call cannot go quiet simply because the room got busy."
      >
        <div className="space-y-3">
          {[
            { ref: 'MPFD-MD-…-0114', label: 'Taxi rollover — M4', anim: true },
            { ref: 'FD-…-0115', label: 'Structure fire — Sydenham', anim: false, pct: 62, hex: '#f59e0b' },
            { ref: 'MP-…-0116', label: 'Assault — West St', anim: false, pct: 88, hex: '#22c55e' },
          ].map((r) => (
            <div key={r.ref}>
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="truncate font-medium text-white/80">{r.label}</span>
                <span className="ml-2 shrink-0 font-mono text-white/35">{r.ref}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${r.anim ? 'lp-clock' : ''}`}
                  style={r.anim ? undefined : { width: `${r.pct}%`, background: r.hex }}
                />
              </div>
            </div>
          ))}
          <p className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-[#f87171]">
            ▲ Escalated to command — response target exceeded
          </p>
        </div>
      </Panel>

      {/* ── Officer down ──────────────────────────────────────────── */}
      <Panel
        title="Officer down outranks everything"
        body="One press raises a Critical incident carrying the officer's position, and takes over the screen of every console in the room — whatever they were doing. It works offline, it works from any screen in the app, and it is sent before anything else in the queue."
      >
        <div className="lp-alarm rounded-lg border border-[#ef4444]/50 bg-[#ef4444]/10 p-5 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#f87171]">Emergency</p>
          <p className="mt-2 text-lg font-bold">Officer requires immediate assistance</p>
          <p className="mt-1.5 font-mono text-[11px] text-white/60">
            Const. Mkhize · MP-04 · −29.8587, 31.0218 (±8 m)
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#dc3545] px-4 py-2 text-xs font-bold">
            Acknowledge and respond
          </div>
        </div>
      </Panel>

      {/* ── Push ──────────────────────────────────────────────────── */}
      <Panel
        title="It reaches a phone in a pocket"
        body="Assignments and alerts arrive as OS push notifications, so a locked, backgrounded handset still wakes. A crew does not have to be watching the app to be told — which is the only assumption worth making about people who are driving."
      >
        <div className="flex h-[152px] items-center justify-center rounded-lg bg-gradient-to-b from-[#0b1222] to-[#050512]">
          <div className="lp-notify w-full max-w-[280px] rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white/50">
              <span className="inline-block h-3 w-3 rounded bg-[#dc3545]" />
              HikTech · now
            </p>
            <p className="mt-1.5 text-sm font-bold">Critical assignment</p>
            <p className="mt-0.5 text-[11px] text-white/65">Taxi rollover, M4 nb Umgeni — entrapment</p>
          </div>
        </div>
      </Panel>

      {/* ── Shared state ──────────────────────────────────────────── */}
      <Panel
        title="One truth, everywhere, without a refresh"
        body="A status changed in a vehicle appears on the control-room board, the live map and the command dashboard in the same moment. Nobody reloads anything, and no two screens disagree about what is happening right now."
      >
        <div className="grid grid-cols-2 gap-3">
          {['Control room', 'Responder app'].map((surface) => (
            <div key={surface} className="rounded-lg border border-white/10 p-3.5">
              <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">{surface}</p>
              <p className="mt-1.5 truncate text-[11px] text-white/60">MPFD-MD-…-0114</p>
              <div className="relative mt-2 h-6">
                <span className="lp-swap-out absolute inset-0 inline-flex items-center rounded-md bg-[#f59e0b]/15 px-2.5 text-[11px] font-bold text-[#fbbf24]">
                  ● Dispatched
                </span>
                <span className="lp-swap-in absolute inset-0 inline-flex items-center rounded-md bg-[#3b82f6]/15 px-2.5 text-[11px] font-bold text-[#60a5fa]">
                  ● En Route
                </span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* ── Automation ────────────────────────────────────────────── */}
      <Panel
        wide
        title="The part of the job nobody should have to remember"
        body="Inside the database, on a schedule, the platform re-reads its own state: calls past their response target, crews whose certifications lapse this month, tasks now overdue, shift digests due at handover. Each one raises itself to the right person. Nothing here waits on somebody thinking to check."
      >
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Response breach', 'Escalates to command'],
            ['Certification expiry', 'Warns before it lapses'],
            ['Task overdue', 'Back to the supervisor'],
            ['Shift digest', 'Ready at handover'],
          ].map(([t, s], i) => (
            <div key={t} className="rounded-lg border border-white/10 p-3.5">
              <p className="flex items-center gap-2 text-[11px] font-bold">
                <span className="lp-tick inline-block h-1.5 w-1.5 rounded-full bg-[#22c55e]"
                  style={{ animationDelay: `${i * 0.35}s` }} />
                {t}
              </p>
              <p className="mt-1 pl-3.5 text-[10px] text-white/45">{s}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
