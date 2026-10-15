# Building the field-test APK and testing offline and notifications

Expo Go cannot test push notifications or the app as installed. This builds a
real Android APK you install on the phones.

## 1. The database (once)

In the Supabase SQL editor run, in order, any not yet applied:
`0062_call_intake_and_shift_vehicles.sql`, `0063_ems_incident_flow.sql`,
`0064_hospital_handover.sql`, `0065_disaster_flow.sql`,
`0066_fire_safety_inspections.sql`, `0067_role_fits_department.sql`,
`0068_dispatch_desk_tags.sql`, `0069_no_anonymous_reads.sql`, `0070_criti.sql`,
`0071_duty_tracks.sql`, `0072_schedules.sql`, `0073_department_parts.sql`,
`0074_officer_close.sql`, `0075_desk_radio_filing.sql`, `0076_call_intake.sql`,
`0077_call_details_numbers.sql`, `0078_languages.sql`, `0079_dispatcher_edits.sql`,
`0080_call_channel_patients.sql`.

Schedules (0072) also need pg_cron and pg_net turned on (Database →
Extensions). See `docs/20-SCHEDULES.md`.

The new call-logging form (0076) is described in `docs/22-CALL-INTAKE.md`.
The details by type, the incident codes and the new incident numbers (0077),
and the languages (0078), are in `docs/23-NEXT-CHANGES.md`.
The dispatcher editing a call before dispatch (0079), and how the call came in
with each patient's severity (0080), are in `docs/22-CALL-INTAKE.md`.

## 2. Push notifications (once)

Android push needs Firebase. Without it the app still works, but alerts only
arrive while the app is open.

1. Firebase console → create (or open) a project → add an Android app with
   package `za.co.ethekwini.criticom` → download `google-services.json`.
2. Give it to EAS (from `apps/mobile`):
   `eas secret:create --scope project --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json`
3. Firebase → Project settings → Service accounts → generate a private key
   (JSON). Then `eas credentials` → Android → `za.co.ethekwini.criticom` →
   Push Notifications: FCM V1 → upload that key.

## 3. Build

From `apps/mobile`, signed in to the Expo account that owns the project
(`npx expo whoami`; the project owner is `kruzen22`):

- With push: `eas build -p android --profile field-test`
- Without push (alerts only while open): `eas build -p android --profile preview`

When it finishes, open the link on each phone and install the APK (allow
"install unknown apps"). Later code changes reach installed phones with
`eas update --channel preview` — no reinstall — unless a native module changes.

Version 1.2.0 adds one (background location, for the route recorder), so
phones on 1.1.0 need the new APK; updates sent to 1.2.0 never reach 1.1.0.

## 4. What to test

Accounts are the seeded ones, password `Test123!`.

**Notifications** (field-test build): sign in on the phone, allow
notifications. From the console as the dispatcher, assign a call to that
officer. With the app in the background or the phone locked, the alert
arrives with Accept / Navigate / Acknowledge.

**Offline** (the full list is in [19-OFFLINE.md](19-OFFLINE.md)): sign in and
start the shift with signal, then open the call the dispatcher sent. Turn on
aeroplane mode, close the app completely and open it again: it opens signed
in, on the same shift. Accept, On Scene, add a photo and a note, and file the
report (police, fire, patient or post-mortem). Walk or drive a few hundred
metres. Turn aeroplane mode off: the queue sends itself, the console shows
the call resolved, and on the console map (Routes driven) the walk appears,
dashed where there was no signal. Filing twice never files twice.

**Each department, start to finish:**
- Police (`police01.metro`): start of shift (readiness, vehicle or "no
  available cars", 187(c), firearm, bodycam, licence/ID optional), a call,
  the incident report.
- Fire (`firefighter01`): start of shift, a call, the fire report.
- EMS (`paramedic01.med`): start of shift, a call, the patient report with the
  hospital handover; `doctor.med` sees it under Hospital Handovers.
- Disaster (`disaster01`): readiness-only start of shift, a call, the
  post-mortem.

Signing in the first time, starting the shift and signing out need a
connection; everything in between works offline.
