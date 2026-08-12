/**
 * The substance sections of the landing page: the services, the desks, what
 * the platform connects to, how it is secured, what it is built on, and the
 * questions a buyer actually asks.
 *
 * Every number here is counted from the repository — screens in the
 * navigation, roles in the enum, migrations on disk, integrations in the
 * catalogue, procedures in the manual. Nothing is a marketing estimate,
 * because the first person to check one would be a municipal IT officer.
 */

/* ── Facts band ───────────────────────────────────────────────────────── */

const FACTS = [
  { n: '5', label: 'Services on one record', sub: 'Police, Fire, EMS, Disaster and the city-wide command tier' },
  { n: '60+', label: 'Console screens', sub: 'Intake through to enforcement, workforce and administration' },
  { n: '24', label: 'Assignable roles', sub: 'Each with its own reach, enforced by the database' },
  { n: '11', label: 'Steps in a call', sub: 'From the phone ringing to a closed, reviewable case' },
  { n: '9', label: 'External systems', sub: 'Radio, SMS, CCTV, traffic feeds and AI' },
  { n: '138', label: 'Pages of manual', sub: '107 procedures — every task, every role, written down' },
];

export function FactsBand() {
  return (
    <div className="border-y border-white/10 bg-white/[0.02]">
      <div className="lp-stagger mx-auto grid w-full max-w-6xl grid-cols-2 gap-px overflow-hidden px-6 py-14 sm:px-8 lg:grid-cols-6 lg:py-16">
        {FACTS.map((f) => (
          <div key={f.label} className="px-2 py-3 lg:px-4">
            <p className="bg-gradient-to-b from-white to-white/55 bg-clip-text text-3xl font-bold text-transparent lg:text-4xl">
              {f.n}
            </p>
            <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">{f.label}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-white/40">{f.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── The services ─────────────────────────────────────────────────────── */

const SERVICES = [
  {
    name: 'Metro Police',
    hex: '#f59e0b',
    line: 'Enforcement, patrol and the paperwork that follows an arrest.',
    gets: ['Metro incident reports with itemised offences', 'Fines, charges, transactions, warrants, summonses',
      'Armoury register and firearm checklists from the field', 'Security-company reports and SIRA detail',
      'Crime hotspot mapping'],
  },
  {
    name: 'Fire & Rescue',
    hex: '#dc3545',
    line: 'Structural, vehicle and hazmat response, plus the assets that support it.',
    gets: ['Firefighter incident reports', 'Public incident reports, published when cleared',
      'Hydrant register with condition and last-tested', 'Appliance checks at start of shift'],
  },
  {
    name: 'EMS',
    hex: '#22c55e',
    line: 'Patient care from dispatch to hospital handover.',
    gets: ['Patient care reports — history, assessment, vitals, interventions',
      'Triage codes carried from the intake screen', 'Legal handover records',
      'Ambulance restock against drug and consumable use'],
  },
  {
    name: 'Disaster Management',
    hex: '#3b82f6',
    line: 'Multi-agency events that run for days rather than hours.',
    gets: ['Rolling disaster logs with periodic updates', 'Mutual-aid partner register and resource dispatch',
      'Relief stock levels', 'Post-mortem reports once the event closes'],
  },
];

export function Services() {
  return (
    <div className="lp-stagger mt-14 grid gap-5 lg:grid-cols-2">
      {SERVICES.map((s) => (
        <div key={s.name} className="lp-card p-7">
          <div className="flex items-center gap-3">
            <span className="h-8 w-1 rounded-full" style={{ background: s.hex }} />
            <h3 className="text-xl font-bold">{s.name}</h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/60">{s.line}</p>
          <ul className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm text-white/70">
            {s.gets.map((g) => (
              <li key={g} className="flex gap-3">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ background: s.hex }} />
                {g}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ── The desks ────────────────────────────────────────────────────────── */

const DESKS = [
  {
    desk: 'The control room',
    hex: '#dc3545',
    roles: ['IncidentLogger', 'ControlRoom', 'Operator', 'Dispatcher'],
    note: 'Intake and dispatch are separate chairs. A logger captures and cannot dispatch; a dispatcher works the queue and cannot capture — the split is pinned by tests, because merging it would be an authorization change disguised as convenience.',
  },
  {
    desk: 'The field',
    hex: '#3b82f6',
    roles: ['Responder', 'Police', 'Officer', 'Metro', 'Security', 'Firefighter', 'Paramedic', 'Doctor', 'Disaster'],
    note: 'Everyone who attends a scene. They carry the app, run the start-of-shift gate, and write the record from where the work happened.',
  },
  {
    desk: 'Command',
    hex: '#22c55e',
    roles: ['Supervisor', 'Captain', 'Chief', 'FireChief', 'SystemController'],
    note: 'People-readiness, the duty board, approvals and the day’s shape. The controller seat sees every department at once without holding account or tenant keys.',
  },
  {
    desk: 'Case and back office',
    hex: '#a855f7',
    roles: ['CaseManager', 'Staff', 'Viewer'],
    note: 'Review, closure quality and read-only oversight — the people who look at the record after the noise has stopped.',
  },
  {
    desk: 'Platform',
    hex: '#94a3b8',
    roles: ['Admin', 'SystemAdmin', 'SuperAdmin'],
    note: 'Accounts, configuration, integrations and — for the SuperAdmin alone — tenants, feature switches and access rules.',
  },
];

export function Desks() {
  return (
    <div className="lp-stagger mt-14 space-y-4">
      {DESKS.map((d) => (
        <div key={d.desk} className="lp-card grid gap-5 p-6 lg:grid-cols-[200px_1fr] lg:p-7">
          <div>
            <h3 className="flex items-center gap-2.5 text-base font-bold">
              <span className="h-2 w-2 rounded-full" style={{ background: d.hex }} />
              {d.desk}
            </h3>
            <p className="mt-1.5 text-[11px] uppercase tracking-wider text-white/35">
              {d.roles.length} role{d.roles.length === 1 ? '' : 's'}
            </p>
          </div>
          <div>
            <div className="flex flex-wrap gap-1.5">
              {d.roles.map((r) => (
                <span
                  key={r}
                  className="rounded-md border px-2 py-1 font-mono text-[11px]"
                  style={{ borderColor: `${d.hex}44`, color: `${d.hex}` }}
                >
                  {r}
                </span>
              ))}
            </div>
            <p className="mt-3.5 text-sm leading-relaxed text-white/55">{d.note}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Integrations ─────────────────────────────────────────────────────── */

const INTEGRATIONS = [
  { cat: 'Comms', hex: '#dc3545', items: [['RealPTT', 'Push-to-talk radio bridge — text straight to a channel']] },
  { cat: 'Notifications', hex: '#f59e0b', items: [['Expo Push', 'Assignments and alerts to locked handsets'], ['BulkSMS', 'Citizen SMS and one-time GPS requests']] },
  { cat: 'Surveillance', hex: '#a855f7', items: [['SANRAL CCTV', 'Freeway camera matrix'], ['Hikvision HikCentral', 'Municipal camera platform and footage retrieval']] },
  { cat: 'External feeds', hex: '#3b82f6', items: [['TomTom', 'Live traffic incidents'], ['i-Traffic', 'Incident CSV import']] },
  { cat: 'AI', hex: '#22c55e', items: [['Groq', 'Primary provider for the Criti assistant'], ['Google Gemini', 'Fallback provider']] },
];

export function Integrations() {
  return (
    <>
      <div className="lp-stagger mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((g) => (
          <div key={g.cat} className="lp-card p-6">
            <p className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.16em]" style={{ color: g.hex }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: g.hex }} />
              {g.cat}
            </p>
            <ul className="mt-4 space-y-3">
              {g.items.map(([name, what]) => (
                <li key={name}>
                  <p className="text-sm font-semibold">{name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/50">{what}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="lp-card lp-reveal mt-5 p-6 text-sm leading-relaxed text-white/65">
        <span className="font-semibold text-white">Every one is a switch, not a rebuild.</span>{' '}
        Each integration is enabled, configured and connection-tested from Admin → Integrations, and
        each records the result of its last test so a failure is visible before somebody depends on it.
        Credentials never live in the database — the table holds the switch, the endpoint and the
        tunable parameters; the secrets stay in server environment variables.
      </p>
    </>
  );
}

/* ── Security ─────────────────────────────────────────────────────────── */

const SECURITY = [
  { t: 'Deny by default', d: 'Every table has row-level security on with no blanket allow. A query returns what the signed-in person is entitled to and nothing else — the application never filters for privacy, because a filter can be forgotten.' },
  { t: 'Tenancy is restrictive', d: 'Organisation scoping is a restrictive policy, so it ANDs onto every other rule rather than widening anything. No permissive policy anywhere can override it.' },
  { t: 'Privileged work is guarded', d: 'Functions that run with elevated rights open with a role check and carry their own tenant guard, so elevation never becomes a way around the matrix.' },
  { t: 'Everything is attributed', d: 'Dispatches, status changes, approvals, enforcement documents and administrative changes all land on an audit trail with who, what and when.' },
  { t: 'Some records cannot be edited', d: 'The attendance register is append-only, and a firearm checklist computes its own pass from the safety items. Corrections are new records, visible as corrections.' },
  { t: 'Limits live in the database', d: 'Rate limiting is counted in Postgres rather than in a serverless process with no shared memory, so the limit is real across every instance.' },
];

export function Security() {
  return (
    <div className="lp-stagger mt-14 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
      {SECURITY.map((s) => (
        <div key={s.t}>
          <h3 className="flex items-start gap-3 text-base font-bold">
            <span className="mt-1.5 inline-block h-3 w-1 shrink-0 rounded-full bg-[#22c55e]" />
            {s.t}
          </h3>
          <p className="mt-2 pl-4 text-sm leading-relaxed text-white/55">{s.d}</p>
        </div>
      ))}
    </div>
  );
}

/* ── Stack ────────────────────────────────────────────────────────────── */

const STACK = [
  { layer: 'Console', items: 'Next.js 15 · React 19 · Tailwind', why: 'Server-rendered, so a page arrives already scoped to the person who asked for it.' },
  { layer: 'Responder app', items: 'Expo SDK 52 · React Native 0.76', why: 'One codebase for both handsets, and over-the-air updates without an app-store round trip.' },
  { layer: 'Data', items: 'PostgreSQL 15 · PostGIS', why: 'Geography as a first-class type, and authorization enforced where the data is.' },
  { layer: 'Platform services', items: 'Auth · Realtime · Storage', why: 'Sessions, live updates and evidence files without a second system to run.' },
  { layer: 'Automation', items: 'pg_cron, in-database', why: 'The engine runs inside the database — no separate worker to deploy, monitor or lose.' },
  { layer: 'Delivery', items: 'Vercel · EAS · GitHub Actions', why: 'Console, app and quality gate ship on their own cadence.' },
];

export function Stack() {
  return (
    <div className="lp-card lp-reveal mt-14 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.14em] text-white/40">
              <th className="px-6 py-4 font-semibold">Layer</th>
              <th className="px-6 py-4 font-semibold">What</th>
              <th className="px-6 py-4 font-semibold">Why it is there</th>
            </tr>
          </thead>
          <tbody>
            {STACK.map((r) => (
              <tr key={r.layer} className="border-b border-white/[0.06] last:border-0">
                <td className="px-6 py-4 font-semibold">{r.layer}</td>
                <td className="px-6 py-4 font-mono text-[13px] text-white/70">{r.items}</td>
                <td className="px-6 py-4 leading-relaxed text-white/50">{r.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────── */

const FAQ = [
  ['What happens when a crew has no signal?',
    'The action is written to the handset and delivered when coverage returns, carrying the time it happened rather than the time it was sent. A queued emergency is sent before a queued photograph, and nothing is ever dropped silently — anything undeliverable stays visible until a person resolves it.'],
  ['Four people call about the same crash. Do we send four crews?',
    'No. Duplicate detection matches location, time and type at the moment of capture and offers the incident that already exists. The crews that were not sent stay available for the next emergency.'],
  ['Can one department see another department’s data?',
    'Only what it has been routed. Silo scoping is enforced by the database, and routing an incident to a department is what grants that department visibility of it — not a setting somebody has to remember.'],
  ['How is another municipality added?',
    'As its own organisation, with its own personnel, numbering, configuration and branding on the same deployment. Its data is invisible to every other organisation on every screen, in every export and in every search.'],
  ['What happens if a call breaches its response target?',
    'The automation engine re-reads the platform’s own state on a schedule and escalates the breach to command by itself. A call cannot go quiet because the room got busy.'],
  ['Who can read internal mail?',
    'The sender and the recipient. Not a supervisor, not an administrator, not the platform tier — it is the one module with no elevated read, because mail people believe is private has to actually be private.'],
  ['Can we turn a module off?',
    'Per organisation, and per role within it. Switches gate whether a capability exists at all; access rules hide modules from specific roles. Neither can grant anybody anything the role matrix already refuses.'],
  ['What proof is there that any of this works as described?',
    'A 138-page operations manual documenting 107 procedures, a quality gate of type checks, tests and lint on every change, and an audit trail that makes the claim checkable against your own data rather than ours.'],
];

export function Faq() {
  return (
    <div className="lp-stagger mt-14 grid gap-4 lg:grid-cols-2">
      {FAQ.map(([q, a]) => (
        <div key={q} className="lp-card p-6">
          <h3 className="text-base font-bold leading-snug">{q}</h3>
          <p className="mt-3 text-sm leading-relaxed text-white/55">{a}</p>
        </div>
      ))}
    </div>
  );
}
