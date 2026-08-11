import type { Metadata } from 'next';
import Link from 'next/link';
import { DashboardPeek } from '@/components/landing/dashboard-peek';
import { Realtime } from '@/components/landing/realtime';
import { Storyboard } from '@/components/landing/storyboard';

/**
 * The public landing page — the only page on this deployment that anyone can
 * read without an account, and the only one that explains *why* the rest of it
 * exists.
 *
 * Like the login hero, it owns its palette in fixed hex rather than the theme
 * tokens: a visitor has no saved theme, and the story should look identical to
 * everyone who is sent the link. Everything here is a server component with no
 * client JavaScript — the page is a document, not an application.
 */

export const metadata: Metadata = {
  title: 'Criticomm — Emergency Command Platform',
  description:
    'One platform for emergency dispatch, field response and the record that follows — across Metro Police, Fire & Rescue, EMS and Disaster Management.',
};

const DEPARTMENTS = [
  { label: 'Metro Police', dot: '#f59e0b' },
  { label: 'Fire & Rescue', dot: '#dc3545' },
  { label: 'EMS', dot: '#22c55e' },
  { label: 'Disaster Management', dot: '#3b82f6' },
];

/** The eleven steps every call passes through, in the order they happen. */
const LIFECYCLE = [
  { n: 1, label: 'Call', sub: 'Intake desk answers', tone: 'red' },
  { n: 2, label: 'Duplicate check', sub: 'Same street, same minute', tone: 'red' },
  { n: 3, label: 'Created', sub: 'Numbered INC-…', tone: 'red' },
  { n: 4, label: 'Routed', sub: 'To every department needed', tone: 'red' },
  { n: 5, label: 'Notified', sub: 'Alert + push to the crew', tone: 'blue' },
  { n: 6, label: 'Assigned', sub: 'A unit accepts', tone: 'blue' },
  { n: 7, label: 'En route', sub: 'Position live on the map', tone: 'blue' },
  { n: 8, label: 'On scene', sub: 'Arrival stamped', tone: 'blue' },
  { n: 9, label: 'Evidence', sub: 'Photos, voice notes', tone: 'blue' },
  { n: 10, label: 'Report', sub: "The department's own form", tone: 'green' },
  { n: 11, label: 'Closed', sub: 'Reviewed and filed', tone: 'green' },
] as const;

const TONE_HEX = { red: '#dc3545', blue: '#3b82f6', green: '#22c55e' } as const;

const PROBLEMS = [
  {
    title: 'Four separate memories',
    body:
      'Police ran one system, Fire another, EMS a third, and Disaster Management on spreadsheets. '
      + 'One incident needing two departments meant two phone calls, two sets of paperwork, and two '
      + 'records that disagreed about what happened.',
  },
  {
    title: 'Radios write nothing down',
    body:
      'The decisive minutes of a response lived in the air and in someone’s memory. Times were '
      + 'reconstructed afterwards from a notebook, which is exactly when precision matters most and '
      + 'is least available.',
  },
  {
    title: 'The field had no signal',
    body:
      'Basements, lift shafts, the industrial south. An officer marked himself on scene, the request '
      + 'failed, and the record lost the moment it happened — the one timestamp an inquiry later '
      + 'turns on.',
  },
];

const PILLARS = [
  {
    kicker: 'One record',
    title: 'Numbered once, shared by everyone',
    body:
      'A call becomes a single incident with a single number, and every department that touches it '
      + 'writes into the same file. Routing a fire call to EMS does not create a second incident — it '
      + 'adds a department to the one that already exists.',
    hex: '#dc3545',
  },
  {
    kicker: 'The field is first-class',
    title: 'The phone works with no signal',
    body:
      'Every field action is written to the handset first and delivered afterwards. The time on the '
      + 'record is when the responder acted, not when the network came back — and a queued emergency '
      + 'is sent before a queued photograph.',
    hex: '#3b82f6',
  },
  {
    kicker: 'The system watches itself',
    title: 'Nothing waits on someone remembering',
    body:
      'Response clocks, escalation, certification expiry and shift digests run inside the database on '
      + 'a schedule. A call breaching its target raises itself to command rather than sitting quietly '
      + 'in a queue.',
    hex: '#22c55e',
  },
];

const MODULE_GROUPS = [
  {
    label: 'Control room',
    hex: '#dc3545',
    items: ['Log incoming call', 'Pending queue', 'Live map', 'Duplicate detection',
      'PTT radio console', 'Dispatch KPIs', 'Alert centre'],
  },
  {
    label: 'Departments',
    hex: '#f59e0b',
    items: ['Metro Police reports', 'Armoury register', 'Fire incident reports', 'Hydrants',
      'Patient care reports', 'Restock', 'Disaster mutual aid'],
  },
  {
    label: 'Enforcement',
    hex: '#a855f7',
    items: ['Fines', 'Charges', 'Charge transactions', 'Warrants', 'Summonses',
      'Firearm checklists', 'Crime hotspots'],
  },
  {
    label: 'Workforce',
    hex: '#3b82f6',
    items: ['Duty allocation', 'Roster & duty sheet', 'Duty maintenance', 'Time & attendance',
      'Leave', 'Training & certifications', 'Performance'],
  },
  {
    label: 'Command & insight',
    hex: '#22c55e',
    items: ['Command dashboard', 'Report builder', 'Analytics', 'Global search',
      'CCTV surveillance', 'Case manager', 'Criti assistant'],
  },
  {
    label: 'Administration',
    hex: '#94a3b8',
    items: ['Users & roles', 'Tenants', 'Feature switches', 'Access control',
      'Automations', 'Integrations', 'Department branding'],
  },
];

const CAPABILITIES = [
  {
    title: 'Works with no signal',
    body:
      'Status changes, notes, photographs and voice notes queue on the handset and deliver themselves '
      + 'when coverage returns. Nothing is dropped silently; anything that cannot be delivered stays '
      + 'visible until a person resolves it.',
  },
  {
    title: 'Officer down',
    body:
      'One press raises a Critical incident with the officer’s position, opens a full-screen interrupt '
      + 'on every console, and outranks everything else in the delivery queue. It works offline and it '
      + 'works from any screen.',
  },
  {
    title: 'Authorization in the database',
    body:
      'Every table denies by default and every query is scoped by the database itself — not by the '
      + 'application asking nicely. A bug in a screen cannot show someone another department’s or '
      + 'another municipality’s data.',
  },
  {
    title: 'Multi-tenant by construction',
    body:
      'One deployment carries many municipalities, each isolated at the row level with its own '
      + 'incident numbering, personnel, configuration and branding. Two cities can both hold '
      + 'incident 0001 and never see each other.',
  },
  {
    title: 'Configurable without a rebuild',
    body:
      'Feature switches turn whole capabilities on or off per organisation, and access rules hide '
      + 'modules per role. Shaping a deployment for a customer is an afternoon of toggles, not a '
      + 'development cycle.',
  },
  {
    title: 'Everything is on the record',
    body:
      'Dispatches, status changes, approvals, enforcement documents and administrative changes all '
      + 'land on an audit trail with who, what and when — because in this domain the record is the '
      + 'product.',
  },
];

const OUTCOMES = [
  { title: 'Nothing is lost', body: 'The dead-zone minute, the photograph, the arrival time — all captured where the work happened and delivered intact.' },
  { title: 'One version of events', body: 'Control room, field crew and command read the same incident, live, instead of three accounts assembled afterwards.' },
  { title: 'The record writes itself', body: 'Times, positions, assignments and evidence accumulate as a by-product of doing the job, not as paperwork afterwards.' },
  { title: 'Command decides on facts', body: 'Strength on duty, coverage, outstanding approvals and breaching calls on one screen, current to the second.' },
  { title: 'Accountability is automatic', body: 'Every action carries a name and a timestamp, so review is a query rather than an investigation.' },
  { title: 'The platform grows with you', body: 'New departments, new modules and new municipalities are configuration and migration — not a rewrite.' },
];

/* ── Small presentational pieces ─────────────────────────────────────── */

function Eyebrow({ children, hex = '#ff5a68' }: { children: React.ReactNode; hex?: string }) {
  return (
    <p className="mb-3 flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.2em]" style={{ color: hex }}>
      <span className="inline-block h-px w-8" style={{ background: hex }} />
      {children}
    </p>
  );
}

function Section({
  id, children, className = '',
}: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl px-6 py-20 sm:px-8 lg:py-28 ${className}`}>
      {children}
    </section>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#05050f] text-white">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05050f]/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6 sm:px-8">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/criticomm-logo.png" alt="Criticomm" className="h-8 w-auto" />
          </div>
          <nav className="flex items-center gap-1 sm:gap-4">
            <a href="#why" className="hidden rounded-md px-3 py-2 text-sm text-white/70 transition-colors hover:text-white lg:block">Why</a>
            <a href="#flow" className="hidden rounded-md px-3 py-2 text-sm text-white/70 transition-colors hover:text-white sm:block">How it works</a>
            <a href="#story" className="hidden rounded-md px-3 py-2 text-sm text-white/70 transition-colors hover:text-white sm:block">Storyboard</a>
            <a href="#realtime" className="hidden rounded-md px-3 py-2 text-sm text-white/70 transition-colors hover:text-white lg:block">Realtime</a>
            <a href="#platform" className="hidden rounded-md px-3 py-2 text-sm text-white/70 transition-colors hover:text-white lg:block">Platform</a>
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-md bg-[#dc3545] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#c32b3a]"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0f1e] via-[#0b1222] to-[#05050f]" />
        <div className="auth-aurora" style={{ width: 620, height: 620, top: -220, left: -160, background: 'radial-gradient(circle, rgba(220,53,69,0.5), transparent 65%)' }} />
        <div className="auth-aurora" style={{ width: 560, height: 560, top: -80, right: -180, background: 'radial-gradient(circle, rgba(59,130,246,0.45), transparent 65%)', animationDelay: '-8s' }} />
        <div className="auth-aurora" style={{ width: 420, height: 420, bottom: -200, left: '38%', background: 'radial-gradient(circle, rgba(16,185,129,0.28), transparent 65%)', animationDelay: '-14s' }} />
        <div className="auth-grid absolute inset-0" />

        <span className="auth-ping-dot text-[#ef4444]" style={{ top: '22%', left: '9%' }}><span className="auth-ping-core" /></span>
        <span className="auth-ping-dot text-[#3b82f6]" style={{ top: '68%', left: '17%' }}><span className="auth-ping-core" /></span>
        <span className="auth-ping-dot text-[#22c55e]" style={{ top: '30%', right: '12%' }}><span className="auth-ping-core" /></span>
        <span className="auth-ping-dot text-[#f59e0b]" style={{ top: '74%', right: '20%' }}><span className="auth-ping-core" /></span>

        <div className="auth-reveal relative z-10 mx-auto w-full max-w-6xl px-6 py-24 sm:px-8 lg:py-36">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white/75 backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#22c55e]" />
            eThekwini Emergency Services
          </p>
          <h1 className="max-w-4xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Every emergency,{' '}
            <span className="bg-gradient-to-r from-[#ff5a68] via-[#ff8a94] to-[#3b82f6] bg-clip-text text-transparent">
              one command platform
            </span>
            .
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-white/70">
            Criticomm unifies dispatch, field response and the record that follows — across Metro Police,
            Fire &amp; Rescue, EMS and Disaster Management. One call taken. One number issued. One trail,
            from the first ring to the closed case.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex h-12 items-center rounded-md bg-[#dc3545] px-7 text-base font-semibold text-white shadow-lg shadow-[#dc3545]/25 transition-colors hover:bg-[#c32b3a]"
            >
              Open the console
            </Link>
            <a
              href="#flow"
              className="inline-flex h-12 items-center rounded-md border border-white/20 bg-white/5 px-7 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
            >
              See how a call flows
            </a>
          </div>

          <div className="mt-12 flex flex-wrap gap-2">
            {DEPARTMENTS.map((d) => (
              <span key={d.label} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm text-white/80 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: d.dot }} />
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── The problem ──────────────────────────────────────────────── */}
      <Section id="why">
        <Eyebrow>Why it exists</Eyebrow>
        <h2 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          A city&rsquo;s emergency response was running on four separate memories.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Not from any single failure — from the ordinary accumulation of systems bought at different
          times for different departments, joined together by a radio and a telephone. It works, right
          up until the moment something needs more than one department at once.
        </p>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
              <div className="mb-4 h-1 w-10 rounded-full bg-[#dc3545]" />
              <h3 className="text-lg font-bold">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/60">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── The vision ───────────────────────────────────────────────── */}
      <div className="border-y border-white/10 bg-white/[0.02]">
        <Section>
          <Eyebrow hex="#3b82f6">The vision</Eyebrow>
          <h2 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            One platform that holds the whole picture — and never loses a minute of it.
          </h2>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
            Three commitments shaped every decision in the build. They are the reasons the system is
            put together the way it is, and each of them costs something to keep.
          </p>

          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {PILLARS.map((p, i) => (
              <div key={p.kicker} className="relative rounded-xl border border-white/10 bg-[#05050f] p-7">
                <span
                  className="absolute left-0 top-7 h-12 w-[3px] rounded-r"
                  style={{ background: p.hex }}
                />
                <p className="text-5xl font-bold leading-none text-white/10">0{i + 1}</p>
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: p.hex }}>
                  {p.kicker}
                </p>
                <h3 className="mt-2 text-xl font-bold leading-snug">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-white/60">{p.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── The life of a call ───────────────────────────────────────── */}
      <Section id="flow">
        <Eyebrow hex="#22c55e">How it works</Eyebrow>
        <h2 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          The life of a call.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Eleven steps from the first ring to the closed case. Red is the control room, blue the field,
          green the case file. The automation engine watches every step and escalates any that stalls.
        </p>

        <ol className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LIFECYCLE.map((s) => (
            <li
              key={s.n}
              className="flex items-start gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:bg-white/[0.06]"
            >
              <span
                className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ background: TONE_HEX[s.tone] }}
              >
                {s.n}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{s.label}</span>
                <span className="mt-0.5 block text-sm text-white/55">{s.sub}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6 sm:p-7">
          <p className="text-sm leading-relaxed text-white/65">
            <span className="font-semibold text-white">What makes it one trail:</span> the number issued
            at step 3 is the only number that incident will ever have. Routing at step 4 adds departments
            to it rather than copying it. The arrival stamped at step 8 is written by the crew on scene
            and cannot be overwritten from a desk afterwards. By step 11 the file already contains
            everything that happened — because it was assembled while it happened, not reconstructed
            after.
          </p>
        </div>
      </Section>

      {/* ── Storyboard ───────────────────────────────────────────────── */}
      <div className="border-y border-white/10 bg-white/[0.02]">
        <Section id="story">
          <Eyebrow>How it saves lives</Eyebrow>
          <h2 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Where the minutes are won.
          </h2>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
            Nobody is saved by software. People are saved by a crew arriving sooner, with the right
            equipment, knowing what they are driving into — and by the crew that stayed free because
            nobody sent three of them to the same crash. Here is one incident, beat by beat, and what
            the platform is doing at each one.
          </p>
          <p className="mt-4 text-sm text-white/40">
            A composed scenario for illustration — the capabilities are real, the incident is not.
          </p>

          <Storyboard />
        </Section>
      </div>

      {/* ── Two surfaces + console peek ──────────────────────────────── */}
      <Section id="console">
        <Eyebrow hex="#f59e0b">A look inside</Eyebrow>
        <h2 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          A console for the room. An app for the vehicle.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          The command dashboard puts the operational day on one screen — strength on duty, coverage,
          approvals waiting and calls running past their target. The app carries the same incident into
          the vehicle.
        </p>

        <DashboardPeek />

        <div className="mt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-[#05050f] p-8">
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#dc3545]/15 text-2xl">🖥️</div>
              <h3 className="text-2xl font-bold">The console</h3>
              <p className="mt-3 leading-relaxed text-white/60">
                Where calls are taken, crews are sent, and the day is run. Live map, pending queue with
                response clocks, department reporting, workforce and enforcement — plus a command
                dashboard that puts strength on duty, coverage, approvals and outstanding tasks on one
                screen.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-white/70">
                {['Intake, routing and dispatch with duplicate detection',
                  'Live incident map and unit positions',
                  'Every department’s own reports and registers',
                  'Command dashboard, analytics and a custom report builder'].map((t) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#dc3545]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#05050f] p-8">
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#3b82f6]/15 text-2xl">📱</div>
              <h3 className="text-2xl font-bold">The responder app</h3>
              <p className="mt-3 leading-relaxed text-white/60">
                What a crew carries. Assigned calls, one-tap status, evidence capture, shift readiness
                and the officer-down button — built to keep working when the network does not, and to
                deliver everything it took in the moment it took it.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-white/70">
                {['Assigned calls with one-tap status advance',
                  'Photo and voice-note evidence from the scene',
                  'Start-of-shift readiness and vehicle inspection',
                  'Officer-down SOS, working offline and from any screen'].map((t) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#3b82f6]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Realtime ─────────────────────────────────────────────────── */}
      <div className="border-y border-white/10 bg-white/[0.02]">
        <Section id="realtime">
          <Eyebrow hex="#3b82f6">Realtime, actually</Eyebrow>
          <h2 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            The screen is never out of date.
          </h2>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
            Not polled every thirty seconds, and not refreshed by hand. Positions, statuses, alerts and
            response clocks arrive as they change — which is the only version of &ldquo;live&rdquo; that
            is any use when a decision is being made right now. Everything below is running.
          </p>

          <Realtime />
        </Section>
      </div>

      {/* ── Platform modules ─────────────────────────────────────────── */}
      <Section id="platform">
        <Eyebrow hex="#a855f7">The platform</Eyebrow>
        <h2 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Everything the service runs on, in one place.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Not a dispatch tool with add-ons — the operational, administrative and command work of an
          emergency service, on one login and one record.
        </p>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {MODULE_GROUPS.map((g) => (
            <div key={g.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
              <p className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.16em]" style={{ color: g.hex }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: g.hex }} />
                {g.label}
              </p>
              <ul className="mt-4 space-y-2 text-sm text-white/65">
                {g.items.map((i) => <li key={i}>{i}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Capabilities ─────────────────────────────────────────────── */}
      <div className="border-y border-white/10 bg-white/[0.02]">
        <Section>
          <Eyebrow hex="#22c55e">Built for how the work happens</Eyebrow>
          <h2 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            The hard parts, handled properly.
          </h2>

          <div className="mt-14 grid gap-x-10 gap-y-9 md:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <div key={c.title}>
                <h3 className="flex items-center gap-3 text-lg font-bold">
                  <span className="inline-block h-4 w-1 rounded-full bg-[#22c55e]" />
                  {c.title}
                </h3>
                <p className="mt-2.5 pl-7 text-sm leading-relaxed text-white/60">{c.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── Outcomes ─────────────────────────────────────────────────── */}
      <Section id="outcomes">
        <Eyebrow>The outcome</Eyebrow>
        <h2 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          What changes when it is all one system.
        </h2>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {OUTCOMES.map((o) => (
            <div key={o.title} className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-6">
              <h3 className="text-base font-bold">{o.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-white/60">{o.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Multi-tenant CTA ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden border-t border-white/10">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0f1e] via-[#0b1222] to-[#05050f]" />
        <div className="auth-aurora" style={{ width: 520, height: 520, top: -180, left: '15%', background: 'radial-gradient(circle, rgba(220,53,69,0.4), transparent 65%)' }} />
        <div className="auth-aurora" style={{ width: 460, height: 460, bottom: -200, right: '10%', background: 'radial-gradient(circle, rgba(59,130,246,0.38), transparent 65%)', animationDelay: '-9s' }} />

        <Section className="relative z-10 text-center">
          <h2 className="mx-auto max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            Built for eThekwini. Ready for the next city.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/70">
            Criticomm is multi-tenant to its foundations. A new municipality is provisioned as its own
            isolated organisation — own personnel, own incident numbering, own configuration, own
            branding — on the same deployment, with its data invisible to every other tenant on every
            screen, in every export and in every search.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex h-12 items-center rounded-md bg-[#dc3545] px-8 text-base font-semibold text-white shadow-lg shadow-[#dc3545]/25 transition-colors hover:bg-[#c32b3a]"
            >
              Sign in to the console
            </Link>
          </div>
        </Section>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-t border-white/10 bg-[#05050f]">
        <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-8">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/criticomm-logo.png" alt="Criticomm" className="h-9 w-auto" />
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/50">
                Emergency command platform for dispatch, field response and the record that follows.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-12 gap-y-6 text-sm">
              <div>
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/40">Platform</p>
                <ul className="space-y-2 text-white/60">
                  <li><a href="#why" className="transition-colors hover:text-white">Why it exists</a></li>
                  <li><a href="#flow" className="transition-colors hover:text-white">How it works</a></li>
                  <li><a href="#platform" className="transition-colors hover:text-white">Modules</a></li>
                  <li><a href="#outcomes" className="transition-colors hover:text-white">Outcomes</a></li>
                </ul>
              </div>
              <div>
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white/40">Access</p>
                <ul className="space-y-2 text-white/60">
                  <li><Link href="/login" className="transition-colors hover:text-white">Sign in</Link></li>
                  <li className="text-white/40">Authorised personnel only</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
            <p>&copy; 2026 Kruz Naidoo. All rights reserved. Proprietary software.</p>
            <p className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#22c55e]" />
              All access is audited
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
