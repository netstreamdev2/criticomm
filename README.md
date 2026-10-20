# Criticomm

**A multi-tenant emergency dispatch, response and command platform.** One call-taker logs an incident; the platform routes it to the right departments, puts it on a map, pushes it to the crews' phones, records everything they do at the scene — offline included — and keeps the evidential trail an inquiry will read a year later.

Built for eThekwini Emergency Services and architected so any number of organisations run on one deployment, each fully isolated at the database.

[![CI](https://github.com/Netstream-Project/CriticommNew/actions/workflows/ci.yml/badge.svg)](https://github.com/Netstream-Project/CriticommNew/actions/workflows/ci.yml)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)

---

## What it does

| Surface | Capabilities |
|---|---|
| **Console** (110 routes) | Call intake with duplicate detection and map-linked geocoding · dispatch queue and unit assignment with road-routed ETAs · live incident case files with timeline, evidence and PDF export · departmental report suites (police cases, fire reports, patient care records, SIRA security, firearms register, disaster logs) · HR command centre, leave with coverage impact, rosters and post-based duty allocation · performance KPIs and annual appraisal cycles · custom report builder · CCTV wall and audited footage retrieval · radio (PTT) bridge · cross-module trigram search (⌘K) · the **Criti** AI assistant reading the live board through the caller's own RLS |
| **Responder app** (Expo) | Modular Home driven by per-tenant feature flags · assigned + nearby incidents with navigation handoff · an **offline-first outbox** so no status change, photo or voice note is ever lost to a dead zone · hold-to-activate **officer-down (SOS)** that works without signal or GPS · start-of-shift gate (fitness declaration, vehicle selection, roadworthiness inspection) · alerts inbox with acknowledgement · leave applications · Criti |
| **Automation engine** (in-database) | Seven rules on a five-minute `pg_cron` tick: unassigned-call SLA escalation, no-arrival detection, stale-incident nudges, certification expiry warnings, unacknowledged duty reminders, per-department morning digests, housekeeping. Anti-spam by design — one alert per entity per escalation tier, ever |
| **Platform tier** | **Multi-tenancy** with database-enforced isolation · **feature flags** toggled per tenant by a SuperAdmin · tenant provisioning and user assignment · operational tuning (SLA clocks, alert behaviour, ETA model) without deployment · system status page that says what each check *means* |

## Architecture

```
┌────────────────┐     RLS-scoped queries      ┌──────────────────────────┐
│  Console       │────────────────────────────▶│  Postgres (Supabase)     │
│  Next.js 15    │                             │  data · authorization ·  │
├────────────────┤     bearer / realtime       │  realtime · much of the  │
│  Responder app │────────────────────────────▶│  business logic          │
│  Expo SDK 52   │                             ├──────────────────────────┤
└────────────────┘                             │  pg_cron → automations   │
        │                                      └────────────┬─────────────┘
        └── Expo Push (locked phones)                       │
                                               Storage · Auth · Realtime
```

Three decisions shape everything:

1. **Authorization lives in the database, never only in the app.** Row-level security decides what every user reads and writes; the application never adds a `WHERE` clause for security. A bug in a page cannot leak another department's — or another tenant's — data, because the page never had it.
2. **Multi-step workflows are stored procedures.** Dispatching writes an incident, updates unit state, appends a timeline entry, audits and raises one alert per department — as application code that is six round trips that can half-succeed, and a half-dispatched call is a crew that never rolls. `route_incident()`, `dispatch_unit()`, `raise_panic()` and friends do the whole job in one transaction; web and mobile call the same procedure so the surfaces cannot drift.
3. **The record is evidence.** Timestamps record when the responder acted, not when the network came back (the offline outbox carries `occurred_at`, server-bounded against backdating). Arrival is write-once. Every mutation is audited by name. Nothing is deleted silently.

### Multi-tenancy

The tenant rides in JWT app metadata; `current_tenant()` reads it (falling back to the founding tenant so pre-tenancy sessions keep working); every operational table carries `tenant_id uuid not null default public.current_tenant()` plus one **RESTRICTIVE** RLS policy. Restrictive matters: Postgres ORs permissive policies together, so adding tenancy as another permissive policy would *widen* access — a restrictive policy is ANDed with everything else. `SECURITY DEFINER` functions bypass RLS and therefore carry their own tenant guards; the automation engine stamps every alert with the source row's tenant because it runs with no JWT at all. Incident numbers, call signs, settings, integrations and branding are unique *per tenant*.

### Feature flags

A typed catalogue in code (`packages/api/src/features`) declares what can be toggled and its default; the database stores only per-tenant deviations. Writes are SuperAdmin-only — enforced by RLS, not just UI. Flags gate **availability, never authorization**: enforcement is nav filtering + page redirects + API refusals from one shared route map, and the mobile app reshapes itself live (with an AsyncStorage cache so a phone opening in a dead zone gets its tenant's last-known shape, failing open to all-enabled — wrongly hiding the SOS button is not a failure mode we accept).

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Web | **Next.js 15** (App Router), **React 19**, TypeScript 5.6 (strict) | Every page `force-dynamic`: per-user views are never statically cached |
| Styling | Tailwind CSS 3.4, Radix primitives, lucide-react | Eight runtime themes via CSS variables; per-department branding |
| Mobile | **Expo SDK 52**, React Native 0.76, expo-router 4 | Dark-only by design (night shifts, vehicle cabs) |
| Data/auth | **Supabase**: Postgres 15 + PostGIS, RLS, Auth, Realtime, Storage | supabase-js 2.110 + @supabase/ssr (cookie sessions); bearer-token path for the app |
| Scheduling | **pg_cron** in-database | The engine is complete without it — anything with a clock can call `run_automations()` |
| Validation | Zod 3 (schemas shared web ↔ mobile via `@criticom/db`) | |
| Maps | Leaflet + Esri/OSM tiles; Photon → Nominatim geocoding proxy | Key-free, no per-view billing |
| PDF | pdf-lib | Case reports embed scene photographs; also stamps the ops manual's folios |
| Charts | Recharts | |
| Monorepo | **pnpm 9** workspaces + **Turborepo 2** | |
| Lint/format | Biome 1.9 (`biome lint`; rationale for every disabled rule in [docs/07](docs/07-ENGINEERING-STANDARDS.md)) | |
| Tests | `node --test` with `--experimental-strip-types` (Node ≥ 22) — no framework, no transpile | 47 tests where a silent regression means a call not reaching a crew |
| CI | GitHub Actions: lint · typecheck · test · build · **all 31 migrations applied from empty** onto throwaway PostGIS | A migration that only works against production has not been tested |
| Mobile delivery | EAS build + Update (OTA) | `runtimeVersion: appVersion` guards the OTA-native-module trap |
| AI | Groq (primary) → Gemini (fallback) behind `/api/chat` | Server-side keys only; model actions whitelisted and audited |

## Repository layout

```
apps/
  web/           Next.js console — routes in app/(app), API in app/api
  mobile/        Expo responder app — screens in app/, providers in lib/
packages/
  db/            Supabase client factories · generated DB types · Zod schemas ·
                 roles.ts (THE route/authorization matrix)
  api/           Every query & mutation, by module. Both apps import from here;
                 neither builds queries inline.
  config/        Shared tsconfig
supabase/
  migrations/    31 numbered, append-only migrations (0001 → 0031)
  seed/          Dev seed data
scripts/         Migration runner · seeding · admin creation · SAPS crime stats loader
docs/            Architecture/security docs · runbook · engineering standards ·
                 wiki/ → the 116-page Operations & Engineering Manual (PDF pipeline)
.github/         CI workflow
```

## Getting started

**Prerequisites:** Node ≥ 22, pnpm ≥ 9 (`corepack enable`), a Supabase project (or local `supabase start`), Chrome/Edge (only for building the manual).

```bash
pnpm install
```

Create env files (see `.env.example`):

| File | Keys |
|---|---|
| `.env` (repo root — scripts) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (use the session pooler; the direct host is IPv6-only) |
| `apps/web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, plus optional integration keys (`GROQ_API_KEY`, `TOMTOM_API_KEY`, `BULKSMS_*`, …) — every one degrades to a clear "not configured" state |
| `apps/mobile/.env.local` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_APP_URL` |

Apply the schema and seed:

```bash
set -a && . ./.env && set +a
node scripts/apply-migration.mjs supabase/migrations/*.sql   # transactional per file
pnpm db:seed
pnpm db:create-admin
```

Run:

```bash
pnpm dev                          # web on :3000 (+ Expo if configured)
pnpm --filter @criticom/mobile start
```

Quality gate (what CI runs):

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Build the 116-page operations manual:

```bash
pnpm docs:build                   # → docs/Criticomm-Operations-Manual.pdf
```

## Database

31 append-only migrations. Never edit an applied one — write the next. Highlights:

| Range | What |
|---|---|
| 0001–0004 | Full schema (57 tables), deny-by-default RLS, realtime/storage, workflow procedures |
| 0010–0011 | Alerts + read receipts + push tokens; department routing with alert fanout |
| 0019–0020 | `require_role()` guards on every privileged mutator; anon EXECUTE actually revoked |
| 0024 | Field ops: offline-safe idempotent writes (`client_ref`), honest timestamps, `raise_panic()` (deliberately no role gate — gating an emergency on a role matrix is how someone dies over a provisioning mistake), collision-free per-day incident numbering |
| 0025–0026 | Automation engine + scheduler |
| 0027 | Trigram global search (`pg_trgm` — operators type identifiers, and `to_tsvector` mangles them) |
| 0028 | Per-user rate limiting in Postgres (serverless makes in-memory counters meaningless); fails open |
| 0029–0031 | Tenants, feature flags, restrictive isolation on every table, tenant guards on every privileged function |

**Gotchas that will bite you if you don't know them** (details in [docs/07](docs/07-ENGINEERING-STANDARDS.md) and [docs/08](docs/08-RUNBOOK.md)):

- PostgREST resolves RPCs by argument name — adding a defaulted parameter creates an *overload* and calls matching both resolve to neither. Drop the old arity in the same migration.
- `packages/db/src/types.generated.ts` is **hand-authored** despite the name (supabase-js 2.110 needs keys the generator omits). Edit it alongside migrations.
- `current_tenant()` must stay `SECURITY DEFINER` — as INVOKER it recurses through the `tenants` RLS policy.
- An OTA update ships JavaScript only. Adding a native module without bumping the app version bricks every installed handset at launch; `app.config.ts` also refuses to build Android without `google-services.json` unless `CRITICOM_ALLOW_NO_PUSH=1` says a realtime-only build is deliberate.

## Security model

Transport (HSTS, strict CSP) → session (Supabase Auth; role/silo/tenant in JWT) → route (middleware over `ROUTE_RULES`) → row (RLS: silo policies AND tenant restriction) → function (`require_role()` on every DEFINER mutator) → rate (per-user Postgres counters) → audit (every mutation, by name). Third-party keys never reach a client bundle — every external call goes through an authenticated, rate-limited server proxy that degrades to "not configured" rather than erroring. Known outstanding items are tracked honestly in [docs/06-SECURITY-AUDIT.md](docs/06-SECURITY-AUDIT.md) and the manual §40.5.

## Documentation

| Doc | Purpose |
|---|---|
| [docs/Criticomm-Operations-Manual.pdf](docs/Criticomm-Operations-Manual.pdf) | **The** reference: 116 pages — role playbooks for all 23 roles, 83 step-by-step procedures with screen-to-screen flow diagrams, admin, ops, full reference indexes |
| [docs/08-RUNBOOK.md](docs/08-RUNBOOK.md) | On-call: triage order, backup/recovery, deploys, common situations. Opens with the only rule that matters: every procedure in it is slower than the radio |
| [docs/07-ENGINEERING-STANDARDS.md](docs/07-ENGINEERING-STANDARDS.md) | What CI enforces and why, rule by rule |
| [docs/01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md) · [docs/05-PARITY-STATUS.md](docs/05-PARITY-STATUS.md) · [docs/06-SECURITY-AUDIT.md](docs/06-SECURITY-AUDIT.md) | Architecture decisions · feature history wave by wave · audit findings |

## License

**Proprietary** — Copyright © 2026 Kruz Naidoo. All rights reserved.

This software may not be used, copied, modified or distributed without the Owner's prior
written authorization. See [LICENSE](LICENSE). ALL PASSWORDS ARE Test123!

