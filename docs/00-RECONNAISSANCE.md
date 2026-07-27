# 00 — Reconnaissance: Exhaustive V4 Feature Inventory

Source: `C:/Users/shiva/source/repos/Criticom-V4` — surveyed every controller, model, view folder, hub, service, and configuration file. No feature is omitted from this inventory; if it's in V4, it appears here.

## A. Tenant / Identity Architecture (V4 → V5 mapping target)

| V4 mechanism | What it does | V5 replacement |
|---|---|---|
| 5 SQL Server DBs (Ethekwini master + MetroPolice, MetroFire, Medical, EthekwiniDisaster silos) | Hard isolation between departments; Ethekwini is the master "waiting room" + identity hub | Single Supabase project, `silo` enum column on every tenant table, RLS policies enforce per-silo isolation |
| `AppIdentityDbContext` resolved at request time from `Silo` claim | Routes the *Identity* DbContext to the matching silo DB | Single Supabase Auth, `silo` stored in `auth.users.app_metadata` and mirrored into `profiles.silo` |
| `EthekwiniSyncWorker` (BackgroundService, 10s loop) | Reads `SyncMessage` rows from each silo, deserializes JSON payloads, upserts into master DB keyed on `MasterId` GUID | Eliminated. Single DB makes this unnecessary. Replace with a materialized view if cross-silo aggregates need pre-computing. |
| `[Authorize(Policy = "RequireSiloAccess")]` + `SiloAuthorizationHandler` | Enforces silo claim presence on a per-controller basis | RLS + a Next.js middleware that reads `silo` from session and 403s mismatched routes |
| `SeedSystemUser` + `DbInitializer.SeedSilos` + `DemoDataSeeder` + `AnalyticsSeeder` | Idempotent system bootstrap users + demo data across all silos | `supabase/seed/*.sql` + an Edge Function for idempotent system-user seeding using `auth.admin.createUser` |
| ASP.NET Identity (`IdentityUser`, `IdentityRole`, `IdentityUserClaim`, `IdentityUserRole`) | Cookie-based auth + roles + custom claims (Silo, AssignedStation, HardwareUUID, FullName, BadgeNumber) | Supabase Auth (email/password + magic link) + `user_roles` table (composite role+silo) + `profiles` table for claims |
| `dbo.CriticomFields` (master incidents table replicated to every silo via `MasterId` GUID) | The single most-used entity — every department reads/writes its own copy | Single `incidents` table with `silo` column; the GUID copy-fan-out is gone |

## B. Roles observed across all controllers

`SystemAdmin`, `SuperAdmin`, `Admin`, `Supervisor`, `Dispatcher`, `Operator`, `ControlRoom`, `IncidentLogger`, `Viewer`, `System`, `Captain`, `Police`, `Officer`, `Metro`, `Security`, `Chief`, `FireChief`, `Firefighter`, `Paramedic`, `Doctor`, `Disaster`, `Case Manager`, `Citizen` (unauthenticated public).

→ V5 normalises to a `role` enum + an `is_admin` boolean + a `silo` enum, with role-display labels handled in the UI layer.

## C. Real-time channels (SignalR hubs → Supabase Realtime)

`DashboardHub` (single method: `AcknowledgeResponder(userId, dispatcherName, message)`) and `RealTimeHub` (broad event broker) emit these client events:

| Event | Payload | Use case | Supabase Realtime equivalent |
|---|---|---|---|
| `ReceiveNotification` | (sender, message, type, incidentId, callId) | Toasts, dispatcher alerts | `broadcast` on channel `notifications:{silo}` |
| `ReceiveAcknowledgment` | (dispatcherName, message) | "Your update was seen" | `broadcast` on user-scoped channel `user:{id}` |
| `ReceiveNewIncident` | (incidentData) | New 911 call hit the queue | `postgres_changes` INSERT on `public.incidents` |
| `ReceiveIncidentUpdate` | (incidentId, status, updateData) | Status flip (Dispatched → En Route, etc.) | `postgres_changes` UPDATE on `public.incidents` |
| `ReceiveKPIUpdate` | (kpiData) | Live dashboard tiles | Server-pushed `broadcast` after RPC computes KPIs |
| `ReceiveDashboardRefresh` | (section) | Force-refresh dashboard widget | `broadcast` on `dashboard:{silo}` |
| `ReceiveChartData` | (chartId, data) | Live chart updates | `broadcast` on `dashboard:{silo}` |
| `ReceiveEmergencyAlert` | (alertType, message, details) | All-hands urgent push | `broadcast` on `alerts:global` |
| `ReceiveRosterUpdate` | (rosterData) | Roster changed | `postgres_changes` on `public.rosters` |
| `ReceivePersonnelStatus` | (personnelId, status, details) | On-duty toggle, GPS update | `postgres_changes` on `public.personnel` |
| `ReceiveSystemStatus` | (component, status, metrics) | Infra health | `broadcast` on `system:health` |
| `Pong` | — | Connectivity check | Native presence/heartbeat |

`Groups.AddToGroupAsync(department)` in `RealTimeHub.JoinDepartment` → Supabase Realtime channel-per-silo with RLS-enforced subscribe.

## D. Storage (Azure Blob → Supabase Storage)

V4 uses a single Azure container `criticom-uploads` with folder prefixes. V5 maps to **Supabase Storage buckets**:

| V4 folder prefix | Used by | V5 bucket | RLS |
|---|---|---|---|
| `incident-images/` | `ResponderController.UploadIncidentSitePost` | `incident-media` | authenticated insert, silo-scoped read |
| `voice-notes/` | same | `incident-media` (same bucket, `voice/` prefix) | same |
| `metro-reports/images/`, `metro-reports/audio/` | `MetroController.Create` | `incident-media` (`metro/` prefix) | same |
| `fire-reports/images/`, `fire-reports/audio/` | `FirefightersController.Create` | `incident-media` (`fire/` prefix) | same |
| `medic-reports/images/`, `medic-reports/audio/` | `ParamedicsController.Create` | `incident-media` (`medical/` prefix) | same |
| `certifications/` | `TrainingController.UploadCertification`, `PoliceTrainingController.UploadCertification` | `certifications` | personnel-self + supervisor read |
| `{silo}-profiles/` | `DevAdminController.Create`, `SuperController.CreateUser` | `avatars` | self-write, public-read |

## E. External integrations (every API key in `appsettings.json` plus hardcoded ones)

| Service | V4 usage | V5 approach |
|---|---|---|
| **SendGrid** (`ApiKeys:SendGrid`) | `ProfileController.RequestPasswordReset` — password reset emails | Supabase Auth handles password reset natively; SendGrid only needed for custom dispatch/incident emails. Keep as Edge Function. |
| **OpenWeatherMap** (`ApiKeys:OpenWeatherMap`) | `CamerasController.Index`, `FireChiefController.GISMap`, `DisasterController.DisasterMap` view bag | Next.js server-only API route proxy + edge cache (key never reaches client) |
| **TomTom** (`ApiKeys:TomTom`) | `CamerasController.GetEmergencyPOIs`, `CamerasController.GetTrafficIncidents`, GIS map basemaps | Same proxy pattern |
| **Marinesia / Kpler** (`ApiKeys:Marinesia`) | `CamerasController.GetLiveMarineData` — maritime AIS feed | Same proxy pattern |
| **FlightRadar24** (`ApiKeys:FlightRadar`) | `CamerasController.GetLiveFlightData`, `GetFlightTracks` | Same proxy pattern |
| **Google Gemini** (`ApiKeys:Gemini`) | `ChatbotService` — `gemini-2.5-flash-lite` powers `Criti` assistant with intent-routed silo lookups + `[UPDATE_STATUS]` / `[FILL_REPORT]` action codes | Edge Function `chat-criti` that calls Gemini, with the same intent → SQL routing logic re-implemented against unified `incidents` table |
| **Azure Blob Storage** (`AzureBlobStorage` conn string) | `BlobStorageService` | Replaced by Supabase Storage |
| **Google Maps** (`GoogleMaps:ApiKey` — read but absent from `appsettings.json`) | `DispatchController.Create` view bag | Decide map provider in Phase 4 — recommend MapLibre + TomTom tiles (already paid) or stick with Google |
| **RealPTT** (`https://api.realptt.com`, **HARD-CODED** account `nets` / password `Realptt1`) | `DispatchController.GetLiveResponders`, `GetUnitVideo`, `SendUnitMessage`, `GetUnitAudio`; `ResponderController.SendUnitMessage`, `GetUnitAudio`; `HomeController.GetLivePTTDevices`, `GetUnitVideo`, `GetUnitBattery`. Implements its own SHA1+HMAC-SHA1 challenge-response auth, fetches GPS positions, audio recordings, video clips, battery level | Edge Function `realptt-proxy` that wraps the SHA1/HMAC auth dance once and exposes typed endpoints; **credentials must be rotated** |
| **BulkSMS** (token `CB1FF6E2…`/`7lsbhRjc…` **HARD-CODED**) | `NotificationsController.TriggerLocationSms` — SMS the citizen a GPS-share link | Edge Function `sms-send`; **credentials must be rotated** |
| **Open-Meteo Archive API** | `ReportsController.IncidentLifecycle` — historical weather snapshot per incident | Edge Function `weather-archive` (no key required) |
| **i-traffic.co.za** (key placeholder) | `CamerasController.FetchExternalCamerasAsync` — camera list import | Same proxy |
| **onaci.github.io/leaflet-velocity** static JSON | `WindController.GetLatest` — cached wind data | Same, cache via Supabase Edge runtime |
| **CSV bundle**: `wwwroot/data/sapacr-2008-2023-v1.1.csv` (SAPS crime stats) | `CrimeController.GetHotspots` — eThekwini crime hotspots for 2022/2023 | Load into a `crime_stats` table once via migration, query from there |

## F. Controllers → V5 route mapping

All 35 controllers categorized by role. Each row is one V5 route to build.

### Dispatch / Control Room (Phase 1)
- `HomeController.Index` → `/dashboard` (master command-center dashboard with KPIs, map, activity feed, on-duty responders, oldest pending alert)
- `HomeController.GetActivityLog`, `GetUnacceptedAlert`, `GetLiveResponders`, `GetLivePTTDevices`, `GetUnitVideo`, `GetUnitBattery` → `app/api/dashboard/*` routes / Edge Functions
- `ControlRoomController.LogNew` (GET/POST) → `/dispatch/log-call` — operator's 911-intake form
- `ControlRoomController.History` → `/dispatch/pending` — pending queue
- `ControlRoomController.CheckDuplicate` → server action wrapping `incidents.duplicate_check` RPC
- `DispatchController.Create` (GET/POST) → `/dispatch/assign/:callId` — dispatcher assignment screen
- `DispatchController.GetLiveResponders`, `GetOnDutyResponders` → `/api/responders/live` (proxies RealPTT + queries personnel)
- `DispatchController.GetLiveDispatcherAlert` → replaced by realtime subscription
- `DispatchController.GetUnitVideo`, `GetUnitAudio` → `/api/ptt/unit/:account/(video|audio)` Edge Function
- `DispatchController.AcknowledgeLog` → realtime broadcast
- `DispatchController.EditIncident` → `/dispatch/incidents/:id/edit` (Supervisor only)
- `DispatchController.CCTV` → `/cctv`
- `DispatchController.KPI` → `/dispatch/kpi` (live KPIs + 24h hourly bars)
- `DispatchController.DisasterLog` → `/disaster/log`
- `IncidentsController.IncomingIncidents`, `Dashboard`, `Details`, `UpdateStatus` → `/incidents`, `/incidents/:id`
- `NotificationsController.*` (Index, Create, Edit, Delete, GPS, ToggleDutyStatus, UpdateLiveLocation, AllIncidents, IncidentKPIs, TriggerLocationSms, GetLivePendingDispatch, GetTopIncidentsForDevice, Paramedic/Police/FireFighter/Metro role-shortcuts) → `/notifications`, `/api/notifications/*`
- `ReportsController.Index` (filtered archive of closed/resolved incidents with 10-code dictionary) → `/reports`
- `ReportsController.GetIncidentUpdates`, `AddUpdate`, `ReassignUnit`, `IncidentLifecycle` → `/incidents/:id/lifecycle` + RPCs

### Responder mobile-first (Phase 3 — these run on both web + mobile)
- `ResponderController.Index` (assigned incidents) → `/responder` (web) + Expo screen
- `ResponderController.Monitor` (dispatcher monitor) → `/responder/monitor`
- `ResponderController.UpdateStatus` → server action / RPC
- `ResponderController.UploadIncidentSite` (GET/POST: notes + multi-image + base64 voice note → Azure blob + smart-routed log) → `/responder/incidents/:id/upload`
- `ResponderController.SendUnitMessage`, `GetUnitAudio` → Edge Function calls
- `AuthController.Logout` (frees vehicle, unsets duty, clears GPS) → server action triggered from logout
- `CitizenController.RequestLocation`, `SaveLocation` (anonymous GPS sharing via SMS link) → public route `/share-location/[token]`

### Shift / Start-of-shift workflow (Phase 1, used by every responder)
- `ShiftController.MentalCheck` → `/shift/mental-check` (6-question Yes/No fitness check)
- `ShiftController.SubmitMentalCheck` → server action; pass → vehicle inspection; fail → reason page
- `ShiftController.Reason`, `SubmitReason` → `/shift/unfit-reason`
- `ShiftController.VehicleInspectionReport` → `/shift/vehicle-inspection`
- `ShiftController.VehicleSelection` → `/shift/vehicle-selection`
- `ShiftController.AssignVehicle` → server action that marks vehicle In Use + personnel on-duty + creates `vehicle_checklist`
- `ShiftController.VehicleChecklist`, `SubmitVehicleChecklist` → `/shift/checklist/:apparatusId`
- `ShiftController.InventoryCheck`, `SubmitInventory` → `/shift/inventory` (Medical only)
- `ShiftController.UnitCompliance` → `/shift/compliance` (Chief/Captain view of today's checks across silo)
- `ShiftController.HasCompletedShiftStartTodayAsync` (idempotency guard) → preserved as DB check in middleware

### Police silo (Phase 2)
- `MetroController.Index`, `Wizard(type)`, `Create` (GET/POST with images + voice notes + contraband + weapons), `MetroCheck` (traffic fine form), `FirearmChecklist`, `ArmoryRecords`, `Records`, `SelectImpound`, `Complete`, `GetMetroAlert` → `/police/*`
- `MetroController.Wizard` types: Arrest, Accident, Vehicle, Firearm, Incident, Tow, Dog → 7 wizard sub-routes
- `PoliceIncidentsController.CreateIncident` (API) → POST `/api/incidents` with silo filter
- `PoliceTrainingController.*` (Index, TrainingStatus, Create, UploadCertification) → reuse `/training` with silo filter
- `CrimeController.GetHotspots` → `/api/crime/hotspots` (reads from `crime_stats` table seeded once from the CSV)

### Fire silo (Phase 2)
- `FirefightersController.ActiveIncidents`, `Create` (GET/POST), `Index`, `DownloadPdf` (table report PDF), `Details`, `Edit`, `CreateInspection` (Fire Safety Inspection that also logs a synthetic incident), `StartDuty`/`MentalCheck`/`Vehicles`/`VehicleChecklist`/`Signature`/`onDuty`/`GPS`/`PoliceCheck`/`PoliceSignature`/`Complete`/`PoliceStation` (placeholder views) → `/fire/*`
- `FireChiefController.GISMap`, `Create`, `UploadIncidentSite`, `GetIncidentWithHydrants`, `GetAllHydrants` → `/fire/chief/*`
- `FireIncidentsController.CreateIncident` (API) → POST `/api/incidents`
- `PIRController.Index`, `Review`, `Publish`, `DownloadPdf` (Chief's edited "Public Incident Report" sanitization workflow + downloadable PDF) → `/fire/pir/*`

### Medical silo (Phase 2)
- `ParamedicsController.Index`, `OnDuty`, `Create` (GET/POST with full PCR — patient demographics, vitals, GCS, skin condition, meds, narrative, images, voice notes), `DownloadPdf`, `Edit`, `Records`, `Complete` → `/medical/*`
- `MedicalIncidentsController.CreateIncident` (API) → POST `/api/incidents`

### Disaster silo (Phase 2)
- `DisasterController.Dashboard`, `DisasterMap`, `Monitor`, `Alerts`, `RequestAid`, `IssueAlert`, `GetActiveIncidents`, `GetIncidentDetails`, `DispatchResources`, `LogPeriodicUpdate`, `GetPartnersByResource` (hardcoded 41-partner directory), `PostMortem` (GET/POST), `GetDashboardStats`, `GetIncidentWithHydrants` → `/disaster/*`
- `DisasterIncidentsController.CreateIncident` (API) → POST `/api/incidents`

### Training & HR (Phase 4)
- `TrainingController.Index` (readiness dashboard), `TrainingStatus`, `Create`, `UploadCertification` → `/training/*` (silo-aware)
- `LeaveController.Index`, `Maintain` (currently mock data), `CheckConnections`, `ListTables`, `ReadLeaveSample` → `/leave/*` (V5 will store leave properly in `leave_entries` table)
- `RosterViewController.Index`, `GetActivities`, `GetSiloUsers`, `SetUserPlatoon`, `CreateShift`, `GeneratePlatoonRoster` (224 + 24-48 rotations), `AssignUser`, `GetShifts`, `GetShiftUsers`, `RepeatShift` → `/roster/*`
- `PerformanceController.Index` → `/performance`

### Reporting / Analytics / Admin (Phase 4)
- `SystemAnalyticsController.Index`, `GetRecentIncidents`, `GetDutyRoster`, `GetKPIs`, `TriggerDashboardRefresh`, `BroadcastNotification` → `/analytics/*`
- `CaseManagerController.Index`, `CaseReports`, `CloseCase`, `DownloadReport` + `PreviewReport` (per-silo PDF generators: police/medical/fire/disaster, each with image embedding from blob URLs in incident-update messages), `AuditHistory` → `/case-manager/*`
- `SystemProfileController.Index`, `Details`, `Create`, `Edit`, `Delete`, `Dashboard` (operator profile + duty roster KPI) → `/system-profile/*`
- `DevAdminController.Index`, `ManageSilo` (User/Vehicle/Device tabs), `Create`/`Edit`/`Delete` user, `CreateVehicle`/`EditVehicle`/`DeleteVehicle`, `CreateDevice`/`EditDevice`/`DeleteDevice`, `DevAuditLogs` → `/admin/*`
- `SuperController.Index`, `NewUser`, `CreateUser`, `NewDevice`, `CreateDevice`, `CreateVehicle`, `GetVehicles`, `DeleteVehicle`, `GetDashboardData`, `VehiclesManagement`, `Report` (per-silo deep stat report) → folded into `/admin/*`
- `ProfileController.Settings`, `SetTheme`, `SetLanguage`, `RequestPasswordReset` → `/profile/*`
- `CamerasController.Index`, `Details`, `Create`, `Edit`, `Delete`, `FetchExternalCamerasAsync`, `GetLiveMarineData`, `GetLiveFlightData`, `GetEmergencyPOIs`, `GetTrafficIncidents`, `GetFlightTracks` → `/cameras/*`
- `WindController.GetLatest` → `/api/wind`
- `ChatbotController.Ask` → Edge Function `chat-criti`

## G. Entities — full list (every EF model becomes a V5 Postgres table)

Listed in survey order; column shapes captured in `supabase/migrations/0001_init.sql`. The `MasterId` GUID and `SourceDatabase` column that V4 used for cross-silo sync are dropped — V5 uses a single DB, so the only tenant marker needed is `silo`.

`incidents` (← `CriticomFields`, the central entity), `personnel` (← `Personnel`), `apparatus` (← `Apparatus`), `vehicle_checklists`, `incident_updates`, `notifications`, `audit_logs`, `mental_checks`, `certifications`, `training_records`, `rosters`, `shifts`, `devices`, `dispatchers` (legacy; consider collapsing into `apparatus`), `sync_messages` (DROP — not needed in V5), `paramedic_reports` (← `Paramedic`), `medical_histories`, `assessment_findings`, `vital_signs`, `interventions`, `legal_handovers`, `ambulance_restocks`, `firefighter_reports`, `public_incident_reports`, `hydrants`, `metro_reports` (← `Metro`), `metro_offenses`, `firearm_authorizations`, `disaster_logs`, `post_mortem_reports`, `relief_stocks`, `cameras`, `security_reports` (← `Security`), `system_profiles` (← `SystemProfile`), `province_incidents` + `province_resources` + `global_dept_registry` (legacy cross-municipality sync — consider deferring), `public_incident_reports_pir` (← `PublicIncidentReport`), `crime_stats` (NEW — replaces the CSV bundle).

## H. Workflows captured (not just entities)

These are the multi-step flows the system enforces. The schema alone isn't enough; the V5 implementation must respect these:

1. **Incident lifecycle**: `Pending Dispatch` → `Dispatched` → `En Route` → `Arrived`/`On Scene` → `Transporting` (medical only) → `Closed`/`Resolved`. Multi-silo broadcast supported via `UnitType = "BroadcastAll"` or `"Fire,Police"` comma list. Status transitions update `dispatch_time`, `arrived_timestamp`, `closed_at`. Acceptance flag flips true on first `En Route` from responder.
2. **Dispatch fan-out**: Master record → one clone per target silo, all linked by `MasterId` GUID (V5: replaced with a single row + a `dispatched_silos` text[] column or join table `incident_dispatches`).
3. **Start-of-shift gate**: mental check → vehicle checklist → (medical: inventory) → (police: firearm checklist) → dashboard. Idempotent per UTC day.
4. **Case close**: master record + every silo copy gets `Status='Closed'` + `ClosedAt=now`; an `IncidentUpdate` row is appended; SignalR notification fires. V5: single UPDATE on `incidents`, RLS lets the supervisor mutate.
5. **Duplicate detection**: 12-hour lookback by `(caller_number)` or `(location_address, incident_type)` on incidents not yet closed.
6. **Citizen GPS share**: SMS containing `/share-location/:token` → public form → `lat/lng` POST → updates `incidents.location_*` + writes audit log entry (citizen-attributed).
7. **Evidence upload**: multi-image + base64 voice note → Azure blob → URL gets logged as a special-format `IncidentUpdate` message (`[EVIDENCE LOGGED] Photographic evidence attached: <url>`). V5: store URLs in `incident_attachments` table directly, not encoded into log messages.
8. **PIR (Public Incident Report) workflow**: raw fire report → chief reviews + sanitizes → publishes `public_incident_reports` row → PDF generated on demand.
9. **Roster generation**: 224 (2-on/2-off/4-off, 8-day cycle) and 24-48 (Red/Blue/Green) shift rotations auto-generated from a platoon assignment + anchor date.
10. **Chatbot actions**: Gemini may emit `[UPDATE_STATUS|IncidentId|Status]` or `[FILL_REPORT|Id|Field|Value]` codes; backend parses, finds the right silo (V5: single table), mutates, returns confirmation.
11. **Cross-silo sync (V4 only)**: `EthekwiniSyncWorker` polls silo `sync_messages` queues and replays into master. **Deleted in V5** — single source of truth.
