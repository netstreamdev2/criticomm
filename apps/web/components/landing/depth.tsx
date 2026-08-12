/**
 * The depth sections: the engineering decisions behind the platform, the shape
 * of a supervisor's day, what going live actually involves, and the manual.
 *
 * These exist because a buyer evaluating an emergency system is really asking
 * one question — "do these people know what they are doing" — and the honest
 * way to answer it is to show the hard choices, including what each one cost.
 */

/* ── Hero proof strip ─────────────────────────────────────────────────── */

const PROOF = [
  'Offline-first',
  'Multi-tenant',
  'Deny-by-default RLS',
  'Fully audited',
  'Realtime',
  '138-page manual',
];

export function HeroProof() {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-white/10 pt-6">
      {PROOF.map((p, i) => (
        <span key={p} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden className="hidden h-3 w-px bg-white/15 sm:block" />}
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
            {p}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ── Three decisions ──────────────────────────────────────────────────── */

const DECISIONS = [
  {
    n: '01',
    hex: '#dc3545',
    title: 'Authorization lives in the database',
    decision:
      'Every table denies by default. What a query returns is decided by row-level policies, not by the code that asked.',
    instead:
      'Filter in the application. It is faster to write, easier to debug, and it is what most systems do.',
    cost:
      'Every feature needs its policy written and tested, and a missing one surfaces as an empty screen rather than a useful error. It is genuinely harder to work on.',
    buys:
      'A bug in a screen cannot leak another department’s data, or another municipality’s. The guarantee holds for the API, an export, a saved report and any future client nobody has written yet — because none of them are the thing enforcing it.',
  },
  {
    n: '02',
    hex: '#3b82f6',
    title: 'The phone writes to itself first',
    decision:
      'Every field action is persisted on the handset before any attempt to send it, and carries the moment it happened.',
    instead:
      'Submit, and show an error if it fails. Simpler, and perfectly correct on a good network.',
    cost:
      'Every write has to be safe to replay, because delivery can be interrupted after the server committed but before the phone knew. That constrains how each one is designed — client-generated ids, idempotency keys, deliberate conflict handling.',
    buys:
      'The time on the record is when the responder acted, not when coverage returned. Under a bridge, that difference is the entire value of the record — it is the number a review or an inquest turns on.',
  },
  {
    n: '03',
    hex: '#22c55e',
    title: 'The engine runs inside the database',
    decision:
      'Escalation, expiry warnings, overdue tasks and shift digests run as scheduled functions in Postgres.',
    instead:
      'A worker service in application code. Easier to write, far easier to test, and familiar to every developer.',
    cost:
      'Operational logic in SQL, which fewer people read comfortably, and changing a rule means a migration rather than a deploy.',
    buys:
      'Nothing separate to deploy, monitor, or quietly lose. There is no state where the console is up and the automation has been dead for a week — which is exactly the failure that makes an escalation system worse than none at all.',
  },
];

export function Decisions() {
  return (
    <div className="lp-stagger mt-14 space-y-5">
      {DECISIONS.map((d) => (
        <div key={d.n} className="lp-card overflow-hidden">
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:p-8">
            <div>
              <p className="text-5xl font-bold leading-none text-white/10">{d.n}</p>
              <h3 className="mt-4 text-xl font-bold leading-snug">{d.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/65">{d.decision}</p>
            </div>

            <div className="grid gap-5 sm:grid-cols-3 lg:border-l lg:border-white/10 lg:pl-8">
              {[
                ['Instead of', d.instead, '#94a3b8'],
                ['What it costs', d.cost, '#f59e0b'],
                ['What it buys', d.buys, d.hex],
              ].map(([label, body, hex]) => (
                <div key={label}>
                  <p
                    className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em]"
                    style={{ color: hex }}
                  >
                    {label}
                  </p>
                  <p className="text-[13px] leading-relaxed text-white/55">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── The shift ────────────────────────────────────────────────────────── */

const SHIFT = [
  {
    time: 'Before the shift',
    title: 'The gate',
    body: 'Every crew member runs the readiness check and the vehicle inspection on their phone. Somebody who does not pass cannot be allocated a call — the platform will not let a supervisor send an unfit crew by accident.',
    hex: '#a855f7',
  },
  {
    time: 'Handover',
    title: 'The board',
    body: 'The command screen shows strength on duty against establishment, who has acknowledged, who is on leave, and who was expected and is not there. The gap is visible at the start of the shift rather than discovered during it.',
    hex: '#dc3545',
  },
  {
    time: 'Through the shift',
    title: 'The queue and the map',
    body: 'Calls arrive, get numbered, routed and assigned. Units report position as they move. Response clocks run on every waiting call and change colour as they approach the target.',
    hex: '#f59e0b',
  },
  {
    time: 'When it goes wrong',
    title: 'The interrupt',
    body: 'A breach escalates itself to command. An officer-down takes over every console in the room. Neither waits for somebody to notice, because at 02:00 the room is thin and noticing is exactly what fails.',
    hex: '#ef4444',
  },
  {
    time: 'The quiet hours',
    title: 'The engine',
    body: 'While nothing is happening, the platform re-reads its own state: certifications lapsing this month, tasks now overdue, digests due at handover. The work that gets forgotten is the work that runs when nobody is watching.',
    hex: '#3b82f6',
  },
  {
    time: 'End of shift',
    title: 'The file',
    body: 'Reports are completed against incidents that already hold every time, position, status change and photograph. Handover is a conversation about exceptions, not a reconstruction of the night.',
    hex: '#22c55e',
  },
];

export function ShiftDay() {
  return (
    <div className="lp-stagger mt-14 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {SHIFT.map((s) => (
        <div key={s.title} className="lp-card relative p-6">
          <span
            aria-hidden
            className="absolute left-0 top-6 h-10 w-[3px] rounded-r"
            style={{ background: s.hex }}
          />
          <p
            className="text-[10px] font-bold uppercase tracking-[0.16em]"
            style={{ color: s.hex }}
          >
            {s.time}
          </p>
          <h3 className="mt-2 text-lg font-bold">{s.title}</h3>
          <p className="mt-2.5 text-sm leading-relaxed text-white/55">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

/* ── Going live ───────────────────────────────────────────────────────── */

const ROLLOUT = [
  ['Provision the organisation', 'A slug, a name, and its own isolated world — numbering, personnel, configuration and switches.'],
  ['Set the identity', 'Crest, colours, official and short names per department, so every screen and printed report carries the right badge.'],
  ['Load the people', 'Personnel, ranks, badge numbers, call signs and reporting lines — then roles, which decide what each person can open.'],
  ['Describe the ground', 'Sections, stations, duty posts and the establishment each post needs to count as properly manned.'],
  ['Tune the thresholds', 'Response targets, alert severity behaviour, escalation timings — the numbers that decide when the platform starts shouting.'],
  ['Switch on what you use', 'Radio, SMS, cameras and traffic feeds, each connection-tested before anybody depends on it. Turn off the modules you do not want.'],
  ['Enrol the handsets', 'Crews sign in, push tokens register, and the start-of-shift gate begins applying.'],
  ['Train from the manual', 'Every role has a playbook and every task a numbered procedure — training material that is already written and already correct.'],
];

export function GoingLive() {
  return (
    <ol className="lp-stagger mt-14 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
      {ROLLOUT.map(([title, body], i) => (
        <li key={title} className="lp-card p-5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white/70">
            {i + 1}
          </span>
          <h3 className="mt-3 text-sm font-bold leading-snug">{title}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/50">{body}</p>
        </li>
      ))}
    </ol>
  );
}

/* ── The manual ───────────────────────────────────────────────────────── */

const VOLUMES = [
  ['I', 'The Platform'], ['II', 'Technology'], ['III', 'Operational Flow'],
  ['IV', 'Role Playbooks'], ['V', 'Task Procedures'], ['VI', 'The Responder App'],
  ['VII', 'Administration'], ['VIII', 'Running It'], ['IX', 'The Command Platform'],
  ['X', 'Reference'],
];

export function Manual() {
  return (
    <div className="lp-reveal mt-14 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
      <div className="lp-card p-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/40">
          Operations &amp; Engineering Manual
        </p>
        <div className="mt-5 flex flex-wrap items-baseline gap-x-8 gap-y-3">
          {[['138', 'pages'], ['10', 'volumes'], ['53', 'chapters'], ['107', 'procedures']].map(
            ([n, l]) => (
              <span key={l}>
                <span className="text-3xl font-bold">{n}</span>
                <span className="ml-1.5 text-xs uppercase tracking-wider text-white/40">{l}</span>
              </span>
            ),
          )}
        </div>
        <p className="mt-6 text-sm leading-relaxed text-white/60">
          Every role has a playbook: what you can reach, what your shift looks like, every task you
          perform, and what you cannot do — with who to ask instead. Every task has a numbered
          procedure naming the screen, who may do it, what it writes, and what happens afterwards.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-white/60">
          It is generated from the codebase rather than written alongside it, which is the only way a
          document this size stays true after the third release.
        </p>
      </div>

      <div className="lp-card p-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/40">Contents</p>
        <ul className="mt-5 space-y-2.5">
          {VOLUMES.map(([n, t]) => (
            <li key={n} className="flex items-baseline gap-4 border-b border-white/[0.06] pb-2.5 last:border-0">
              <span className="w-8 shrink-0 font-mono text-xs text-white/35">{n}</span>
              <span className="text-sm text-white/75">{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
