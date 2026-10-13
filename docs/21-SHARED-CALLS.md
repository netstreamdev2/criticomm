# One call, several departments

A call can be sent to more than one department, for example a truck fire
with the driver trapped goes to Police, Fire & Rescue and EMS. Each of those
departments now has its own part of the call (`0073_department_parts.sql`).
It is still one call, with one number and one link (`/incidents/<id>`).

## What changed

| | Before | Now |
|---|---|---|
| **Queue** | When Police dispatched, the call left the Fire queue too. | The call stays in each desk's queue until that desk dispatches its own crews. The row shows what the others have done, for example "Metro Police · Dispatched". |
| **Leading** | Once a police officer accepted, Fire could not send its crews. Firefighters could only join as backup to Police. | Each department has its own lead: the first of its crew to respond, or the crew member its desk assigned. |
| **Report** | The police report resolved the whole call, even with Fire still on scene. | Each report finishes only its department's part: the police report, the fire report, the patient report or the post-mortem. |
| **Resolved** | When any report was filed. | When every department has filed its report or been marked not needed. Only then can the case manager review and close it. |
| **Cancelling** | Any desk could close a live call. | A department's desk can only cancel a call that no other department still has. Otherwise it marks its own department "Not needed". The control room can still cancel any call. |
| **On duty** | The Metro Police desk counted Fire and EMS crews as on duty. | A department's desk sees and counts only its own crews. The control room and organisation admins see every department. |

## Not needed

When a department isn't needed on a call (for example, EMS sent to a fire
where nobody is hurt), its desk or command marks it **Not needed** on the
call page and says why. The crew gets a "stand down" alert.

- Before the crew is on scene: its desk, its command, or the control room.
- Once the crew is on scene: its command only (Supervisor, Captain, Fire
  Chief, Admin). Otherwise the lead files the report.
- The last department on a call that nobody has filed a report for can't be
  marked not needed. The call is cancelled instead, with the reason.

## Where to see it

- **Pending queue:** each call shows every department's part. A
  department's desk sees only the calls waiting for it.
- **Dispatch page:** a department already being worked, or finished, can't
  be sent again. The other departments still can.
- **Call page:** "Departments on this call" shows, for each department, who
  dispatched it, who leads it, when they arrived and whether the report is
  in. The buttons for dispatch, marking the crew's steps and Not needed
  appear only for the departments you direct.
- **Phone:** a crew member sees the call through their own department: their
  lead, their status and their report. Once their department has finished,
  the call is off their list, and they can sign off even while another
  department is still working it.

## Setting it up

Run `0073_department_parts.sql` in the Supabase SQL editor (after 0072).
It sets up a part for each department on every call already on record,
keeping where each department is. Until it runs, the console and the app
work as before.

## Test script

1. Log a call for Metro Police and Fire & Rescue.
2. As the Metro Police dispatcher, dispatch it. It leaves the Police queue
   and stays in the Fire queue, marked "Metro Police · Dispatched".
3. On the phone, a police officer accepts. As the Fire dispatcher, dispatch
   Fire. This now works.
4. A firefighter accepts. They lead Fire, not back up Police.
5. The police officer goes on scene and files the police report. The call
   is still live, and the call page shows Police "Report filed", Fire "En
   Route". The police officer can sign off. The firefighter can't.
6. Try to close the case as the case manager: refused, because Fire is still
   working it.
7. The firefighter goes on scene and files the fire report. The call is
   resolved, and the case manager can review and close it.
8. Log another call for Police and EMS. As the EMS dispatcher, mark EMS
   "Not needed" with a reason. It leaves the EMS queue. Try to cancel the
   whole call as the EMS dispatcher: refused, because Police still has it.

## How it is built

| Piece | Where |
|---|---|
| Parts, dispatch, responding, reports, not needed, cancelling, crews on duty | `supabase/migrations/0073_department_parts.sql` |
| The call as one department sees it (mirrors the database) | `packages/api/src/incidents/parts.ts` |
| Queue, call reads, assigned calls | `packages/api/src/incidents/index.ts` |
| Who directs a department | `canDirectDepartment`, `commandsDepartment` in `packages/db/src/roles.ts` |
| Queue, dispatch page, call page | `apps/web/app/(app)/dispatch/`, `apps/web/app/(app)/incidents/[id]/departments-card.tsx` |
| Criti on a department's desk | `packages/api/src/criti/board.ts` |

## Verified

- `scripts/test-department-parts.mjs` runs 0073 twice on Postgres (PGlite),
  with the real report tables. All 12 scenarios pass:
  - calls already on record are carried over
  - each desk's queue
  - Fire dispatching after a police officer has accepted
  - each department leading its own part
  - the police report finishing only Police, and the fire report then
    resolving the call
  - the patient report and the post-mortem
  - Not needed
  - cancelling
  - assigning
  - the desk marking a crew's steps
  - crews on duty per desk
  - who can read and change the parts
- Unit tests and type checks pass for the packages, the console and the
  phone.
- The queue, dispatch page and call page load on the console before 0073 is
  run.

Not yet checked on the hosted database or on a phone.
