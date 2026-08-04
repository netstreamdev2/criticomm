# 08 — Operations runbook

For whoever is on call. Written to be read at 03:00 by someone who did not
build this.

**Fallback first:** every procedure below is slower than the radio. If the
platform is degraded and crews are waiting, put the control room on radio and
paper, then fix the platform. Nothing here is more urgent than that.

---

## 1. What runs where

| Component | Where | Notes |
|---|---|---|
| Web console | Vercel (`criticomm-new-web.vercel.app`) | Next.js 15, all pages server-rendered per request |
| Responder app | Expo / EAS, project `f0dde5d8-3714-4335-ab03-74e1c63d8337` | OTA updates on the `production` channel |
| Database, auth, storage, realtime | Supabase project `iujoptwerpvtveyneybl`, region `eu-west-1` | |
| Automations | `pg_cron` job `criticom-automations`, inside the database | Every 5 minutes |

The direct database host is IPv6-only from some networks. Use the session
pooler for CLI work — `SUPABASE_DB_URL` in `.env` already points at it.

---

## 2. First response: "the system is down"

Work in this order. Each step tells you what to rule out.

1. **Is it the web app or the database?**
   Open `/api/health/config`. It reports what environment variables the running
   deployment can actually see, without exposing their values.
   - Page does not load at all → Vercel. Check the deployment log.
   - Page loads, reports missing variables → the env was not set at *build*
     time. `NEXT_PUBLIC_*` are inlined at build, so setting them requires a
     **redeploy**, not a restart.

2. **Is the database reachable?**
   ```bash
   psql "$SUPABASE_DB_URL" -c 'select now()'
   ```
   If this fails, everything else is downstream of it. Supabase status page.

3. **Is authentication working?**
   Sign in as a seeded account (`sysadmin@criticom.gov.za`). If sign-in fails
   but the database answers, it is Supabase Auth, not your data.

4. **Are alerts flowing?**
   ```sql
   select count(*) from alerts where created_at > now() - interval '15 minutes';
   ```
   Zero on a busy shift means realtime or the automation engine — see §5.

---

## 3. Deploying

### Web

Push to `main`. CI must be green: lint, typecheck, test, build, and the
migration-from-empty job. Vercel builds from the same commit.

Env changes need a redeploy, not a restart — `NEXT_PUBLIC_*` values are compiled
into the bundle.

### Database

```bash
set -a && . ./.env && set +a
node scripts/apply-migration.mjs supabase/migrations/00NN_your_migration.sql
```

Each file runs inside a transaction: a failing statement rolls the whole file
back, so a half-applied migration is not a state you can reach. Apply
migrations **before** the deploy that depends on them — the app tolerates a
schema newer than the code far better than the reverse.

### Responder app

```bash
cd apps/mobile
eas build --profile production --platform android
eas build --profile production --platform ios
```

A JS-only change can ship over the air instead, which takes minutes rather than
a store review:

```bash
eas update --branch production --message "what changed"
```

Native changes — a new native module, a permission, anything in `app.json` or
`app.config.ts` — need a real build. OTA cannot deliver them.

**Android builds require `google-services.json`.** `app.config.ts` refuses to
build without it rather than producing an app that cannot receive a dispatch.
Supply it as an EAS secret:

```bash
eas secret:create --scope project --name GOOGLE_SERVICES_JSON \
  --type file --value ./google-services.json
```

To deliberately build without push (internal preview only), set
`CRITICOM_ALLOW_NO_PUSH=1`. Alerts then arrive only while the app is open. Do
not hand that build to a crew on shift.

---

## 4. Backups and recovery

Supabase takes automatic daily backups; point-in-time recovery depends on the
plan. **Verify which you have before you need it.**

Take a manual snapshot before anything irreversible:

```bash
pg_dump "$SUPABASE_DB_URL" --no-owner --no-acl -Fc -f criticom-$(date +%F).dump
```

Restore into a *new* project first and check it, then cut over. Restoring over a
live database while crews are working turns one incident into two.

What a database restore does **not** bring back:
- **Storage** (`incident-media`, `avatars`, `department-logos`) — separate.
  Evidence photos live here, so a restore that ignores storage silently loses
  the attachments a case file references.
- **Auth users** — restored with the database, but any account created since the
  snapshot is gone. Re-create with `pnpm db:create-admin`.
- **Push tokens** — harmless. Phones re-register on next launch.

---

## 5. The automation engine

Seven rules on a five-minute tick (`docs` §Automations, migration `0025`).

**Console:** Admin → Automations. Engine health is the first thing on the page;
a stalled scheduler is called out explicitly rather than left to be inferred
from rules that look fine.

**Is it ticking?**
```sql
select jobname, schedule, active from cron.job;
select status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 5;
select key, enabled, last_run_at, last_status, last_detail
  from automation_rules order by key;
```

**It is not ticking.** The engine is complete without `pg_cron` — anything with
a clock can drive it:
```sql
select public.run_automations();
```
Point an external scheduler at that every five minutes and the service is fully
functional while you fix cron.

**A rule is erroring.** Each rule runs in its own exception block, so one
failure does not stop the others; `automation_runs.detail` holds the message.
Disable it from the console while you fix it — a disabled rule is a known gap, a
silently failing one is not.

**Alert storm.** If a rule is over-alerting, disable it first, then look at
`automation_events` — that table is what stops repeat alerts, and a rule
alerting repeatedly means its claim key is wrong. Widening a threshold in the
console is the fast mitigation.

---

## 6. Credentials

Every key is server-side. Nothing that costs money is in a client bundle.

**Rotating the Supabase service-role key or database password:**
1. Rotate in the Supabase dashboard.
2. Update Vercel env → **redeploy**.
3. Update local `.env` and `apps/web/.env.local`.
4. The anon key is public by design and does not need rotation for this.

**Known outstanding (from `docs/04-SECURITY-MIGRATION.md` and `06-SECURITY-AUDIT.md`):**
- V4's BulkSMS token pair and Gemini key are in that repository's source history
  and must be revoked at the provider. Rotating them in V5's env is not enough —
  the old values are still in V4's git history.
- The service-role key and database password were pasted into a chat transcript
  during setup and should be rotated.

---

## 7. Rate limits

Per-user, counted in Postgres so the limit holds across serverless instances
(migration `0028`). Buckets and their limits are listed in
`apps/web/lib/rate-limit.ts` — read that file, not this table, as the source of
truth.

The limiter **fails open**: if the table is unreachable the request proceeds. A
rate limiter that takes down dispatch when the database hiccups has caused more
harm than the runaway loop it was guarding against.

If an operator reports a 429 during normal work, the limit is wrong, not the
operator. Raise it in `RATE_LIMITS` and deploy.

To clear one user's counter:
```sql
delete from rate_limit_buckets where key like 'chat:%<user-uuid>';
```

---

## 8. Common situations

**A crew's phone is not receiving dispatches.**
Check Profile → Dispatch alerts on the handset. It states which of these it is:
permission denied (fixable on the device), no push in this build (needs an FCM
build), emulator, or registration failed. Realtime still delivers while the app
is open in every one of those cases.

**A responder says their update "did not go through".**
The sync tray at the bottom of the app lists everything undelivered, with the
error. Work queued offline is not lost — it is held against *their* account and
sends when they next have signal while signed in. If they signed out on a shared
handset, it waits for them, not for the next person carrying it.

**An officer-emergency alert fired by accident.**
Close the incident as you would any other. The panic is deliberately easy to
trigger and impossible to un-send: acknowledged and closed with a note beats a
button people hesitate over.

**Incident numbers look wrong.**
Format is `INC-YYYYMMDD-NNNN`, sequential per department per day, from
`incident_number_counters`. Numbers before migration `0024` used a random
3-digit suffix and are not sequential — that is history, not a fault.

**Storage is filling up.**
Scene photos and voice notes in `incident-media` dominate. Nothing deletes them
automatically, and that is deliberate: they are evidence. Removing any of it is
a records-retention decision, not an operational one.

---

## 9. Useful queries

```sql
-- Live officer emergencies
select incident_number, silo, responding_officer, location_address, incident_created_at
  from incidents
 where source = 'Responder-Panic' and status not in ('Closed','Resolved');

-- Calls waiting for a department right now
select incident_number, silo, incident_severity,
       round(extract(epoch from (now() - call_timestamp)) / 60) as minutes_waiting
  from incidents
 where status in ('New','Pending','Pending Dispatch','Pending Analysis')
 order by call_timestamp;

-- Who is on duty
select full_name, rank, silo, call_sign from profiles where is_on_duty;

-- Automation health at a glance
select key, enabled, last_status, last_run_at, last_detail
  from automation_rules order by key;

-- Recent sign-ins (audit trail)
select user_name, silo, timestamp from audit_logs
 where action_type = 'Logon' order by timestamp desc limit 20;
```
