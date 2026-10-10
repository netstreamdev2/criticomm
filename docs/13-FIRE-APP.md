# Fire responder app — dashboard and start of shift

Built 6 October 2026. The Expo responder app now selects a dedicated Fire home
and start-of-shift flow for `MetroFire`. Police keeps its existing home, 187(c)
inspection, firearm and bodycam flow. Camera integration work is separate.

## References and scope

Read with the architecture/migration guidance in docs 00–08, the staff account
onboarding in 10, and the Police fleet/shift implementation in 11. The V4 source
is `FirefightersController` and `Views/Firefighters/{StartDuty,MentalCheck,
Vehicles,VehicleChecklist,Signature,OnDuty}.cshtml`. The user's five screenshots
show the same five stages. Those are workflow references, not instructions to
copy the old controller's premature on-duty update or its omission of Fire
equipment from the pass calculation.

This slice covers the firefighter home and shift gate. Fire reports, hydrant
overlays, and appliance crew membership are not expanded here.

## What the firefighter sees

- A Fire & Rescue home that looks like the Police home: the same earth-at-night
  backdrop in dark mode (plain in light mode), panels, blue accent and
  Real-Time Incident Map card. It carries Fire's own content: the station,
  the crew on duty, the connection status, the assigned appliance, and
  schedule and shift-record shortcuts. Fire has no fines.
  (Changed 2026-10-07, look only: the `fire-rescue.jpg` photograph and orange
  accents were removed. See "One look, every department" in
  `07-ENGINEERING-STANDARDS.md`.)
- The existing shared home header, incident totals, My Incidents, My Performance,
  and incident map.
- The start of shift uses the shared step indicator, cards and buttons on a
  plain background, like the Police start of shift.
- Five stages: welcome → six readiness questions → available Fire appliance →
  fuel and 11 checks → review, declaration and finger signature.
- A saved record with server reference, inspector, appliance, fuel and SAST filing
  time. The final action verifies clearance and puts the firefighter on duty.

The 11 checks match V4: lights/siren, tyres, emergency equipment, radio/GPS,
brakes, SCBA, water tank, pump, hoses/nozzles, ladders and turnout gear/PPE.
Every answer starts blank. A No answer is retained; it cannot be converted into
a pass by ticking the declaration. Low fuel is recorded and highlighted without
inventing a new fuel threshold that V4 did not have.

## The incident flow (migration 0059, 2026-10-07)

Run `supabase/migrations/0059_fire_incident_flow.sql` after 0058.

**On the phone (firefighter):**
1. The alert arrives with **Acknowledge & open**, **Navigate** (the phone's map app with directions) and Acknowledge. The notification has the same three buttons. This applies to Police too.
2. **Accept · Mark En Route**, then **Mark On Scene**.
3. On scene, the main button is **File fire report**, with **Mark Transporting** beside it for when the appliance or a casualty is moving. A Fire incident is never closed with a bare "Resolved". The server refuses it from the field, as it does for Police.
4. The **fire report** (`/fire-report/[id]`) uses our UI with the sections of the V4 FirefighterReport:
   - Incident details, and a Response timeline auto-synced from the incident.
   - Narrative, Conditions, Actions & rescue, Support operations.
   - Origin & cause, Property & damage, Casualties, Debrief, Photos.

   The draft is kept on the phone, and filing works offline through the outbox.

   Required: incident type, a summary of at least 20 characters, a cause (default "Under investigation"), details for any injuries or fatalities, and either photos on the incident or a reason there are none.
5. `file_fire_report()` then does the rest in one transaction:
   - checks that the firefighter leads the incident and is on scene;
   - files the report on `firefighter_reports`, as `FR-<incident number>`;
   - works out the dispatch, arrival and time-on-scene figures from the incident's own timestamps;
   - resolves the incident and writes the timeline and audit trail;
   - tells dispatch and command.

   A retry from the outbox returns the report already filed.

**On the console (dispatch, command, case managers):**
- The **incident page** updates live as the crew moves. A strip shows Dispatched → En Route → On Scene → Transporting → Resolved with the times, and Transporting is in the history. Once the incident resolves, the **fire report** shows on the same page.
- **Fire & Rescue** (`/fire`) shows live counts (waiting, en route, on scene, transporting, reports filed today) and the live Fire incidents with each crew's status. Its recent reports link to their incidents.
- **All incidents** (`/incidents`) refreshes itself too.

**Who reads a fire report:**
- Fire and the tenant-wide tier, as before.
- Now also everyone who worked the incident, and case managers.
- A report filed against an incident is permanent. Only a supervisor's review stamp may be added afterwards.

**Not covered:** on a call shared with Police, the lead files their own department's report and closes the incident. A firefighter there as backup does not file a separate fire report.

**Verified:** 21 database checks on 0059, unit tests for the report spec (`packages/db/src/fire-report.test.ts`) and the Fire ladder (`apps/mobile/lib/response.test.ts`), and typecheck and lint on web, mobile and the packages. Not yet seen on a phone against the real database.

## Records and enforcement

Migration `0056_fire_start_of_shift.sql` is required **before using Fire sign-on**.
It is additive and leaves historical inspections unmodified. Run it after 0055:

```sh
node scripts/apply-migration.mjs supabase/migrations/0056_fire_start_of_shift.sql
```

The existing runner needs `SUPABASE_DB_URL`. Do not put database credentials in
the app's `EXPO_PUBLIC_*` settings. Until the migration is installed, Fire shows
an actionable setup error with Retry; it does not fall back to the Police form
or grant clearance.

- Readiness remains in `mental_checks`. A failed assessment keeps the gate
  closed and directs the firefighter to their station officer.
- Appliance reservation uses the existing atomic `assign_vehicle` RPC, restricted
  to the Fire fleet. There is no fabricated/default appliance when the fleet is
  empty. This retains the existing single-officer reservation model.
- Fire inspections use `vehicle_checklists.form_version = 'fire-v1'` and six new
  nullable equipment booleans. Historical nulls never count as checked.
- A Fire-only validation trigger checks identity, role, tenant, department,
  current assignment, readiness, fuel, every answer, declaration, signature and
  required fault notes. It locks the personnel/appliance records and stamps
  the inspector, time, reference and counts server-side.
- Fire-only side effects update the fleet inspection result and add an audit
  entry. Any failed check puts the appliance Out of Service, releases its assigned
  personnel, takes them off duty and sends a command alert. The original Police
  inspection trigger is unchanged. Fleet control returns appliances to service.
- `shift_vehicle_passed_today` has a Fire branch requiring all 11 checks on the
  latest inspection of the currently assigned in-use Fire appliance, today in
  Johannesburg. Its non-Fire branch retains the previous 187(c) rule. The combined
  duty gate still handles Police firearm/bodycam requirements as before.
- Today's shift and Unit Compliance include Fire equipment failures. Existing
  self/command read policies and restrictive tenant isolation apply to the new
  columns; responders cannot update/delete a filed inspection.

## Recovery and limitations

Readiness, appliance assignment and the signed inspection resume from the
server. Unsigned equipment answers, fuel and notes are saved locally per tenant,
user, SAST day and appliance; signatures are drawn afresh after a reload. Drafts
never count as clearance. Successful filing removes that draft.

Starting a shift still needs a connection to reserve the appliance, file the
declarations and verify duty clearance. A failure keeps the form and shows a
retry option. A lost successful response is recovered by re-reading the saved
inspection before resubmission. This is not an offline clearance mechanism.

As in the existing responder gate, checks are daily rather than one new record
per same-day shift. Native push/build settings and existing end-of-shift handling
are unchanged.

## Verification

Workspace gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
Pure Fire rules are tested in `packages/db/src/fire-shift.test.ts`.

Verified locally on 6 October 2026: all four workspace gates passed (lint has
pre-existing web accessibility warnings); 33 database scenarios and six browser
scenarios passed. Android and iOS Hermes bundle exports also passed with
`expo export --platform android --max-workers 2` / `--platform ios --max-workers 2`.
Use a separate temporary output directory for each export. The initial combined
export exhausted local memory; limiting workers resolved that.

The shared Metro resolver now pins `react-dom` alongside the already-pinned
mobile React 18, preventing the console's hoisted React DOM 19 from breaking
Expo web. Duty refresh also re-reads personnel status so the post-sign-on header
does not depend on receiving a realtime event. Police dashboard rendering and
its existing database gate were included in the regression checks.

`scripts/test-fire-shift.mjs` runs the real migration twice against a minimal
isolated PostgreSQL fixture with the existing shift policies, 187(c) validation,
Police inspection effects and combined duty gate. It exercises all 11 failures,
missing answers, unsigned/undeclared forms, forged identity, tenant isolation,
read-only history, date/assignment boundaries and the Police firearm/bodycam
gate. It rolls back the fixture. CI runs it alongside the full migration chain.

```sh
FIRE_TEST_DB_URL=postgres://postgres@127.0.0.1:55456/criticomm_fire_test node scripts/test-fire-shift.mjs
```

`scripts/test-fire-mobile.mjs` drives Expo web at port 8081 with Playwright and
mocked Supabase requests, including signature drawing. No real account is put
on duty. Set `FIRE_PLAYWRIGHT_MODULE` to a Playwright module URL when installed
outside the workspace; screenshots go to the OS temp directory (override with
`FIRE_SCREENSHOT_DIR`). A handset check is still needed for native touch and push.
The shared native incident map uses WebView, which does not render in Expo web;
map interaction must be checked on the handset rather than the browser preview.

## Deployment handoff

The hosted database was checked read-only: Fire equipment columns are not yet
installed. The user chose to apply migration 0056 themselves; no hosted
migration or real duty/inspection data was written during this work. Apply the
migration above after 0055, then reload the app and sign in with a linked
`MetroFire` responder account and an available Fire appliance. Local app preview:
`http://localhost:8081`. The existing web console remains on port 3000.

## Fire safety inspections and the fire command console (2026-10-10)

Run `supabase/migrations/0066_fire_safety_inspections.sql` after 0065.

**Inspections** (`/fire/inspections`): V4's Firefighters/CreateInspection —
Business / Site Name, Contact Person, Site Address, Extinguishers Present &
Serviced? (Yes - Compliant / No - Violation / Not Applicable), Emergency Exits
Clear? (Yes - Compliant / No - Blocked / Violation), Additional Inspector
Notes, and the Final Inspection Result (PASS / FAIL). The server numbers them
`INSP-YYYYMMDD-nnnn`, stamps the inspector and time, and needs notes for a
FAIL or any violation. A FAIL tells fire command. Filed by Firefighter,
FireChief and the admin tier in Fire; read by Fire and the tenant-wide tier;
permanent. Verified by `scripts/test-fire-inspections.mjs` (6 scenarios).

**Console**: the Fire Chief and the Fire admin now have a sidebar (Fire
Dashboard, Fire Reports, Fire Safety Inspections, Hydrants, Public Reports,
incidents, live map, appliances and shift, crews, reports, settings) instead
of the top navigation; `/dashboard` opens `/fire`, as V4's chief board did.
