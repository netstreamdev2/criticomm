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
