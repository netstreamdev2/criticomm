# 25 — Radios: PocStar, our own Talk, the Radio Desk and the SOS key

**On screen, no platform is ever named.** Dispatchers and officers see radios,
people and Talk; never PocStar, RealPTT, LiveKit or "the HikTech app" as a
source. The names below are for the developers only.

## Run once

In the Supabase SQL editor, after 0081: `0082_radio_register.sql`. It is safe to
run again.

## What the field uses

| Device | Platform | What we found |
|---|---|---|
| Estalky E977 radio | **PocStar** (Constellations console) | Android 12. The PTT app is `com.shli.interphone`, a Netstream build of PocStar's (`2.9.4.15_Netstream_E966_E977_HW_3`). It is logged in as "FIRE ALPHA" in group "Netstream" and reports its GPS every 10 seconds to PocStar's Johannesburg server. |
| Smart hard hats | **PocStar** | Not yet checked on the device. |
| Older radios Nets1–4 | ~~RealPTT~~ | **Removed (0087).** The subscription lapsed on 18 August 2026. Code, routes, settings and register entries are gone. |

Constellations (`constellationsza.co.za`) is PocStar's dispatch console under
another name. We have asked PocStar for their API and web SDK.

## The radio register (Admin → Radios)

Each radio, hard hat or dispatcher seat is linked to its platform and account,
the person or vehicle it belongs to, and its department. The Radio Desk, the
map and SOS alerts use this to say "Capt. Dube's radio" instead of an account
name.

- **Who changes it:** the system administrators and the system controller, for any
  department; a department's administrator, for their own only.
- **Who reads it:** dispatch and other organisation-wide roles see every
  department; everyone else sees their own.
- Changes go only through `save_radio_device()`, and every one is audited
  (`RadioAdded`, `RadioChanged`, `RadioRetired`).
- Nothing is deleted. A radio taken out of service is marked Retired.
- Accounts a platform reports that are not in the register are listed at the
  top of the page, ready to add.

## The Radio Desk (`/dispatch/ptt`)

Kept plain, for people who read little:

- **Talk** at the top: join, then hold the button (or the space bar).
- **Three counts:** On, Off, Low battery (only when there is one).
- **List or Map.** Each radio is one row: a green dot (on, pulsing while
  talking) or grey (off, with the time it was last seen), the person's name,
  the battery, and a map button. A name search shows when there are more than six.
- **Map:** street or satellite; the ring round each dot is the battery. Tap a
  radio for its route over the last 12 hours on duty.
- **Refresh:** every 10 seconds.
- Only real radios: the register, and E977/E966 radios running our app. No
  made-up or test accounts.

## The E977's SOS key in the HikTech app

The radio's system sends `android.intent.action.SOS.down` when the orange SOS
key is pressed (and `...SOS.up` when it is let go). The PocStar app listens for
the same signal and raises its own alarm.

The HikTech app now listens for it too (`modules/radio-keys`, a small native
module):

1. A press opens a 5-second countdown with **Send SOS now** and **Cancel**.
2. When the countdown ends, the usual SOS goes out (`raise_panic`): queued
   offline, GPS raced against a timeout, delivered to dispatch and command.
3. Presses within a minute of an SOS are the same emergency and are ignored.

It is limited to E977 and E966 models, because any app on a phone could send
the same signal. **It needs a new app build (APK).** Over-the-air updates
cannot add native code.

## Still to come

- **PocStar, once their API arrives:** devices, GPS, SOS alarms as HikTech
  alerts, hard hat video, recordings, text.
- **Talking from the console with PocStar radios:** PocStar's web SDK, if they have one.
- **Map and incident:** radios on the live map, and a Radio card on the incident
  page.

## Verification

```
node --experimental-strip-types --test packages/api/src/radio/live.test.ts
CASE_PGLITE_MODULE=… node scripts/test-radio-register.mjs
```

## HikTech Talk: our own push-to-talk (0083)

Live voice between the console and the phones, without PocStar or RealPTT.

**Set up once:**
1. Run `0083_talk.sql`.
2. Create a free LiveKit Cloud project. Under Settings → Keys, copy the URL, key and secret.
3. As a system administrator, open **Admin → Radios → Voice server**, paste them and save.
   The secret is kept in the database only and is never shown again.

**Talk groups** (the database decides, in `talk_access()`):

| Group | Who listens | Who speaks |
|---|---|---|
| A department (`dept:MetroPolice`…) | its people, and dispatch | the same, except the call logger and the viewer |
| All call (`all`) | everyone | the dispatch desk, command (captain, fire chief) and administrators |
| A call (`incident:<id>`) | whoever works the call | the same, until the call is closed |

The desk has **priority**: it can talk over a radio. Everyone else gets **Busy**
while someone has the channel.

**How it works:**
- `talk_pass()` signs a 2-hour LiveKit pass inside Supabase (HMAC-SHA256 from
  core `sha256`, no extension), one room per organisation. The phone and the
  console never see the secret. Every join is audited (`TalkJoined`).
- Each transmission is logged in `talk_log` (who, which group, how long).
  Transmissions are cut at 60 seconds, so a stuck button cannot hold a channel.
- **Console:** the Talk panel on the **Radio Desk**, and on each **incident page**
  for its call. Hold the button or the space bar to talk.
- **Phone (app 1.3.0):** the radio icon in the header, or **Talk on this call**
  on a call. Hold the big button to talk. Sound comes through the loudspeaker
  (or a headset or Bluetooth).
- The shared session (`packages/api/src/radio/talk-session.ts`) runs the same on
  both.

**Needs a new app build** (LiveKit's WebRTC is native code): app 1.3.0 on EAS.
Older builds show "Talk needs the new app".

**Not yet:**
- recordings of the audio (LiveKit Egress);
- the radio's physical PTT key (PocStar holds it);
- talking with the screen off;
- our own voice server in South Africa.

```
CASE_PGLITE_MODULE=… node scripts/test-talk.mjs
node --experimental-strip-types --test packages/api/src/radio/talk.test.ts
```

## The HikTech app as the radio's backup (0087)

PocStar is the main platform. While its API is not here, and whenever it is
not answering for a radio, the HikTech app on the same radio stands in.

**Run once:** `0087_radio_presence.sql` in the SQL editor, after 0086. Safe to run again.

**What the app reports** (`apps/mobile/lib/presence.ts`):
- signed in or signed out (sent at once when signing out);
- battery and charging (from the build after 1.3.0, see below);
- network: Wi-Fi, mobile data or no signal;
- the talk group it is in, and whether it is talking now;
- how many positions are waiting on the radio for signal;
- where it is, **on duty only**. Off duty the position is cleared.

It reports every 30 seconds with the app open, at once when talking starts
or stops, and in the background on duty once a minute with the route
recorder. With no signal it skips the report; the route itself is still
queued and sent later (0071). **No audio is kept.**

**The Radio ID.** Each install of the app makes one, like `HT-4F2K-9QXA`, shown
at the bottom of the Talk screen. A radio handed to another person moves to
them, and that is audited (`RadioHandedOver`).

**On the Radio Desk:** a PocStar radio whose person runs the app shows PocStar's
report while PocStar says it is on, and otherwise the app's. Nothing on screen
says which. An E977 or E966 running the app that is not in the register still
shows; ordinary phones do not.

**Admin → Radios:** nobody picks a platform. Type the radio's name (a PocStar
account) or its Radio ID (`HT-…`, a radio running our app); the form works out which.

**Who sees it:** the person, and the desks and command who oversee crews, for
their own department unless they see every department. Only
`report_radio_presence()` writes it, and only for the person signed in.

**Needs a new app build for:** the battery (read by the `radio-keys` module).
Until then the battery shows as a dash. Everything else works over the air.

**Not yet:** the radio's physical PTT key (PocStar holds it; we asked them for
the key's broadcast); "locate now" from the desk (needs push in the build).

```
CASE_PGLITE_MODULE=… node scripts/test-radio-presence.mjs
node --experimental-strip-types --test packages/api/src/radio/live.test.ts
```
