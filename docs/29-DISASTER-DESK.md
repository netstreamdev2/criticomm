# The Disaster desk

Built 26 October 2026. Migration `0111_disaster_desk.sql` (run after 0110).

## Why

eThekwini Disaster Management has no field workers on the app. The whole
operation runs from the Disaster dispatch desk:

1. The call taker logs the call as usual and sends it to Disaster.
2. The desk calls out the partners the call needs: V4's mutual-aid list
   (Eskom KZN Control Center, Amanzimtoti Fire Station, SASSA, the
   hospitals, Gift of the Givers …), by phone, radio or WhatsApp.
3. The partners report back; the desk logs each update with how it came in
   (call, radio, WhatsApp, other) and from whom, until they leave the scene.
4. The desk files the post-mortem; the case goes to case review as before.

The apps are now Police, Medical and Fire. The Disaster phone screens stay in
the code, unused.

## Screens (web)

- **Disaster Desk** (`/disaster/desk`): every open call sent to Disaster, the
  ones that need the desk first (nobody called out, no news for 30 minutes,
  a partner not on the way), then by severity.
- **The call's command board** (`/disaster/desk/[id]`): the call at a glance
  with live timers (since the call, since the last news, partners there,
  coming and called); log an update; the timeline; Criti; the partners
  called out with their numbers, radio channels, status and timers; call out
  a partner (search the list, or someone not on it); the map. It refreshes
  live for every dispatcher on the desk.
- **Post-mortem**: opened from the board with the start and end times filled
  in; **Draft with Criti** writes the cause, the lessons and the counts from
  the timeline into the empty fields, for the dispatcher to check.
- The old **Dispatch Resources** page opens the desk. The incident page has
  **Open on the Disaster desk** for Disaster calls.
- **Layout**: solid tiles (nothing see-through over the background photo).
  The desk list is a grid of tiles: a call that needs the desk now, or is
  Critical, gets a big tile; the rest are small. The command board fits one
  desk screen: what came in and the timeline on the left, Criti in the
  widest column in the middle, the partners on the right; each tile scrolls
  inside itself. Smaller screens stack the tiles.
- **Menu** (everyone on the Disaster desk: Disaster officers, Disaster
  dispatchers and control room, supervisor, administrator): Disaster Desk,
  Dashboard, Post-Mortems, Partner List, Disaster Incidents, then staff,
  reports and settings. The field-dispatch items are gone (Dispatch
  Resources, Active Responders, Live Map, start of shift, readiness review).
  Dispatchers open on the desk; the supervisor and administrator on the
  dashboard.
- **Dashboard** (`/disaster`): the desk's figures (open calls, calls that
  need the desk, partners working, time to the first call-out, displaced
  people filed), the open calls, the map, the wind, recent post-mortems. The
  field parts are gone (standby officers, on-site assessments, V4's
  deployment monitor), and so are the old dispatch and periodic-update
  actions that wrote `disaster_logs` from the browser.

## Criti on the desk

Two halves (`packages/api/src/criti/disaster.ts`, tested in `disaster.test.ts`):

- **The desk's rules**, no AI, so they work when every provider is down:
  nobody called out after 5 minutes; a partner called 20 minutes ago and not
  on the way; a partner 10 minutes later than they said; no update for 30
  minutes while partners work the call (V4's SitRep heartbeat); every
  partner gone, so file the post-mortem.
- **The AI's reading** (Grok, Groq or Gemini, as the rest of Criti): what is
  happening now, who to call out next and why, what is being missed, what to
  ask next, and the numbers stated so far. Suggestions are kept only when the
  partner is on the desk's own list and not already working the call. One
  press calls them out, marked as suggested by Criti in the record. Asked
  after every change on the call and every 4 minutes while it is open; a
  reading for the same updates in the last 3 minutes is reused, so the whole
  desk sees one reading. The model never gets the caller's name or number.

## Security

- New tables `disaster_callouts`, `disaster_desk_updates`, `disaster_ai_briefs`:
  tenant wall, read by the desk, Disaster, case review; no writes from a
  signed-in user, nothing for anonymous users.
- Writes only through `disaster_call_out`, `set_callout_status`,
  `log_disaster_update`, `save_disaster_ai_brief` (SECURITY DEFINER). Each
  checks the caller works the Disaster desk (`works_disaster_desk()`: Disaster
  dispatch and command, the control room, administrators, Disaster officers),
  that the call is theirs and was sent to Disaster, and writes the audit log
  and the call's timeline. A client reference makes a double press safe.
- Updates and call-outs are permanent. Progress only goes forward.
- The first call-out dispatches Disaster's part of the call; the first partner
  on scene puts it on scene "by the desk" (0099), so the call's status follows.
- `file_post_mortem` (as 0075) also lets the Disaster desk file once it has
  called a partner out; partners still on the call are stood down with it.
- The old Dispatch Resources form wrote `disaster_logs` straight from the
  browser; it is gone (the page opens the desk).

## Tests

`scripts/test-disaster-desk.mjs` (7 scenarios, 0111 applied twice):

```
CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-disaster-desk.mjs
```

## To do before go-live

- Run `0111_disaster_desk.sql`, then `0112_disaster_doc.sql`, then
  `0113_disaster_operations.sql`, then `0114_disaster_checks.sql` in Supabase
  (after 0108–0110). Each checks the one before it is in.
- Set `BULKSMS_TOKEN_ID` and `BULKSMS_TOKEN_SECRET` on the web host, and buy
  BulkSMS credits. Without them the desk still drafts and logs each SMS as
  "Not set up".
- Make Zoiper the computer's handler for phone links, so Call opens it.
- Translate the new desk wording (278 sentences on 2026-10-26) through
  `.claude/translations/TRANSLATIONS.md`; until then it shows in English.

## The eThekwini way (0112)

Migration `0112_disaster_doc.sql` (run after 0111). Follows the eThekwini
Municipal Disaster Management Plan (rev. 7 Aug 2012, ratified by EXCO
13 Aug 2013) and its words: EMACC, FCP, EOC, DOC, SCG, sitrep, reception centre.

- **The call**: a short title, the hazard from the Plan's Classification of
  Potential Hazards (natural: meteorological, geological, biological;
  non-natural: human caused, technological), the municipalities affected
  (eThekwini Metro and the KZN districts), the FCP and the EOC.
- **Bronze / Silver / Gold** (the Plan, pp. 16–18): Bronze = EMACC and the
  services at an FCP; Silver = a joint EOC on site; Gold = the DOC activated
  and the SCG called into session (asks first; told to the call's chain).
  The highest level reached goes on the post-mortem. Criti advises when the
  level should change, with one press to change it.
- **Public partners only**: private ambulance, hospital and security
  companies are switched off. The list now holds the City's line functions
  (EMACC 031 361 0000, MDMC 031 367 0001, Electricity 080 131 3111, Water
  080 131 3013 …), provincial and national (KZN EMS 10177, SAPS 10111, SASSA
  0800 60 10 11, Eskom 08600 37566 …), the neighbouring districts' 24-hour
  disaster centres and civil society relief (Gift of the Givers, Red Cross,
  NSRI …). Numbers not yet confirmed show **Check this number**; Disaster
  command and administrators confirm or correct them on the Partner List.
- **Calling**: every number is a Call button (a phone link). Set Zoiper (or
  Phone Link / Teams) as Windows' app for phone links and the desk dials
  with one press.
- **Shelters** (`/disaster/shelters`): the register of halls and facilities
  with key holders, capacity, people in now and places free. On the call: open
  a shelter, log arrivals, departures, households, children, elderly, people
  with disabilities and relief handed out (meals, blankets, mattresses, food
  parcels, hygiene packs, clothing); closed only when everyone has left.
- **Our officers**: Disaster Management officers are called out by the desk
  like a partner (they have no app); the desk files their on-site assessment
  for them, with who reported it.
- **Duty roster** (`/disaster/duty`): who is on duty or on standby now and
  their duty (Principal Disaster Management Stand-by Officer, MDMC Duty
  Officer, DOC Commander, Stand-by Incident Logger, EMACC and CCTV
  operators), what is coming up, and the SCG duty chair for each month.
- **Post-mortem** (`/disaster/desk/[id]/post-mortem`): laid out as on the
  phone, filled in from the record (times, hazard, highest level,
  municipalities, DOC and SCG, who was called out and when, the shelters and
  people in them, the assessments' counts), plus the Plan's impact counts
  and whether to recommend a local state of disaster. Draft with Criti
  writes the cause and lessons. Filing takes the facts from the record again.

Tests: `scripts/test-disaster-doc.mjs` (8 scenarios, 0112 applied twice over 0111).

Phase 2 (next): department readiness (line functions, DOC representatives,
plan reviews), forum meetings and Technical Task Teams, the Framework's
measures.

## Operations (0113)

- **Open incident** (`/disaster/desk/new`): the desk opens a call itself
  (EMACC, the desk's own line, radio, WhatsApp, walk-in). The address search
  fills the ward and suburb; the hazard is picked from the incident type.
  `open_disaster_incident` numbers it on the Disaster sequence and writes the
  facts and the first timeline line in one step.
- **Departments**: the Plan's 19 line functions with their roles during
  disaster operations, word for word. Disaster Management and Metro Police
  are on every incident (Metro for road closures and cordons); the rest are
  suggested by hazard (no Fire form for a flood) and added only when needed.
  Each has a four-step form in a modal that asks before closing with unsaved
  work: DOC representative (picked from `/disaster/departments` contacts),
  duties (Done, Under way, Not needed), figures and notes, review. The list
  shows Not started, In progress or Done. Health handles an outbreak.
- **Sitrep figures**: injured, dead, missing, evacuated, people helped,
  households affected, and how and where people were moved. The newest
  figures fill the situation strip at the top of the board.
- **Casualties**: everything optional; a description for someone not
  identified ("blue jeans, about 30"). Names and contact details only on the
  web desk, for the Disaster desk and command, case managers and admins;
  everyone else sees counts. The table has no direct read: the list comes
  through `list_disaster_casualties`, and each read is audited (once per ten
  minutes per person and call). The timeline never carries a name.
- **Shelter supplies**: food and toiletries (Enough, Running low, None),
  water (Mains, Water tanker, Bottled, None), toilets and temporary toilets, and services on site, updated by
  whoever is on the ground through the desk. Criti warns when a hall is full,
  when supplies run low, and when people were evacuated with no hall open.
  A hall saved with an address is placed on the map.
- **SMS**: to the caller, a department's representative or a partner called
  out. Criti drafts in plain, professional words (no dashes); the dispatcher
  reads it and presses Send (BulkSMS). Every SMS is logged with its result,
  stays on record, and is capped at 60 an hour per incident.
- **Live map**: the incident, zones, reception centres (green, red when
  full), measured rain radar (through `/api/weather/radar`), traffic, and
  aircraft and ships when switched on. Ward boundaries wait for open data.
- **Report (PDF)** (`/api/pdf/disaster/[id]`): the Official After-Action
  Report with everything on the record: the incident, impact, command and
  co-ordination, call-outs with times, each department's representative,
  duties and figures, reception centres with relief and supplies, casualty
  counts (names only for those allowed, marked confidential), the analysis,
  the SMS log and the timeline. From the board header and the filed
  post-mortem.

Tests: `scripts/test-disaster-doc.mjs` (15 scenarios: 0112 and 0113 applied
twice over 0111).

## Checks on what is typed (0114)

Only the obvious rules, each refused with one short sentence, checked as the
form is filled in (`apps/web/lib/disaster-checks.ts`) and again by the
database (triggers on each Disaster table), so nothing made up gets in
whichever way it is sent:

- Phone numbers: South African (082 123 4567, +27 82 123 4567) or
  international (+44 …), not one digit over and over. A partner called out by
  hand may have a short number (10111, 10177).
- Wards: a number; eThekwini 1 to 111, elsewhere up to 120 ("Ward 76" is kept
  as "76").
- Names: letters, not numbers. Ages: whole years, 0 to 120. Email:
  name@place.domain.
- Hall capacity: 1 to 20 000 (0: not known yet). Figures: things (vehicles,
  tankers, roads) up to 1 000; people and homes up to 500 000. Arrival time:
  up to 24 hours.

A change is checked only on what it changes, so an older record typed before
0114 still saves when something else on it changes. The caller's number on
an incident the desk adds is checked by the web server (it lives on the
shared incidents table).

Tests: `scripts/test-disaster-doc.mjs` (16 scenarios: 0112, 0113 and 0114
applied twice over 0111) and `apps/web/lib/disaster-checks.test.ts`.

## Revision 2: the JOC, warnings, relief, readiness and Criti's tour (0115 to 0121)

From the Directorate's process (the Disaster Incident Management Process and
its flowchart) and the Director's briefing of 1 December 2025.

**Before the app update**, run in Supabase, in order: `0115_disaster_joc.sql`,
`0116_disaster_warnings.sql`, `0117_disaster_joc_activation.sql`,
`0118_disaster_relief.sql`, `0119_disaster_records.sql`,
`0120_disaster_readiness.sql`, `0121_guides_and_practice.sql`. Each is safe to
run again.

**Settings** (in `apps/web/.env.local` and on the web host):

- `SUPABASE_SERVICE_ROLE_KEY`: needed. The SAWS warning reader writes with it
  (only `ingest_saws_warning` and `note_feed_sync` accept it).
- `BULKSMS_TOKEN_ID`, `BULKSMS_TOKEN_SECRET`: already set for the desk's SMS;
  warnings to the councillors use them too (up to 6 parts per message).
- `WAQI_TOKEN` (optional): air quality from the stations; without it, the
  modelled air quality from Open-Meteo.
- `FIRMS_MAP_KEY` (optional): today's fire count on Hazard Watch; the fires
  from space on the map need no key.

What changed:

- **The JOC (0115, 0117)**: Gold is the Joint Operations Centre at the DOC.
  The DOC Commander is now the JOC Commander (rows renamed, audited). The top
  ten priority risks lead the hazard list; the 2012 names still save. Moving
  up a level needs at least one reason ticked (Bronze, Silver and Gold have
  their own list) and the place: the FCP for Silver, the DOC for Gold. Gold
  also needs who authorised it, from the listed roles, checked against the
  roster. Each move is kept in `disaster_level_changes`. The JOC tile keeps
  the activation checklist, the members (internal units and outside
  agencies), and the daily sessions.
- **Statuses, recovery and the review (0117)**: Active, Stood down, In
  recovery, Closed, in that order, each with a reason. Closing a recovery
  needs the hand-over confirmed. The recovery tasks, and the post-incident
  review with its four sign-offs (shared, PDMC and NDMC, the Forum, the
  Director), are on the board after stand-down. An incident in an informal
  settlement is ticked as one.
- **Early warnings (0116)**, `/disaster/warnings`: SAWS impact-based warnings
  for eThekwini arrive by themselves. The desk's open screens ask every five
  minutes; the server reads the SAWS feed at most once in five minutes, over
  https, eThekwini areas only. A warning SAWS re-issues updates the same
  record; a cancel cancels it. One that came by email or PDF is typed in.
  Each warning has its steps (check with FEWS, tell the services, SMS the
  councillors, spread it). At Level 4 or more the JOC's readiness session is
  held and its outcome recorded, and an incident can be opened from it.
- **Councillors (0116)**, `/disaster/councillors`: one per ward, PR
  councillors without one. Added by hand or from a spreadsheet (.xlsx or
  .csv; added, changed and skipped are counted). Their numbers are for the
  Disaster desk and command only.
- **Relief by ward (0118)**: counts only, never names: people, households,
  and each vulnerable group (never more than the people), and what was handed
  out. Relief stock (`/disaster/readiness`) now has a minimum and is written
  only through `set_relief_stock`; the old policy that let the browser write
  it is gone.
- **Past disasters (0119)**, `/disaster/records`: SAWS's record of weather
  disasters in eThekwini (read from the NDMC) and the major events in the
  Director's briefing. Load records fills it; loading again updates the same
  rows. Real events, kept apart from live calls: they never alert. They fill
  the ward profiles (`/disaster/wards`).
- **Readiness and IDP (0120)**, `/disaster/readiness`: the readiness score
  (eight measures), the IDP figures for the financial year (July to June):
  incidents, deaths, warnings, readiness sessions and signed reviews. The
  population, each department's plan review date, the task-team chairs and
  the Advisory Forum's meetings are kept here and on Duty and Forum.
  `disaster_framework_status` and `set_framework_status` are ready for the
  Framework's measures; the page waits for the Directorate's wording.
- **The map** (`/disaster/map`): 29 outside overlays in a searchable layer
  list, by group: warnings, flooding and fires from space (NASA), cloud
  (EUMETSAT), river forecasts and flood hazard (GloFAS), cyclones, NDMC risk,
  wards and their councillors, past disasters, the April 2022 damage,
  earthquakes, GDACS. The server fetches, colours and caches them
  (`/api/maps/features/[id]`, `/api/maps/tiles/[id]/[z]/[x]/[y]`), so the
  browser talks to no outside site. Hazard Watch (`/disaster/watch`) shows the
  latest from each source, with its link.
- **Criti's tour and practice (0121)**: the first time someone opens a
  Disaster page, Criti offers a short tour. Later asks again next time;
  Don't show this again, or finishing it, stops it on that account
  (`user_guides`, own rows only). Practise an incident (`/disaster/practice`)
  walks through adding one, moving it up a level, logging what came in,
  relief for a ward and stand-down, with the real rules. A practice incident
  is its owner's alone (`disaster_practice_incidents`): it never reaches the
  desk, the map, an SMS or a figure. The Disaster pages and the board's
  tiles have their (i)s, and each list page its How this page works.

Tests: `scripts/test-disaster-revision2.mjs` (7 scenarios: 0115 to 0121
applied twice over 0111 to 0114), and the tests beside each list in
`packages/db/src/disaster-*.test.ts`, `apps/web/lib/saws-cap.test.ts`,
`apps/web/lib/councillors.test.ts` and `apps/web/lib/ops-map/catalogue.test.ts`.
