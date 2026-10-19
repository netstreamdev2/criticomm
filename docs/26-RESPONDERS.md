# 26 — Responders: My calls, and the Active Responders terminal

V4 had two screens behind one controller (`ResponderController`):

| V4 | HikTech | For |
|---|---|---|
| `Responder/Index` (assigned incidents) | `/responder`, **My calls** | field officers: the calls sent to them |
| `Responder/Monitor`, "Active Responder Terminal" | `/responder/monitor`, **Active Responders** | the desks: every crew still out |

The migration plan (docs/00) named `/responder/monitor`. It is now built.

## Active Responders (`/responder/monitor`)

- **Tiles:** calls with crews out, responding, on scene, transporting, critical,
  and officers out with the longest time on scene.
- **Filters:** search (call, type, code, place, officer), stage, department,
  severity.
- **Each call:**
  - the call number, code, severity and status;
  - type and classification, and the place;
  - each department's part with its status and lead;
  - the crew, lead first;
  - a live clock showing "out for" or "time on scene".
- **Open a row:** the dispatch narrative, the caller's name (not their number),
  the crew, and V4's operational timeline (dispatched, arrived, time on scene).
- **Live:** it refreshes when a crew moves (realtime), and every 30 seconds as
  a safety net.
- **Actions:**
  - **Open the call**, for everyone who can see it.
  - **Talk to the crew** (HikTech Talk on the call's channel) and **Export the
    log** (PDF, audited as `ResponderLogExported`): not the Viewer, as V4 hid
    its buttons from the Viewer.
- **Change from V4:** V4 dropped a unit once it arrived. Here it stays, as
  *On scene* with the time-on-scene clock, until the call is resolved.

## Who sees it

| Role | Opens it | Sees which calls | Acts |
|---|---|---|---|
| Dispatcher, ControlRoom, Supervisor | ✅ | their desk's (0068) | ✅ |
| Viewer | ✅ | every department's | ❌ watches only |
| SystemAdmin, SuperAdmin, SystemController, System | ✅ | every department's | ✅ |
| Admin (a department's) | ✅ | their own department's | ✅ |
| Field officers (Police, Firefighter, Paramedic, Doctor, Disaster), Captain, FireChief | ❌ (they have My calls and the command board) | — | — |
| IncidentLogger | ❌ (they watch calls on the incident pages, 0081) | — | — |
| CaseManager | ❌ | — | — |

`Operator` and `Security` were V4 roles and are retired in HikTech.

## How it is secured

1. **The route matrix:** `RESPONDER_MONITOR_ROLES` in `packages/db/src/roles.ts`,
   checked by the middleware and by the page itself.
2. **The database:** the page reads with the person's own session. Row-level
   security decides which calls (`incidents`, the desk wall of 0068), crews
   (`incident_responders`, follow the call) and department parts
   (`incident_departments`, follow the call) are on it. Nothing is written.
3. **Actions:** the export route refuses the Viewer (`RESPONDER_MONITOR_ACT_ROLES`).
   Talk is decided by `talk_access()` (0083), where the Viewer only listens.

No migration was needed.

## Verification

```
node --experimental-strip-types --test packages/api/src/incidents/responder-board.test.ts packages/db/src/roles.test.ts
```
