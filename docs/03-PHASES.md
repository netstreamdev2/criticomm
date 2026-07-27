# 03 — Phased Delivery Plan

Each phase is sized to be reviewable end-to-end. We don't start phase N+1 until phase N is shipped to staging and working with real data. **No phase is a "scaffold-only" phase** — each one ends with a usable, testable slice.

## Phase 0 — Plan & schema (this turn)

**Deliverables (already produced in this commit):**
- ✅ Complete reconnaissance of V4 surface ([00-RECONNAISSANCE.md](00-RECONNAISSANCE.md))
- ✅ Architecture decisions ([01-ARCHITECTURE.md](01-ARCHITECTURE.md))
- ✅ Monorepo layout ([02-MONOREPO.md](02-MONOREPO.md))
- ✅ This phased plan
- ✅ Security/migration plan ([04-SECURITY-MIGRATION.md](04-SECURITY-MIGRATION.md))
- ✅ Full Supabase schema (`supabase/migrations/0001_init.sql`)
- ✅ RLS policies (`supabase/migrations/0002_rls.sql`)
- ✅ Realtime + Storage (`supabase/migrations/0003_realtime_storage.sql`)

**Exit criteria for Phase 0**: this plan reviewed and approved by you. **You must rotate the leaked credentials in `appsettings.json` before any team member sees the V4 repo (see §1 of the security doc).**

---

## Phase 1 — Foundation + Police silo end-to-end (target: 3–4 weeks)

**Goal**: a real dispatcher can log a 911 call, dispatch a police unit, the unit's responder can update status from web or mobile, the supervisor can close the case, and an audit trail is visible — all on V5, with V4 still running in parallel.

### Phase 1 scope
1. **Monorepo scaffold** — Turborepo, Next.js 15 web app shell, Expo SDK 52 mobile shell, `@criticom/db`, `@criticom/api`, `@criticom/ui*` packages.
2. **Supabase project provisioned** — local + staging + prod. Migrations 0001–0003 applied. Generated types committed.
3. **Auth** — Supabase email/password login on web + mobile. Password reset via Supabase Auth. Login form ↔ V4 `Auth/Login.cshtml` parity (theme, "Criticom" branding).
4. **Silo middleware** — Next.js middleware that rejects non-matching silo routes; RPC `auth.silo()` used in RLS.
5. **Dispatcher / Control Room** (web only):
   - `ControlRoomController.LogNew` → `/dispatch/log-call` with duplicate detection
   - `ControlRoomController.History` → `/dispatch/pending`
   - `DispatchController.Create` → `/dispatch/assign/:callId`
   - `DispatchController.KPI` → `/dispatch/kpi` with live charts
   - `IncidentsController.*` → `/incidents`
   - `ReportsController.Index` + `IncidentLifecycle` → `/reports` + `/incidents/:id/lifecycle`
   - `NotificationsController` partial: `Index`, `Create`, `ToggleDutyStatus`, `UpdateLiveLocation`, `TriggerLocationSms`
6. **Police silo MVC parity** (web + mobile):
   - `MetroController.Index`, `Create`, `MetroCheck`, `FirearmChecklist`, `ArmoryRecords`, `Records`, `Wizard(type)` for all 7 types
   - `PoliceIncidentsController.CreateIncident` API
   - `ResponderController.Index`, `Monitor`, `UpdateStatus`, `UploadIncidentSite` (with image + voice note → `incident-media` bucket)
   - `AuthController.Logout` (free vehicle, clear duty)
7. **Shift workflow** (web + mobile):
   - `ShiftController.MentalCheck`, `Reason`, `VehicleSelection`, `AssignVehicle`, `VehicleChecklist`, `UnitCompliance`
8. **Citizen GPS share** — public `/share-location/[token]` route on both web (deep link from SMS) and mobile (deep link handler).
9. **Realtime** — `incidents:MetroPolice` channel wired into dispatcher pending list and responder index. Dispatcher gets toast on new incident.
10. **PDF**: `CaseManagerController.DownloadReport` for police (POL) only — Edge Function with `pdf-lib`.

### Phase 1 explicitly out of scope
- Other silos (Fire/Medical/Disaster) — Phase 2
- Chatbot, FlightRadar, Marinesia, Wind, Cameras, Hydrant integrations — Phase 4
- Roster generation, Leave, Training, Performance, SystemAnalytics — Phase 4
- Mobile-specific responder PTT integration — Phase 3 (web uses dispatcher view)

### Phase 1 done = these acceptance tests pass
- A new operator account can log a fresh incident, see it appear realtime in the dispatch queue
- A dispatcher can assign a police unit; the assigned responder's mobile app receives a push within 5s
- The responder can flip status `En Route → Arrived → Closed`, attach a photo + voice note, and the case-manager sees the evidence
- An audit-log row exists for every state change
- An SMS to a test number renders the citizen GPS-share page and persists the lat/lng
- A supervisor can close a case; the dispatcher's KPI tiles update without refresh
- A police case-report PDF downloads with the embedded evidence images

---

## Phase 2 — Fire, Medical, Disaster silos (target: 3 weeks)

Replicate the Phase 1 surface for the three remaining silos. Where workflows diverge:

### Fire-specific
- `FirefightersController.Create` + `FirefighterReport` model — 50+ field fire report (smoke, flame spread, origin, casualties, property value, hazmat, rescue, ventilation, salvage, …)
- `FirefightersController.CreateInspection` — fire-safety inspection that synthesizes an `incidents` row
- `FireChiefController.GISMap` + `GetIncidentWithHydrants` + `GetAllHydrants` — hydrant proximity rendering on map
- `FirefightersController.DownloadPdf` — table PDF of all fire reports
- `PIRController.Index`, `Review`, `Publish`, `DownloadPdf` — Chief sanitises raw fire reports into Public Incident Reports

### Medical-specific
- `ParamedicsController.Create` — full Patient Care Report (PCR): demographics, MOI, GCS, vitals, skin condition, medications, treatment narrative, signatures (base64), inventory checklist
- `ShiftController.InventoryCheck` (medical-only branch)
- `medical_histories`, `assessment_findings`, `vital_signs`, `interventions`, `legal_handovers` tables wired into the report
- `ParamedicsController.Edit` (PCRs are editable until closed)

### Disaster-specific
- `DisasterController.Dashboard`, `DisasterMap`, `Monitor`, `Alerts`
- `DisasterController.DispatchResources` writing to `disaster_logs`
- `DisasterController.LogPeriodicUpdate` appending JSON timeline entries
- `DisasterController.GetPartnersByResource` — the hardcoded 41-partner mutual-aid directory becomes a `mutual_aid_partners` seed table
- `DisasterController.PostMortem` — after-action report flow + close incident
- `DisasterIncidentsController.CreateIncident` API
- Note: Disaster has a parallel "incident logger" flow via `ControlRoomController.LogNew` that bypasses the master queue when silo claim = `EthekwiniDisaster` and writes directly to disaster silo with `SourceDatabase = "DisasterLogger"` — preserve as a `direct_log` boolean on `incidents`

### Phase 2 done =
- All 4 silos can be operated independently end-to-end
- A cross-silo `BroadcastAll` dispatch fans out a single incident to multiple responder pools (police + fire + medical + disaster simultaneously)
- Case-manager PDFs render correctly for all 4 silos

---

## Phase 3 — Production-grade Expo mobile responder app (target: 3 weeks)

Phase 1 + 2 already provide mobile parity for the *core* responder flows. Phase 3 is about making the mobile app first-class:

1. **Push notifications** — Expo Notifications + Supabase webhook bridge for `incidents` INSERT/UPDATE
2. **Offline mode** — PowerSync or AsyncStorage-backed Supabase cache for incidents, with conflict-resolution rules (server wins for status, client wins for narrative drafts)
3. **GPS heartbeat** — background location task (Expo TaskManager) posting to `personnel.lat/lng` on duty
4. **Camera + voice-note capture** — native UI for image/audio capture, direct upload to `incident-media`
5. **RealPTT integration** — calls Edge Function `realptt-proxy`; shows audio recordings, sends text-to-PTT
6. **SOS / panic button** — single-tap broadcast on `alerts:global` with current GPS
7. **Biometric unlock** — expo-local-authentication
8. **Tablet-optimized layouts** — Mobile Data Terminal (MDT) form factor for in-vehicle use
9. **Citizen public-facing share screen** — already added in Phase 1; here we polish for low-end Android devices

### Phase 3 done =
- A responder can do an entire shift (mental check → vehicle inspection → on-duty → take call → upload evidence → close → end of shift) from the mobile app alone
- App works in airplane mode (queues pending mutations)
- Push lands within 5 seconds of a dispatch on a real device

---

## Phase 4 — Analytics, integrations, polish (target: 4 weeks)

Everything left:

### Analytics & reporting
- `SystemAnalyticsController.*` → `/analytics` (officer performance, department stats, response trends, resource utilization)
- `PerformanceController.Index` → `/performance`
- `CaseManagerController.Index`, `CaseReports`, `AuditHistory`, `CloseCase` → `/case-manager/*` (PDF generators for all silos with image embedding)
- `SystemProfileController.*` → `/system-profile/*` (operator profile management with NATO phonetic call-sign generator)

### Roster, HR, training
- `RosterViewController.*` → `/roster/*` (224 and 24-48 platoon-rotation generators, platoon assignment, repeat-shift)
- `ShiftController.UnitCompliance` already in Phase 1
- `TrainingController.*` + `PoliceTrainingController.*` → `/training/*` (silo-aware)
- `LeaveController.*` → `/leave/*` (replace mock data with real `leave_entries` table)

### Admin
- `DevAdminController.*` + `SuperController.*` → `/admin/*` (user/vehicle/device CRUD per silo, audit log views, dashboard data API)
- `ProfileController.Settings`, `SetTheme`, `SetLanguage` (Google Translate cookie), `RequestPasswordReset` → `/profile/*`

### External integrations
- `CamerasController.*` → `/cameras` + `/cctv` (i-traffic feed import, marine AIS via Kpler, FlightRadar24 live + tracks, TomTom POIs + traffic incidents)
- `WindController.GetLatest` → `/api/wind`
- `CrimeController.GetHotspots` → preload SAPS CSV into `crime_stats`
- `ChatbotController.Ask` → Edge Function `chat-criti` (Gemini wrapper) with action-code parsing for `[UPDATE_STATUS]` / `[FILL_REPORT]`
- All 6 external API proxies (TomTom, OpenWeatherMap, FlightRadar, Marinesia, RealPTT, BulkSMS) become hardened Edge Functions

### Data migration cutover (see security doc §3)
- Final sync from SQL Server → Supabase
- Read-only freeze on V4 for 1 hour
- DNS cutover
- V4 kept running read-only for 90 days as a fallback

### Phase 4 done =
- 100% feature parity with V4
- V4 is decommissioned
- Production runs on V5 only
- Every external API works through Edge Functions (no keys in client bundles)

---

## Risk register

| Risk | Mitigation |
|---|---|
| RealPTT auth dance is fiddly (SHA1+HMAC) and the API is undocumented externally | Build `realptt-proxy` Edge Function early in Phase 1 and test against real hardware. Keep a fallback flag to disable PTT features cleanly. |
| ASP.NET Identity password hashes (PBKDF2) need bridging to Supabase | Implement custom verify in an Edge Function that runs on first login; bulk-force password reset if too complex. Detailed in security doc. |
| Existing V4 data has 5 DBs with inconsistent schemas, drift between silos | Migration script reads each DB's `INFORMATION_SCHEMA` first, builds a column-map, then ETLs. Spot-checks per table. |
| PdfSharp PDFs use specific fonts (Verdana) — output won't be byte-identical | Visual diff test, accept "looks-the-same" rather than byte-identical. |
| Realtime channel cardinality (one channel per silo + per user + presence) can blow connection limits on Supabase Pro plan (200 concurrent) | Audit Phase 2 with realistic numbers; bump to Team plan or shard channels if needed. |
| Tenant model bug in RLS could leak cross-silo data | Add pgTAP tests asserting no row visibility leak; run on every PR. |
