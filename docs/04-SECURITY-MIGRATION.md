# 04 — Security Rotation & Data Migration

## 1. URGENT — Credentials to rotate today

V4's `appsettings.json` (and several hard-coded values in controllers) contain live production secrets. **They sit in source code that has been read by every developer with access to the repo, plus me, just now.** Treat them as compromised.

### Rotation checklist

| Credential | Where it leaks | Rotation step |
|---|---|---|
| Azure SQL `criticom@criticom.database.windows.net` password `Netstream_v4` (all 5 DBs) | `appsettings.json` | Azure Portal → SQL Server → `criticom.database.windows.net` → Reset password. Update connection strings *only* in V4 server's Azure App Service config (never re-commit). |
| Azure Blob `criticommedia` AccountKey `BwQRjdY90d…` | `appsettings.json` | Azure Portal → Storage Account → Access Keys → Rotate Key 1. |
| SendGrid API key `SG.EkuQhEQqRH6Snlikgta4rw.5C1PHHgrmLY8c…` | `appsettings.json` | SendGrid → API Keys → revoke and create new. Update V4 + V5 secrets. |
| OpenWeatherMap key `36dd71731308ffd094c3c851074c1738` | `appsettings.json` | OWM dashboard → revoke + regenerate. |
| TomTom key `hyybTNp9WfRK7QIfhLaL8gtcjhzmnwuu` | `appsettings.json` | TomTom developer portal → delete key + regenerate. |
| Marinesia/Kpler bearer `S0d2c2VpRHFLVHZ3am…` | `appsettings.json` | Kpler portal → revoke + regenerate. |
| FlightRadar24 key `019c6ffe-2c69-73be-…` | `appsettings.json` | FR24 portal → revoke + regenerate. |
| Google Gemini API key `AIzaSyDvZ72WzA2_LKxjXkIwRfDWh-h2svtg7cc` | `appsettings.json` | GCP Console → APIs & Services → Credentials → restrict-then-delete (don't unrestrict the new key to all IPs). |
| **RealPTT enterprise password** `nets` / `Realptt1` | **Hard-coded** in `DispatchController.cs:147`, `:340`, `:490`, `ResponderController.cs:490, 555`, `HomeController.cs:397, 478, 587` | Contact RealPTT, rotate the company-account password. Then implement the V5 pattern: server-side env var only, accessed by `realptt-proxy` Edge Function. |
| **BulkSMS token** `CB1FF6E282DE…` / `7lsbhRjc1cRkuwm…` | **Hard-coded** in `NotificationsController.cs:635-636` | BulkSMS portal → revoke token + create new. Store in Supabase Vault. |
| Identity-seed test passwords (`DevPass123!`, `Test123!` × 10 system accounts) | `Program.cs:151-165` | These are seed passwords for development users. Disable or force-reset on production. |
| Hard-coded i-traffic placeholder `YOUR_KEY` | `CamerasController.cs:152` | Was always a placeholder — no rotation, but reach out to i-traffic for a real key. |

### Where to keep them after rotation

- **Supabase Vault** for any value an Edge Function needs (BulkSMS, RealPTT, Gemini, SendGrid, TomTom, OpenWeatherMap, FlightRadar, Marinesia)
- **Vercel environment variables** (production + preview, server-only) for keys needed in Next.js server actions
- **GitHub Actions secrets** for CI
- **Never** in `.env` files committed to git. `.env.example` only.

### Recommend: git-history scrubbing

Even after rotation, the historic commits leak the *old* keys. If the V4 repo is ever made public or shared, run `git filter-repo` to strip `appsettings.json` from history. For now (private repo, internal team) rotation is enough.

---

## 2. Identity migration: ASP.NET Identity → Supabase Auth

> **Superseded on 3 October 2026** by the staff onboarding design ([10-STAFF-ONBOARDING.md](10-STAFF-ONBOARDING.md)). V4 password hashes are **not** carried across, for three reasons:
>
> - They sat behind a database password that was exposed in source code (§1), so they must be treated as possibly compromised.
> - The plan below stored each hash in `app_metadata`, which travels inside every sign-in token.
> - A fresh activation lets each person set a password only they know, pass the staff-register check, and accept the POPIA notice.
>
> People now come across through the staff register import, and accounts through invitations. The claims table below still shows where V4's fields land in the register.

V4 stores PBKDF2-SHA256 password hashes in `AspNetUsers.PasswordHash` (the default Identity v3 format: `\x01\x00\x00\x10\x00\x00\x00...iter…salt…hash`).

### Strategy: lazy migration on first login (preferred)

1. Export every user from each of the 5 silo `AspNetUsers` tables (dedup by email since V4 keeps a copy in each silo).
2. Import to Supabase with `password_hash = null` and a custom `auth.users.raw_app_meta_data.legacy_pbkdf2_hash` = the original hex hash + `raw_app_meta_data.silo` = their primary silo.
3. Implement an Edge Function `auth-bridge` triggered by Supabase Auth's "Password verification failed" hook (or a custom sign-in flow that runs the legacy verify first, then if it matches calls `supabase.auth.admin.updateUser` to set the real password).
4. Users sign in with their old password → bridge upgrades the hash to Supabase's native bcrypt → next login uses native path.
5. After 90 days, any user with a non-null `legacy_pbkdf2_hash` and no recent login gets a password-reset email + their legacy hash is cleared.

### Fallback: forced password reset (simpler but UX-impacting)

If the bridge function is too risky, import users with random passwords and send everyone a reset email at cutover. Acceptable for internal users but bad for citizens (none in V4 right now, but planned).

### Claims → profile fields

| V4 claim | V5 column |
|---|---|
| `Silo` | `auth.users.raw_app_meta_data.silo` + `profiles.silo` |
| `AssignedStation` | `profiles.station` |
| `HardwareUUID` | `profiles.hardware_uuid` |
| `FullName` | `profiles.full_name` |
| `BadgeNumber` | `profiles.badge_number` |
| Role (via `AspNetUserRoles`) | `profiles.role` |

---

## 3. Data migration: 5 SQL Server DBs → 1 Supabase Postgres

### Approach

Use a Python script (`scripts/migrate.py` — created in Phase 4, not now) that:

1. Connects to each of the 5 SQL Server DBs via `pyodbc` using rotated credentials.
2. For each entity, reads in chunks (`OFFSET/FETCH NEXT 1000`), transforms, and `COPY`s into Supabase Postgres via `asyncpg`.
3. Transformations applied per-entity:
   - Drop `MasterId` GUID — collapse all silo copies of an incident into one row using `MasterId` as the join key (master always wins for canonical fields; silo-specific fields like `UnitId`, `RespondingOfficer`, `DispatchTime` come from the silo copy that has them).
   - Convert SAST wall-clock `datetime2` → UTC `timestamptz` (subtract 2h).
   - `IncidentId` deduplication: V4 sometimes has the same `IncidentId` string across silo copies; primary key in V5 is `id uuid` (generated), `incident_number` (formerly `IncidentId`) is unique per silo.
   - Drop `SyncMessage` table entirely.
   - Drop the `SourceDatabase` column.
   - Foreign-keys: V4 has loose FKs (often just int columns named `…Id`); explicitly model them in V5 and reject orphans (log to `migration_orphans` for manual review).

### Pre-flight checks

- `INFORMATION_SCHEMA.COLUMNS` diff across all 5 silos — if any silo added a column the others don't have, surface it
- Row counts per table per silo → expected vs actual after import

### Cutover

The user said this is a full rebuild, so timing is up to the rollout plan:

**Option A — clean cutover (recommended once V5 ships):**
1. Friday 23:00 SAST: V4 marked read-only via maintenance page
2. 23:15: Final delta migration runs (only rows changed since the bulk export earlier in the week)
3. 23:30: smoke test: log a call, dispatch, close — full lifecycle
4. 23:45: DNS swap (`criticom-staging-…azurewebsites.net` → Vercel)
5. 00:00: V5 live. V4 left running read-only for 90 days as escape hatch.

**Option B — dual-write bridge (skip unless cutover-window politics demand):**
- V5 Edge Function writes incidents to *both* V4 SQL Server (via REST shim in V4) and Supabase
- Reads from Supabase only
- Decommission V4 after stability period
- 2–3× the implementation cost, only worth it if there's an explicit no-downtime mandate

---

## 4. RLS test plan

Phase 1 ships pgTAP tests in `supabase/tests/rls/`:

```sql
-- Example: a MetroFire user must not see MetroPolice incidents
prepare set_user as select set_config('request.jwt.claims',
  '{"sub":"…","raw_app_meta_data":{"silo":"MetroFire"}}'::text, true);
execute set_user;
select results_eq(
  $$ select count(*)::int from public.incidents where silo = 'MetroPolice' $$,
  $$ values (0) $$,
  'Fire user sees zero police incidents');
```

Run on every PR via `supabase test db` in CI. Any change to RLS without a passing test blocks merge.

---

## 5. PII / compliance notes

V4 stores significant PII without specific protections: patient names, ID numbers, allergies, chronic conditions, medications, medical histories, witness names, suspect descriptions, civilian victim details. POPIA (South African data-protection act, equivalent to GDPR) applies.

V5 must add:
- Field-level encryption for `medical_histories.{allergies,chronic_conditions,medications}` and `paramedic_reports.identification_number` using `pgcrypto` + a key stored in Supabase Vault.
- An audit-log trigger on every read of sensitive tables (Postgres `pgaudit`).
- Data-retention policies: medical reports retained 7 years (legal), incident reports indefinite, raw GPS/duty pings purged after 90 days.
- Right-to-access / right-to-delete endpoints for citizens (the public incident reporter flow).

Out of scope for Phase 0 but flagged here so we don't paint ourselves into a corner.
