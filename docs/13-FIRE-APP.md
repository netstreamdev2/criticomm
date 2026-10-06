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

- A Fire & Rescue home with the original MVC `fire1.jpg` photograph bundled as
  `apps/mobile/assets/fire-rescue.jpg`, ember accents, and light/dark support.
- The existing shared home header, incident totals, My Incidents, My Performance,
  and incident map, plus their assigned appliance, duty/connectivity status,
  department on-duty count, schedule and shift-record shortcuts.
- Five stages: welcome → six readiness questions → available Fire appliance →
  fuel and 11 checks → review, declaration and finger signature.
- A saved record with server reference, inspector, appliance, fuel and SAST filing
  time. The final action verifies clearance and puts the firefighter on duty.

The 11 checks match V4: lights/siren, tyres, emergency equipment, radio/GPS,
brakes, SCBA, water tank, pump, hoses/nozzles, ladders and turnout gear/PPE.
Every answer starts blank. A No answer is retained; it cannot be converted into
a pass by ticking the declaration. Low fuel is recorded and highlighted without
inventing a new fuel threshold that V4 did not have.

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
