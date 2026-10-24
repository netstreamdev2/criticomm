# Fire site inspections and Disaster Management on standby

Built 23–24 October 2026. Migrations `0106_fire_site_inspections.sql` and
`0107_disaster_standby.sql` (run after 0105, in that order).

## Why, from the research

**eThekwini Disaster Management** (Director VB Ngubane's presentation to
Parliament, 1 Dec 2025; Adaptation, Resilience and Disaster Management in
eThekwini, Oct 2025; eThekwini vacancy adverts):

- 14 staff. They work a **standby roster**, "continuously on call"; the
  24-hour Emergency Call Centre (031 361 0000) calls them out after hours.
- The **JOC is activated at SAWS warning Level 4 or higher**, and daily in a
  major incident.
- On site they do the **initial and needs assessment**, give relief from its
  findings, open **community halls** as shelters, and produce reports and
  **beneficiary lists**; relief goes through Ward Councillors.
- The city lists "technology to assist with incident management and
  assessments" as a priority project; shelters have "no proper system".

**eThekwini fire safety inspections** (eThekwini Fire By-law, 2022; SAnews and
The Star, 2026):

- Checks by section: escape routes and fire doors (s.18, s.19), equipment
  serviced every 12 months (s.25–s.31), emergency plan and yearly drill
  (s.33), dangerous goods (s.37, s.38, s.43, s.48, s.56), site and access
  (s.5, s.16, s.17, s.34).
- A **compliance notice** (s.81) states the findings, the sections, the
  remedy, the time to comply and the consequences; served by hand, or fixed
  to the premises.
- An **instruction** (s.76) can close or evacuate premises at once; verbal
  instructions are confirmed in writing.
- Re-inspections by risk: immediately, or at 30, 60, 90 days. High-risk sites
  (hospitals, old age homes, malls, stadiums, halls) every 6 or 12 months.
- Appeal to the Municipal Manager within 21 days (s.87).

## Fire: site inspections

- **Phone** (Fire): Profile → My work → **Site inspections**. Sites due
  (never inspected, overdue, notice open, due in 14 days), search the
  register, my inspections. New inspection in four steps: Site → Checks
  (22, Yes/No/N/A, "All yes" per group, last notice's faults flagged) →
  Outcome (days per fault; optional instruction) → Sign off (how served,
  person in charge). Works offline (outbox op `fire_inspection`). No start
  of shift needed: inspectors do not ride appliances.
- **Console**: `/fire/inspections` (due list + all inspections),
  `/fire/inspections/new`, `/fire/inspections/[id]`,
  `/fire/inspections/[id]/notice` (printable compliance notice with the
  uploaded crest), `/fire/inspections/premises` (register; command adds and
  changes sites).
- **Server**: `fire_premises` register; `fire_safety_inspections` gains the
  checklist, notice items, dates, instruction, service, position, client
  ref; `file_fire_inspection()` and `save_fire_premises()` are the only
  writes. Command is told of an instruction, and of a re-inspection that
  finds a notice's fault still there.
- Spec: `packages/db/src/fire-inspection.ts`. The server's own copy of the
  checklist is compared with it by the test.

## Disaster Management: standby and the assessment

- **Start standby** (Shift tab): Welcome → the six readiness questions →
  the number the call centre dials + kit at hand (a "No" is recorded for the
  supervisor, not refused) → On standby. End standby there or on Profile.
- Standby lasts a week (`disaster.max_standby_hours`, default 168, 12–336),
  not the 14-hour shift. The standby register follows the duty switch.
- Wording: ON STANDBY, Call-out, Accept call-out ("You are fit and ready to
  go now?"), "Sent to everyone on standby".
- On site the main step is **Assessment** (one per place: households and
  people affected, displaced, injured, dead, missing; homes destroyed or
  damaged; services hit; needs; relief handed out; hall and people
  sheltered), with **File post-mortem** beside it. Backup officers can
  assess too. Offline (outbox op `disaster_assessment`).
- **Console**: Disaster dashboard shows who is on standby (tap to call, kit
  missing) and the assessed figures per open call; the call page lists every
  place assessed; the dispatch form says "Call out … on standby".
- Spec: `packages/db/src/disaster.ts`.

## Not built yet (decide first)

- **Beneficiary list** per household (names, ID numbers): personal data on
  phones; needs the owner's decision.
- Server-side push for call-outs (today the browser sends the push).

## Verified

- `scripts/test-fire-inspections.mjs` (13 scenarios, 0106 twice) and
  `scripts/test-disaster-standby.mjs` (14 scenarios, 0107 twice), run with
  `CASE_PGLITE_MODULE=file:///…/@electric-sql/pglite/dist/index.js`
  (the first with `node --experimental-strip-types`).
- Unit tests: `fire-inspection.test.ts`, `disaster.test.ts`, the Disaster
  steps in `apps/mobile/lib/response.test.ts`. Type checks and lint clean.
