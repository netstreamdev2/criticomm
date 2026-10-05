# Security audit — production readiness

Audit of CriticomV5 as a critical-services system. Findings are ordered by
severity. Everything marked **Fixed** has been verified, not just changed.

The system has three enforcement layers. A finding is serious in proportion to
how many of them it defeats:

| Layer | Where | Defeated by |
| --- | --- | --- |
| Route matrix | `packages/db/src/roles.ts`, enforced in `apps/web/middleware.ts` | direct API/RPC calls |
| RLS policies | Postgres, per table | `SECURITY DEFINER` functions |
| Function guards | inside each `SECURITY DEFINER` RPC | nothing below it |

---

## 1. Unauthenticated write access to live incidents — **CRITICAL**

**Fixed and verified — `0019_privileged_function_guards.sql` +
`0020_revoke_public_execute.sql`, both applied.**

Every mutating RPC (`route_incident`, `dispatch_unit`, `close_case`,
`log_incoming_call`, `update_responder_status`, `assign_vehicle`) is
`SECURITY DEFINER`, so it executes as the owner and bypasses RLS entirely.
None of them checked the caller's role. `auth.uid()` appeared in each body for
**attribution** — stamping the audit log — never for **enforcement**.

`EXECUTE` was additionally granted to `anon`. The practical consequence: a
caller holding nothing but the public anon key, with no session at all, could
route, dispatch, or close any incident in any silo. The audit trail would
record each action as legitimate, with a null actor.

This defeated all three layers at once — the route matrix never sees an RPC,
and `SECURITY DEFINER` skips RLS.

**Fix:** a `require_role()` guard as the first statement of each function,
raising `42501` for the wrong role or no session; `EXECUTE` revoked from `anon`
on every operational function. Role sets mirror `packages/db/src/roles.ts`.

`citizen_update_location` deliberately remains `anon`-executable — the citizen
has no account. It is authenticated by a single-use, expiring bearer token.

**Correction applied in 0020.** 0019's `revoke execute … from anon` lines were
no-ops. Postgres grants `EXECUTE` to `PUBLIC` on every function at creation and
`anon` inherits it, so revoking the named role left the `PUBLIC` grant in place
and `anon` kept access. It shows in the ACL as the entry with an empty grantee
(`=X/postgres` is PUBLIC; `anon=X/postgres` is the named role). The correct form
is to revoke from `PUBLIC` and grant back to `authenticated` and `service_role`
explicitly — which 0020 does, extending it to the read-only `SECURITY DEFINER`
functions too, since those also bypass RLS (`get_dispatcher_kpis` leaked
operational KPIs anonymously, and `check_duplicate_incident` worked as a lookup
oracle for whether a phone number appears in the system).

**Verified — guard decisions, exercised per persona against the live database:**

| role | log call | route | dispatch | close | field status |
| --- | --- | --- | --- | --- | --- |
| SystemAdmin | allow | allow | allow | allow | allow |
| Supervisor | deny | allow | allow | allow | allow |
| Dispatcher | deny | allow | allow | allow | allow |
| IncidentLogger | **allow** | deny | deny | deny | deny |
| Firefighter / Paramedic | deny | deny | deny | deny | allow |
| Viewer | deny | deny | deny | deny | deny |
| *no session* | deny | deny | deny | deny | deny |

That is the two-desk split — loggers log, dispatchers dispatch — now enforced
at the data layer rather than only in the route matrix.

**Verified — `anon` EXECUTE:** revoked on all 11 operational functions;
retained only on `citizen_update_location`. RLS helper predicates
(`is_global`, `role_in`, `current_silo`, `can_write_global`, `require_role`,
`app_role`) are intentionally left executable — they are evaluated during
policy checks on behalf of whichever role is querying, including `anon` on the
public share-location page, so restricting them would break RLS itself.

## 2. Anonymous enumeration of citizen GPS bearer tokens — **CRITICAL**

**Fixed and verified — `0018_security_hardening.sql`, applied.**

`citizen_share_tokens` carried `for select using (true)`. Any anonymous holder
of the public anon key could list every live share token with its `incident_id`.

Chained with finding 1, that is false-location injection on any active
emergency: read a token, call `citizen_update_location`, and the incident's
coordinates move to wherever the attacker chooses. Responders are then sent to
the wrong address.

**Fix:** replaced with a staff-only read policy; added
`purge_expired_share_tokens()` and a coordinate check constraint.

**Verified:** rows that exist: 5 · rows an anonymous caller sees: **0** (was 5)
· rows a dispatcher sees: 5 (staff flow intact).

## 3. Read-only and intake roles could write operational data — **HIGH**

**Fixed and verified — `0019`, applied.**

`is_global()` conflates cross-silo *visibility* with authority to *write*. It
returns true for `Viewer` (read-only) and `IncidentLogger`.

Where it is ANDed behind a role check — `role_in(...) AND (silo =
current_silo() OR is_global())` — it is correct, and 11 policies using that
shape were left alone. Five policies used it as a bare `OR` branch, which
grants writes outright:

| Policy | Consequence |
| --- | --- |
| `incidents_dispatcher_update` | a `Viewer` could close a live emergency; an `IncidentLogger` could dispatch one, breaking the two-desk split |
| `citizen_share_admin` | a `Viewer` could mint or revoke citizen GPS tokens |
| `incident_updates_insert` | a `Viewer` could forge entries in the evidentiary incident log |
| `incident_attachments_insert` | a `Viewer` could attach evidence |
| `notifications_insert` | a `Viewer` could forge notifications to other users |

**Fix:** `can_write_global()` — same cross-silo scope, minus the roles with no
write authority. `is_global()` is unchanged and remains correct for `SELECT`.

## 4. Secret metadata exposed on a public endpoint — **MEDIUM**

**Fixed and verified.** `/api/health/config` returned the project URL and the
length, prefix and suffix of the service-role key to anonymous callers —
reconnaissance material, and enough key material to narrow a search.

**Fix:** anonymous callers get a liveness verdict only
(`{ok, status}` / 503). Full diagnostics require an admin session. No key
fragment is returned to anyone, at any role.

**Verified:** anonymous → `{"ok":true,"status":"configured"}`; dispatcher →
verdict only; admin → full detail, no fragments.

## 5. API routes redirected instead of returning a status — **LOW**

**Fixed and verified.** Unauthenticated `/api/*` calls were redirected to the
HTML login page, so callers got `200` full of markup and the classic
`Unexpected token '<'` parse error instead of an actionable status.

**Fix:** `middleware.ts` returns JSON `401`/`403` for `/api/*`.
**Verified:** `401 {"error":"Unauthorized"}`.

## 6. No browser security headers — **MEDIUM**

**Fixed and verified.** Added CSP, `X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy` (camera/mic/geolocation limited to
self — the console legitimately uses all three), HSTS with preload, and
`no-store` on `/api/*` so incident data never sits in a shared cache.
`X-Powered-By` removed.

CSP keeps `unsafe-inline`/`unsafe-eval` for scripts — Next's inline bootstrap
requires it. Tightening that needs per-request nonces, which is separate work.

## 7. No crash boundary on the root layout — **MEDIUM**

**Fixed.** A throw in the root layout unmounted everything and left a blank
page — in a dispatch room, indistinguishable from the system being down.
`app/global-error.tsx` now renders a recovery screen with the error digest for
log correlation, styled inline since it replaces the stylesheet too.

## 8. No tests on the authorization boundary — **MEDIUM**

**Fixed.** `packages/db/src/roles.test.ts` — 12 tests, the first in the repo,
wired to `pnpm test`. They pin the decisions that are expensive to get wrong:
the two-desk split, the dispatch-alert loop (every responder must be able to
open `/incidents/{id}`, or acknowledging an alert dead-ends at login), silo
isolation, admin closure, self-service openness, and longest-prefix precedence.

---

## Second audit — the admin ladder and tenant walls (0046)

Audited against the intended model: **SuperAdmin** owns the platform (all of
SystemAdmin's powers plus tenants, features, access rules, automations, and
sole control of the SuperAdmin role); **SystemAdmin** runs one tenant;
**Admin** runs one department of one tenant; nobody sees another tenant.
Every fix below is in `0046_access_hierarchy_and_tenant_walls.sql`, and was
verified by executing the migration against a mock of this schema: 53
checks, including proof that each hole was open before the migration ran.

### 9. Any user could make themselves SuperAdmin — **CRITICAL**

`profiles_self_update` had no column limits, and `role_in()` trusts
`profiles.role`. One `update profiles set role = 'SuperAdmin'` from the
browser gave any signed-in user every database permission in their tenant,
plus write access to the tenant register. Separately, `profiles_admin_write`
let Supervisors and department Admins grant any role, SuperAdmin included,
in any department.

**Fix:** `guard_profile_write()` (BEFORE trigger) decides *which changes* a
browser session may make; the policies decide *which rows*. Role, department
and account status change only down the ladder, and never on yourself.
Duty state, sign-in time, totals, e-mail and tenant are system-written only.
Trusted writers (SQL editor, service role, DEFINER functions) pass, which
`current_user` distinguishes. The web mirrors the same rule in
`rolesAssignableBy()` so the Admin picker offers only grantable roles.

### 10. Two sources of truth for a person's role — **HIGH**

The web and the app read the role from `app_metadata`; the database read it
from `profiles`; nothing linked them. An Admin's role change never took
effect, and a demotion never removed access. **Fix:** `profiles` is the
source, and `sync_profile_to_token()` copies role and department to the
token on every change. The migration first reconciled existing drift in the
token's favour, because only the platform can write the token.

### 11. Files had no tenant wall — **HIGH**

Storage paths begin with the department name, which is identical in every
tenant, so one tenant's officers could list and download another tenant's
evidence photos. **Fix:** a restrictive storage policy requires the incident
(or person) named in the path to be visible to the caller under their own
row security. Another tenant's record is simply not found.

### 12. Smaller gaps — **MEDIUM**

- `current_silo()` fell back to `user_metadata`, which users write themselves.
- An officer could move their own personnel row to another department, and
  so receive that department's dispatches.
- `log_incoming_call()` answered a repeated `client_ref` with a matching
  incident from any tenant.
- A SystemAdmin could read every tenant's row in the register.
- Automations are one platform-wide set, yet any tenant's Admin could retune,
  disable or fire them for all tenants. Now SuperAdmin only.
- Suspending a tenant had no effect. `current_tenant()` now resolves a
  suspended tenant to nothing, closing every wall. The founding tenant cannot
  be suspended.

**Known limitation:** automation run summaries are counted across all tenants
and visible to each tenant's admins (numbers only, no records). Fully
per-tenant automations would need tenant-scoped rules.

## Account safety rules (0048)

Agreed with the product owner for eThekwini, enforced in
`0048_account_safety_rules.sql`, and verified by executing the migration
against a mock of this schema (70 checks, including every refusal path).

| Rule | How it is enforced |
| --- | --- |
| At least **two active SystemAdmins** per organisation | `keep_two_system_admins` trigger refuses any demotion, deactivation, deletion or move that would leave fewer. It applies to every writer, the SQL editor included, and serialises concurrent removals with an advisory lock. |
| Every role, department or status change has a **reason** and a **typed confirmation** | Browser sessions can no longer write those columns, create accounts or delete them (`guard_profile_write`). The only doors are `change_account_role()` and `set_account_active()`, which require a 10+ character reason and the account's badge number (or full name) typed back. |
| **Two people** for powerful roles | Anything touching SystemAdmin, Admin or SystemController waits in `account_requests` for `decide_account_request()`. The requester cannot decide it, nor can the person it is about. With no other SystemAdmin the SuperAdmin decides. While a request is open the account is frozen. Requests expire after 7 days. |
| **Deactivate, never delete** | `set_account_active()` bans the sign-in, revokes sessions, takes the person off duty and off rosters, and keeps their records. `current_tenant()` and the role helpers ignore a deactivated profile, so it sees nothing from its next query. Anyone leading or assigned an open incident must hand it on first. |
| **Permanent history** | `account_history` is written by a trigger on every role, department and activation change, recording who made it, why, who approved it and the request. Changes made outside the app are recorded too, flagged as such. Update, delete and truncate are refused. |

Also closed: a signed-in login with **no profile** resolved to the founding
tenant through `current_tenant()`'s fallback, and could read that tenant's
department-wide records. One such account existed in the live project.
`current_tenant()` now requires an active profile in the tenant.

## Verified sound (no change needed)

- **RLS coverage** — 51 tables; every application table has RLS enabled with
  policies. No table has RLS off. No table is write-open by accident.
- **Server Actions** — all 22 action files run through the caller's own
  RLS-scoped client, so the database is the real boundary. The admin actions
  additionally call `requireAdmin()` in application code.
- **`citizen_update_location`** — validates the token, enforces single use
  (`used_at is null`) and expiry before writing.
- **Silo isolation** — field roles cannot cross departments; verified by test
  and by an 11-persona × 94-route flow audit.
- **Tenant walls on tables** (second audit) — every table carrying
  `tenant_id` has its restrictive policy. 0046 re-checks this in the live
  database and refuses to finish otherwise. The exceptions are deliberate:
  shared SAPS crime statistics, rate limits, and automation internals.
- **DEFINER functions** (second audit) — every function that bypasses row
  security and touches tenant data either locks the row with a tenant check
  before acting, keys on the caller's own `auth.uid()`, or runs as a platform
  job that stamps each row's own tenant. The one exception, `log_incoming_call`,
  is fixed in 12.
- **Push route** — recipients are chosen with the service role, but only after
  the caller has proved they can read the incident, and only within that
  incident's tenant.

## Still open — requires the operator

All eight findings above are fixed, applied and verified. Remaining items are
outside what a code change can close:

1. **Rotate credentials.** The Groq key, the Supabase service-role key and DB
   password, and the RealPTT credentials were all exposed in plaintext (the
   last hardcoded in the V4 source). Rotation is the only fix for exposure.
2. **Tighten CSP** with per-request nonces to drop `unsafe-inline`/`unsafe-eval`.
3. **Rate limiting** — there is none on `/api/*` or the login form. Worth an
   edge rule before public exposure.

## Note for future migrations

`revoke … from anon` on a function is almost always wrong on its own — the
privilege usually comes from the default `PUBLIC` grant. Revoke from `PUBLIC`
and grant back explicitly, then verify with
`has_function_privilege('anon', oid, 'EXECUTE')` rather than reading the
migration and assuming it took. Finding 1 was reported fixed once before it
actually was, on exactly this mistake.
