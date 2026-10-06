# 12 — Body cams

Built 2026-10-05. Migration `0054_bodycams.sql` must be run in Supabase before any of it works;
until then each screen says so instead of failing, and the app's start of shift has no
bodycam step.

Metro Police officers wear a Hikvision DS-MCW407 bodycam that streams over 4G to the Hikvision
platform (HCM Lite). This phase is everything on the HikTech side. Feeds play a public sample
video ("test video") until the platform is connected; connecting it is the next phase (see
**Connecting the Hikvision platform** below).

## What was built

| Where | What |
|---|---|
| **Body Cams** `/cameras` (web, was Surveillance) | Every bodycam out with an officer that this person may watch. One or four live feeds at once; each asks why it is being opened. Updates itself as bodycams are booked out and handed back. |
| **Body Cam Footage** `/cameras/footage` (web, was CCTV Footage) | Recorded video, found by who had which bodycam and when: a time window, an officer, or a whole incident (`?incident=`). Plays in the page. |
| **SANRAL Cameras** `/sanral` (web, new) | The freeway camera wall, live traffic and the i-traffic registry, moved off the old Surveillance page. Also layers on the live map. |
| **Bodycam register** `/police/bodycams` (web) | Every bodycam: serial, model, SIM number, Hikvision camera code, station, status, who has it. Add, edit, change status with a reason (Available / In repair / Lost / Retired), receive one back for an officer. "Who has watched": the latest views with their reasons. |
| `/police/bodycams/import`, `/police/bodycams/template` | The register from a spreadsheet, with the same import flow as the armoury. |
| Live map (dashboard, Live Map, full-screen wall) | Officers wearing a bodycam get a red dot. Clicking one opens the live feed in the left-hand panel, for people who may watch it. |
| Incident page | "Body cams on this incident": the lead, backups and assigned officer, with "Watch live" (the incident is the reason, and the view goes on the incident's history) and a link to the incident's footage. |
| Today's shift `/shift/today` | A Bodycam column (serial, or "None:" with the reason), a "Bodycams out" count, and two flags. |
| Captain dashboard | "Team bodycams on" tile and a Body cams link. |
| Police report (web) | "Bodycam active" is ticked when the officer has one booked out. |
| Start of shift (app) | After the firearm: choose a bodycam, tick three checks (battery, test recording, mount), or say why there is none. The last step is now called "Loadout". |
| End of shift (app) | After the firearm: hand the bodycam back (in order, damaged or lost, with what happened). |
| Field report (app) | "Body camera active" starts as Yes when the officer has one booked out. |
| Notice (app) | "Control room is viewing your camera", at the top of every screen while a live view is open. Never says who. |
| Admin → Integrations → Hikvision | A **Bodycam test video: on/off** switch. "Test connection" lists the platform's cameras. |

The action bar, the sidebars, the command palette and the breadcrumbs use the new names. The
feature switch `web.cameras` ("Body cams and cameras") hides Body Cams, Body Cam Footage and
SANRAL Cameras; officers still book bodycams out and back.

## Who can do what

The database decides (`can_watch_bodycam`, `can_manage_bodycams`); the pages only hide
buttons.

| | Watch live | Footage | Keep the register |
|---|---|---|---|
| SuperAdmin, SystemAdmin, SystemController | Every department | Every department | Every department |
| ControlRoom, Dispatcher | Every department | Every department | No |
| Supervisor, Captain | Own department | Own department | Own department |
| CaseManager | No | Own department | No |
| Admin | No | No | Own department |
| Viewer, IncidentLogger | No (they keep SANRAL Cameras) | No | No |
| Police officer | No: books out and hands back in the app | No | No |

"Own department" includes the Ethekwini control silo reaching Metro Police kit, as for
firearms. The rules are tested in `packages/db/src/bodycams.test.ts`.

## Watching

- **A reason first.** From an incident, the incident is the reason. Anywhere else, choose one:
  officer safety check, SOS or officer in distress, supervising work in progress,
  investigation or evidence review, or other (say why). The last reason is offered again on
  the same screen.
- **Every view is a record** (`bodycam_views`): who, which bodycam, whose it was, live or
  which window, the reason, when it opened and closed, and why it closed. It also goes in the
  audit log (`BodycamLiveViewed`, `BodycamFootageViewed`), and on the incident's history when
  opened for one.
- **Four live feeds per person.** The database refuses a fifth.
- **"Still watching?"** after ten minutes. The feed stops a minute later if nobody answers,
  which saves the bodycam's mobile data. The screen confirms every 30 seconds; a view that
  stops confirming for two minutes has ended.
- **Handing the bodycam back ends every live view of it.**
- **The officer is told** while any live view is open, and never by whom
  (`bodycam_watch_status`).
- **Footage** windows are capped at 24 hours. A booking that failed its check never went out,
  so it is not offered.

The video never passes through HikTech's database. Once `start_bodycam_view` has said yes
and written the record, the web server asks the platform for an HLS address
(`/api/bodycams/view`) and the browser plays it with hls.js.

## The rules that keep the record honest

- **Status and custody move only through the database functions:** `book_out_bodycam`,
  `return_bodycam`, `receive_bodycam`, `set_bodycam_status`. Editing the row cannot change
  them, and nothing is deleted: a bodycam is retired instead.
- **A failed check at book-out sends it for repair**, records it, and tells command. The
  officer chooses another or says why there is none.
- **The duty gate asks for the bodycam step.** A book-out or a reason completes it; silence
  does not. An empty register never blocks a shift: the officer says why there is none.
- **No end of shift with a bodycam out.** `end_shift` refuses until it is handed back. Signing
  out anyway is allowed; command is told and the board flags it.
- **Damaged or lost** goes to command at once (In repair / Lost).
- **Bookings are kept** (`bodycam_bookings`): how footage is found again.

## Importing the register

The same flow as the armoury (`packages/db/src/assets.ts`, `checkBodycamList`). Bodycams are
matched by **serial number**, ignoring spaces and dashes. A blank cell never erases, and an
import never changes who has a bodycam or its status. One Hikvision camera code belongs to
one bodycam: a code already on another bodycam, or on two rows of the file, holds that row
back. A code that is not a code can be dropped and the row imported without it.

## Today's shift flags

| Flag | Meaning |
|---|---|
| Shift ended, bodycam not handed back | Ended or signed out with a bodycam still booked out. |
| Bodycam out over 13 hours | As for firearms (`FIREARM_OUT_LIMIT_HOURS`). |

## Test video

Admin → Integrations → Hikvision → **Bodycam test video: on**. Every feed then plays a public
sample stream (`test_stream_url`, default `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`),
marked "Test video — not the bodycam". Everything else is real: the reason, the record, the
audit log, the four-feed limit, "Still watching?" and the officer's notice. Switch it off once
the platform is connected.

## Connecting the Hikvision platform (next phase)

What is ready: the signed client for HCM Lite's OpenAPI (`apps/web/lib/hikvision.ts`,
`lib/hikvision-sign.ts`, following the vendor's guide and Postman collection: v1 video calls,
`treeCode`, timestamp and nonce signed). What it needs, from Paul:

1. **`HIKVISION_APP_KEY` and `HIKVISION_APP_SECRET`** on the server, with the camera, live
   view and playback APIs authorised for that key.
2. **`base_url`** in the Hikvision parameters (e.g. `https://91.72.153.50:1443` for the demo
   platform). It has a self-signed certificate, so set `"verify_tls": false` there.
3. **Enable** the integration and press **Test connection**: it should list the cameras.
4. **Each bodycam's camera code** (`cameraIndexCode`) on the register, by hand or by import.
5. **The streaming host** in `BODYCAM_STREAM_ORIGINS`, then redeploy. Browsers only play from
   hosts the security policy allows.
6. Switch the **test video off**.

Open questions for Paul, which decide whether step 5 works:

- **Does live view on HCM Lite 2.4.0 return HLS?** The client asks for `protocol: "hls"`. If
  not, the platform's WebSocket stream needs Hikvision's H5 player kit.
- **Are the stream addresses https?** An http address is refused on the HTTPS console; the
  feed says so when it happens.
- **SOS and GPS events from the bodycam.** Not in Lite's guide; not built.

Other parameters: `stream_type` (0 main, 1 sub-stream: lighter on mobile data),
`record_location` (`"0"` central storage, where bodycams upload; `"1"` on the device), and
`transcode` (default on: turns H.265 into H.264 for browsers).

## Before 0054 is run

The web pages load and say "run migration 0054_bodycams.sql" where they need it. The map,
the incident page and the Captain tile simply show no bodycams. The app's start of shift has
no bodycam step, its end of shift has nothing to hand back, and the watch notice stays
hidden.

## Test day

Run 0054 first (0050 and 0051 too, if they have not been run). Switch the test video on.

1. **Load the register.** Download the bodycam template, fill in three bodycams and import
   them. Import the same file again: everything should be unchanged.
2. **Start a shift.** The officer (police01.metro) completes readiness, the vehicle and the
   firearm, then books out a bodycam with all three checks.
   - Today's shift (captain.metro) shows the bodycam.
   - The register shows it booked out, with its holder.
3. **Fail a check.** A second officer books out another bodycam with the battery check
   unticked and a note.
   - It shows In repair, and command gets an alert.
   - The app offers "Back to bodycams". Choose "No bodycam today" with a reason; Today's shift
     shows it.
4. **Watch.** The captain opens Body Cams, chooses the officer, gives a reason and watches.
   - The officer's phone shows "Control room is viewing your camera" within 15 seconds.
   - "Who has watched" on the register shows the view.
   - Open four feeds; a fifth is refused.
   - Leave one open ten minutes: "Still watching?" appears, then it stops.
5. **From the map and an incident.** Dispatch an incident to the officer. Click the officer's red
   dot on the live map: the feed opens on the left. On the incident page, "Watch live" opens
   without asking why; the incident's history shows the view.
6. **Footage.** The case manager opens Body Cam Footage from the incident, plays a booking,
   and gives a reason. The case manager cannot open Body Cams live.
7. **End the shift.** The officer tries to end the shift first: refused until the bodycam is
   back. Hand it back as damaged with a note. Command is told; any live view stops.
8. **Doors.** Viewer and IncidentLogger see SANRAL Cameras but not Body Cams. The fire
   supervisor cannot see police bodycams.

## Known gaps

- **Real video waits for the platform** (above). Until then only the test video plays.
- **Handing back needs signal**, as for firearms; the keeper can receive it on the web.
- **Bodycam GPS and its SOS button** are not used yet: the map uses the phone's position, and
  the app's own SOS stands. Both depend on HCM Lite's events.
- **The officer is told within about 15 seconds**, not instantly: the app checks rather than
  listens, to keep it light.
- **Fire, EMS and Disaster** have no bodycam step; the register and watching are built for any
  department, and adding a department is a change to `shift_requires_bodycam`.
- **Data cost.** Each live feed uses the bodycam's 4G data. The four-feed limit and "Still
  watching?" keep it down; `stream_type: 1` (sub-stream) halves it again if picture quality
  allows.
