# 05 — V4 → V5 Parity Status

Updated: 2026-07-24 (wave 4 — July feature-drop alignment). Build: `pnpm --filter @criticom/web build` ✅ (86 routes) · typecheck ✅ (db, api, web, mobile).

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
- **Maps**: shared Leaflet component (`components/leaflet-map.tsx`) — OSM tiles, severity-coloured markers.

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
| FireChiefController | `/fire/hydrants` — GIS map + register | ✅ |
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
- `/api/chat` — Gemini "Criti" assistant (needs `GEMINI_API_KEY`, optional `GEMINI_MODEL`)
- `/api/geocode` — Nominatim proxy for the dispatch console's address ⇄ coordinate lookup (no key)
- `/api/push/notify` — Expo push fanout to the departments a call was routed to (service-role read of `push_tokens`)
- `/api/integrations/test/[key]` — per-integration connection probe, admin-only

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
