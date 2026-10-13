# 18 — Criti: the assistant on the console

Built 2026-10-11. Migration `supabase/migrations/0070_criti.sql` (run after 0069).
V4 reference: `ChatbotController.Ask` and `ChatbotService` (the live board and
department context injected into Gemini, `[UPDATE_STATUS]` and `[FILL_REPORT]`
action codes, "System Task Complete" replies).

Criti is not a general chatbot. It knows how the person's department works,
reads the live board their role may see, points out what needs attention, and
prepares tasks for them to confirm. This round covers the web console. The
phone app keeps its text-only Ask Criti until the mobile round.

## The one rule

**Criti reads as the person and acts only when they confirm.**

- Every read uses the person's own session, so row-level security decides what
  Criti sees: a department's dispatch desk sees the calls sent to it, a
  department's staff their department, the control room everything.
- Criti never changes anything by itself. What it prepares appears as a card.
  The person reads it and presses Confirm.
- On Confirm, `/api/criti/act` checks the task again: the schema, the role, the
  person's team, and the live record. It then does the task through the same
  database functions the forms use, which apply every rule they apply to the
  forms. Each confirmed task is written to the audit trail as `CritiAction`.

V4 and the previous V5 assistant carried out action codes straight from the
model's reply. That is gone.

## Where it lives

| Place | What it is |
|---|---|
| Suggestion tiles | On the dashboard (every persona), the Pending Queue, and the Fire & Rescue, EMS, Disaster, Police and Command pages. Live: they refresh on every change to a call or a crew and every 30 seconds. |
| The dock | Right edge of every page. Ctrl+J opens and closes it. Two tabs: **Chat** and **Suggestions**. The launcher shows a red count of urgent suggestions. |
| `/assistant` | The same conversation, full page. |

The tiles use **no AI model**. They are fixed rules over the live board
(`packages/api/src/criti/insights.ts`), so they work with no key, cost nothing,
and give the same answer every time.

## Everything Criti can do

### Suggestion tiles

| Tile | Shown to | When | What it offers |
|---|---|---|---|
| SOS from … | Desk, command; field crews of that department | An officer's panic call is open | Open the call; ask Criti who is nearest |
| Critical / High call waiting for dispatch | Desk, command | A High or Critical call is waiting, under the late threshold | Assign the nearest free crew (with a road estimate); send to everyone on duty; open in the queue |
| Late dispatch: over 10 / 20 min | Desk, command | Any call waiting past the escalation minutes | As above |
| No one has responded | Desk, command | Sent or assigned 5 min ago and nobody pressed Responding | Assign someone else (never the person holding it); send to everyone on duty |
| Crew not on scene yet | Desk, command | Accepted, and no arrival after the response target (30 min) | Mark on scene for a crew that radioed it (desk only) |
| Long time on scene | Command; the field crew on it | On scene past the call duration target (2 h), still open | Open the call; it reminds which report closes it |
| No news in a while | Desk, command | An open call with no update for 4 h | Ask Criti to summarise it and say what is missing |
| Possible duplicate | Call takers, desk | Two open calls within 12 h with the same caller number (last nine digits) or the same address and code | Open both; close the newer as a duplicate (desk and command only) |
| People hurt, EMS not sent / X not sent | Call takers, desk | The code or anyone hurt says a department should have the call, and its desk does not | Send to that department's desk |
| Nobody on duty in … | Desk, command | Calls are waiting for a department and no one from it is on duty in the app | Open the duty board |
| Queue building for … | Desk, command | 4 or more calls waiting for a department, fewer crews free than calls | Open the queue |
| … past 14 hours on duty | Command | On duty longer than the maximum shift | Open today's shift |
| A call is waiting for you / Open call for … | Field crews on the console | A call assigned to them, or open to their department | Open the call |

× on a tile hides it for 15 minutes on that screen. The minutes come from the
automatic rules (Admin → Automations) and Operations Settings, read through
`criti_thresholds()`, so a tile and the escalation it warns about agree.

### Questions it answers

- **The live board**: what is waiting, who is on which call, who is free, how
  long things have stood, which crews have no location.
- **A call by number** (`INC-20261011-0007`, or `0007` when only one open call
  ends that way), with its timeline, what the caller said, notes, patient,
  who took and dispatched it. A number shared by two departments is never
  guessed: Criti says so.
- **The call on screen**: on a case file or an Assign page, "this call" is that call.
- **How the department works**: the four departments' start of shift, call
  flow, reports (incident report, fire report, patient report, post-mortem),
  intake triage (P1 to P4), and where each screen is.
- **The person's own access**: which screens they can open and what Criti may
  do for them.
- What it cannot see, and why: it says so instead of guessing.

### Tasks it prepares

| Task | Who may confirm it | Done by |
|---|---|---|
| Log a call from the conversation | Call Taker, Control Room, admin tiers | `log_incoming_call()` with the desks tagged |
| Send a call to another department's dispatch desk | Call Taker, Dispatcher, Control Room, Supervisor, admin tiers, System Controller | `tag_incident_departments()` |
| Assign a call to someone on duty | Dispatcher, Control Room, Supervisor, admin tiers | `assign_incident()` |
| Send a call to everyone on duty in a department | As above | `route_incident()` |
| Record a crew's step they radioed in (En Route, Arrived, On Scene, Transporting) | Dispatcher, Control Room, Supervisor, admin tiers | `update_responder_status()` |
| Close a live call that needs no report, with a reason (hoax, duplicate, cancelled) | Dispatch desk and command, not case managers | `close_case()` |
| Add a note to a call's timeline | Everyone who works calls; never a Viewer | the timeline insert rules |
| Send a broadcast | Supervisor, Captain, Fire Chief, Dispatcher, Control Room, admin tiers. Department staff reach their own department only. | `send_broadcast()` (0070) |

The lists mirror each function's `require_role()` and are tested in
`packages/api/src/criti/criti.test.ts`. A department's dispatch desk dispatches
its own crews only; Criti offers nothing else, and the database refuses it
anyway (0068).

### Logging a call by conversation

A call taker types or pastes what the caller says, for example
"Sipho Dlamini on 082 555 1234, house on fire at 12 Smith Road, Umbilo, two
people inside". Criti:

1. fills in what it heard and asks for what is missing, two or three items at a time;
2. picks the incident code only from the configured list;
3. suggests the desks the way the form does (the code, and EMS when anyone is hurt);
4. checks the number as the form does, places the address on the map, sets the
   region, and flags an open call from the same number or the same address;
5. shows the card. While anything is missing there is no Confirm, only
   **Open in the form**, which opens Log Incoming Call already filled in.

## Security, in full

| Concern | How it is held |
|---|---|
| Seeing what one should not | Every read is the person's own session under RLS. The person's role and department come from their profile in the database, never the request. A switched-off account is refused. |
| Doing what one should not | Nothing runs without a confirmation. The confirmation is checked again on the server (schema, role, team, live record, call number unchanged), then done by the database function the form uses. |
| A desk writing to another department's call | New in 0070: a department's dispatch desk can add notes and files only to calls sent to it. Before, it could if it knew the call's id. |
| Broadcasts | New in 0070: `send_broadcast()` checks the role, keeps department staff to their own department, and sends one alert per person in the departments chosen. Before, a department-wide alert also reached every other department's desk. |
| Text that tries to steer Criti | Caller descriptions and notes are marked as information, never instructions. Whatever the model is talked into, it can only propose; the person confirms and the server checks. |
| Made-up records | The model names calls by number and people by name or badge. Each is matched to the person's own board; anything else is dropped with a plain reason. |
| Runaway use | Rate limits: chat 40/min, tiles 150/min, confirmed tasks 30/min per person. |
| Switching it off | Admin → Features: **Criti assistant** (dock, chat, model spend) and **Criti suggestion tiles**, separately. Admin → Integrations switches each AI provider. |
| The trail | Each confirmed task: its own audit entry from the database function, plus `CritiAction` naming the task and who confirmed it. |

**Decision for the service:** to answer, Criti sends the board the person may
see (call types, addresses, caller names, crew names) to the AI provider in
use. V4 did the same with Gemini. Under POPIA, confirm that the provider's
terms suit this data before turning the chat on. The tiles send nothing
anywhere.

## Setting it up

1. Run `0070_criti.sql` in Supabase (after 0067, 0068 and 0069).
2. Add one or more AI keys to `apps/web/.env.local` (and the hosting provider),
   then restart the console:

   | Variable | Provider | Model variable and default |
   |---|---|---|
   | `XAI_API_KEY` | xAI Grok | `XAI_MODEL`, `grok-4.7` |
   | `GROQ_API_KEY` | Groq | `GROQ_MODEL`, `openai/gpt-oss-120b` |
   | `GEMINI_API_KEY` | Google Gemini | `GEMINI_MODEL`, `gemini-3.5-flash-lite` |

   They are tried in that order, skipping any without a key or switched off
   under Admin → Integrations. `CRITI_PROVIDERS=gemini,grok` changes the order.
   With no key, the tiles still work and the chat says it is not switched on,
   listing what needs attention instead.
3. Admin → Integrations → Test on each provider confirms the key and model.

## Test script

Apply 0070, restart the console, then:

1. **Fire desk dispatcher.** Have the control room log a Critical fire call
   tagged Fire & Rescue, without dispatching it. The dashboard shows
   "Critical call waiting for dispatch" with the nearest free firefighter, and
   minutes away when their phone has a location. Press
   **Assign …**, read the card, Confirm. The call opens as Dispatched and the
   firefighter's phone rings. Log a Police-only call: no tile on the fire desk.
2. **Late and unanswered.** Leave a call waiting past 10 minutes: the tile turns
   to Late dispatch. Assign it and do not respond for 5 minutes: "No one has
   responded" offers someone else.
3. **Duplicate.** Log two calls from the same number: the call taker sees
   "Possible duplicate" (no close button); the dispatcher can close the newer one.
4. **EMS not sent.** Log a call with 2 hurt and untick EMS, so only Police
   gets it: "People hurt, EMS not sent" offers Send to EMS.
5. **Chat (with a key).** As a call taker, open the dock (Ctrl+J) and paste a
   call. Criti asks for what is missing; answer; Confirm the card, or Open in
   the form. As a dispatcher: "Who is nearest to INC-…?", then "assign them".
6. **Refusals.** Ask a Dispatcher's Criti to log a call: it says call takers do.
   Ask a fire Supervisor's Criti to broadcast to Police: it says it can reach
   Fire & Rescue only. Ask about a police call from the fire desk: it cannot see it.
7. **Viewer.** No tiles, no Suggestions tab; the chat answers questions and
   prepares nothing.

## Code

- `packages/api/src/criti/`: `types.ts`, `abilities.ts` (who may do what),
  `insights.ts` (the tiles), `proposals.ts` (task schema and cards),
  `resolve.ts` (from the model's words to checked tasks), `knowledge.ts`
  (department and role knowledge), `board.ts` (the live board under RLS).
- `apps/web/app/api/chat` (conversation), `apps/web/app/api/criti/insights`,
  `apps/web/app/api/criti/act`; `apps/web/lib/criti/` (providers, prompt, server helpers).
- `apps/web/components/criti/` (tiles, cards, chat) and `components/assistant-dock.tsx`.

## Verified

- `packages/api/src/criti/criti.test.ts`: 21 tests (roles, team scope, every tile
  rule, crew ranking, duplicate numbers, call drafting, proposal checks).
- `scripts/test-criti.mjs`: 6 scenarios on PGlite with 0068 then 0070 applied
  twice (shared thresholds, the desk write wall, broadcast scope and
  presentation, who may not broadcast, the Grok listing).
- Type checks for the console, the phone app and the packages; lint with no new warnings.

**Not yet seen:** a live model answer (no AI key is set in `.env.local`), and
0070 on the hosted database.

## Not in this phase

- Criti on the phone: cards and tiles come with the mobile round. The phone's
  Ask Criti keeps working and now explains how to do things rather than doing them.
- The automatic escalations (0025) still alert the call's own department and the
  control room, not every tagged desk.
- Tiles for case managers (cases waiting longest for review).
