# 25 — Radios: PocStar, RealPTT, the Radio Desk and the SOS key

## Run once

In the Supabase SQL editor, after 0081: `0082_radio_register.sql`. It is safe to
run again.

## What the field uses

| Device | Platform | What we found |
|---|---|---|
| Estalky E977 radio | **PocStar** (Constellations console) | Android 12. The PTT app is `com.shli.interphone`, a Netstream build of PocStar's (`2.9.4.15_Netstream_E966_E977_HW_3`). It is logged in as "FIRE ALPHA" in group "Netstream" and reports its GPS every 10 seconds to PocStar's Johannesburg server. |
| Smart hard hats | **PocStar** | Not yet checked on the device. |
| Older radios Nets1–4 | **RealPTT** | Company account `nets`, talk group 161632. Last seen between January and August 2026. |

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

- **Each radio:** online or offline, battery, last position and how fresh it is,
  last time online.
- **Platform status:** connected, waiting, or not answering.
- **Tiles and filters:** totals for radios, online, low battery, hard hats and
  not in the register, plus search and filters.
- **For a RealPTT radio:** text to the radio (audited as `RadioTextSent`) and
  the last 2 hours of recordings.
- **Refresh:** every 15 seconds. The server asks each platform at most every
  10 seconds, however many people are looking.
- **PocStar:** shows "Waiting for PocStar's API" until it is connected. Radios in
  the register still appear. No made-up data.

RealPTT needs `REALPTT_ACCOUNT` and `REALPTT_PASSWORD` in the server environment.
**Change the RealPTT password before go-live.** V4 had it written into its code.

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
- **Talking from the console:** RealPTT's web SDK (we have it from V4), and
  PocStar's if they have one.
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
