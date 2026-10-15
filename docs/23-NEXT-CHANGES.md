# Next changes

The changes still to make, one at a time. Each has the decision and a short plan.

---

## 1. Languages

**Decision:** we build our own translator. There's no live translation service.
Every screen in the console and the phone app can be shown in South Africa's
official written languages, from translations that people have checked.

**Why not a translation service (Google, Azure and the like):**

- Machine translation of the smaller languages isn't accurate enough for
  emergency work. One wrong word on "Critical" or "Accept incident" is a real
  risk.
- The field app must work offline.
- Government security: screen wording would go to Google or Microsoft on every
  screen.
- The free allowances run out, and every screen waits on the network.

### The languages

| Language | Code | Notes |
|---|---|---|
| English | `en` | The source. Every sentence is written in English first. |
| isiZulu | `zu` | |
| isiXhosa | `xh` | |
| Afrikaans | `af` | |
| Sepedi (Northern Sotho) | `nso` | |
| Setswana | `tn` | |
| Sesotho | `st` | |
| Xitsonga | `ts` | |
| siSwati | `ss` | |
| Tshivenda | `ve` | |
| isiNdebele | `nr` | |
| South African Sign Language | — | Has no written form, so it can't be a screen language. It needs sign-language videos or a relay interpreter service: a separate project (see *To decide*). |

### How our translator works

1. **One word list for both apps.** It lives in `packages/db/src/i18n`. Each
   sentence is found by its English, for example "Send to dispatch now". The
   console and the phone app both read from it, so a sentence is translated
   once. A word with two meanings carries a short note (the context), so each
   is translated on its own.
2. **The glossary first.** A short list of the words that matter most
   (Critical, High, P1–P4, En Route, On Scene, Dispatch, Accept, Not needed,
   Details to follow). Each has one approved translation per language. Some
   may stay in English on purpose, because crews know them that way.
3. **Machine draft.** On the Translations page, *Draft with Criti* sends only
   the screen wording (never call data) to our AI provider (Grok or Gemini),
   glossary first. Each result is saved as **Draft**. It never overwrites a
   person's draft or an approved sentence.
4. **Human check, in the app.** A *Translations* page, for translators and
   administrators, shows:
   - the English beside the draft, and where the sentence appears;
   - the glossary words it uses.

   The translator corrects the draft and marks it **Approved**. Each approval
   records who approved it and when.
5. **Only approved text is shown.** A sentence not approved yet shows in
   English, never as an unchecked draft. These checks stop a mistake before it
   reaches a phone:
   - the word list matches the screens (a test fails if a sentence was added
     and the list wasn't rebuilt);
   - a sentence can't be built from pieces the list can't see;
   - any `{number}` or `{name}` in the English must still be in the
     translation. The database refuses one without it, and the apps show the
     English instead.
6. **Picking a language.**
   - **Console:** the language menu in the top bar, saved to the person's
     profile, so it follows them to any computer.
   - **Phone:** on the Profile screen. It starts in the phone's own language
     if we have it.
   - **Offline:** the phone keeps the approved translations, so switching
     works with no signal. New approvals reach it the next time it's online.
7. **What is never translated:**
   - what people type (call descriptions, notes, reports, statements): these
     are records and stay exactly as entered;
   - names, addresses, incident numbers and registrations.
8. **Admin's own lists** (incident types, injuries and the like) get a
   translated name per language, added in the same Translations page.
9. **Criti** answers in the person's language when asked. Its answers are
   marked as AI, as now, because they aren't checked by a translator.

### Tools

Our own, about 300 lines across both apps, with no new packages. Off-the-shelf
libraries (`next-intl`, `i18next`) would mean two setups and a second word
list. Ours reads the same list in both apps and works offline.

### Plan, in order

| Step | What | Who | Visible to users | Status |
|---|---|---|---|---|
| 0 | Agree the glossary and find accredited translators (SATI, or the municipality's language unit). | Minenhle, the client | No | Waiting |
| 1 | The word list, the checks, the language picker and the profile setting. English only. | Us | The picker, with English only | Done (migration 0078) |
| 2 | Move the phone app's wording into the word list. | Us | No change | Done |
| 3 | Draft isiZulu and Afrikaans, translators check them, and ship to the phones. | Us, translators | isiZulu and Afrikaans on the phone | Ready to start |
| 4 | Move the console's wording into the word list. | Us | No change | Started: the call logger |
| 5 | Console in isiZulu and Afrikaans. | Translators | Console in 3 languages | |
| 6 | The other eight languages, as the translators finish each one. | Translators | One language at a time | |
| 7 | Admin lists, the guides, and messages sent by push and SMS. | Us, translators | Yes | |

The coding is steps 1, 2 and 4: moving a few thousand sentences out of the
screens. The translation itself is the longest part, and it runs alongside
the coding.

### Where things are

- **The word list:** `packages/db/src/i18n/source.ts`, 3,455 sentences, built
  from the screens and the forms. After changing any wording, rebuild it with
  `node --experimental-strip-types scripts/i18n-extract.mjs`.
- **The Translations page:** `/translations` in the console, for
  administrators and the people given a language to translate. It drafts with
  Criti, saves, approves and downloads.
- **On the phone:** every screen, the department forms (police reports, fire
  report, patient report, post-mortem, fines, shift checks) and the shared
  helpers use the word list.

### Still in English on the phone, on purpose or for later

- **Records:** the printed fine slip, the start-of-shift PDF, the patient
  report's dispatch summary, photo captions, and the SOS text message to the
  control room. These are official records or go to others (see *To decide*).
- **Words from the server:** a refusal from the database ("Choose a vehicle
  first") shows as the server wrote it.
- **Names an administrator types:** shift names, leave types and the like
  (step 7).
- **The map's pop-up cards** are drawn inside a web page on the map. Their
  labels ("Cases of…", "Ranked…") are a small follow-up.
- **The buttons on a dispatch notification** (Open, Navigate, Acknowledge) are
  set when the app starts, in English (step 7).

### To decide

- Which two languages come first. The plan assumes isiZulu and Afrikaans;
  please confirm with eThekwini.
- Who the translators are, and who approves for each language.
- Whether PDF reports and case files stay in English as the official record,
  or follow the reader's language.
- How to serve South African Sign Language users (videos of key screens, or a
  relay interpreter link).

---

## 2. The call logger, round two

**What changes:**

- The description is built around the incident type, not around injuries.
- Every type gets its code.
- A new incident number shows the departments, the date and the time.

### 2.1 The description follows the incident type

Most calls aren't about someone hurt: "They broke in and stole my phone and
TV." Today the Description window is built for injuries.

- **Locked until the type is chosen.** The Description box says *Choose the
  incident type first* and doesn't open until then. Everything inside is made
  for that type.
- **Template sentences.** When it opens, it shows one to three short sentences
  for the type. One click puts a sentence in the description. The blanks are
  buttons: click one to choose (for example *a home / a business*), or type
  over it. We write them for every type, and the client checks them. They are
  then translated with the rest of the screens (item 1).
- **Details for the type.** A few quick fields that suit the type, as V4 had
  ("Weapon description", "Vehicles involved"). They come from small sets that
  types share:

| Set | Asks | Used by, for example |
|---|---|---|
| What was taken | Cellphone, TV, laptop, cash, jewellery, vehicle, firearm, other | Burglary, robbery, theft, hijacking |
| Suspects | How many; what they look like; weapons (none, knife, firearm, other); vehicle and registration; which way they went; still there? | Most crimes |
| Vehicles | How many; registrations; road blocked?; anyone trapped?; fuel leak or fire? | Traffic |
| Fire | What is burning; anyone inside?; is it spreading? | Fire |
| Patient | Age; man or woman; awake?; breathing? | Medical |
| Homes and people | Homes affected; people needing shelter; anyone trapped? | Disaster |

- **Ask the caller, with one-tap answers.** Each question has its answers as
  buttons: *Is the attacker still there?* **Yes / No / Not known**. A tap fills
  the matching detail and the template sentence.
- **Injuries only when someone may be hurt.** The injuries list shows for
  medical and injury types, or once *Is anyone hurt?* is answered Yes. The
  injuries that fit the type come first (for an assault: head injury, stab
  wound, cuts and bruises). The search finds injuries only.
- **Who.** The answer to *Who is hurt* (the caller or someone else) goes into the
  sentence: "The caller was assaulted…" or "A person was assaulted…".

Examples:

> **Burglary.** Break-in at **[a home / a business]**. **[What was taken]**
> taken. The suspects are **[still there / gone]**.
> After two clicks and the stolen items ticked: *Break-in at a home. A
> cellphone and a TV taken. The suspects are gone.*

> **Assault.** **[The caller / A person]** was assaulted by **[one person /
> 2 people / a group]**. The attacker is **[still there / gone]**.

### 2.2 Criti works on top of that

- **Reads the typed words for the type's details.** If it hears "they took my
  phone and TV", it ticks Cellphone and TV, marked ✦ Criti.
- **Write it up.** Turns the details and answers into a short, clear
  description for the call taker to check. It uses only what was said and
  never makes anything up.
- **Questions for the type.** It chooses them by the type and what is still
  unknown, and stops asking what is already answered.
- **Same rules as now.** It fills only empty fields and is never sent the
  caller's name or number.

### 2.3 Where the details go

- **Saved separately from the caller's words.** V4 folded them into the
  description as "[Label: value]". Keeping them separate lets reports count
  them (for example, cellphones stolen this month), and a short summary still
  shows under the description.
- **Shown everywhere the call is read:** the dispatch page, the call page, the
  crew's phone and the case PDF.
- **Added later too.** They can be added after an early send, like the other
  details.

### 2.4 Incident codes

**What the research found:**

- **No official list is published.** Nothing turned up for eThekwini or
  nationally. I searched eThekwini's website and tenders, SAPS, the Fire
  Protection Association and EMS research. Each dispatch centre sets its own
  codes.
- **V4 used radio 10-codes** for 52 incident types in 8 groups, for example
  *10-50 PI Accident (Personal Injury)*, *10-32 Armed Individual / Subject
  with Gun* and *10-70 Fire Alarm / Report*. They are the client's codes from
  the old system. The full list is below, with V4's extra fields per type.
- **Our database's codes are placeholders** (10-1 Assault, 10-2 Robbery, 10-3
  Burglary, 20-1 Motor Vehicle Accident, 30-1 Structure Fire…). They aren't
  V4's codes, and they clash with radio meanings (in V4, 10-10 is a fight).
  They will be replaced.
- **Two official national schemes exist:**
  - SAPS crime categories, for example *Burglary at residential premises*, or
    *Robbery with aggravating circumstances → Carjacking*.
  - For EMS, P1–P4 with the South African Triage Scale colours (red, orange,
    yellow, green, blue). These are already on the form.

**What was decided and built (migration 0077):**

- **Code first.** Every type shows its code first: *10-50 PI · Crash with
  injuries*.
- **V4's types came over.** 39 V4 types were added with their codes. There are
  123 types in all.
- **V4's code where the type is the same** (53 types): *10-10 Fight*, *10-50 PI
  Crash with injuries*, *10-11C Dog bite / animal attack*.
- **Our own code for the rest** (70 types): two letters for the group and a
  number, for example *CR-03 Burglary*, *TR-02*, *FI-04*, *ME-07*, *PO-01*,
  *DI-05*. They don't look like radio codes, so they can't be mistaken for
  one.
- **The old placeholder codes** (10-1 Assault and the like, which clashed with
  radio codes) are replaced. A code an administrator already changed is kept.
- **SAPS categories.** Each crime type is tagged with its official SAPS
  category. Where the details decide it, they do: a burglary at a home is
  *Burglary at residential premises*.
- *Suspicious person or vehicle* is retired. V4's *10-37 Suspicious person*
  and *10-38 Suspicious vehicle* replace it.
- **Admins can still edit codes** in Admin → Configuration.

### 2.5 The incident number

Departments, date, time and number of the day:

`MP-20261010-1115-0034`

| Part | Meaning |
|---|---|
| `MP` | The departments it was sent to: **MP** Metro Police, **FD** Fire Department, **MD** Medical (EMS), **DM** Disaster Management. Always in that order. |
| `20261010` | The date it was sent to dispatch: 10 October 2026. |
| `1115` | The time it was sent, 24-hour: 11:15. |
| `0034` | The 34th call of the day. |

The department codes are joined in pairs, as in your examples:

| Sent to | Number |
|---|---|
| Metro Police | `MP-20261010-1115-0034` |
| Metro Police, Fire | `MPFD-20261010-1115-0034` |
| Metro Police, Fire, EMS | `MPFD-MD-20261010-1115-0034` |
| All four | `MPFD-MDDM-20261010-1115-0034` |
| Fire, EMS | `FDMD-20261010-1115-0034` |
| EMS only | `MD-20261010-1115-0034` |

Rules:

- **Made when sent.** The number is created the moment the call is sent to
  dispatch, never before. That covers *Send to dispatch*, *Send to dispatch
  now*, Criti logging a call, and an officer's SOS.
- **South African time,** so a call at 23:59 gets the right date.
- **One counter per day,** for the whole organisation, starting at 0001 at
  midnight. Two calls sent in the same minute to the same departments still
  differ: 0034 and 0035.
- **It never changes.** If a department is added later, the call shows it, but
  the number stays as sent. By then it's already on the radio, the crew's
  phone and the paperwork.
- **Old calls keep their numbers.** Calls already on record keep their INC-
  numbers.
- **It fixes a fault.** Today each department has its own daily counter, so
  the control room and Metro Police can both have *INC-20261015-0001* on the
  same day. One counter fixes that.

What changes with it:

- the three places that create a call (logging, sending early and SOS);
- the number becomes unique across the organisation;
- Criti and search recognise both the old and new numbers, and "call 34";
- the longer number has to fit on the phone, the PDFs and SMS.

### Plan, in order

| Step | What | Who | Status |
|---|---|---|---|
| 0 | Confirm the number rules. | Minenhle, the client | Done: pairs, V4 codes and our own, SAPS categories |
| 1 | The new incident number, tested on Postgres. | Us | Done |
| 2 | Types and codes: V4's types and codes added, the placeholders replaced, our own codes for the rest. | Us | Done |
| 3 | The description by type: locked until the type is chosen, templates, details, one-tap answers, injuries only when someone is hurt. | Us | Done |
| 4 | Criti on top: reading the details, *Write it up*. | Us | Done |
| 5 | The details on the dispatch page, the call page, the phone and the PDF. | Us | Done |
| 6 | Templates written for every type (all 123 have them; 111 have details to fill in), then checked by the client. | Us, the client | Written; waiting for the client's check |
| 7 | Guides and docs updated. | Us | Done |

The database changes are in `0077_call_details_numbers.sql`, after `0076`.

### Decided

- **The pair rule** holds for every combination, for example Fire and EMS as
  `FDMD-…`.
- **Codes:** V4's where the type is the same, our own for the rest.
- **SAPS categories:** yes, on every crime type.
- **The number never changes** once sent, and the counter restarts at midnight
  for the whole organisation.

### V4's incident codes

"Ours now" is the type we already had before 0077; **New** means the type was
added.

| Code | V4 name | Ours now |
|---|---|---|
| **Critical / in progress** | | |
| 10-33 | Emergency / Officer Needs Assistance | New |
| 10-32 | Armed Individual / Subject with Gun | New |
| 10-31 | Crime in Progress | New |
| 10-34 | Riot / Civil Unrest | Violent protest / riot |
| 10-89 | Bomb Threat | New |
| 10-90 | Bank Alarm / Holdup | New |
| 10-98 | Prison Break | New |
| **Traffic and accidents** | | |
| 10-50 | Vehicle Accident (General) | Motor Vehicle Accident |
| 10-50 PI | Accident (Personal Injury) | Crash with injuries |
| 10-50 PD | Accident (Property Damage) | New |
| 10-50 F | Accident (Fatality) | New |
| 10-55 | Intoxicated Driver (DUI) | Drunk driver |
| 10-57 | Hit and Run | Hit and run |
| 10-80 | Vehicular Chase | New |
| 10-94 | Illegal Street Racing | New |
| 10-46 | Disabled Vehicle / Assist Motorist | New |
| 10-51 | Tow Truck / Wrecker Needed | New |
| **Roads and obstructions** | | |
| 10-53 | Road Blocked | Road blocked |
| 10-93 | Roadblock / Checkpoint Setup | New |
| 10-92 | Illegally Parked Vehicle | New |
| 10-47 | Road Repair Needed | New |
| 10-48 | Traffic Sign Repair Needed | New |
| 10-49 | Traffic Light Out | Traffic lights out |
| 10-58 | Direct Traffic / Point Duty | New |
| **Animals** | | |
| 10-11 | Animal Case (General) | New |
| 10-11A | Pick up Animal | New |
| 10-11B | Stray Animal | New |
| 10-11C | Animal Bite / Vicious Animal | Dog bite / animal attack |
| 10-11D | Dead Animal Removal | New |
| 10-11E | Injured Animal | New |
| 10-45 | Animal Carcass in Road | New |
| 10-54 | Livestock on Road | New |
| **Disturbances and suspicious activity** | | |
| 10-10 | Fight / Physical Altercation | New |
| 10-16 | Domestic Disturbance | Domestic violence |
| 10-15 | Civil Disturbance / Noise Complaint | Noise complaint |
| 10-14 | Prowler Report | New |
| 10-37 | Suspicious Person | Suspicious person or vehicle (split in two) |
| 10-38 | Suspicious Vehicle | Suspicious person or vehicle (split in two) |
| 10-99 | Stolen / Wanted Vehicle or Person | New |
| **Fire and hazmat** | | |
| 10-70 | Fire Alarm / Report | Structure Fire, House fire and the other fire types |
| 10-71 | Nature of Fire (Specify in Notes) | New |
| 10-73 | Smoke Report | Smoke seen |
| 10-25 | Gas Leak / Hazmat | Gas leak, Hazardous chemical spill |
| **Medical and welfare** | | |
| 10-52 | Ambulance Requested | The medical types |
| 10-56 | Intoxicated Individual (Pedestrian) | New |
| 10-96 | Mental Health / Psych Case | Mental health crisis / suicide attempt |
| 10-79 | Coroner / Mortuary Van Needed | New |
| **Police service and transport** | | |
| 10-17 | Meet Complainant | New |
| 10-21 | Call Complainant (Telephone) | New |
| 10-59 | Escort (Funeral / VIP) | New |
| 10-91 | Pick up Subject / Prisoner Transport | New |
| 10-78 | Request Assistance (Non-Emergency) | New |

From V4: `Data/ConfigSeeder.cs` (codes and extra fields) and
`Views/ControlRoom/LogNew.cshtml` (the call form).

### Sources

- SAPS crime categories:
  [SAPS Annual Crime Report 2022/23](https://www.saps.gov.za/services/downloads/2022-2023-Annual-Crime-Statistics-Report.pdf),
  [the categories as a list](https://github.com/afrith/crime-stats).
- South African Triage Scale:
  [SATS training manual](https://emssa.org.za/wp-content/uploads/2011/04/SATS-Manual-A5-LR-spreads.pdf).
- Dispatch priority and triage in South Africa:
  [Western Cape study](https://link.springer.com/article/10.1186/s12873-025-01198-9).
- Each dispatch centre sets its own codes:
  [PulsePoint](https://www.pulsepoint.org/incident-types).

---

## 3. *(waiting for Minenhle)*
