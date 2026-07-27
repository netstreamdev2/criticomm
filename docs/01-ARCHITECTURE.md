# 01 — Architecture: Supabase + Next.js + Expo

## 1. Tenant model — single DB + RLS by silo

V4 used 5 physical SQL Server databases and a `MasterId` GUID to keep copies in sync. **V5 uses a single Supabase Postgres database** with these primitives:

```sql
create type silo as enum (
  'Ethekwini',      -- master / global
  'MetroPolice',
  'MetroFire',
  'Medical',
  'EthekwiniDisaster'
);
```

Every tenant-bound table carries a non-null `silo silo` column. RLS policies enforce: a user can only `SELECT/INSERT/UPDATE/DELETE` rows where `silo = jwt.silo` OR they hold the `Ethekwini` (global) silo (dispatchers, control room, system admins).

### Why not 5 projects or schemas?

- **5 projects**: 5× cost, 5× ops surface, cross-silo analytics requires ETL — strictly worse than RLS unless we had a regulatory mandate for physical isolation (we don't; V4 already shares one Azure SQL server, just different databases).
- **5 schemas**: Supabase Realtime publication and Storage RLS are most ergonomic against `public`. Workable but more friction than the column-discriminator approach.
- **Single DB + RLS**: Postgres-native, Supabase-default, allows cross-silo reads for global roles via a single policy clause, kills the entire sync worker.

### Where `silo` lives

- `auth.users.raw_app_meta_data->>'silo'` — set by an Edge Function on user creation (admin can change it). `raw_app_meta_data` is server-controlled, unlike `raw_user_meta_data`. Required for it to be trustworthy in RLS.
- A helper function `auth.silo()` returns the current user's silo from JWT.
- `profiles.silo` mirrors it for joins; a trigger keeps them in sync.

## 2. Identity → Supabase Auth

| V4 thing | V5 thing |
|---|---|
| `IdentityUser` (email, password hash, EmailConfirmed, PhoneNumber, SecurityStamp) | `auth.users` (handles all of this natively) |
| `IdentityRole` + `IdentityUserRole` | `public.profiles.role role_enum` (single role per user — V4 also effectively does this) |
| `IdentityUserClaim("Silo")` | `auth.users.raw_app_meta_data.silo` + `profiles.silo` mirror |
| `IdentityUserClaim("AssignedStation"|"BadgeNumber"|"FullName"|"HardwareUUID")` | `profiles.station|badge_number|full_name|hardware_uuid` |
| Password reset via SendGrid + custom token | Supabase Auth `resetPasswordForEmail` (built-in, uses your own SMTP if you swap it in) |
| `[Authorize(Roles="…")]` | RLS policy `using (auth.role_in('Dispatcher','Operator',…))` — implemented as a `SECURITY DEFINER` function `auth.role_in(variadic text[])` reading `profiles.role` |
| `[Authorize(Policy="RequireSiloAccess")]` | RLS `using (silo = auth.silo() or auth.silo() = 'Ethekwini')` plus Next.js middleware refusing route `/police/*` to non-Police silos to spare the round-trip |

Auth migration: existing `IdentityUser` records are imported via Supabase Admin API with their PBKDF2 password hashes preserved (Supabase supports custom hash schemes via Edge Function on first sign-in, falling back to a one-time password reset email if that's too complex). See `docs/04-SECURITY-MIGRATION.md` §3.

## 3. Realtime — replacing both SignalR hubs

Supabase Realtime offers three primitives we use:

1. **Postgres Changes** — auto-broadcast `INSERT|UPDATE|DELETE` on whitelisted tables. RLS-aware. Replaces `ReceiveNewIncident`, `ReceiveIncidentUpdate`, `ReceiveRosterUpdate`, `ReceivePersonnelStatus`.
2. **Broadcast** — manual `channel.send({event,payload})` between any clients. Replaces `ReceiveNotification`, `ReceiveAcknowledgment`, `ReceiveKPIUpdate`, `ReceiveDashboardRefresh`, `ReceiveChartData`, `ReceiveEmergencyAlert`, `ReceiveSystemStatus`.
3. **Presence** — connection-state tracking. Replaces the explicit Ping/Pong + on-duty heartbeat.

### Channel naming

| Channel | Subscribers | Events |
|---|---|---|
| `incidents:{silo}` | All authenticated, silo-scoped via RLS on publication | Postgres changes |
| `incidents:global` | Ethekwini/SystemAdmin only | Cross-silo aggregate |
| `notifications:{userId}` | Single user | Broadcast (acknowledgments, dispatcher-to-responder pings) |
| `dispatch:{silo}` | Dispatchers + ControlRoom | Broadcast (KPI refresh, dashboard refresh, chart updates) |
| `alerts:global` | All authenticated | Broadcast emergency-wide alerts |
| `personnel:{silo}` | Same-silo + dispatchers | Postgres changes on `personnel` (on-duty/GPS) |
| `presence:duty:{silo}` | Same | Presence (who's currently connected) |

Publication setup is in `0003_realtime_storage.sql`.

## 4. Storage

One bucket per access pattern. Each has its own RLS policy on `storage.objects`.

| Bucket | Public read | Auth write | Use |
|---|---|---|---|
| `avatars` | yes | self only | Profile pictures |
| `incident-media` | no | authenticated, silo-scoped | Evidence images, voice notes, body-cam |
| `certifications` | no | personnel-self + supervisors | Cert PDFs |
| `incident-attachments` | no | authenticated, silo-scoped | Signed-URL only |
| `pdf-exports` | no | service role | Generated PIR/case-report PDFs (cached) |

V4 logs blob URLs into `IncidentUpdate.Message` as a magic string (`[EVIDENCE LOGGED] Photographic evidence attached: <url>`). V5 stores them in a proper `incident_attachments` table — see schema.

## 5. Background jobs / hosted services

`EthekwiniSyncWorker` is **deleted**. Other background needs:

| V4 worker | V5 replacement |
|---|---|
| `EthekwiniSyncWorker` (cross-silo sync) | DELETE — no longer needed |
| Idempotent column-add ALTER TABLE at startup (`ClosedAt`, `RespondingOfficer`) | Replaced by versioned migrations |
| `SeedSystemUser` × 11 system accounts | Edge Function `seed-system-users` (idempotent), called once via Supabase Admin or CI |
| `DemoDataSeeder.SeedAsync` + `AnalyticsSeeder.SeedAsync` | `supabase/seed/dev.sql` — only ever applied to staging/dev |

For periodic jobs (V4 has none, but V5 may want some — e.g. nightly rollups for analytics): Supabase Cron extension (`pg_cron`) + Edge Functions.

## 6. PDF generation

V4 uses **PdfSharp** in-process for: PIR public reports, case-manager per-silo reports, firefighter report tabular dump. V5 needs a server-side PDF renderer.

Recommended: **Edge Function with `@react-pdf/renderer`** or `pdf-lib` for the simpler tabular dumps, with HTML templates we can review. Pre-rendered PDFs land in the `pdf-exports` Storage bucket (cached for 24h on signed URL).

Alternative if templates get complex: **`puppeteer-core` on a Render/Fly worker** triggered by an Edge Function. Skip Vercel for this — long-running PDF rendering doesn't fit the serverless limits.

## 7. Server actions vs. RPCs vs. Edge Functions — when to use what

| Concern | Tool |
|---|---|
| Simple table mutation from web | Next.js Server Action calling Supabase client with user session — RLS handles auth |
| Mutation requiring elevated privilege (e.g. seed-system-user, RealPTT auth) | Supabase Edge Function with `service_role` key |
| Complex multi-table workflow (dispatch fan-out, case-close) | Postgres function (`SECURITY DEFINER`) called via `supabase.rpc()` — atomic + reusable from mobile |
| Cross-API integrations (TomTom, OpenWeatherMap, FlightRadar, Marinesia, RealPTT, BulkSMS, Gemini, SendGrid) | Edge Functions only — keys never reach client |

## 8. Web ↔ Mobile parity

A single `@criticom/api` package exports server-action signatures and RPC wrappers as plain async functions; both `apps/web` and `apps/mobile` import the same module. The `@criticom/db` package exports the generated `Database` type from `supabase gen types typescript` so a renamed column is a type error in both clients.

## 9. Time handling

V4 uses `TimeHelper.SaNow` (South Africa Standard Time, UTC+2) for `IncidentCreatedAt`, `CallTimestamp`, etc. — wall-clock-stored, no offset. V5 fixes this: every timestamp is `timestamptz` stored in UTC; UI formats to `Africa/Johannesburg`. Migration step: assume V4 wall-clock is SAST and convert to UTC during import.

## 10. What the production-grade UI looks like

Not part of the schema, but worth stating now so we don't bikeshed in Phase 1:

- **Design system**: shadcn/ui (Radix primitives + Tailwind) on web; react-native-paper or NativeWind+custom on mobile, both consuming `@criticom/ui-tokens` for shared colors/spacing.
- **Maps**: MapLibre GL JS (web) + MapLibre Native (mobile) with TomTom vector tiles (we already pay for TomTom). Single map component shared via `@criticom/ui-map`.
- **Charts**: Recharts on web, Victory Native on mobile.
- **Forms**: react-hook-form + zod schemas exported from `@criticom/db`.
- **Tables**: TanStack Table on web (V4's filterable Reports page is the model).
