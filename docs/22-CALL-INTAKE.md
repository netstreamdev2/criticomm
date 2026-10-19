# Logging a call: the new form, Criti, and sending early

The call-logging screen (`/dispatch/log-call`) was rebuilt so the call taker
gets the important things down first, Criti helps as they type, and an urgent
call can reach dispatch before every detail is in (`0076_call_intake.sql`).

## What changed

| | Before | Now |
|---|---|---|
| **Order** | Caller and location on the left, the details on the right. | **What and where** on the left: incident type, description, location. **Caller and dispatch** on the right: caller, number, patient question, severity, triage, notes, departments. |
| **Incident type** | A long drop-down of the 10-codes. | A search box: type "gun", "crash", "chest". About 85 types in six groups. Each shows coloured dots for the departments it goes to: blue Police, orange Fire, red EMS, purple Disaster. |
| **Description** | A small "narrative" box. | A box that opens a large **Description** window: the caller's words, a searchable list of 27 injuries (gunshot wound, stab wound, chest pain / heart attack…), who is hurt and how many. |
| **Patient question** | Asked on every call. | Asked only when someone is, or may be, hurt (a medical type, an injury ticked, or EMS chosen). The database asks it only for calls sent to EMS. |
| **EMS triage** | Always shown. | Shown only when someone is, or may be, hurt. |
| **Severity** | A drop-down, chosen by hand. | Four buttons. Criti fills it in from the type and the injuries; the call taker can change it. |
| **Location** | Addresses only. | Addresses and places: "Gateway", "Engen near Pavilion", "the Shell in Pinetown", "hospital near Umlazi". |
| **Urgent calls** | Sent only when every field was filled in. | A High or Critical call can be sent as soon as it has a type, a map pin and a department. The rest is added to the same call as the call taker types. |

## Criti on the form

A slim dark strip at the top shows up to three lines (warnings, what to ask the
caller next, what is still missing). **View all** shows everything.

- **Rules, instantly, no AI:** the departments, severity, medical code (P1–P4)
  and questions for the type and the injuries ticked. They come from
  `packages/db/src/intake.ts` and give the same answer every time.
- **The AI reads the description** about a second after the call taker stops
  typing (Grok first, then Groq, then Gemini; 8-second limit). It suggests the
  type, severity, injuries, how many are hurt, whether the caller is the
  patient, departments, warnings and questions. Anything not on the
  organisation's own lists is dropped.
- **It never overwrites the call taker.** Criti fills only empty fields and
  marks them **✦ Criti**. Once the call taker changes a field, Criti leaves it
  alone. When the call taker picked a different severity, Criti only says
  "Criti suggests …".
- **Privacy:** the AI is sent the type, the injuries, the number hurt and the
  description, never the caller's name or number. It is read only when the call
  taker has typed the description, not Criti's own draft.
- **Limits:** only call takers can use it (`/api/criti/intake`), under the
  Criti switch, with its own rate limit (30 a minute per person). If no AI is
  set up, or it fails, the rules still work and the strip says so.

## Sending early

1. Once the call has a type, a map pin and a department, and it is High or
   Critical, a pop-up asks **Send to dispatch now?** once. The button also
   stays in the strip and above the send button.
2. The call is created at once (`send_call_early`). The desks get it as any new
   call, with a toast and a chime. Anything not given yet is stored as
   "Not given yet" (caller) or "Details to follow." (description).
3. The form stays open, with a green banner. Each change is added to the call
   (`complete_call_intake`): choices within a second, typed text after a short
   pause or when the call taker moves to the next field. The call's timeline
   says what was added. **Finish the call** checks that the caller, number, description and (for EMS) the patient question are in, saves, and confirms from the database that the call is complete before saying so.
4. The queue row, the dispatch page, the call page and the new-call toast show
   **⧗ Details to follow** until the caller's name, number and the description
   are in (and, for EMS, whether the caller is the patient). The dispatch page
   refreshes by itself while it shows that mark.

Rules for adding details:

- Only the person who logged the call, the control room, or an organisation
  administrator can add them.
- A department can be added; one already sent stays.
- Once a crew has accepted, only the dispatcher changes the type. Once a crew
  is on scene, only the dispatcher changes the place.
- Nothing can be added to a resolved or closed call.

## Place search

`apps/web/lib/places.ts` reads what the caller said; `apps/web/lib/geocode.ts`
looks it up.

- Common names are widened to the name on the map, for example "Gateway" to
  Gateway Theatre of Shopping and "KED" to King Edward VIII Hospital. Each was
  checked against the map; names the map doesn't have were left out.
- "X near Y" looks for X within about 4 km of Y. A kind of place ("garage",
  "taxi rank", "hospital") finds any of them there, and only named places count.
- "South Beach taxi rank" or "Engen Umlazi" is tried as "near" when the whole
  phrase finds nothing.
- Results stay inside eThekwini and its edges. The suburb is never a ward
  number.
- Photon is used first. If it fails or times out, Nominatim is used for a
  minute. Answers are kept for ten minutes.

## Setting it up

Run `0076_call_intake.sql` in the Supabase SQL editor (after 0075). It:

- adds `injuries` and `intake_complete` to incidents (every call already on
  record counts as complete);
- makes incident codes unique per organisation (they were unique across all of
  them), and adds the missing groups and types to every organisation, with the
  questions to ask. Types an organisation already has stay as they are; their
  questions are filled in only where they have none. Administrators can still
  edit them under Admin → Configuration → Incident categories;
- asks the patient question only on calls sent to EMS, and keeps the injuries;
- adds `send_call_early` and `complete_call_intake`. Both check who is asking,
  and neither can be called without signing in.

Until it is run:

- a normal send still works. On a call with no one hurt, the form sends "the
  caller is not the patient", which is what the old database asks for;
- **Send to dispatch now** says it needs the update;
- the AI uses the organisation's old list of types, so it may choose a broader
  one (for example Assault instead of Shooting).

## How it is built

| Piece | Where |
|---|---|
| Types, injuries, Criti's rules, the description draft | `packages/db/src/intake.ts` |
| Form checks: normal, early, adding details | `packages/db/src/schemas/index.ts` |
| Calls to the database | `logIncomingCall`, `sendCallEarly`, `completeCallIntake` in `packages/api/src/incidents/index.ts` |
| What the AI is asked, and how its answer is read | `packages/api/src/criti/intake.ts` |
| AI route | `apps/web/app/api/criti/intake/route.ts` |
| The form | `apps/web/app/(app)/dispatch/log-call/` |
| Place search | `apps/web/lib/places.ts`, `apps/web/lib/geocode.ts` |
| Details to follow | `apps/web/components/details-to-follow.tsx` |
| Database | `supabase/migrations/0076_call_intake.sql` |

## Verified

- `scripts/test-call-intake.mjs` runs 0076 twice on Postgres (PGlite). All 9
  scenarios pass, including: the patient question only on EMS calls; sending
  early and its limits; pressing send twice; adding details; who may add them;
  and the locks once a crew has accepted or is on scene.
- Unit tests pass: the rules (`intake.test.ts`, 8), reading the AI's answer
  (3) and the place search (5). Type checks pass for the packages, the console
  and the phone; lint adds no warnings.
- On the dev server, signed in as the call logger, the form loads. Place search
  found Gateway, the Engens near Pavilion, the Shells in Pinetown and the fuel
  stations next to Gateway. The AI (Gemini) read a test shooting description in
  about 8 seconds: Critical, gunshot wound and severe bleeding, 1 hurt, Police
  and EMS, two warnings and three questions. The queue, dispatch page and call
  page load for a dispatcher and the control room.

Not yet checked on the hosted database (0076 not run yet) or with a real call
sent early end to end.

## Round two: details by type, codes and numbers (0077)

The plan and the decisions are in `docs/23-NEXT-CHANGES.md`, item 2.

Run `0077_call_details_numbers.sql` after 0076. It:

- adds `details` (what the call taker filled in for the type) and
  `incident_code` to incidents. A call with no details is unchanged;
- adds the V4 types and gives every type its code. V4's code is used where the
  type is the same, and our own (CR-, TR-, FI-, ME-, PO-, DI-) for the rest. A
  code an administrator already changed is kept;
- makes the new incident number, for example `MPFD-20261010-1115-0034`, when a
  call is sent (normal, early, Criti, SOS). There is one counter per
  organisation per day, in South African time. Old calls keep their INC-
  numbers.

Until it is run, the form still sends. Details stay off and the old number is
used. The phone shows no details.

| Piece | Where |
|---|---|
| The details each type asks for | `packages/db/src/intake-details.ts` |
| Types, codes, SAPS categories, templates | `packages/db/src/intake.ts` |
| The incident number | `packages/db/src/incident-number.ts` (the database makes it; this reads it) |
| Shown on the console and PDF | `apps/web/components/call-details.tsx`, `apps/web/app/api/pdf/incident/[id]/route.ts` |
| Shown on the phone | `apps/mobile/components/call-details.tsx` |
| Database | `supabase/migrations/0077_call_details_numbers.sql` |

Verified: `scripts/test-call-details.mjs` runs 0076 and 0077 on Postgres
(PGlite), with 0077 run twice. All 7 scenarios pass: the codes; the number
(pairs, date and time, number of the day); South African time at midnight;
the SOS number; the details (kept apart from the description, checked, added
later); a new type bringing its code; and unique numbers. Not yet run on the
hosted database.

## The dispatcher edits before dispatch (0079)

On the assign page, **Edit before dispatch** lets the dispatcher correct the
call before sending crews: the type, severity, description and details, the
caller, the place, the patient and the notes, with an optional reason.

- **Who:** dispatchers, operators, supervisors, the control room and
  administrators. A department's desk edits only the calls sent to it.
- **Until when:** a department's desk until its own department's crews are
  sent; the control room until any department's are. After that, the call
  taker and the control room add details as before.
- **Same checks** as the call taker's (0077): a refused change saves nothing.
- **Every change is kept** in `incident_edits`, with who made it, their role,
  when, why, and each field as it was and as it became. The call taker's own
  edits are kept the same way.
- **Where it shows:**
  - the audit trail (`DISPATCH_EDIT`, with the old and new wording);
  - the call's timeline (`[DISPATCH] Edited before dispatch by …`);
  - *Changes since it was logged* on the assign page and the call page;
  - the case PDF. It shows who logged the call, who edited it, the call as it
    was logged, and each change.

Run `0079_dispatcher_edits.sql` after 0078. Until it is run, the button shows
but saving says it needs the update, and no changes are listed.

| Piece | Where |
|---|---|
| Who may edit until when | `editableBeforeDispatch` in `packages/api/src/incidents/parts.ts` (the page); `dispatcher_edit_call` in the database |
| Saving and reading the changes | `editCallBeforeDispatch`, `listIncidentEdits` in `packages/api/src/incidents/index.ts` |
| The changes in words | `packages/db/src/incident-edits.ts` |
| The edit window | `apps/web/app/(app)/dispatch/assign/[id]/edit-call.tsx` |
| The list of changes | `apps/web/components/call-edits.tsx` |
| Database | `supabase/migrations/0079_dispatcher_edits.sql` |

Verified: `scripts/test-dispatcher-edits.mjs` runs 0076, 0077 and 0079 on
Postgres (PGlite), with 0079 run twice. All 6 scenarios pass: each field kept
before and after; the audit trail and the timeline; before dispatch only, per
desk; only dispatchers on their own desk's calls in their organisation; the
call taker's rules unchanged; and nobody writes the changes directly. Not yet
run on the hosted database.

## How the call came in, and each patient's severity (0080)

- **How the call came in:** the call logger picks Phone call (chosen at the
  start), WhatsApp, In person, or Other. Other takes a few words, for example
  "radio from a security guard".
- **The patient, in the Description window:** *Is the caller the patient?* is
  asked near the top of the Description window, only when EMS is on the call.
  It is no longer on the main form. If it is missing when the call is sent,
  the window opens to it.
- **Each patient's own severity:** Critical, High, Medium, Low or Unknown,
  apart from the incident's. A house fire can be Critical while the
  neighbour's minor burns are Low.
  - If the caller is the patient, one severity is asked for them.
  - If not, each patient gets a name, if known, and a severity.
- **Shown** on the dispatch page (EMS box), the call page, the case PDF and
  the crew's phone. The dispatcher can correct both before dispatch, and each
  change is kept as for the other fields (0079).

Run `0080_call_channel_patients.sql` after 0079. Until it is run, calls are
logged and sent without the channel and the patients' severities, and
correcting only those says it needs the update.

Also in this round:

- **The Description window and the dispatcher's edit window** fit the screen.
  They scroll inside with a wider scroll bar, and their buttons stay in view
  at the bottom.
  - Clicking the dark area or pressing Escape asks *Close this window?* first.
  - The edit window asks only when there are unsaved changes.
- **The edit window** shows each problem in red under its own field.
- **The dispatch page** says *Department*, with a coloured pill for each
  department on the call, and the box is called *EMS*.

| Piece | Where |
|---|---|
| Channels, patient severities, in words | `packages/db/src/call-facts.ts` |
| The window | `apps/web/components/ui/modal.tsx` |
| Department pills, patient list | `apps/web/components/department-pills.tsx` |
| Database | `supabase/migrations/0080_call_channel_patients.sql` |

Verified: `scripts/test-call-patients.mjs` runs 0076, 0077, 0079 and 0080 on
Postgres (PGlite), with 0080 run twice. All 5 scenarios pass: the channel and
its note; each patient cleaned and kept apart from the incident's severity;
sent early; corrected by the dispatcher and the call taker with each change
kept; and one of each function, with the helper not callable. Not yet run on
the hosted database.

## Carrying on with a call sent early, after a refresh

A call sent with **Send to dispatch now** is already with dispatch. Each
change after that is saved to the call within seconds. If the page was
refreshed or closed before the call was finished, the form used to start
blank, with no way back to that call.

- **The call logger page** lists the calls sent early that still need their
  details: the person's own, or every unfinished call for the control room.
  **Carry on** opens the same call in the form, filled in as saved. Each
  further change goes to it, and nothing already saved is sent again.
- **The call's page** has **Finish this call** while it is unfinished.
- **Who:** the person who logged it, the control room and the organisation's
  administrators, while the call is unfinished and not closed. This is the
  same rule `complete_call_intake` enforces on every change: the page
  decides only whether the form opens (`finishCallBlock` in
  `packages/db/src/unfinished-call.ts`). Anyone else gets a plain refusal
  and no form.
- Every change is kept with who made it (0079), as before.
- Once a call is sent, the duplicate-call check no longer flags the call
  against itself.

No database change: run nothing new for this.
