# 11 — Armoury, fleet and the end of a shift (Phase 0)

Built 2026-10-04. Migration `0051_armoury_fleet_end_of_shift.sql` must be run in Supabase
before any of it works; until then each screen says so instead of failing.

Phase 0 finishes the police app before the same pattern is used for Fire, EMS and Disaster.
Administrators can now put firearms and vehicles on the register, by hand or from a
spreadsheet, and see them in use. Officers hand their kit back at the end of a shift, and
supervisors see who has what on one board.

## What was built

| Where | What |
|---|---|
| `/police/armoury` (web) | Every firearm: where it is kept, its status, and who holds it with how many rounds and since when. Add, edit, change status (Available / Maintenance / Retired, with a reason), and receive one back for an officer who cannot do it in the app. |
| `/police/armoury/import`, `/police/armoury/template` | The armoury from a spreadsheet, using the same import flow as the staff register. |
| `/admin/vehicles` (web, rewritten) | Every vehicle: driver, status and why, last inspection result, licence disc. Add, edit, change status with a reason. |
| `/admin/vehicles/import`, `/admin/vehicles/template` | The fleet from a spreadsheet. |
| `/shift/today` (web) | Today's shift: who started, readiness, vehicle and inspection, firearm, on duty / ended. Problems first. Vehicles off the road, with "Return to service". Refreshes itself. |
| End of shift (app, `app/end-shift.tsx`) | Hand back the firearm (rounds counted, magazines, unloaded, checks, condition, notes), then the vehicle (odometer, any fault), then end the shift. Reached from Profile → End shift. |
| Sign out (app) | Warns if a firearm is still booked out and offers End shift first. |
| Failed vehicle inspection (app) | "Choose another vehicle". The database has already taken the failed one off the road. |

The old issue register at `/police/firearms` (paper-style authorisations) is unchanged and is
now labelled "Issue register". The Police page's "Firearms booked out" figure now counts the
armoury, which is what the app books against.

## Who can do what

The database decides (`can_manage_armoury`, `can_manage_fleet`); the pages only hide buttons.

| | Armoury | Fleet |
|---|---|---|
| SystemAdmin, SuperAdmin, SystemController | Every department | Every department |
| Admin | Own department | Own department |
| Supervisor, Captain, Fire Chief | Own department | Own department (from Today's shift; `/admin/vehicles` stays administrators-only) |
| System | Own department | No |
| Police officer | Sees nothing here; books out and hands back in the app | Chooses a vehicle in the app |

Pages: `/police/armoury` is for Captain, Supervisor and administrators in Metro Police (and
the global roles). `/shift/today` is for command staff (`SUPERVISORY_ROLES`) and the
SystemController. Both rules are tested in `packages/db/src/roles.test.ts`.

## The rules that keep the record honest

- **Custody moves only through the database functions.** A firearm becomes Issued when the
  officer books it out at the start of a shift (0037). It comes back through
  `return_shift_firearm` (the officer) or `receive_firearm` (the armourer). Nobody can set
  "Issued" or change who holds it by editing the row, and nothing is deleted: a firearm is
  retired instead.
- **Rounds are counted back.** If rounds are short, notes are required and command is
  alerted. A firearm that comes back damaged or failing a check goes to Maintenance, not back
  into service.
- **No end of shift with a firearm out.** `end_shift` refuses until the firearm is returned.
  Signing out anyway is allowed (a dead battery happens), but the shift end is recorded as
  "firearm out", command is alerted, and the board flags it.
- **A failed inspection takes the vehicle off the road by itself.** The
  `apply_vehicle_inspection` trigger sets it Out of Service with the reason, releases the
  officer and alerts command. Only fleet control returns it to service.
- **A vehicle with an officer is left alone.** Its status can change once the shift ends.
- **A fault reported at the end of a shift** sends the vehicle to Maintenance and alerts
  command.
- **Shift ends are permanent records** (`shift_ends`: from the app, from sign-out, or sign-out
  with a firearm still out).

## Importing a register

The same flow as the staff list. The template comes from the page and has drop-downs for type
and department. The file is read and checked in the browser, and nothing is sent until the
administrator confirms with a reason. The database checks every row again and keeps the
import on record (`asset_imports`: file name, fingerprint, reason, counts).

- Firearms are matched by **serial number**, ignoring spaces and dashes. Vehicles are matched
  by **department and unit number**.
- A blank cell never erases anything. Importing the same file again changes nothing.
- An import never changes who holds a firearm or whether a vehicle is on the road.
- Capitals and spacing are tidied: GLOCK becomes Glock, and ND 123 456 matches ND 123-456.
  The register's own spelling is kept, so an all-caps file is not reported as changes.
- Needs a person (the row is held back, the rest go ahead):
  - the same serial or unit twice in the file with different details;
  - a serial already on the register under a different make;
  - a unit already on the register with a different plate;
  - a plate already on another unit, or on two units in the file;
  - an unknown department or type;
  - a year or date that cannot be read.

Code: `packages/db/src/sheet.ts` (headings, rows), `packages/db/src/assets.ts` (columns and
checks), `apps/web/components/register/asset-import.tsx` (the wizard),
`apps/web/lib/register/asset-templates.ts`.

## Today's shift flags

| Flag | Meaning |
|---|---|
| Shift ended, firearm not handed back | Signed out, or ended, with a firearm still booked out. |
| Firearm out over 13 hours | Out longer than a 12-hour shift plus an hour's grace. Measured from booking out, not from midnight, so night shifts are not flagged at 00:00. Set by `FIREARM_OUT_LIMIT_HOURS`. |
| Failed readiness check | Stood down today. |
| Vehicle failed inspection | The vehicle is off the road. |

"Today" for readiness and inspections starts at midnight South African time. Anyone holding a
firearm is on the board, whatever day they took it.

## Before 0051 is run

The pages load. The armoury, fleet, import and board screens show "run migration
0051_armoury_fleet_end_of_shift.sql" where they need it. The app's End shift says ending a
shift in the app is not switched on yet. Sign-out works as before.

## Test day

Run 0051 first, and 0050 if it has not been run. The hosted armoury is empty, so load it
first.

1. **Load the armoury.** Download the armoury template, fill in three firearms and import
   them. Import the same file again: everything should be unchanged.
2. **Start a shift.** The officer (police01.metro) completes readiness, chooses a vehicle,
   passes the inspection and books out a firearm with 30 rounds.
   - Today's shift (captain.metro) shows the vehicle and the firearm.
   - The armoury shows the firearm as booked out, with its holder.
3. **Fail an inspection.** On another vehicle, fail the brakes.
   - The vehicle shows Out of Service, with the reason, on the fleet page and the board.
   - Command gets an alert.
   - The app offers "Choose another vehicle".
4. **Return to service.** The captain uses "Change status" on Today's shift, with a reason.
5. **End the shift.** The officer hands back 28 rounds with a note, and records the odometer
   and a fault.
   - Command gets alerts for the rounds and the fault.
   - The vehicle goes to Maintenance.
   - The board shows "Ended in the app".
6. **Sign out holding a firearm.** Book a firearm out again and sign out.
   - The app warns first. Choose "Sign out anyway".
   - The board flags it and command gets an alert.
   - The captain receives the firearm back on the armoury page.
7. **Doors.** The officer cannot open the armoury or Today's shift. The fire chief sees
   Today's shift for Fire only.

## Known gaps

- **Handing back needs signal.** The end of shift goes straight to the server, not through
  the phone's outbox, and armouries are often in basements. If it fails, the armourer
  receives the firearm on the web.
- **Two firearm records.** The issue register (`firearm_authorizations`) and the armoury
  (`firearms`) are separate, and nothing reconciles them. Decide whether the issue register
  is retired.
- **Back on duty after ending a shift.** Whether an officer can go back on duty the same day
  without repeating start of shift depends on the existing gate (`getShiftGateProgress`).
  Check this on the test day.
- **The armoury page is police-only.** The end of shift works for every department; without a
  firearm it is just the vehicle.
- **Fleet page access.** Command staff below administrator change vehicle status from Today's
  shift, not `/admin/vehicles`.
