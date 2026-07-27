# 02 — Monorepo Layout

Stack: **Turborepo + pnpm workspaces**, TypeScript strict mode, Biome for lint/format (faster than ESLint+Prettier).

```
CriticomV5/
├── apps/
│   ├── web/                          # Next.js 15 App Router
│   │   ├── app/
│   │   │   ├── (auth)/login, /reset-password, /share-location/[token]
│   │   │   ├── (dashboard)/dashboard, /dispatch, /incidents, /reports, /cctv, /cameras
│   │   │   ├── (police)/police/*
│   │   │   ├── (fire)/fire/*, /fire/chief/*, /fire/pir/*
│   │   │   ├── (medical)/medical/*
│   │   │   ├── (disaster)/disaster/*
│   │   │   ├── (responder)/responder/*
│   │   │   ├── (shift)/shift/*
│   │   │   ├── (admin)/admin/*, /analytics, /case-manager, /system-profile
│   │   │   ├── (hr)/training, /leave, /roster, /performance, /profile
│   │   │   └── api/                  # Route handlers that proxy keyed APIs server-side
│   │   ├── middleware.ts             # Auth + silo gate
│   │   ├── components/               # Page-specific only
│   │   └── lib/                      # Web-only helpers
│   │
│   └── mobile/                       # Expo SDK 52, expo-router
│       ├── app/
│       │   ├── (auth)/login
│       │   ├── (responder)/index, incidents, [id], upload, ptt
│       │   ├── (shift)/mental-check, vehicle-checklist, inventory
│       │   └── (citizen)/share-location/[token]   # Deep-link target
│       ├── components/
│       └── lib/
│
├── packages/
│   ├── db/                           # Single source of truth for DB types & client
│   │   ├── src/
│   │   │   ├── types.generated.ts    # `supabase gen types typescript`
│   │   │   ├── client.ts             # createBrowserClient/createServerClient factories
│   │   │   ├── server.ts             # service_role client (server-only)
│   │   │   └── schemas/              # Zod schemas mirroring each table
│   │   └── package.json
│   │
│   ├── api/                          # Pure functions; shared business logic
│   │   ├── src/
│   │   │   ├── incidents/            # logIncomingCall, dispatchUnit, closeCase, …
│   │   │   ├── personnel/            # toggleDuty, assignVehicle, …
│   │   │   ├── shift/                # submitMentalCheck, submitVehicleChecklist, …
│   │   │   ├── reports/              # buildKpis, fetchIncidentLifecycle, …
│   │   │   ├── realtime/             # channel subscriptions typed
│   │   │   └── external/             # tomtom, openweather, fr24, marinesia, realptt, bulksms, gemini
│   │   └── package.json
│   │
│   ├── ui/                           # Cross-platform-aware design tokens + a few primitives
│   │   ├── src/
│   │   │   ├── tokens.ts             # colors, spacing, radii
│   │   │   └── icons.ts              # lucide-react / lucide-react-native re-exports
│   │   └── package.json
│   │
│   ├── ui-web/                       # shadcn/ui-based primitives (web only)
│   │   └── src/components/...
│   │
│   ├── ui-mobile/                    # react-native-paper or custom (mobile only)
│   │   └── src/components/...
│   │
│   ├── config/                       # Shared eslint/biome/tsconfig presets
│   │   ├── biome.json
│   │   ├── tsconfig.base.json
│   │   └── tsconfig.next.json
│   │
│   └── testing/                      # Playwright fixtures, Vitest setup
│
├── supabase/
│   ├── config.toml                   # Local dev config
│   ├── migrations/
│   │   ├── 0001_init.sql             # All tables, indexes, enums, FKs
│   │   ├── 0002_rls.sql              # RLS policies
│   │   ├── 0003_realtime_storage.sql # Realtime publication + Storage buckets + Storage RLS
│   │   ├── 0004_functions.sql        # SECURITY DEFINER RPCs (dispatch_unit, close_case, etc.)
│   │   └── 0005_views.sql            # Materialized views for analytics
│   ├── functions/                    # Edge Functions
│   │   ├── seed-system-users/
│   │   ├── tomtom-proxy/
│   │   ├── openweather-proxy/
│   │   ├── fr24-proxy/
│   │   ├── marinesia-proxy/
│   │   ├── realptt-proxy/
│   │   ├── bulksms-send/
│   │   ├── chat-criti/               # Gemini wrapper
│   │   ├── weather-archive/          # Open-Meteo
│   │   ├── pdf-render/               # PIR + case-report PDFs
│   │   └── _shared/                  # CORS, auth helpers
│   └── seed/
│       ├── dev.sql                   # Demo data (DemoDataSeeder.cs equivalent)
│       └── crime_stats.sql           # SAPS CSV loaded once
│
├── docs/                             # The plan docs you're reading now
├── .github/workflows/
│   ├── ci.yml                        # Lint + typecheck + test
│   ├── migrate-staging.yml           # supabase db push on merge to staging
│   └── deploy-web.yml                # vercel deploy
├── package.json                      # Workspace root
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

## Tooling versions

| Tool | Version | Why |
|---|---|---|
| Node | 22 LTS | Both Next 15 and Expo 52 need ≥ 20 |
| pnpm | 9 | Workspace protocol, smaller installs than npm |
| Turborepo | 2 | Remote cache support, the project will benefit |
| Next.js | 15 | App Router, server actions, React 19 |
| React | 19 | Required by Next 15 |
| Expo | SDK 52 | React Native 0.76, New Architecture |
| expo-router | 4 | File-based routing — mirrors Next.js |
| Supabase JS | 2.x | Latest |
| TypeScript | 5.6 | strict + verbatimModuleSyntax |
| Biome | 1.9 | Replaces ESLint + Prettier |
| Vitest | 2 | Web unit tests |
| Playwright | 1.48 | Web E2E |

## Shared package conventions

- `@criticom/db` is **the only** module that imports `@supabase/supabase-js`. Apps import from `@criticom/api`.
- `@criticom/api` functions take a `SupabaseClient` parameter so they're testable without env vars.
- Every external integration in `@criticom/api/external/*` has the same shape: `export async function fetchX(args, { fetchImpl = fetch } = {}): Promise<Result>` — that makes it trivial to mock in tests.

## CI pipeline (.github/workflows/ci.yml shape)

```yaml
jobs:
  lint-typecheck:
    - pnpm install --frozen-lockfile
    - pnpm turbo lint typecheck
  test:
    - pnpm turbo test
  build-web:
    - pnpm turbo build --filter=@criticom/web
  build-mobile:
    - eas build --platform all --profile preview  # Triggered manually for release builds
  migrate:
    if: github.ref == 'refs/heads/main'
    - supabase db push --linked  # to staging
```
