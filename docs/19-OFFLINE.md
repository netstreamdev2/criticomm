# The responder apps offline

A crew loses signal in basements, lifts, the industrial south and long
stretches of the N3. From version 1.2.0 the officer app (police, fire, EMS,
disaster) keeps working without signal. It keeps what it has seen,
stores everything the officer does, and sends it all when signal returns.
Dispatch sees where the crew went while they were offline, once the phone
reconnects.

## What works with no signal

| | Offline | When signal returns |
|---|---|---|
| **Staying signed in** | The app opens signed in, even after it was closed. Before 1.2.0 it went back to the sign-in screen once the one-hour sign-in was due for renewal. | The sign-in is renewed. If the server refused it (account deactivated), the app signs out. |
| **Start of shift** | A shift started today stays started. | — |
| **Every screen already opened** | Shows what was saved: home, calls, the call sheet, timeline, schedule, alerts, leave, performance. The sync tray says when it was saved. | Screens refresh. |
| **Calls sent to the officer** | The call sheet, timeline and report details are saved ahead of time while there is signal, even if the officer never opened them. | — |
| **Accept, En Route, On Scene, Transporting** | Recorded at the moment pressed. | Sent in order, with the real times. |
| **Notes, photos, voice notes** | Kept on the phone. | Uploaded, with no duplicates. |
| **Reports: police incident report, fire report, patient report (PCR), post-mortem** | Open, fill in and file. A call accepted offline counts as the officer's. Photos still on the phone count towards the report. | Filed after the statuses it depends on. Never filed twice. |
| **Fines, firearm checks** | Issued and recorded (as before). | Sent. |
| **SOS** | Sent first the moment there is signal (as before). | — |
| **Alerts: read, acknowledge** (in the app and from the notification buttons) | Recorded. | Sent. |
| **Roster: "I have read this duty"** | Recorded. | Sent. |
| **Leave requests** | Recorded. | Sent, never twice. |
| **GPS route** | Recorded with the screen off and the app in the background (see below). | The whole route is sent; the console map draws it. |

Needs signal, and says so in plain words ("No connection. Try again when you
have signal."): signing in the first time, the start-of-shift steps (vehicle,
inspection, firearm, bodycam), ending the shift and signing out. Signing out
is refused offline on purpose: the vehicle and duty would stay held on the
server, and dispatch would keep sending calls to someone who has gone.

A screen the officer never opened while online, for a call not sent to them,
cannot be shown offline. Map tiles need signal.

## The route while offline

While the officer is on duty the phone records where they are: on Android
as a foreground service (the "On duty" notification), so it keeps recording
with the screen off. It needs only the "while using the app" location
permission. If the service cannot start, it records while the app is open.

- A fix is kept every 20 m of movement, or once a minute when parked. Rough
  fixes and GPS jumps are dropped (`apps/mobile/lib/track-policy.ts`).
- Fixes are written to the phone first and sent in batches every 15 to 30
  seconds. With no signal they wait, for up to 70 hours.
- When signal returns the whole stretch is sent. The server skips any fix it
  already has, so a batch cut off halfway is simply sent again.
- The dispatcher's marker moves only forward in time. A stretch delivered
  late never drags it back.

**On the console map**, the "Routes driven" layer (on by default for
dispatch, control room and supervisors) draws each on-duty officer's route
since they went on duty, in their department's colour. **Dashed** stretches
were recorded with no signal. An officer whose phone has not checked in for 3
minutes shows greyed out, with "Offline since 10:42". Their route fills in
when they reconnect.

**Who sees a route:** the officer, plus dispatch, the control room,
supervisors, captains, chiefs and the admin tier. They see only officers they
can already see; a department's dispatch desk sees only its own department.
Nobody can write or change a route except the officer's phone, and only for
themselves. Routes are kept for 90 days (Operations Settings,
`duty.track_retention_days`, 7 to 365), then deleted nightly. Nothing is
recorded off duty.

**POPIA:** a location history of staff is personal information. It is
recorded only on duty, for operational dispatch and safety, and is readable
only by the people above. Confirm the retention period with the information
officer.

## Setting it up

1. Run `supabase/migrations/0071_duty_tracks.sql` in Supabase, after 0070.
   Without it the console works as before, and the phone keeps the route
   until the migration is run.
2. Build a new APK: `eas build -p android --profile field-test`, from
   `apps/mobile`. Version 1.2.0 adds a native module (expo-task-manager), so
   `eas update` cannot bring 1.1.0 phones up to date.
3. On first going on duty, allow location (and notifications, so the "On
   duty" notification shows).

## Test script

1. Sign in on the phone with signal and start the shift. From the console,
   assign the officer a call. Do not open it on the phone.
2. Turn on aeroplane mode. Close the app completely (swipe it away) and open
   it again. It opens signed in, on the shift, with home and the call list
   as they were. The sync tray says "Offline".
3. Open the call: its sheet and timeline show. Accept, then On Scene. Add a
   photo and a note.
4. Open the report and file it. It says "Saved. It sends when you have
   signal." The sync tray lists everything waiting.
5. Acknowledge an alert. On Schedule, confirm a duty. Apply for a day's leave.
6. With the phone in a pocket and the screen off, walk or drive 500 m or more.
7. Turn aeroplane mode off. Within a minute the sync tray empties. The
   console shows the call resolved with the real On Scene time, the photo and
   the note. On the map, the route appears, dashed for the offline stretch,
   and the marker is where the officer is now.
8. Try signing out in aeroplane mode: it says to do it with signal.

## How it is built

| Piece | Where |
|---|---|
| Staying signed in offline | `apps/mobile/lib/auth.tsx`, `readSavedSession()` and `keepUserOffline()` in `lib/supabase.ts` |
| Saving reads, answering offline | `lib/offline-cache.ts` (the fetch under supabase-js), rules in `lib/offline-cache-policy.ts` |
| Saving calls ahead of time | `lib/offline-prefetch.tsx` |
| The outbox (every action) | `lib/outbox.ts`, `lib/outbox-policy.ts`, delivery in `lib/sync.tsx` |
| Reports offline | `statusOnPhone`, `leadsOnPhone`, `mediaOnPhone` in `lib/outbox-policy.ts`, used by the four report screens |
| Route recorder | `lib/tracker.ts`, `lib/route-task.ts` (defined at start-up from `index.ts`), `lib/route-tracker.tsx` |
| Server | `0071_duty_tracks.sql`: `duty_tracks`, `record_track()`, `list_duty_tracks()`, `personnel.location_at` |
| Console map | `apps/web/components/ops-map/ops-map.tsx` (Routes driven), `lib/ops-map/layers.ts` (`routeSegments`, `offlineSince`) |

Saved answers are filed per person and deleted on sign-out, so the next
person on a shared handset sees none of them. They are kept in files, not
AsyncStorage, which Android caps at a few megabytes. Answers that depend
on "today" are only shown on the day they were saved. Nothing older than
48 hours is shown.

## Verified

- Unit tests: phone 82 (offline rules, route rules, reports offline, queued
  alerts, duty and leave), console 80 (routes and offline on the map). Type
  checks pass for the phone, console and packages.
- `scripts/test-duty-tracks.mjs` runs 0071 on Postgres (PGlite), 9 scenarios:
  resends add nothing, the marker never goes back, a late stretch reads as
  offline, off-duty fixes do not place the marker, bad points are dropped,
  nobody writes routes directly, who reads them, thinning, retention.

Not yet verified on a phone: background recording with the screen off, and
the whole script above. They need the 1.2.0 APK.
