# EMS paramedic app — dashboard and start of shift

Built 7 October 2026. The Expo responder app now gives `Medical` (EMS) staff
their own home and start of shift. It looks exactly like Police and Fire (see
"One look, every department" in `07-ENGINEERING-STANDARDS.md`); only the
content differs. Incident handling for EMS (the patient care report and
hospital handover) is the next phase and is **not** part of this one.

## References

The V4 source is `ShiftController` (`MentalCheck`, `VehicleSelection`,
`VehicleChecklist`, and the Medical-only `InventoryCheck`, see
`00-RECONNAISSANCE.md`). The user's four screenshots of the old app show the
welcome card ("Metro EMS · Medical Response"), the six-question cognitive test,
"Shift Start: Inventory Check" with Equipment and Consumables, and the
"Sanitization Check" modal. The old app exists only as a compiled build, so the
screenshots and the reconnaissance notes are the reference.

## What the paramedic sees

**Home** (`components/ems-home.tsx`): the shared `ServiceHome` that Fire also
uses, with EMS words: "Emergency Medical Services", the base, crew on duty,
connection, **Your ambulance** with duty status, My incidents, My performance,
the real-time incident map, and schedule / shift-record shortcuts. No fines.

**Start of shift** (`components/ems-shift.tsx`), five steps:

1. **Welcome.**
2. **Readiness**: the same six questions as every department. A No needs a
   note and stands the paramedic down until a supervisor deals with it.
3. **Ambulance**: pick an available EMS ambulance (the atomic `assign_vehicle`).
4. **Vehicle**: fuel level and the five V4 vehicle checks (lights & siren,
   tyres, emergency equipment, radio / GPS, brakes), Yes or No each.
5. **Stock**: V4's eight items, ticked as on board and ready:
   - Equipment: Oxygen Cylinders (Full), Defibrillator / AED (Battery OK),
     Suction Unit (Functional), BVM & Masks (Adult/Ped).
   - Consumables: Jump Bag (Fully Stocked), IV Fluids & Giving Sets,
     Drug Box (Seals Intact), Gloves & PPE.

   Then a one-tap declaration ("I checked this ambulance and its stock
   myself"), **Confirm stock & finish**, and V4's question: **Does the
   ambulance require cleaning?**

| Result | What happens |
|---|---|
| All 13 pass, **No** to cleaning | Cleared. "Go on duty & open dashboard". |
| A vehicle check fails, or **Yes** to cleaning | Filed. The ambulance goes **Out of Service** ("Off road for cleaning" / the failed checks), the paramedic is released from it and stays off duty, command gets a High alert. Fleet control returns it to service. The paramedic picks another ambulance. |
| Stock not all ticked | Filed. The paramedic **keeps** the ambulance but is not cleared; command gets a Medium alert. "I've restocked — check again" files a new check. A reload reopens the stock page with the gaps listed. |

Anything failed or short needs a note before filing. Every answer starts
blank; nothing defaults to Yes.

**Phones and tablets.** Content is centred (up to 880 px on the shift, 960 px
on the home). From 700 px wide the readiness questions, ambulances, vehicle
checks and the two stock columns sit side by side, as in V4's inventory page;
on a phone they stack. The home map is taller on a tablet. Checked at 390 px,
820 × 1180 (portrait) and 1180 × 820 (landscape), dark and light.

## Records and enforcement — migration 0060

Run `supabase/migrations/0060_ems_start_of_shift.sql` after 0059. It is
additive and safe to re-run. Until it is installed, the EMS start of shift
shows "ask your administrator to apply migration 0060" with Retry and keeps the
gate closed; it never falls back to the Police form.

- One row in `vehicle_checklists` per check, `form_version = 'ems-v1'`, with
  nine new nullable columns: the eight stock items and `requires_cleaning`.
- `validate_ems_inspection` (before insert) checks role, department, tenant,
  the signed-in paramedic, the ambulance they currently hold (In Use),
  today's readiness, fuel, all 13 answers, the cleaning answer, the
  declaration, and a note for anything failed or short. It stamps the time,
  inspector name, reference (`EMS-YYYYMMDD-xxxxxxxx`) and counts on the server.
- `apply_ems_inspection` (after insert) records the result on the ambulance
  (`pass` / `faults` / `fail`), writes the audit entry, and applies the table
  above.
- `shift_vehicle_passed_today` gains a Medical branch: the **latest** EMS check
  today, for the ambulance the paramedic holds, must pass all 13 and say no
  cleaning. The Fire and Police branches are copied unchanged. A 187(c) sheet
  does not count for EMS.
- Filed checks cannot be edited or deleted. The phone chooses each record's id,
  so a retry after a lost response finds the record instead of filing twice.
- Console: **Today's shift** and **Unit compliance** judge EMS checks by the
  same rule and list short stock and "requires cleaning" as defects.

Unsigned answers are kept on the phone per tenant, user, SAST day and
ambulance until filed; a draft never counts as clearance.

## Verification

- `scripts/test-ems-shift.mjs`: 40 scenarios on in-memory Postgres (PGlite)
  with the real 0036, 0037, 0051, 0054 and 0056 functions and 0060 applied
  twice: every vehicle failure, every stock item, cleaning, missing answers,
  declaration, notes, forged user/tenant/ambulance, a firefighter or police
  officer trying to file one, edits and deletes refused, tenant isolation,
  old day / released ambulance, and Fire and Police still behaving as before.
  `EMS_PGLITE_MODULE=file:///…/@electric-sql/pglite/dist/index.js node scripts/test-ems-shift.mjs`
- `scripts/test-ems-mobile.mjs`: 9 browser scenarios against Expo web (port
  8081) with mocked Supabase, phone and tablet sizes. Fire's own
  `test-fire-mobile.mjs` still passes (6 scenarios) after the shared home.
- `packages/db/src/ems-shift.test.ts` for the rules; typecheck and lint on
  web, mobile and the packages.

**Not yet done:** run against the real database (0060 is for the user to
apply), and a look on a real phone and tablet. The app is still locked to
portrait (`app.json`); tablets in landscape need that changed in a new build.

## The incident flow (migration 0063, 2026-10-09)

Run `supabase/migrations/0063_ems_incident_flow.sql` after 0062. V4 reference:
`ParamedicsController`, `Views/Paramedics/{Create,Records,PrintableReport}`,
the medical branch of `Views/Notifications/Create.cshtml` (the field state
machine) and the EMS triage block of `Views/ControlRoom/LogNew.cshtml`.

**Call intake (console).** As V4: "Is the caller the patient?" (required); when
No, patient name(s), with + for more, saved as `patient_name` ("Unknown / Not
Provided" when none is typed; the caller's name when Yes). EMS triage: number
of victims 0–4 or Multiple (5+), and the P1–P4 medical severity code with V4's
wording. Both are required unless "No injuries / EMS not required" is ticked.

**On the phone (paramedic or doctor).**
1. The alert: Accept incident, Acknowledge, Navigate.
2. **Accept · Mark En Route**, then **Mark On Scene**.
3. On scene the main button is **File patient report**, with **Mark
   Transporting** beside it. A paramedic or doctor can never close an EMS call
   with a bare Resolved; the server refuses it. On a call shared with Police
   the paramedic lead files the PCR, not the police report.
4. The ePCR (`/pcr/[id]`) has V4's sections, in order, from `packages/db/src/pcr.ts`:
   Personal Information, Scene & Transport, Crew Assignment, Multiple
   Casualties, Clinical Assessment & Psychological Presentation, Signs Symptoms
   & Vitals (with the GCS total), Interventions & Medication, Vehicle Inventory
   & Restock Checklist, Sign Off & Handover (three pads) and Site Media.
   Filled in from the call as V4 did: patient name, location with suburb and
   city, MOI, and the scene assessment ("[Dispatch Alert]…[Severity]…
   [Reported Casualties]…[Dispatcher Notes]"). The draft is kept on the phone;
   filing goes through the outbox.
5. V4's last question: **Does the vehicle require cleaning?** "Yes - mark as off
   road" or "No - ready for next call".

Required: chief complaint, care level, patient response, the lead paramedic's
signature, the cleaning answer, and the destination when transported by
ambulance or air.

**`file_pcr()`** in one transaction: checks EMS, the lead, on scene; files
`paramedic_reports` as `PCR-<incident number>` with its vitals,
interventions and medical history records, the ambulance and V4's total
response time; resolves the incident; timeline, audit and the dispatch /
command alert. Cleaning Yes puts the ambulance Out of Service ("Off road for
cleaning"), releases the crew and alerts command (High), as the start of shift
does. Unticked stock alerts command (Medium). A replay returns the filed report.

**Console.** `/medical`: live EMS calls with crew status, ambulances off road
for cleaning, recent reports. `/medical/pcr`: the Clinical Archive (Incident
Ref, Patient, Arrival, Destination, Care Level, Paramedics) with search, care
level, destination and dates. The PCR shows on the incident page, in the case
review line and in the incident PDF. The console's "New Manual Entry" and Edit
use the same spec. A filed PCR is never deleted or re-linked and locks when the
case is closed; until then EMS may correct it, as V4 allowed. Crew, EMS and
case managers read it with its clinical records; other departments do not.

**Verified:** `scripts/test-ems-pcr.mjs` (11 scenarios on PGlite with the real
0001 tables, 0063 applied twice), `packages/db/src/pcr.test.ts` (8),
`apps/mobile/lib/response.test.ts` (EMS ladder), typecheck and lint.
**Not yet done:** a run on a phone, and 0063 on the hosted database.

## Hospital handover and the Doctor role (migration 0064, 2026-10-10)

Run `supabase/migrations/0064_hospital_handover.sql` after 0063. V4 had a
`LegalHandover` model (receiving hospital, doctor, signature, time, patient
status at handover) that no screen used; this builds it.

**Two EMS roles, no overlap.**
- **Paramedic** is the EMS crew: the phone app, start of shift, ambulance,
  calls, the patient report.
- **Doctor** is the receiving doctor at the hospital. They sign the handover
  on the crew's phone. Their own login is read only: on the phone, a single
  Patient Handovers screen (no start of shift, no tabs, never dispatched); on
  the console, a two-item sidebar (Hospital Handovers, Clinical Archive) and
  no New, Edit or Restock. `file_pcr()` and the EMS write rules no longer
  accept Doctor. V4 seeded Doctor only as a coverage login and locked it out
  of `ParamedicsController`, so nothing a V4 doctor could do is lost.

**The handover.** When the patient is taken by Ambulance (Ground) or HEMS
(Airlift), the PCR's Hospital Handover section appears: Receiving Hospital
(the destination), Hospital Arrival / Handover Time, Receiving Doctor, Patient
Status at Handover (500 characters), and the doctor signs the Attending
Doctor pad. All are required then; none when treated on scene or by private
transport. `file_pcr()` checks the same and writes the timeline line
"patient handed over to <doctor> at <hospital>, HH:MM".

**The record.** The handover lives on the report (`handover_doctor_name`,
`handover_patient_status`) and on `legal_handovers`, one per report
(`pcr_id`), written and kept in step by the `sync_pcr_handover` trigger,
including console corrections. Nobody writes `legal_handovers` directly. It
reads like its report (crew, EMS, case managers, the doctor; not Police) and
locks with it when the case is closed.

Also fixed: 0002's EMS write rules checked the role only on changes, so any
EMS account could add records. 0064 checks it on new records too.

**Verified:** `scripts/test-ems-handover.mjs` (8 scenarios, 0063 then 0064
applied twice), `packages/db/src/pcr.test.ts` (9) and `roles.test.ts`.
