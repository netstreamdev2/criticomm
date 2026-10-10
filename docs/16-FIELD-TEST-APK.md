# Building the field-test APK and testing offline and notifications

Expo Go cannot test push notifications or the app as installed. This builds a
real Android APK you install on the phones.

## 1. The database (once)

In the Supabase SQL editor run, in order, any not yet applied:
`0062_call_intake_and_shift_vehicles.sql`, `0063_ems_incident_flow.sql`,
`0064_hospital_handover.sql`, `0065_disaster_flow.sql`,
`0066_fire_safety_inspections.sql`, `0067_role_fits_department.sql`,
`0068_dispatch_desk_tags.sql`, `0069_no_anonymous_reads.sql`.

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

## 4. What to test

Accounts are the seeded ones, password `Test123!`.

**Notifications** (field-test build): sign in on the phone, allow
notifications. From the console as the dispatcher, assign a call to that
officer. With the app in the background or the phone locked, the alert
arrives with Accept / Navigate / Acknowledge.

**Offline**: start a call on the phone (Accept, On Scene). Turn on aeroplane
mode. File the report (police, fire, patient or post-mortem) and add a photo.
The home shows "queued". Turn aeroplane mode off: the queue sends itself and
the console shows the call resolved. Filing twice never files twice.

**Each department, start to finish:**
- Police (`police01.metro`): start of shift (readiness, vehicle or "no
  available cars", 187(c), firearm, bodycam, licence/ID optional), a call,
  the incident report.
- Fire (`firefighter01`): start of shift, a call, the fire report.
- EMS (`paramedic01.med`): start of shift, a call, the patient report with the
  hospital handover; `doctor.med` sees it under Hospital Handovers.
- Disaster (`disaster01`): readiness-only start of shift, a call, the
  post-mortem.

Sign-in itself needs a connection; everything after that queues offline.
