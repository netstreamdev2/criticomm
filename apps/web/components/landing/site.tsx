import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { TopicFrame } from '@/components/landing/topic-frame';
import { DashboardPeek } from '@/components/landing/dashboard-peek';
import { Decisions, GoingLive, HeroProof, Manual, ShiftDay } from '@/components/landing/depth';
import {
  Desks, Faq, FactsBand, Integrations, Oversight, Security, Services, Stack,
} from '@/components/landing/details';
import { HeroVisual } from '@/components/landing/hero-visual';
import { Realtime } from '@/components/landing/realtime';
import { Storyboard } from '@/components/landing/storyboard';

/**
 * Public landing pages. Content is shared so each topic page uses the same
 * sections that originally appeared on the home page.
 *
 * TopicFrame supplies the shared navigation and dark public-site styling.
 */

export const LANDING_TOPICS = [
  { slug: 'why', label: 'Why', title: 'Why HikTech exists', description: 'The problem, the vision, and the difference one shared emergency record makes.' },
  { slug: 'story', label: 'Storyboard', title: 'The life of a call', description: 'Follow an incident from the first ring through dispatch, field response, and the end of a shift.' },
  { slug: 'decisions', label: 'Decisions', title: 'The decisions behind the platform', description: 'The trade-offs that shape how HikTech is built and how a new organisation goes live.' },
  { slug: 'platform', label: 'Platform', title: 'One platform for the whole service', description: 'Explore the console, responder work, departments, modules, reporting, and integrations.' },
  { slug: 'security', label: 'Security', title: 'Security that follows the record', description: 'See how access, evidence, and accountability work throughout an incident.' },
  { slug: 'manual', label: 'Manual', title: 'The operations manual', description: 'Find the procedures and reference material behind the platform.' },
  { slug: 'faq', label: 'FAQ', title: 'Frequently asked questions', description: 'Answers to the questions people ask first about HikTech.' },
] as const;

export type LandingTopic = typeof LANDING_TOPICS[number]['slug'];

export function landingMetadata(topic: LandingTopic): Metadata {
  const { label, description } = LANDING_TOPICS.find((entry) => entry.slug === topic)!;
  return { title: `${label} · HikTech`, description };
}

const DEPARTMENTS = [
  { label: 'Metro Police', dot: '#f59e0b' },
  { label: 'Fire & Rescue', dot: '#dc3545' },
  { label: 'EMS', dot: '#22c55e' },
  { label: 'Disaster Management', dot: '#3b82f6' },
];


/** Landing page destinations shared by the desktop bar and mobile menu. */
const NAV_LINKS = LANDING_TOPICS.map(({ slug, label }) => ({ href: `/${slug}`, label, slug }));

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
      <span className="lp-uline inline-block h-px w-8" style={{ background: hex }} />
      {children}
    </p>
  );
}

/**
 * A page section. `tint` paints the alternating band, which used to be a
 * hand-written wrapper div around every other section — easy to get wrong when
 * a section is inserted, and it had in fact drifted. Owning it here means the
 * rhythm is visible as one flag per section in the page below.
 */
function Section({
  id, tint = false, children, className = '',
}: { id?: string; tint?: boolean; children: React.ReactNode; className?: string }) {
  const inner = (
    <section
      id={id}
      className={`lp-anchor lp-container px-6 py-20 sm:px-8 lg:py-28 2xl:px-10 2xl:py-32 ${className}`}
    >
      {children}
    </section>
  );
  if (!tint) return inner;
  return <div className="border-y border-white/10 bg-white/[0.02]">{inner}</div>;
}

export function LandingSite({ page = 'home' }: { page?: LandingTopic | 'home' }) {
  const topic = page === 'home' ? null : LANDING_TOPICS.find((entry) => entry.slug === page)!;
  return (
    <TopicFrame topic={topic}>
      {page === 'home' && (
      <div id="top" className="lp-hero relative mx-3 overflow-hidden rounded-[24px] sm:mx-5">
        <div className="lp-hero-grid absolute inset-0" aria-hidden />
        <div className="lp-container relative z-10 grid min-h-[640px] items-center gap-10 px-6 pb-12 pt-36 sm:px-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-12 lg:pb-20 lg:pt-40 2xl:px-14">
          <div>
            <p className="lp-enter lp-d1 mb-7 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
              <span className="h-2 w-2 rounded-full bg-[#ed3b43] shadow-[0_0_16px_#ed3b43]" />
              eThekwini Emergency Services
            </p>
            <h1 className="lp-hero-title lp-enter lp-d2 max-w-[720px] text-[clamp(2.1rem,5.3vw,5.8rem)] font-medium leading-[1.02] tracking-[-0.055em] text-white sm:text-[clamp(3.25rem,5.3vw,5.8rem)]">
              Every emergency.<br />
              <span className="text-[#ed3b43]">One command</span><br />
              platform.
            </h1>
            <p className="lp-enter lp-d3 mt-8 max-w-lg text-base leading-relaxed text-white/60 sm:text-lg">
              HikTech unifies dispatch, field response and the record that follows — across Metro
              Police, Fire &amp; Rescue, EMS and Disaster Management. One call taken. One number issued.
              One trail, from the first ring to the closed case.
            </p>

            <div className="lp-enter lp-d4 mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="lp-ease inline-flex h-12 items-center rounded-full bg-[#ed3b43] px-6 text-sm font-semibold text-white shadow-lg shadow-[#ed3b43]/20 transition-all hover:-translate-y-0.5 hover:bg-[#d52d37]"
              >
                Open the console <span aria-hidden className="ml-3 text-lg">↗</span>
              </Link>
              <Link
                href="/story"
                className="lp-ease inline-flex h-12 items-center rounded-full border border-white/20 bg-white/[0.05] px-6 text-sm font-semibold text-white transition-all hover:border-white/40 hover:bg-white/10"
              >
                See how it saves minutes <span aria-hidden className="ml-3">↗</span>
              </Link>
            </div>

            <div className="lp-enter lp-d5 mt-12 flex flex-wrap gap-2">
              {DEPARTMENTS.map((d) => (
                <span key={d.label} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs text-white/65">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: d.dot }} />
                  {d.label}
                </span>
              ))}
            </div>

            <div className="lp-enter lp-d6">
              <HeroProof />
            </div>
          </div>

          <div className="lp-enter lp-d4 min-w-0">
            <HeroVisual />
          </div>
        </div>
      </div>
      )}

      {/* ── Facts ────────────────────────────────────────────────────── */}
      {page === 'home' && <FactsBand />}

      {page === 'home' && (
        <Section>
          <Eyebrow>Explore HikTech</Eyebrow>
          <h2 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">Find the part of the story you need.</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LANDING_TOPICS.map((entry) => (
              <Link key={entry.slug} href={`/${entry.slug}`} className="lp-card lp-item block p-6 transition-colors hover:border-white/25">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#ff5a68]">{entry.label}</span>
                <h3 className="mt-3 text-lg font-bold">{entry.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{entry.description}</p>
                <span className="mt-5 inline-block text-sm font-semibold text-white/75">Read more →</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* ── The problem ──────────────────────────────────────────────── */}
      {page === 'why' && (
      <Section id="why">
        <Eyebrow>Why it exists</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          A city&rsquo;s emergency response was running on four separate memories.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Not from any single failure — from the ordinary accumulation of systems bought at different
          times for different departments, joined together by a radio and a telephone. It works, right
          up until the moment something needs more than one department at once.
        </p>

        <div className="lp-stagger mt-14 grid gap-5 md:grid-cols-3">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="lp-card relative overflow-hidden p-6">
              <span aria-hidden className="lp-rail absolute left-0 top-0 h-full w-[2px] bg-[#dc3545]/60" />
              <div className="lp-uline mb-4 h-1 w-10 origin-left rounded-full bg-[#dc3545]" />
              <h3 className="text-lg font-bold">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/60">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>
      )}

      {/* ── The vision ───────────────────────────────────────────────── */}
      {page === 'why' && (
      <Section tint id="vision">
        <Eyebrow hex="#3b82f6">The vision</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          One platform that holds the whole picture — and never loses a minute of it.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Three commitments shaped every decision in the build. They are the reasons the system is
          put together the way it is, and each of them costs something to keep.
        </p>

        <div className="lp-stagger mt-14 grid gap-6 lg:grid-cols-3">
          {PILLARS.map((p, i) => (
            <div key={p.kicker} className="lp-card relative p-7">
              <span
                aria-hidden
                className="lp-rail absolute left-0 top-7 h-12 w-[3px] rounded-r"
                style={{ background: p.hex }}
              />
              <p className="lp-pop text-5xl font-bold leading-none text-white/10">0{i + 1}</p>
              <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: p.hex }}>
                {p.kicker}
              </p>
              <h3 className="mt-2 text-xl font-bold leading-snug">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/60">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>
      )}

      {/* ── The life of a call ───────────────────────────────────────── */}
      {page === 'story' && (
      <Section id="flow">
        <Eyebrow hex="#22c55e">How it works</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          The life of a call.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Eleven steps from the first ring to the closed case. Red is the control room, blue the field,
          green the case file. The automation engine watches every step and escalates any that stalls.
        </p>

        <ol className="lp-stagger lp-pops mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {LIFECYCLE.map((s) => (
            <li
              key={s.n}
              className="lp-card flex items-start gap-4 p-5"
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

        <div className="lp-card lp-reveal mt-8 p-6 sm:p-7">
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
      )}

      {/* ── Storyboard ───────────────────────────────────────────────── */}
      {page === 'story' && (
      <Section tint id="story">
        <Eyebrow>How it saves lives</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
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
      )}


      {/* ── Three decisions ──────────────────────────────────────────── */}
      {page === 'decisions' && (
      <Section id="decisions">
        <Eyebrow hex="#dc3545">The decisions</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Three choices that shaped everything else.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Every one of these had an easier alternative that most systems take, and every one costs
          something real to hold. They are here with their costs attached, because a platform that
          only lists its advantages is telling you about its brochure rather than its architecture.
        </p>
        <Decisions />
      </Section>
      )}

      {/* ── Two surfaces + console peek ──────────────────────────────── */}
      {page === 'platform' && (
      <Section tint id="console">
        <Eyebrow hex="#f59e0b">A look inside</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          A console for the room. An app for the vehicle.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          The command dashboard puts the operational day on one screen — strength on duty, coverage,
          approvals waiting and calls running past their target. The app carries the same incident into
          the vehicle.
        </p>

        <DashboardPeek />

        <div className="mt-6">
          <div className="lp-stagger grid gap-6 lg:grid-cols-2">
            <div className="lp-card p-8">
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

            <div className="lp-card p-8">
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
      )}

      {/* ── Realtime ─────────────────────────────────────────────────── */}
      {page === 'platform' && (
      <Section id="realtime">
        <Eyebrow hex="#3b82f6">Realtime, actually</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          The screen is never out of date.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Not polled every thirty seconds, and not refreshed by hand. Positions, statuses, alerts and
          response clocks arrive as they change — which is the only version of &ldquo;live&rdquo; that
          is any use when a decision is being made right now. Everything below is running.
        </p>

        <Realtime />
      </Section>
      )}


      {/* ── The shift ────────────────────────────────────────────────── */}
      {page === 'story' && (
      <Section id="shift">
        <Eyebrow hex="#a855f7">A shift, end to end</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          One incident is the easy part. A whole shift is the job.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          The storyboard follows a single call. This is the twelve hours around it — the readiness
          gate before anybody takes a job, the board at handover, the quiet hours where the platform
          does the remembering, and the file that is already complete when the shift ends.
        </p>
        <ShiftDay />
      </Section>
      )}

      {/* ── The services ─────────────────────────────────────────────── */}
      {page === 'platform' && (
      <Section tint id="services">
        <Eyebrow hex="#f59e0b">The services</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Four services, four sets of paperwork, one incident.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Each service keeps the forms it is legally and operationally required to keep — a patient care
          report is not a fire report, and neither is a charge sheet. What they share is the incident
          underneath, so routing a call to three of them produces one file with three departments
          writing into it, not three files that disagree.
        </p>
        <Services />
      </Section>
      )}

      {/* ── Platform modules ─────────────────────────────────────────── */}
      {page === 'platform' && (
      <Section id="platform">
        <Eyebrow hex="#a855f7">The platform</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Everything the service runs on, in one place.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Not a dispatch tool with add-ons — the operational, administrative and command work of an
          emergency service, on one login and one record.
        </p>

        <div className="lp-stagger mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {MODULE_GROUPS.map((g) => (
            <div key={g.label} className="lp-card p-6">
              <p className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.16em]" style={{ color: g.hex }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: g.hex }} />
                {g.label}
              </p>
              <ul className="mt-4 space-y-2 text-sm text-white/65">
                {g.items.map((i) => <li key={i} className="lp-item cursor-default">{i}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Section>
      )}

      {/* ── The desks ────────────────────────────────────────────────── */}
      {page === 'platform' && (
      <Section tint id="desks">
        <Eyebrow>Who is on it</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Twenty-four roles, five desks.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          A role is not a job title here — it is a set of doors. What each one may open is decided by
          the route matrix in code and row-level security in the database, so the answer is the same
          whether somebody arrives through a screen, a bookmark or the API.
        </p>
        <Desks />
      </Section>
      )}

      {/* ── Reporting and oversight ──────────────────────────────────── */}
      {page === 'platform' && (
      <Section id="oversight">
        <Eyebrow hex="#f59e0b">Reporting and oversight</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Every question, and the screen that answers it.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          A record is only worth keeping if somebody can interrogate it afterwards. These are the
          questions a command team, a council committee and an inquiry actually ask — and where each
          one is answered without anybody writing a query.
        </p>
        <Oversight />
      </Section>
      )}

      {/* ── Security ─────────────────────────────────────────────────── */}
      {page === 'security' && (
      <Section id="security">
        <Eyebrow hex="#22c55e">Security</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          The database decides, not the screen.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Emergency records are evidence. They get read back in disciplinary hearings, inquests and
          court, sometimes years later — so the question is never only &ldquo;can this person see
          it&rdquo; but &ldquo;can anyone prove what it said and who changed it&rdquo;.
        </p>
        <Security />
      </Section>
      )}

      {/* ── Integrations ─────────────────────────────────────────────── */}
      {page === 'platform' && (
      <Section tint id="integrations">
        <Eyebrow hex="#3b82f6">Integrations</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          It plugs into what the city already runs.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Nine external systems, each one an admin switch rather than a deployment: radio, SMS, two
          camera platforms, two traffic feeds and the assistant&rsquo;s AI providers.
        </p>
        <Integrations />
      </Section>
      )}

      {/* ── Stack ────────────────────────────────────────────────────── */}
      {page === 'platform' && (
      <Section id="stack">
        <Eyebrow hex="#94a3b8">What it is built on</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Boring where it matters.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Nothing here is chosen to be interesting. An emergency platform is judged on the night it
          is needed, so every layer is something with a long, dull, well-understood failure record.
        </p>
        <Stack />
      </Section>
      )}


      {/* ── The manual ───────────────────────────────────────────────── */}
      {page === 'manual' && (
      <Section tint id="manual">
        <Eyebrow hex="#94a3b8">Written down</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Nothing here lives only in someone&rsquo;s head.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          The difference between a system a municipality owns and one it is merely renting is whether
          anybody but the original developer can run it. Every role, every task and every procedure is
          documented — and the document is generated from the codebase, so it stays true.
        </p>
        <Manual />
      </Section>
      )}

      {/* ── Outcomes ─────────────────────────────────────────────────── */}
      {page === 'why' && (
      <Section id="outcomes">
        <Eyebrow>The outcome</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          What changes when it is all one system.
        </h2>

        <div className="lp-stagger mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {OUTCOMES.map((o) => (
            <div key={o.title} className="lp-card p-6">
              <span aria-hidden className="lp-uline mb-4 block h-px w-12 origin-left bg-[#ff5a68]" />
              <h3 className="text-base font-bold">{o.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-white/60">{o.body}</p>
            </div>
          ))}
        </div>
      </Section>
      )}


      {/* ── Going live ───────────────────────────────────────────────── */}
      {page === 'decisions' && (
      <Section tint id="go-live">
        <Eyebrow hex="#22c55e">Going live</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          From an empty organisation to a running control room.
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/65">
          Eight steps, none of which require a developer. A new municipality is provisioned,
          configured and trained from the same console its supervisors will use every day.
        </p>
        <GoingLive />
      </Section>
      )}

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      {page === 'faq' && (
      <Section id="faq">
        <Eyebrow hex="#3b82f6">Questions</Eyebrow>
        <h2 className="lp-reveal max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          The eight things people ask first.
        </h2>
        <Faq />
      </Section>
      )}

      {/* ── Multi-tenant CTA ─────────────────────────────────────────── */}
      <section className="hk-topic-cta hik-home-glass" aria-labelledby="hk-topic-cta-title">
        <div>
          <p className="hik-home-eyebrow"><span /> BUILT TO SCALE</p>
          <h2 id="hk-topic-cta-title">Built for eThekwini.<br /><em>Ready for the next city.</em></h2>
        </div>
        <div>
          <p>HikTech is multi-tenant to its foundations. A new municipality is provisioned as its own isolated organisation &mdash; own personnel, own incident numbering, own configuration, own branding &mdash; on the same deployment, with its data invisible to every other tenant on every screen, in every export and in every search.</p>
          <Link href="/login" className="hik-home-primary-cta">Sign in to the console <ArrowUpRight size={18} /></Link>
        </div>
      </section>

    </TopicFrame>
  );
}
