# 15 — Case management: the end of a call's life

Built 2026-10-08. Migration `0061_case_review_and_close.sql` must be run in Supabase (after
0060) for closing to work. Until then the console loads, but the case manager cannot close a
case and sees only control-room calls.

## The life of a police call

| Step | Who | Where | Status after |
|---|---|---|---|
| Log the call | Call-taker (IncidentLogger, ControlRoom) | Console → Log Incoming Call | Pending Dispatch |
| Dispatch it | Dispatcher | Pending Queue → Assign | Dispatched |
| Respond | Officer (or Captain) | App → Accept · En Route → On Scene | En Route → On Scene |
| File the report | The accepting officer | App → File incident report | **Resolved** |
| Review and close | Case manager (or command, or the desk) | Case file → Close | **Closed** (Reviewed) |

A call that will never have a report (hoax, duplicate, caller cancelled) is closed by the desk or
command from the case file, **with a reason**: Closed (Cancelled). The officers on it are told to
stand down. A case manager does not cancel live calls.

## What was broken, and what changed

| Was | Now |
|---|---|
| A reported call could never be Closed: the console hid the button on Resolved, and `close_case()` refused the CaseManager role. | `close_case()` accepts case managers for Resolved calls and records who, how (`close_kind`) and why (`close_reason`). The case file shows a **Case review** card with the report summary and the close form. |
| The control-room case manager could not see Metro Police calls, their report, timeline, evidence or audit trail. | A control-silo case manager reads every case in their tenant (`is_tenant_case_reviewer()`, extended `can_work_incident()`, `incidents_case_review_read`, `audit_logs_case_read`). A department case manager keeps their department. |
| The incident page's "Set status" buttons let the desk mark a police call Resolved with no report, and threw an error for viewers and case managers. | Only the dispatch desk sees **Mark for the crew** (En Route, Arrived, On Scene, Transporting), and only on a dispatched live call. The database refuses Resolved without the report on police and fire calls, refuses Closed outside `close_case()`, and refuses moving a finished call back to live. |
| A Captain responding from the phone was never the accepting officer, so their report was refused. | Captains respond as field officers. |
| Case manager figures read `closed_at` only and counted "today" in UTC. | The dashboard counts Resolved (awaiting review), live, closed today and reports filed today from SA midnight, with average call → resolved and report → closed times. |
| The case PDF had no officer report and UTC times; one emoji in a narrative failed the whole PDF. | The PDF carries the police report (the same readout as the screen), the closure, SA times, and the full audit trail. Text the standard font cannot draw is replaced, never fatal. |
| The case audit page filtered on one entity type, hiding the database functions' events (logged, routed, report, closed). | Both entity types; search by incident number or id. One number can name two cases (numbers are unique per department per day); both are shown. |
| All Incidents and Reports Archive, for a department user, hid control-room calls dispatched to that department. | A department's incidents are the ones it owns or was sent. Search text can no longer break the filter. |
| Web "My Incidents" listed calls by the officer's vehicle (pre-0040) and offered a Resolved the database refuses. Web "Start of Shift" saved a check the duty gate no longer accepts and reserved a vehicle. | Web **My calls** lists what the phone lists and points to the app for responding. Web **Start of shift** shows today's progress; the start of shift itself is done in the app. |

## Case Management (console)

The case manager now has their own sidebar:

- **Case Dashboard** `/case-manager`: awaiting review, live calls, closed today, reports filed
  today, average times, a by-department breakdown, the review queue, live calls and recently closed.
  Live: it re-renders when a report lands or a case closes.
- **Awaiting Review** `/case-manager/review`: Resolved calls, longest waiting first, with the
  report type and officer. **Review** opens the case file at its review card.
- **Live Cases** `/case-manager/open`, **Closed Cases** `/case-manager/closed`: with outcome,
  who closed it and the call-to-close time.
- **Case Audit Trail** `/case-manager/audit`.

Filters (search, department, severity, call dates) live in the URL. SystemAdmins, Supervisors,
Captains and the SystemController get Case Management links in their own menus. `/dashboard` sends
a case manager to the case dashboard.

**Who closes:** case managers, Supervisor, Captain, FireChief, Admin tiers, SystemController and the
dispatch desk close a Resolved case (`CASE_CLOSE_ROLES`). The same, minus case managers, cancel a
live call (`CALL_CANCEL_ROLES`). Call-takers and viewers read cases, never close them. Rules in
`packages/db/src/roles.ts`, tested in `roles.test.ts`.

**Who hears:** when a report lands, case managers (control-room ones tenant-wide, department
ones for their department) get a "resolved" alert. On close, the officers on the call, the
dispatcher, department command and the other case managers are told.

## Before the demo

1. Run `supabase/migrations/0061_case_review_and_close.sql` in the Supabase SQL editor, or
   `node scripts/apply-migration.mjs supabase/migrations/0061_case_review_and_close.sql`.
   It is additive and safe to re-run; it checks itself at the end.
2. Sign the officer (police01.metro) through the start of shift in the app before the demo.

## Test script

1. `logger@`: log a call (Crime → Robbery, High), pinned on the map.
2. `dispatch@`: Pending Queue → Assign → Const. Khumalo.
3. Phone (`police01.metro`): Acknowledge & open → Accept · En Route → Mark On Scene → File incident
   report. The sync tray should say delivered.
4. `casemanager@`: the "resolved" alert arrives; Case Dashboard shows it under Awaiting review.
   Review → read the report → add a note → **Close**. The officer's phone gets "closed".
5. Closed Cases shows it as Reviewed, by the case manager. Case PDF has the report and the closure.
6. `sysadmin@`: All Incidents (status Closed), Case Management → Closed Cases.
7. A cancellation: log another call, dispatch it, and as `dispatch@` use **Close without a report**
   on the case file with a reason. The officer is told to stand down.

## Verification

- `scripts/test-case-close.mjs`: 17 scenarios on in-memory Postgres (PGlite) with 0061 applied
  twice: visibility per role and tenant, the report rule for field and desk, a finished call stays
  finished, Captains as responders, EMS resolution stamps, review close, cancel with a reason,
  refusals (call-taker, viewer, officer, another department's Admin, another tenant, anon), who is
  notified, and who reads the audit trail.
  `CASE_PGLITE_MODULE=file:///…/@electric-sql/pglite/dist/index.js node scripts/test-case-close.mjs`
- Unit tests: `packages/db/src/roles.test.ts` (case rules), `packages/api/src/cases/cases.test.ts`
  (figures, SA days, search cleaning), `packages/api/src/police/report-types.test.ts` (report
  readout), `apps/web/lib/pdf-text.test.ts` (PDF text).
- Typecheck and lint on web, mobile and the packages. Every case page rendered against the hosted
  database for the case manager, dispatcher, call-taker, officer and SystemAdmin.
- **Not yet seen:** the close itself against the hosted database (0061 is for you to apply).

## Not in this phase

- Reopening a closed case.
- EMS patient care reports and fire reports in the review readout beyond a summary line (the fire
  report has its own PDF).
- Incident numbers are unique per department per day, not per tenant; a control-room call and a
  department call can share a number. Changing the numbering is a separate decision.
