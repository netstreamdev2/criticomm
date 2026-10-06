# 05 — V4 → V5 Parity Status

Updated: 2026-08-04 (wave 5 — field hardening, automation, search, CI).
Build ✅ · typecheck ✅ · lint ✅ · 47 tests ✅ · 28 migrations apply from empty ✅.

---

## Wave 5 (2026-08-04)

V4 parity was already complete. This wave is about what a production emergency
service needs that V4 never had.

**The responder app stops losing work.** An offline outbox
(`apps/mobile/lib/outbox-policy.ts` + `outbox.ts` + `sync.tsx`) writes every
field mutation to disk before sending it. Status changes, notes, photos, voice
notes and position heartbeats all queue; a panic jumps the queue. Ops carry the
time the responder acted, so an arrival timestamp no longer drifts by the length
of a dead zone — and migration `0024` teaches `update_responder_status` to
accept that time, bounded to the last 12 hours and never in the future. Nothing
is dropped silently: an op that exhausts its retries parks as `failed` and stays
in the sync tray. Entries are scoped to the account that captured them, because
handsets are shared across shifts.

**Officer-down.** Hold-to-trigger SOS on every mobile screen. `raise_panic`
(0024) creates a Critical incident at the officer's position and raises a
blocking, acknowledgement-required alert to their department *and* the control
room; a standing banner sits in the web app shell until the incident closes.
Deliberately no role gate — gating an emergency on a role matrix is how someone
dies over a provisioning mistake. Idempotent via `client_ref`, so a replayed
panic returns the original rather than raising a second emergency.

**Push, restored safely.** `app.config.ts` now refuses to produce an Android
build without `google-services.json` instead of shipping one that crashes at
launch, and every `expo-notifications` call is guarded so a build without the
native module degrades to realtime-only.

**Mobile reaches parity on the field surfaces**: alerts inbox with a live badge
and acknowledgement state, a Mine/Nearby switch on incidents with distance
sorting, leave applications, and Criti — which needed a bearer-token auth path
(`createBearerClient` + `getRequestSupabase`) for a client with no cookie jar.

**The platform notices things on its own.** Seven rules on a five-minute
`pg_cron` tick (`0025`/`0026`): unassigned-call escalation, no arrival recorded,
open incident gone quiet, certification expiry, unacknowledged duty reminders, a
per-department morning digest, and housekeeping. Every action is claimed against
a `(rule, entity, bucket)` unique index, so a rule that runs every five minutes
alerts once per tier rather than forever — an alerting system that cries wolf is
worse than none. Thresholds are tunable from **Admin → Automations** without a
deploy.

**Global search** (`0027`) across incidents, personnel, fleet and reports, in ⌘K
and at `/search`. Trigram rather than full-text, because operators type
identifiers (`INC-…`, plates, badges) that `to_tsvector` mangles. `SECURITY
INVOKER`, so RLS scopes every branch.

**Production hardening.** Per-user rate limits counted in Postgres (`0028`) on
the routes that spend money or third-party quota, failing open. `/api/geocode`
closed — it needed no key, but an open relay in front of Nominatim gets the
deployment's IP banned. **Admin → System Status** answers "is the platform
working" in one page. `docs/07-ENGINEERING-STANDARDS.md` and
`docs/08-RUNBOOK.md` record what CI enforces and what to do at 03:00.

**CI** (`.github/workflows/ci.yml`) gates lint, typecheck, test and build, plus a
job that applies all 28 migrations to a throwaway PostGIS from empty.

### Fixed along the way

- **Incident numbers collided.** `INC-<date>-<random 100..999>` against a unique
  constraint: ~50% chance of a collision at 35 calls in a silo-day, surfacing as
  an exception thrown at a call-taker with a caller on the line. Now a per-silo
  daily counter (`0024`).
- **The outbox retry budget was wrong**, and attempts accrued while offline — a
  crew driving through a tunnel would have a scene photo marked failed. Found by
  writing the test.
- **`pnpm lint` was red on `main`**, which makes a lint worse than useless.

---

## Wave 4 and earlier

**Wave 4 aligned V5 with the V4 commits from 2026-07-21 → 07-23:**
- **Schema `0007_v4_alignment.sql`** — incidents get `call_taken_by`, `dispatched_by`, `incident_category`, `region` (operator attribution for KPIs); personnel get `service_number`/`force_number`; rosters get `call_sign`/`shift_group_code`/`special_instructions`/`vehicle`/`sector`/`status`; five new tables — `command_records` (admin config), `endorsements`, `performance_kpis`, `performance_plans`, `performance_scores` — all with RLS + default config/KPI seed.
- **AdminConfig** (`/admin/config`) — configurable Incident Categories (groups + sub-categories with form prompts), Leave Types, Shift Types, saved Report Templates; soft-delete toggle. Log-call now drives category/sub-category/region from config and stamps the call taker; dispatch stamps the dispatcher; leave form pulls configured types.
- **Performance suite** (`/performance/*`) — Operational KPI console (call-taker/dispatcher throughput, category pivot, call detail, logons + CSV export, faithful to `OperationalKpiService`); My Performance self-service (throughput vs team, monthly trend, appraisal snapshot); Role KPIs; KPI config; annual 1-July appraisal Plans with mid-year/final scoring + approval workflow.
- **Report Hub** (`/report-hub`) — advanced filtered incident reporting (search/status/dept/category/region/date), CSV export, saved templates persisted as `ReportTemplate` config records.
- **Duty roster** — endorsements CRUD (court/special-event/instruction/restriction), vehicle/sector/call-sign on assignment, and the printable **DCP duty sheet** (`/roster/duty-sheet`) with shift blocks, on-leave list, special events and sign-off columns.
- **MyHR portal** (`/profile/my-hr`) + officer-portal KPI hero on the dashboard for field roles.

**Wave 3 closed every remaining gap:**
- **Expo mobile app** (`apps/mobile`) — full responder app: login, live my-incidents with status flow, incident detail with camera/library evidence capture into `incident-media`, 3-step start-of-shift wizard, duty toggle with 60s GPS heartbeat, logout that frees the vehicle. Expo SDK 52 + expo-router, typechecks clean.
- **BulkSMS** (`lib/sms.ts` + "Request citizen GPS" on incident detail) — V4 payload/normalisation, mints a `citizen_share_tokens` row and SMSes the `/share-location/{token}` link.
- **RealPTT** (`lib/realptt.ts`, `/api/ptt/send`, `/api/ptt/audio`, `/dispatch/ptt` console) — faithful port of the SHA1+HMAC auth dance, user lookup, sendMsg, and 2-hour audio log.
- **External proxies** — `/api/external/{traffic,pois,flights,flight-tracks,vessels}` (TomTom ×2, FR24 ×2, Kpler AIS) with V4's exact URLs/headers; `/api/cameras/import` parses the i-traffic XML and upserts; live traffic panel on `/cameras`.
- **Chatbot full parity** — V4 system prompt, live DB-context injection (RLS-scoped), and executable `[UPDATE_STATUS|…]` / `[FILL_REPORT|…]` action codes with audit logging.
- **PDF evidence embedding** — case-report PDFs now download and embed scene photos from Storage.
- **PCR signatures** — canvas signature capture (responder / hospital rep / doctor) stored as base64, rendered on the PCR detail.
- **Seed data** — migration `0006_seed_mutual_aid.sql` (all 41 V4 partners verbatim); SAPS crime CSV copied into `supabase/seed/data` with loader `pnpm db:load-crime`.
- **Stack** — web upgraded to stable React 19 + Next 15.1; single `@types/react` enforced via pnpm overrides.

### Environment variables

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web |
| `SUPABASE_SERVICE_ROLE_KEY` | web (camera import, seed scripts) |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile |
| `NEXT_PUBLIC_APP_URL` | SMS share-links (falls back to request host) |
| `BULKSMS_TOKEN_ID` / `BULKSMS_TOKEN_SECRET` | `/lib/sms.ts` |
| `REALPTT_ACCOUNT` / `REALPTT_PASSWORD` | `/api/ptt/*` |
| `TOMTOM_API_KEY` | `/api/external/traffic`, `/api/external/pois` |
| `FLIGHTRADAR_API_KEY` | `/api/external/flights`, `/api/external/flight-tracks` |
| `MARINESIA_API_KEY` | `/api/external/vessels` |
| `ITRAFFIC_API_KEY` | `/api/cameras/import` |
| `OPENWEATHER_API_KEY` | `/api/wind` |
| `GEMINI_API_KEY` (+`GEMINI_MODEL`) | `/api/chat` |

Every proxy degrades gracefully (clear "not configured" response) when its key is absent — no crashes, no fake data.

## Authorization

- `packages/db/src/roles.ts` is the single source of truth: role groups + `ROUTE_RULES` + `canAccess()`.
- Enforced in `apps/web/middleware.ts` (redirect → `/403`) **and** used to filter the sidebar, so nav and enforcement cannot drift.
- Migration `0005_roles_alignment.sql` adds the V4 roles `Responder` and `Staff` that were missing from the enum.
- All 24 V4 roles are assignable from `/admin`; role-aware quick actions on the dashboard.

## UX / shell

- **Responsive**: desktop sidebar rail collapses to a hamburger drawer below `lg`; header condenses; form grids stack; every table scrolls in place.
- **Realtime**: global toast on new incidents (silo-scoped; global roles hear everything) + live refresh on the dispatch queue.
- **States**: skeleton `loading.tsx`, recoverable `error.tsx`, branded 404, active-route highlighting, status badges, focus-visible rings, styled scrollbars, print stylesheet.
- **Charts**: recharts wrappers (`components/charts.tsx`) on dashboard, KPI and analytics.
- **Maps**: shared Leaflet component (`components/leaflet-map.tsx`) — OSM tiles, severity-coloured markers — for the small single-purpose maps. The dispatch board and `/incidents/map` use the **live operations map** (`components/ops-map/`): incidents and on-duty officers move in place over realtime, SOS beacons always show, and a **Layers** panel switches V4 `_MapCore` overlays on and off (crime zones from `crime_stats`, hydrants, CCTV, OpenWeather rain/cloud/temperature/wind tiles, TomTom traffic and emergency facilities). Choices are remembered per browser; each desk opens with its own defaults (`lib/ops-map/layers.ts`). **Full screen** (or F) makes it a wall display for a control-room TV — HUD with SAST clock and live counts, controls fade when idle, screen kept awake, view follows the incidents; `/incidents/map?wall=1` opens straight into it.
- **Perimeters & zones** (migration 0053, `components/ops-map/zones/`): command and control-room staff (`MAP_ZONE_DRAW_ROLES`) draw areas, circles, lines and points on the live map — live measurements, radius to the metre, coordinates to six decimals, points snapped onto a call's pin, vertex editing, self-crossing areas refused — then name the type (cordon, exclusion, evacuation, hazard, search, road closure, route, staging, command post, rendezvous, last seen, note), say why, link a call, choose who sees it (only me / my department / chosen departments / everyone on the call / everyone) and an end time. Writes go only through `save_map_zone()` / `end_map_zone()` (PostGIS validation and geodesic measurements, change history in `map_zone_events`, audit log); zones are stood down with a reason, never deleted. Consoles receive shared zones live with who set them and why (`components/zone-notifier.tsx`); the incident page lists a call's zones. Police officers now **see** shared zones on the app's Live Map (below), but nothing is pushed to them: nothing is written to `alerts`.
- **Officer app Live Map, police overlays** (6 Oct 2026, `apps/mobile/app/live-map.tsx`, `lib/police-overlays.ts`): full screen with a floating back button, a weather chip, and a Layers sheet for Metro Police only. It offers SAPS crime zones (the same maths as the console, now in `@criticom/db/map-layers`, with a category picker), the perimeters and zones shared with the officer (RLS, kept live by Realtime), and rain radar. The choice is remembered on the phone. Each overlay opens a small card when tapped. Other departments keep the plain incident map.

## Controller → route map

| V4 controller | V5 route(s) | Status |
|---|---|---|
| AuthController | `/login`, logout button | ✅ |
| ControlRoomController | `/dispatch/log-call`, `/dispatch/pending` | ✅ |
| DispatchController | `/dispatch/assign/[id]`, `/dispatch/kpi` | ✅ |
| IncidentsController | `/incidents`, `/incidents/[id]`, `/incidents/map` (live GIS) | ✅ |
| ReportsController | `/reports`; lifecycle folded into `/incidents/[id]` | ✅ |
| ResponderController | `/responder` (status flow, evidence upload) | ✅ |
| ShiftController | `/shift/*` 3-step workflow + `/shift/unit-compliance`; medical restock | ✅ |
| MetroController | `/police`, `/police/reports(/new,/[id])` — 7 wizards, `/police/firearms(/new)` | ✅ |
| SecuritiesController | `/police/security(/new)` — SIRA guard reports + resolve flow | ✅ |
| CrimeController | `/police/crime-hotspots` (SAPS dataset, ranked) | ✅ (CSV import = ops task) |
| FirefightersController | `/fire/reports(/new,/[id])` + **PDF download** | ✅ |
| FireChiefController | `/fire/hydrants` — GIS map + register; hydrants also on the live map. `scripts/load-hydrants.mjs` loads EWS hydrant GeoJSON (needs migration 0052; re-runs update in place, never overwrite fire-service inspections). V4's copy is a partial 1,000-point extract — the full EWS register is still to be obtained | ✅ |
| PIRController | `/fire/pir`, `/fire/pir/publish/[reportId]` | ✅ |
| ParamedicsController | `/medical/pcr(/new,/[id],/[id]/edit)` — full PCR | ✅ (signature canvas → mobile phase) |
| DisasterController | `/disaster` (monitor, map, **wind widget**), `/disaster/dispatch`, `/disaster/post-mortem`, `/disaster/partners` | ✅ |
| WindController | `/api/wind` (OpenWeatherMap proxy, key server-side) | ✅ |
| ChatbotController | `/assistant` full page + right-hand **assistant dock** on every route + `/api/chat` (live board context, four action codes) | ✅ |
| CaseManagerController | `/case-manager`, audit views, close-case, **case PDF** (`/api/pdf/incident/[id]`) | ✅ |
| CitizenController | public `/share-location/[token]` — live geolocation → `citizen_update_location` RPC | ✅ |
| NotificationsController | `/notifications` alert feed + duty RPCs + global toast system, blocking dispatch pop-ups, live unread bell, Expo push to the responder app | ✅ (beyond V4) |
| RosterViewController | `/roster` — 224 & 24-48 generators, shifts, assignments | ✅ |
| LeaveController | `/leave` — real table, approve/reject | ✅ |
| Training/PoliceTrainingController | `/training` | ✅ |
| Performance/SystemAnalyticsController | `/performance` + `/analytics` (trends, closure rate, charts) | ✅ |
| DevAdmin/SuperController | `/admin` + `/admin/{personnel,operators,vehicles,devices,integrations}` + audit | ✅ (integrations panel is new) |
| HRController / StaffController | `/admin/personnel` register | ✅ |
| Profile/SystemProfileController | `/profile` (call-sign generator) + `/admin/operators` | ✅ |
| CamerasController | `/cameras` registry | ✅ registry (live feed import = ops task) |
| HomeController | `/dashboard` (charts + role-aware actions) | ✅ |

## API routes (replaces V4 server-side proxies — keys never reach the client)

- `/api/pdf/incident/[id]` — case report PDF (pdf-lib)
- `/api/pdf/fire-report/[id]` — fire report PDF
- `/api/wind` — OpenWeatherMap (needs `OPENWEATHER_API_KEY`)
- `/api/weather/tiles/[layer]/[z]/[x]/[y]` — OpenWeather map tiles for the live map (same key; no `.png` suffix so the middleware still authenticates it). The officer app's map loads tiles as plain images, which cannot carry a sign-in. It adds a two-hour signed `?pass=` from `/api/weather/pass` (`lib/weather-pass.ts`; key `WEATHER_PASS_SECRET`, falling back to the service role key), which the route checks.
- Middleware: `/api/*` also accepts the officer app's Supabase access token as `Authorization: Bearer`, verified by Supabase Auth. The same role, silo and deactivation checks then apply. Before this, every bearer call from the app (the assistant included) was refused with 401 at the edge.
- `/api/chat` — Gemini "Criti" assistant (needs `GEMINI_API_KEY`, optional `GEMINI_MODEL`)
- `/api/geocode` — Nominatim proxy for the dispatch console's address ⇄ coordinate lookup (no key)
- `/api/push/notify` — Expo push fanout to the departments a call was routed to (service-role read of `push_tokens`)
- `/api/integrations/test/[key]` — per-integration connection probe, admin-only

## Department branding (V5 addition)

Each silo carries its own identity — official name, short name, monogram, colours and motto —
stored in `department_branding` and editable at **Admin → Departments**. Crests are *uploaded*
into the public `department-logos` bucket rather than shipped with the app: official municipal and
service insignia belong to the municipality, so the platform never fabricates them. Until a crest
is uploaded the UI renders a monogram badge in that department's colours, so nothing looks
unfinished. The badge appears in the web sidebar, My Schedule and the mobile app shell and profile;
`DeptBadge` / `DeptChip` (web) and `DeptBadge` / `DeptHeader` (mobile) are the shared components.

## My Schedule (V5 addition)

`getMySchedule` answers "when am I working?" in one call — current duty, next duty, upcoming roster
allocations with call sign/vehicle/sector, leave balances, leave requests and active endorsements.
Surfaced at `/roster/mine` (open to every role) and as the mobile **Schedule** tab.

## HR system (V5 addition — far beyond V4's leave table)

- **HR Command Centre** (`/hr`, supervisory tier): headcount, on-duty, on-leave-today,
  approvals waiting with inline decide, and certifications expiring within 30 days.
- **Leave**: per-member balances (entitlements live on LeaveType config rows — `detail3` days,
  tunable from Admin → Configuration), a month calendar of who's away, a reason field, and an
  approval trail (`approved_by`/`approved_at`). Every pending request shows its **coverage
  impact** — the percentage of the department away if granted. Decisions raise a targeted alert
  to the member. RLS: members insert their own requests Pending-only (0015); decisions stay with
  the supervisory tier.
- **Roster**: a week schedule board — seven days of shifts with the members rostered onto each,
  coloured by activity type — alongside the existing generators, endorsements and duty sheet.
- **Performance reports** (`/performance/reports`): one date window cut three ways — by member
  (calls taken / dispatches / responses / closures / avg close / leave days), by department
  (volume, closure rate, staffing, leave burden), by incident type (severity mix + resolution) —
  each with CSV export via `/api/hr/report.csv`.

## Ops command bar + CCTV platform (V5 addition)

Every page carries the V4-style command bar under the topbar: an external-resources tier
(E-NATIS, CAS, PERSAL, FIREARM, FINES, TRACE, FORENSICS, CONSTELLATIONS, REAL PTT, FLIGHTRADAR,
MARINETRAFFIC, REPORTS) driven by `OpsLink` config records — admins repoint or add systems from
Admin → Configuration, placeholders render dimmed until their endpoint is issued — plus an internal
module tier (Dispatch, Incoming, Body Cams, Body Cam Footage, SANRAL Cameras, Responder, KPI, Operations dropdown)
filtered per role by the shared route matrix. Collapsible per user.

Cameras (2026-10-05, migration 0054): the SANRAL freeway wall moved to `/sanral` and `/api/cctv/cameras`
serves only its registry. The Hikvision platform (HCM Lite) now serves the bodycams: Body Cams
(`/cameras`), Body Cam Footage (`/cameras/footage`), the live map and the incident page, through
`/api/bodycams/view`, which opens a view only after `start_bodycam_view()` has allowed and recorded it.
`/api/cctv/stream` is gone. See docs/12-BODYCAMS.md.

SANRAL CCTV matrix (2026-10-06): V4's `Dispatch/CCTV` view framed i-traffic's own
`/Map/EmbeddedMap` with a province picker; clicking a camera shows its latest snapshot (SANRAL
publishes stills, not video). Ported to the top of `/sanral` (`itraffic-map.tsx`): no API key
needed, areas eThekwini (default)/KZN/GP/WC/EC/All, layer chips, full screen, and `?lat=&lng=`
centres it, which the incident page links to ("SANRAL freeway cameras nearby"). CSP `frame-src`
allows only `https://www.i-traffic.co.za`, sandboxed. The registry wall, table and live-map
camera layer still need `ITRAFFIC_API_KEY`; they are hidden while the registry is empty.

## Operational tuning (V5 addition)

Admin → **Operations Settings** exposes the service's knobs without a deploy: intake-clock
warn/critical thresholds, dashboard SLA gauge targets, which severity interrupts with a blocking
pop-up, alert sound on/off, toast duration, the ETA model (speed + road factor), default basemap,
and ops-board feed/volume windows. The catalogue lives in `packages/api/src/settings` — each knob
declares its type, bounds, default and description, and the admin page renders from the catalogue,
so adding a future knob is one entry there. Values are stored as overrides in `app_settings`
(admin-write, everyone-read RLS), validated and clamped on read and write, and every change or
reset is audit-logged. If the table is unreachable the code defaults apply — a tuning problem can
never take a screen down.

## Alerting (V5 addition — V4 had SignalR toasts only)

`alerts` rows are the "tell a human now" channel. `route_incident(incident, silos[])` writes one
silo-wide alert per receiving department and returns in a single round trip; RLS scopes delivery so a
crew only ever sees its own department's copy. High and Critical calls are raised with
`presentation: 'modal'` and `requires_ack: true`, which renders as a blocking pop-up on web and a
full-screen interrupt on mobile; acknowledgement is recorded in `alert_reads`. Everything else is a
corner toast. Realtime covers open screens; Expo push covers locked phones.

## Still outstanding (operational, not code)

1. **Data migration** from the five SQL Server DBs (security doc §3) — **credential rotation still urgent**; V4's leaked BulkSMS token pair and Gemini key are now confirmed in source and must be revoked.
2. Provision Supabase (local/staging/prod), apply migrations 0001–0006, run `pnpm db:load-crime`, trigger `/api/cameras/import`, and set the env keys above.
3. Mobile store builds (EAS build profiles + push-notification credentials) — the app itself is complete.
