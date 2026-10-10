# Disaster Management — start of shift, field flow and post-mortem

Built 10 October 2026. Migration `supabase/migrations/0065_disaster_flow.sql`
(run after 0064). V4 references: `DisasterController` (Dashboard, Dispatch
Resources, Periodic Update, Partners, PostMortem, GetDashboardStats),
`Views/Disaster/PostMortem.cshtml`, `ShiftController` (Disaster: "STEP 1 OF 2",
readiness then on duty) and Operations Manual chapter 17.

## On the phone (Disaster officer)

- **Home**: the same layout as Police, Fire and EMS ("DISASTER MANAGEMENT"),
  with the shift card in place of a vehicle.
- **Start of shift**: V4's two steps, the welcome and the six readiness
  questions, then on duty. No vehicle form; `shift_vehicle_passed_today` has a
  Disaster branch that needs none. A No stands the officer down.
- **Incidents**: Accept · Mark En Route, Mark On Scene, then **File
  post-mortem**. A Disaster officer cannot close an incident with a bare
  Resolved (the server refuses it).
- **Post-mortem** (`/post-mortem/[id]`): V4's Official After-Action Report —
  Incident Overview (type and location from the incident, Start Time, Resolved
  Time, the duration), Impact Metrics (Confirmed Injuries, Confirmed
  Fatalities, Displaced Persons), Operational Analysis (Root Cause Analysis,
  Lessons Learned / Recommendations, Reporting Officer Name). The incident's
  timeline is shown and filed with it. Draft kept on the phone; filing goes
  through the outbox. Spec: `packages/db/src/post-mortem.ts`.

## On the console (Disaster desk and admin)

- **Sidebar** for Disaster officers and the Disaster admin: Disaster
  Dashboard, Dispatch Resources, Post-Mortems, Mutual-Aid Partners, incidents,
  live map, shift and crews, reports, settings. `/dashboard` opens `/disaster`.
- **Dashboard**: V4's figures — active incidents, displaced people, average
  response (call to deployment), resources dispatched — the map, wind, and
  the deployment monitor with periodic updates.
- **Dispatch Resources**: choose an open incident (V4's dropdown); dispatching
  again updates that incident's deployment, as V4 did.
- **Post-Mortems**: the register; command (Supervisor, Admin) can file the
  report for a deployed incident from here, as V4's desk did.
- The post-mortem shows on the incident page, in the case review line and in
  the incident PDF.

## `file_post_mortem()`

Checks Disaster Management, a Disaster incident, and either the lead officer
on scene or command on a deployed incident; validates the times (in order,
not in the future), whole counts, and the three required answers. Files
`post_mortem_reports` as `PM-<incident number>` with the timeline snapshot
(incident history and deployment updates, SA time), resolves the incident,
writes the timeline line and audit trail, and tells dispatch and command. A
replay returns the filed report. Readers: Disaster, the tenant-wide tier, the
crew and case managers. Never deleted or re-linked; correctable until the
case is closed, with the duration recomputed. 0002's write rules checked the
role only on changes; new records are checked too.

**Verified:** `scripts/test-disaster-flow.mjs` (8 scenarios, 0065 applied
twice), `packages/db/src/post-mortem.test.ts` (5), the Disaster ladder in
`apps/mobile/lib/response.test.ts`.
