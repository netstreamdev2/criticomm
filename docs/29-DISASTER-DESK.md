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
  `0113_disaster_operations.sql` in Supabase (after 0108–0110). Each checks
  the one before it is in.
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
