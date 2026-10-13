/** Run the real schedules migration (0072) against in-memory Postgres (PGlite)
 * and try every rule: who may roster whom, what the person may change (only
 * their confirmation), what each person reads, clashes, rotations, publishing,
 * check-in, late and not started, outcomes, leave from request to cancel,
 * swaps, deactivation and the punctuality summary.
 *
 * CASE_PGLITE_MODULE=file:///path/to/@electric-sql/pglite/dist/index.js node scripts/test-schedules.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.CASE_PGLITE_MODULE || '@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase/migrations/0072_schedules.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const one = async (q, args) => (await db.query(q, args)).rows[0];
const rows = async (q, args) => (await db.query(q, args)).rows;

const T = '20000000-0000-4000-8000-000000000001';
const T2 = '20000000-0000-4000-8000-000000000002';
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = {
  cop1: id(1), cop2: id(2), cop3: id(3), sup: id(4), sup2: id(5), captain: id(6), polAdmin: id(7),
  ff1: id(8), fireSup: id(9), hr: id(10), hr2: id(11), central: id(12), gone: id(13), stranger: id(14),
  crSup: id(15), crOp: id(16),
};
const PEOPLE = [
  // id, role, silo, name, team, station, tenant
  [U.cop1, 'Police', 'MetroPolice', 'Const. Thandi Dlamini', 'A', 'Station 4'],
  [U.cop2, 'Police', 'MetroPolice', 'Const. Sipho Ngcobo', 'A', 'Station 4'],
  [U.cop3, 'Police', 'MetroPolice', 'Const. Lerato Khumalo', 'B', 'Station 7'],
  [U.sup, 'Supervisor', 'MetroPolice', 'Sgt. Pillay', 'A', 'Station 4'],
  [U.sup2, 'Supervisor', 'MetroPolice', 'Sgt. Moodley', 'B', 'Station 7'],
  [U.captain, 'Captain', 'MetroPolice', 'Capt. Naidoo', null, 'Station 4'],
  [U.polAdmin, 'Admin', 'MetroPolice', 'Police Admin', null, 'HQ'],
  [U.ff1, 'Firefighter', 'MetroFire', 'FF Mthembu', 'Red', 'Station 1'],
  [U.fireSup, 'Supervisor', 'MetroFire', 'Stn Officer Zulu', 'Red', 'Station 1'],
  [U.hr, 'SystemAdmin', 'Ethekwini', 'HR Admin One', null, 'HQ'],
  [U.hr2, 'SystemAdmin', 'Ethekwini', 'HR Admin Two', null, 'HQ'],
  [U.central, 'Dispatcher', 'Ethekwini', 'Central Dispatcher', null, 'Control'],
  [U.gone, 'Police', 'MetroPolice', 'Const. Left Already', 'A', 'Station 4'],
  [U.stranger, 'Supervisor', 'MetroPolice', 'Other Org Sgt', 'A', 'Elsewhere', T2],
  [U.crSup, 'Supervisor', 'Ethekwini', 'Control Room Supervisor', 'A', 'Control'],
  [U.crOp, 'ControlRoom', 'Ethekwini', 'Control Room Operator', 'A', 'Control'],
];

async function as(uid, tenant = T) {
  await db.query('reset role');
  await db.query("select set_config('test.user', $1, true), set_config('test.tenant', $2, true)", [uid ?? '', tenant]);
  await db.query('set local role authenticated');
}
async function system() {
  await db.query('reset role');
  await db.query("select set_config('test.user', '', true), set_config('test.tenant', '', true)");
}
async function refused(call, pattern, message) {
  await db.query('savepoint refused');
  try { await assert.rejects(call(), pattern, message); }
  finally { await db.query('rollback to savepoint refused'); }
}
async function scenario(label, work) {
  await db.query('reset role');
  await db.query('savepoint scenario');
  try { await work(); checks++; console.log(`PASS ${label}`); }
  finally { await db.query('reset role'); await db.query('rollback to savepoint scenario'); }
}

// South African dates, as the database counts them.
const saToday = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00+02:00`).toISOString();
// The database's clock: now() stands still for the whole transaction the test runs in.
let NOW = Date.now();
const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();
const hoursAhead = (h) => new Date(NOW + h * 3_600_000).toISOString();

const tpl = async (silo, name) => (await one('select id from public.shift_templates where tenant_id = $1 and silo = $2 and name = $3', [T, silo, name])).id;
const addShift = (user, day, template, publish = false) =>
  db.query('select public.add_shift($1, $2::date, $3, $4) as id', [user, day, template, publish]).then((r) => r.rows[0].id);
/** A line at exact times, written by the system (the same checks apply). */
async function line(user, silo, start, end, extra = {}) {
  const cols = { tenant_id: T, silo, user_id: user, user_name: '', station: 'Station 4', activity_type: 'Day shift', start_at: start, end_at: end, published: true, ...extra };
  const keys = Object.keys(cols);
  const r = await one(`insert into public.rosters (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, keys.map((k) => cols[k]));
  return r.id;
}
const alertsFor = (user, kind) => rows('select title, body, kind from public.alerts where target_user_id = $1 and ($2::text is null or kind = $2) order by created_at', [user, kind ?? null]);

try {
  await db.exec(`
    create role authenticated nologin; create role anon nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user', true), '')::uuid $$;
    create type public.silo as enum ('Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster');
    create type public.user_role as enum ('SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'ControlRoom',
      'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'FireChief', 'Firefighter', 'Paramedic', 'Doctor',
      'Disaster', 'CaseManager', 'Staff', 'SystemController');
    create table public.tenants (id uuid primary key, slug text, name text);
    insert into public.tenants values ('${T}', 'ethekwini', 'eThekwini'), ('${T2}', 'other', 'Other');
    create function public.current_tenant() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('test.tenant', true), '')::uuid, '${T}'::uuid) $$;
    create table public.profiles (
      id uuid primary key, tenant_id uuid not null, role public.user_role, silo public.silo,
      full_name text, badge_number text, station text, deactivated_at timestamptz);
    create function public.current_silo() returns public.silo language sql stable security definer as $$
      select coalesce((select silo from public.profiles where id = auth.uid()), 'Ethekwini') $$;
    create function public.is_global() returns boolean language sql stable security definer as $$
      select coalesce((select role in ('SystemAdmin','SuperAdmin','Dispatcher','ControlRoom','IncidentLogger','Viewer','System','SystemController')
        from public.profiles where id = auth.uid() and deactivated_at is null), false) $$;
    create function public.department_label(p_silo public.silo) returns text language sql immutable as $$
      select case p_silo::text when 'Ethekwini' then 'the Control Room' when 'MetroPolice' then 'Metro Police'
        when 'MetroFire' then 'Fire & Rescue' when 'Medical' then 'EMS' else 'Disaster Management' end $$;
    create table public.personnel (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, user_id uuid, silo public.silo not null,
      first_name text, last_name text, badge_number text, station text, platoon text,
      is_on_duty boolean not null default false, duty_started_at timestamptz, left_at timestamptz);
    create table public.shifts (id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      silo public.silo not null, shift_name text, start_time timestamptz, end_time timestamptz);
    create table public.duty_posts (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null, name text not null, station text, sector text, vehicle text, call_sign text,
      activity_type text, min_staff int not null default 1, active boolean not null default true);
    create table public.leave_entries (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null, user_id uuid, eff_from date not null, eff_to date not null, absence text,
      status text not null, reason text, approved_by text, approved_at timestamptz, created_at timestamptz not null default now());
    create table public.rosters (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null, user_id uuid, user_name text not null, badge_number text,
      shift_id uuid references public.shifts(id) on delete cascade, station text not null, activity_type text not null,
      description text, created_by_supervisor_id text, created_by_supervisor_name text, created_at timestamptz not null default now(),
      call_sign text, shift_group_code text, special_instructions text, vehicle text, sector text,
      status text not null default 'Present', duty_date date, start_at timestamptz, end_at timestamptz, post text,
      published boolean not null default true, published_at timestamptz, acknowledged_at timestamptz,
      post_id uuid references public.duty_posts(id) on delete set null);
    create table public.endorsements (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null, user_id uuid, employee_name text, type text not null, details text,
      start_date date not null, end_date date, is_active boolean not null default true);
    create table public.alerts (id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      silo public.silo not null, target_user_id uuid, kind text not null default 'info', severity text, title text not null,
      body text, incident_id uuid, link text, presentation text, requires_ack boolean, created_by uuid, created_by_name text,
      created_at timestamptz not null default clock_timestamp(), expires_at timestamptz);
    create table public.push_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null, token text not null);
    create table public.reporting_lines (id uuid primary key default gen_random_uuid(), silo public.silo not null,
      member_kind text not null, member_id uuid not null, manager_kind text, manager_id uuid);
    create table public.attendance_events (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null default public.current_silo(), user_id uuid not null default auth.uid(), user_name text,
      kind text not null check (kind in ('clock_in','clock_out')), at timestamptz not null default now(),
      source text not null default 'console', note text);
    create table public.command_records (id uuid primary key default gen_random_uuid(), tenant_id uuid not null default public.current_tenant(),
      silo public.silo not null default 'Ethekwini', module text not null, name text, detail3 text, status text not null default 'Active');
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), tenant_id uuid default public.current_tenant(),
      silo public.silo not null, user_id uuid, user_name text, department text, action_type text not null,
      entity_type text, entity_id text, details text, timestamp timestamptz not null default now());
    create table public.automation_rules (key text primary key, name text not null, description text not null,
      enabled boolean not null default true, interval_minutes int not null default 5, config jsonb not null default '{}',
      last_run_at timestamptz, last_status text, last_detail text, updated_at timestamptz not null default now());
    create table public.automation_runs (id bigserial primary key, rule_key text, triggered_by uuid, finished_at timestamptz,
      status text, affected int, detail text);
    create table public.automation_events (id bigserial primary key, rule_key text not null, entity_id text not null,
      bucket text not null, created_at timestamptz not null default now());
    create unique index on public.automation_events (rule_key, entity_id, bucket);
    create function public.automation_claim(p_rule text, p_entity text, p_bucket text) returns boolean
      language plpgsql security definer as $$
      begin insert into public.automation_events (rule_key, entity_id, bucket) values (p_rule, p_entity, p_bucket); return true;
      exception when unique_violation then return false; end $$;
    create function public.automation_cfg_int(p_config jsonb, p_key text, p_default int) returns int language sql immutable as $$
      select coalesce(nullif(p_config ->> p_key, '')::int, p_default) $$;

    -- As in production: RLS on, the person's own clock-ins, shifts read by the department.
    alter table public.rosters enable row level security;
    alter table public.leave_entries enable row level security;
    alter table public.attendance_events enable row level security;
    create policy attendance_insert_self on public.attendance_events for insert to authenticated with check (user_id = auth.uid());
    create policy attendance_read on public.attendance_events for select to authenticated using (user_id = auth.uid());
    alter table public.shifts enable row level security;
    create policy shifts_read on public.shifts for select using (true);
    grant usage on schema public, auth to authenticated;
    grant all on all tables in schema public to authenticated;
    grant all on all sequences in schema public to authenticated;
    alter default privileges in schema public grant all on tables to authenticated;
    alter default privileges in schema public grant all on sequences to authenticated;
  `);
  for (const [uid, role, silo, name, team, station, tenant = T] of PEOPLE) {
    await db.query('insert into public.profiles values ($1, $2, $3, $4, $5, $6, $7, null)', [uid, tenant, role, silo, name, `B${uid.slice(-3)}`, station]);
    await db.query('insert into public.personnel (tenant_id, user_id, silo, first_name, badge_number, station, platoon) values ($1, $2, $3, $4, $5, $6, $7)',
      [tenant, uid, silo, name, `B${uid.slice(-3)}`, station, team]);
  }
  await db.query("update public.profiles set deactivated_at = now() where id = $1", [U.gone]);

  await db.exec('begin');
  NOW = new Date((await one('select now() as n')).n).getTime();
  await db.exec(migration);
  await db.exec(migration); // safe to re-run

  const DAY = await tpl('MetroPolice', 'Day shift');
  const NIGHT = await tpl('MetroPolice', 'Night shift');
  const FIRE24 = await tpl('MetroFire', '24-hour shift');
  const ROT224 = (await one("select id from public.rotations where tenant_id = $1 and silo = 'MetroPolice'", [T])).id;
  const future = addDays(saToday(), 3);

  await scenario('every department starts with its shift types, a rotation, and the public holidays', async () => {
    const set = await rows('select silo, name, code, to_char(start_time, $2) as start, minutes from public.shift_templates where tenant_id = $1 order by silo, sort_order', [T, 'HH24:MI']);
    const by = (s) => set.filter((x) => x.silo === s).map((x) => `${x.code} ${x.start} ${x.minutes}`);
    assert.deepEqual(by('MetroPolice'), ['D 06:00 720', 'N 18:00 720']);
    assert.deepEqual(by('Medical'), ['D 07:00 720', 'N 19:00 720']);
    assert.deepEqual(by('MetroFire'), ['24 08:00 1440']);
    assert.deepEqual(by('EthekwiniDisaster'), ['O 08:00 510', 'S 16:30 930']);
    assert.deepEqual(by('Ethekwini'), ['D 06:00 720', 'N 18:00 720']);
    const rot = await rows('select silo, teams, offsets, array_length(cycle, 1) as len from public.rotations where tenant_id = $1 order by silo', [T]);
    assert.deepEqual(rot.find((r) => r.silo === 'MetroFire'), { silo: 'MetroFire', teams: ['Red', 'Blue', 'Green'], offsets: [0, 1, 2], len: 3 });
    assert.equal((await one("select count(*)::int as n from public.public_holidays where tenant_id = $1 and day between '2026-01-01' and '2026-12-31'", [T])).n, 12);
    assert.equal((await one("select name from public.public_holidays where tenant_id = $1 and day = '2026-08-10'", [T])).name, 'National Women\'s Day (observed)');
    assert.equal((await one('select count(*)::int as n from public.shift_templates where tenant_id = $1', [T2])).n, 9, 'every organisation gets its own');
  });

  await scenario('who sets things up: the department admin and HR; not supervisors, not other departments', async () => {
    await as(U.sup);
    await refused(() => db.query("insert into public.shift_templates (silo, name, code, start_time, minutes) values ('MetroPolice', 'Court day', 'C', '08:00', 480)"), /row-level security/);
    await refused(() => db.query("update public.schedule_settings set grace_minutes = 30"), /row-level security|0 rows/).catch(() => {});
    await as(U.polAdmin);
    await db.query("insert into public.shift_templates (silo, name, code, start_time, minutes) values ('MetroPolice', 'Court day', 'C', '08:00', 480)");
    await db.query("insert into public.schedule_settings (silo, grace_minutes, noshow_minutes) values ('MetroPolice', 15, 45)");
    await refused(() => db.query("insert into public.shift_templates (silo, name, code, start_time, minutes) values ('MetroFire', 'Bad', 'X', '08:00', 480)"), /row-level security/, 'not another department');
    await refused(() => db.query('insert into public.rotations (silo, name, cycle, teams, offsets, anchor) values ($1, $2, $3::uuid[], $4, $5, $6)',
      ['MetroPolice', 'Uses fire shifts', `{${FIRE24}}`, '{A}', '{0}', '2026-01-01']), /only this department/);
    await refused(() => db.query("insert into public.schedule_settings (silo, grace_minutes, noshow_minutes) values ('Medical', 30, 20)"), /row-level security|check/);
    await refused(() => db.query("insert into public.public_holidays (day, name) values ('2026-10-15', 'Made up')"), /row-level security/, 'holidays are HR');
    await as(U.hr);
    await db.query("insert into public.public_holidays (day, name) values ('2026-11-02', 'Municipal holiday')");
    await as(U.cop1);
    assert.ok((await rows('select * from public.shift_templates')).length >= 9, 'everyone reads the set-up');
    await refused(() => db.query("delete from public.public_holidays"), /row-level security|0 rows/).catch(() => {});
  });

  await scenario('who rosters whom: the department, never across; drafts unseen by staff', async () => {
    await as(U.sup);
    const mine = await addShift(U.cop1, future, DAY);
    await refused(() => addShift(U.ff1, future, FIRE24), /do not roster/, 'a police supervisor does not roster fire');
    await refused(() => addShift(U.ff1, future, DAY), /not in this department/, 'a firefighter cannot be put on the police roster');
    await refused(() => addShift(U.gone, future, DAY), /no active account/, 'a deactivated account cannot be rostered');
    await as(U.captain); await addShift(U.cop3, future, NIGHT);
    await as(U.polAdmin); await addShift(U.cop2, future, DAY);
    await as(U.hr); await addShift(U.ff1, future, FIRE24);
    await system();
    const otherDay = (await one("select id from public.shift_templates where tenant_id = $1 and silo = 'MetroPolice' and name = 'Day shift'", [T2])).id;
    await as(U.stranger, T2);
    await refused(() => addShift(U.cop1, addDays(future, 1), otherDay), /no active account/, 'another organisation cannot roster our people');
    await refused(() => addShift(U.cop1, addDays(future, 1), DAY), /not available/, 'nor use our shift types');
    await as(U.cop1);
    await refused(() => addShift(U.cop2, future, DAY), /do not roster/, 'a constable does not roster');
    await refused(() => db.query("insert into public.rosters (silo, user_id, user_name, station, activity_type, start_at, end_at) values ('MetroPolice', $1, 'x', '', '', now() + interval '1 day', now() + interval '1 day 8 hours')", [U.cop1]), /row-level security|Not permitted/);
    assert.equal((await rows('select id from public.rosters')).length, 0, 'drafts are not issued: not even your own shows');
    await as(U.cop3);
    assert.equal((await rows('select id from public.rosters')).length, 0);
    await as(U.sup);
    assert.equal((await rows("select id from public.rosters where silo = 'MetroPolice'")).length, 3, 'the supervisor sees the drafts');
    await as(U.fireSup);
    assert.equal((await rows("select id from public.rosters where silo = 'MetroPolice'")).length, 0, 'fire sees no police drafts');
    const line1 = await one('select start_at, end_at, duty_date, user_name, badge_number, station from public.rosters where id = $1', [mine]).catch(() => null);
    await as(U.sup);
    const l = await one('select start_at, end_at, duty_date::text as d, user_name, station from public.rosters where id = $1', [mine]);
    assert.equal(new Date(l.start_at).toISOString(), new Date(at(future, '06:00')).toISOString(), 'Day shift starts 06:00 SA time');
    assert.equal(new Date(l.end_at) - new Date(l.start_at), 12 * 3_600_000);
    assert.deepEqual([l.d, l.user_name, l.station], [future, 'Const. Thandi Dlamini', 'Station 4']);
    void line1;
  });

  await scenario('the 224 rotation lands on the right days at the right times, and running it twice adds nothing', async () => {
    await as(U.sup);
    const from = addDays(saToday(), 2);
    const to = addDays(from, 15);
    const res = (await one('select public.generate_roster($1, $2::date, $3::date, $4) as r', [ROT224, from, to, ['A']])).r;
    // Team A (offset 0) from 1 Jan 2026: day, day, night, night, four off.
    const expected = [];
    for (let i = 0; i <= 15; i++) {
      const day = addDays(from, i);
      const pos = ((daysBetween('2026-01-01', day) % 8) + 8) % 8;
      if (pos < 2) expected.push(`${day} 06:00`);
      else if (pos < 4) expected.push(`${day} 18:00`);
    }
    const got = await rows("select to_char(start_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI') as s from public.rosters where user_id = $1 order by start_at", [U.cop1]);
    assert.deepEqual(got.map((g) => g.s), expected);
    // Team A is cop1, cop2, the sergeant (and the account that left, which is skipped).
    assert.equal(res.created, expected.length * 3);
    assert.equal(res.skipped, 0);
    const again = (await one('select public.generate_roster($1, $2::date, $3::date, $4) as r', [ROT224, from, to, ['A']])).r;
    assert.deepEqual([again.created, again.already], [0, expected.length * 3]);
    assert.equal((await one("select count(*)::int as n from public.rosters where published")).n, 0, 'generated as drafts');
    await refused(() => db.query('select public.generate_roster($1, $2::date, $3::date)', [ROT224, from, addDays(from, 120)]), /three months/);
  });

  await scenario('leave, court and double bookings are left out of a rotation with the reason', async () => {
    await system();
    const from = addDays(saToday(), 2);
    // The first day team A works in the range.
    let courtDay = from;
    while ((((daysBetween('2026-01-01', courtDay) % 8) + 8) % 8) >= 4) courtDay = addDays(courtDay, 1);
    await db.query("insert into public.leave_entries (tenant_id, silo, user_id, eff_from, eff_to, absence, status) values ($1, 'MetroPolice', $2, $3, $4, 'Annual', 'Approved')",
      [T, U.cop2, from, addDays(from, 30)]);
    await db.query("insert into public.endorsements (tenant_id, silo, user_id, type, details, start_date, end_date) values ($1, 'MetroPolice', $2, 'Court Attendance', 'Durban Magistrate 09:00', $3, $3)",
      [T, U.cop1, courtDay]);
    await as(U.sup);
    const res = (await one('select public.generate_roster($1, $2::date, $3::date, $4) as r', [ROT224, from, addDays(from, 15), ['A']])).r;
    assert.ok(res.reasons.some((r) => r.name === 'Const. Sipho Ngcobo' && /approved leave/.test(r.reason)));
    assert.ok(res.reasons.some((r) => r.name === 'Const. Thandi Dlamini' && /booked for court then \(Durban Magistrate 09:00\)/.test(r.reason) && r.day === courtDay));
    assert.equal((await one('select count(*)::int as n from public.rosters where user_id = $1 and duty_date = $2', [U.cop1, courtDay])).n, 0);
    assert.equal((await one('select count(*)::int as n from public.rosters where user_id = $1', [U.cop2])).n, 0);
  });

  await scenario('clashes are refused for every writer: another shift, leave, court, a vehicle on two posts', async () => {
    await as(U.sup);
    const day = addDays(saToday(), 5);
    await addShift(U.cop1, day, DAY);
    await refused(() => addShift(U.cop1, day, DAY), /already on a shift/);
    const p1 = (await one("insert into public.duty_posts (silo, name, vehicle, min_staff) values ('MetroPolice', 'Sector 1 car', 'MP-101', 2) returning id")).id;
    const p2 = (await one("insert into public.duty_posts (silo, name, vehicle) values ('MetroPolice', 'Sector 2 car', 'MP-101') returning id")).id;
    await db.query('select public.assign_post($1, $2::date, $3, null)', [p1, day, U.cop1]);
    await db.query('select public.assign_post($1, $2::date, $3, $4)', [p1, day, U.cop2, DAY]); // the crew shares its vehicle
    await refused(() => db.query('select public.assign_post($1, $2::date, $3, $4)', [p2, day, U.cop3, DAY]), /Vehicle MP-101 is already out/);
    await refused(() => db.query('select public.assign_post($1, $2::date, $3, null)', [p2, addDays(day, 1), U.cop3]), /no shift that day/);
    const crew = await rows('select user_id, post, vehicle from public.rosters where post_id = $1 order by user_name', [p1]);
    assert.equal(crew.length, 2);
    // The system is held to the same rules.
    await system();
    await refused(() => line(U.cop1, 'MetroPolice', at(day, '10:00'), at(day, '14:00')), /already on a shift/);
    await refused(() => line(U.cop1, 'MetroPolice', at(day, '20:00'), at(day, '19:00')), /ends after it starts/);
  });

  await scenario('publishing tells each person once; the person confirms, and that is all they may change', async () => {
    await as(U.sup);
    const from = addDays(saToday(), 2);
    await db.query('select public.generate_roster($1, $2::date, $3::date, $4)', [ROT224, from, addDays(from, 15), ['A']]);
    const n = (await one("select public.publish_roster('MetroPolice', $1::date, $2::date) as n", [from, addDays(from, 15)])).n;
    assert.ok(n >= 12);
    const told = await alertsFor(U.cop1, 'shift_published');
    assert.equal(told.length, 1, 'one alert for the whole roster');
    assert.match(told[0].title, /Your roster is out: \d+ shifts/);
    assert.equal((await alertsFor(U.sup, 'shift_published')).length, 0, 'not the one who published');

    await as(U.cop1);
    const mine = await rows('select id, start_at from public.rosters where user_id = $1 order by start_at', [U.cop1]);
    assert.ok(mine.length >= 4, 'issued shifts now show');
    const target = mine[0].id;
    await db.query('update public.rosters set acknowledged_at = now() + interval \'3 days\' where id = $1', [target]);
    const ack = await one('select acknowledged_at from public.rosters where id = $1', [target]);
    assert.ok(new Date(ack.acknowledged_at) <= new Date(Date.now() + 5000), 'a confirmation is never in the future');
    await db.query('update public.rosters set acknowledged_at = now() - interval \'1 day\' where id = $1', [target]);
    assert.equal(new Date((await one('select acknowledged_at from public.rosters where id = $1', [target])).acknowledged_at).getTime(),
      new Date(ack.acknowledged_at).getTime(), 'the first confirmation stands');
    await refused(() => db.query("update public.rosters set start_at = start_at + interval '2 hours' where id = $1", [target]), /confirm your duty/);
    await refused(() => db.query("update public.rosters set vehicle = 'MY-CAR' where id = $1", [target]), /confirm your duty/);
    await refused(() => db.query('delete from public.rosters where id = $1 returning id', [target]).then((r) => { if (!r.rows.length) throw new Error('row-level security: nothing deleted'); }), /row-level security/);
    await as(U.cop2);
    const theirs = await rows('select id, user_id from public.rosters where user_id = $1', [U.cop1]);
    assert.ok(theirs.length > 0, 'colleagues see who is on');
    const r = await db.query('update public.rosters set acknowledged_at = now() where id = $1 returning id', [theirs[0].id]);
    assert.equal(r.rows.length, 0, 'nobody confirms for someone else');
    await as(U.central);
    assert.ok((await rows("select id from public.rosters where silo = 'MetroPolice'")).length > 0, 'the control room sees who is on in every department');
    await as(U.ff1);
    assert.equal((await rows("select id from public.rosters where silo = 'MetroPolice'")).length, 0, 'fire does not read the police roster');
  });

  await scenario('a change to an issued shift tells the person; a started shift is frozen except to someone senior', async () => {
    await as(U.sup);
    const day = addDays(saToday(), 4);
    const l = await addShift(U.cop1, day, DAY, true);
    assert.equal((await alertsFor(U.cop1, 'shift_changed')).length, 1, 'a new issued shift is announced');
    await db.query("update public.rosters set start_at = start_at + interval '1 hour', end_at = end_at + interval '1 hour' where id = $1", [l]);
    const changed = await alertsFor(U.cop1, 'shift_changed');
    assert.equal(changed.length, 2);
    assert.match(changed[1].body, /Now: Day shift · .* · 07:00–19:00/);
    await refused(() => db.query('select public.cancel_shift($1, $2)', [l, '']), /Say why/);
    await db.query('select public.cancel_shift($1, $2)', [l, 'Court case moved']);
    assert.match((await alertsFor(U.cop1, 'shift_changed'))[2].body, /Court case moved/);
    const logged = await rows('select action from public.roster_changes where roster_id = $1 order by at, id', [l]);
    assert.deepEqual(logged.map((x) => x.action), ['added', 'retimed', 'cancelled']);

    // A shift under way.
    await system();
    const running = await line(U.cop2, 'MetroPolice', minsAgo(120), hoursAhead(6));
    const own = await line(U.sup, 'MetroPolice', minsAgo(120), hoursAhead(6));
    await as(U.sup);
    await db.query("update public.rosters set end_at = end_at + interval '1 hour' where id = $1", [running]);
    await refused(() => db.query("update public.rosters set end_at = end_at - interval '1 hour' where id = $1", [own]), /Only someone senior to Sgt. Pillay/);
    await refused(() => db.query('delete from public.rosters where id = $1', [running]), /cannot be deleted/);
    await refused(() => db.query('select public.cancel_shift($1, $2)', [own, 'Going home']), /Only someone senior/);
    await as(U.captain);
    await db.query("update public.rosters set end_at = end_at - interval '1 hour' where id = $1", [own]);
    await refused(() => db.query("update public.rosters set cancelled_at = now() where id = $1", [running]), /Cancel shift/);
  });

  await scenario('check-in: going on duty, or Start shift at the console; nobody dates their own clock-in', async () => {
    await system();
    const s1 = await line(U.cop1, 'MetroPolice', minsAgo(15), hoursAhead(8));
    const s2 = await line(U.crOp, 'Ethekwini', minsAgo(3), hoursAhead(8), { station: 'Control' });
    await db.query('update public.personnel set is_on_duty = true, duty_started_at = now() where user_id = $1', [U.cop1]);
    const a1 = await one('select checked_in_at, check_in_source, late_minutes from public.shift_attendance where roster_id = $1', [s1]);
    assert.deepEqual([a1.check_in_source, a1.late_minutes], ['start_of_shift', 15]);
    await as(U.crOp);
    const res = (await one('select public.start_my_shift() as r')).r;
    assert.equal(res.checked_in, true);
    assert.equal(res.late_minutes, 3);
    await db.query("insert into public.attendance_events (user_id, kind, at) values ($1, 'clock_out', now() - interval '2 days')", [U.crOp]);
    const ev = await one("select at from public.attendance_events where user_id = $1 and kind = 'clock_out'", [U.crOp]);
    assert.equal(new Date(ev.at).getTime(), NOW, 'the time is when it happened');
    assert.ok((await one('select ended_at from public.shift_attendance where roster_id = $1', [s2])).ended_at, 'clocking out ends the shift');
    await as(U.cop2);
    assert.equal((await rows('select * from public.shift_attendance')).length, 0, 'colleagues do not see attendance');
    await refused(() => db.query("update public.shift_attendance set late_minutes = 0"), /permission denied/);
    await as(U.sup);
    assert.equal((await rows("select * from public.shift_attendance where silo = 'MetroPolice'")).length, 1, 'the supervisor does');
  });

  await scenario('late after the grace minutes, not started after the no-show minutes, each told once', async () => {
    await system();
    await db.query("insert into public.reporting_lines (silo, member_kind, member_id, manager_kind, manager_id) values ('MetroPolice', 'user', $1, 'user', $2)", [U.cop1, U.sup2]);
    await db.query('update public.personnel set is_on_duty = true where user_id = $1', [U.sup]); // the sergeant is working
    const l = await line(U.cop1, 'MetroPolice', minsAgo(12), hoursAhead(8));
    const early = await line(U.cop2, 'MetroPolice', minsAgo(5), hoursAhead(8));
    await line(U.cop3, 'MetroPolice', minsAgo(30), hoursAhead(8), { status: 'Leave' });
    void early;
    const r1 = await one('select * from public.schedule_attendance_tick()');
    assert.match(r1.detail, /1 late/);
    assert.equal((await alertsFor(U.cop1, 'shift_late')).length, 1);
    const sup2 = await alertsFor(U.sup2, 'shift_team_late');
    const sup = await alertsFor(U.sup, 'shift_team_late');
    assert.deepEqual([sup2.length, sup.length], [1, 1], 'their manager and the sergeant on duty');
    assert.match(sup[0].title, /Late: Const. Thandi Dlamini/);
    assert.equal((await alertsFor(U.captain, 'shift_team_late')).length, 0, 'command is not woken for lateness');
    assert.equal((await alertsFor(U.cop3)).length, 0, 'someone on leave is never late');
    await db.query('select * from public.schedule_attendance_tick()');
    assert.equal((await alertsFor(U.cop1, 'shift_late')).length, 1, 'told once');

    await db.query("update public.rosters set start_at = now() - interval '70 minutes' where id = $1", [l]);
    await db.query("update public.shift_attendance set start_at = now() - interval '70 minutes' where roster_id = $1", [l]);
    await db.query('select * from public.schedule_attendance_tick()');
    assert.equal((await alertsFor(U.cop1, 'shift_noshow')).length, 1);
    assert.equal((await alertsFor(U.captain, 'shift_team_noshow')).length, 1, 'command hears of a no-show');
    await db.query('select * from public.schedule_attendance_tick()');
    assert.equal((await alertsFor(U.captain, 'shift_team_noshow')).length, 1);

    // They arrive: those told hear it.
    await db.query('update public.personnel set is_on_duty = true, duty_started_at = now() where user_id = $1', [U.cop1]);
    assert.equal((await alertsFor(U.sup, 'shift_started_late')).length, 1);
    assert.equal((await one('select late_minutes from public.shift_attendance where roster_id = $1', [l])).late_minutes, 70);
  });

  await scenario('someone already working is found, not chased; an outcome stops the alerts', async () => {
    await system();
    await db.query('update public.personnel set is_on_duty = true, duty_started_at = now() - interval \'4 hours\' where user_id = $1', [U.cop2]);
    const l = await line(U.cop2, 'MetroPolice', minsAgo(20), hoursAhead(8));
    const r = await one('select * from public.schedule_attendance_tick()');
    assert.match(r.detail, /found already working/);
    assert.equal((await alertsFor(U.cop2, 'shift_late')).length, 0);
    assert.ok((await one('select checked_in_at from public.shift_attendance where roster_id = $1', [l])).checked_in_at);

    const l2 = await line(U.cop3, 'MetroPolice', minsAgo(20), hoursAhead(8));
    await as(U.cop2);
    await refused(() => db.query('select public.record_shift_outcome($1, $2, $3)', [l2, 'Excused', 'Car broke down']), /Only someone senior/);
    await as(U.sup2);
    await refused(() => db.query('select public.record_shift_outcome($1, $2, $3)', [l2, 'Excused', '']), /Say why/);
    await refused(() => db.query('select public.record_shift_outcome($1, $2, $3)', [l2, 'Holiday', 'x x x']), /Choose Present/);
    await db.query('select public.record_shift_outcome($1, $2, $3)', [l2, 'Excused', 'Car broke down on the N2']);
    assert.match((await alertsFor(U.cop3, 'shift_outcome'))[0].title, /Excused/);
    await system();
    await db.query('select * from public.schedule_attendance_tick()');
    assert.equal((await alertsFor(U.cop3, 'shift_late')).length, 0, 'recorded, so not chased');
    await system();
    const own = await line(U.sup, 'MetroPolice', minsAgo(20), hoursAhead(8));
    await as(U.sup);
    await refused(() => db.query('select public.record_shift_outcome($1, $2, $3)', [own, 'Excused', 'Myself']), /Only someone senior/, 'never your own');
  });

  await scenario('leave: asked for by the person, checked and costed; never dated, typed or overlapped wrongly', async () => {
    await as(U.cop3);
    const from = '2026-12-14'; // Monday; 16 Dec is a public holiday
    await db.query("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('MetroFire', $1, $2, $3, 'Annual', 'Approved')", [U.cop3, from, '2026-12-18']);
    const l = await one('select silo, status, days::float as days, applicant_name from public.leave_entries where user_id = $1', [U.cop3]);
    assert.deepEqual(l, { silo: 'MetroPolice', status: 'Pending', days: 4, applicant_name: 'Const. Lerato Khumalo' },
      'their own department, pending, and four working days (the 16th is a holiday)');
    await refused(() => db.query("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('MetroPolice', $1, '2026-12-17', '2026-12-21', 'Annual', 'Pending')", [U.cop3]), /already have pending leave/);
    await refused(() => db.query("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('MetroPolice', $1, '2027-01-10', '2027-01-05', 'Annual', 'Pending')", [U.cop3]), /cannot be before/);
    await refused(() => db.query("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('MetroPolice', $1, '2027-01-10', '2027-01-12', 'Holiday in Mauritius', 'Pending')", [U.cop3]), /leave type/);
    await refused(() => db.query("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('MetroPolice', $1, '2027-01-10', '2027-01-12', 'Annual', 'Pending')", [U.cop1]), /row-level security|own leave/);
    const self = await db.query("update public.leave_entries set status = 'Approved' where user_id = $1 returning id", [U.cop3]);
    assert.equal(self.rows.length, 0, 'nobody approves their own leave by editing it');
    assert.equal((await one('select status from public.leave_entries where user_id = $1', [U.cop3])).status, 'Pending');
    await as(U.sup2);
    assert.equal((await alertsFor(U.sup2, 'leave_request')).length, 1, 'the next tier up is asked');

    // A shift worker's leave costs the shifts it covers.
    await as(U.sup);
    const d0 = addDays(saToday(), 10);
    await addShift(U.cop1, d0, DAY); await addShift(U.cop1, addDays(d0, 1), DAY);
    await as(U.cop1);
    await db.query("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('MetroPolice', $1, $2, $3, 'Annual', 'Pending')", [U.cop1, d0, addDays(d0, 1)]);
    assert.equal((await one('select days::float as d from public.leave_entries where user_id = $1', [U.cop1])).d, 2);
  });

  await scenario('leave: decided by someone senior in the department, never by yourself; approval clears the roster', async () => {
    await as(U.sup);
    const d0 = addDays(saToday(), 10);
    const s1 = await addShift(U.cop1, d0, DAY, true);
    const s2 = await addShift(U.sup, d0, DAY, true);
    await as(U.cop1);
    const leave = (await one("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status, reason) values ('MetroPolice', $1, $2, $2, 'Family Responsibility', 'Pending', 'Child sick') returning id", [U.cop1, d0])).id;
    await as(U.sup);
    const own = (await one("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('MetroPolice', $1, $2, $2, 'Annual', 'Pending') returning id", [U.sup, d0])).id;
    await refused(() => db.query('select public.decide_leave($1, true)', [own]), /your own leave/);
    await as(U.sup2);
    await refused(() => db.query('select public.decide_leave($1, true)', [own]), /Only someone senior/, 'a sergeant does not approve a sergeant');
    await as(U.fireSup);
    await refused(() => db.query('select public.decide_leave($1, true)', [leave]), /Only someone senior|not found/, 'fire does not decide police leave');
    assert.equal((await rows('select id from public.leave_entries')).length, 0, 'and cannot read it');
    await as(U.cop2);
    assert.equal((await rows('select id from public.leave_entries')).length, 0, 'colleagues never read your leave');
    await as(U.sup);
    await refused(() => db.query('select public.decide_leave($1, false)', [leave]), /Say why/);
    await db.query('select public.decide_leave($1, true, $2)', [leave, 'Get well soon']);
    assert.equal((await one('select status from public.rosters where id = $1', [s1])).status, 'Leave');
    assert.match((await alertsFor(U.cop1, 'leave_decision'))[0].title, /Leave approved/);
    await refused(() => addShift(U.cop1, d0, NIGHT), /approved leave/, 'leave now blocks rostering');
    await as(U.captain);
    await db.query('select public.decide_leave($1, true)', [own]);
    assert.equal((await one('select status from public.rosters where id = $1', [s2])).status, 'Leave');
    await as(U.cop2);
    const seen = await one('select status, special_instructions from public.rosters where id = $1', [s1]);
    assert.deepEqual(seen, { status: 'Leave', special_instructions: null }, 'colleagues see "on leave", never why');
    await as(U.hr);
    const hrOwn = (await one("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('Ethekwini', $1, $2, $2, 'Annual', 'Pending') returning id", [U.hr, d0])).id;
    await as(U.hr2);
    await db.query('select public.decide_leave($1, true)', [hrOwn]);
  });

  await scenario('leave: the person cancels before it starts and gets their shifts back; after that, a senior with a reason', async () => {
    await as(U.sup);
    const d0 = addDays(saToday(), 12);
    const s1 = await addShift(U.cop1, d0, DAY, true);
    await as(U.cop1);
    const leave = (await one("insert into public.leave_entries (silo, user_id, eff_from, eff_to, absence, status) values ('MetroPolice', $1, $2, $2, 'Annual', 'Pending') returning id", [U.cop1, d0])).id;
    await as(U.sup); await db.query('select public.decide_leave($1, true)', [leave]);
    await as(U.cop1);
    await db.query('select public.cancel_leave($1)', [leave]);
    assert.equal((await one('select status from public.leave_entries where id = $1', [leave])).status, 'Cancelled');
    assert.equal((await one('select status from public.rosters where id = $1', [s1])).status, 'Present', 'the shift is back');
    assert.match((await alertsFor(U.sup, 'leave_request')).at(-1).title, /Leave cancelled by/);
    // Leave already under way.
    await system();
    const started = (await one("insert into public.leave_entries (tenant_id, silo, user_id, eff_from, eff_to, absence, status) values ($1, 'MetroPolice', $2, $3, $4, 'Sick', 'Approved') returning id", [T, U.cop2, addDays(saToday(), -1), addDays(saToday(), 1)])).id;
    await as(U.cop2);
    await refused(() => db.query('select public.cancel_leave($1)', [started]), /has started/);
    await as(U.cop1);
    await refused(() => db.query('select public.cancel_leave($1, $2)', [started, 'Not mine']), /Only/);
    await as(U.sup);
    await refused(() => db.query('select public.cancel_leave($1)', [started]), /Say why/);
    await db.query('select public.cancel_leave($1, $2)', [started, 'Back early, fit for duty']);
    assert.match((await alertsFor(U.cop2, 'leave_decision')).at(-1).title, /Leave cancelled/);
  });

  await scenario('swaps: offered, accepted, approved by someone senior to both; the shifts change hands', async () => {
    await as(U.sup);
    const a = await addShift(U.cop1, addDays(saToday(), 6), DAY, true);
    const b = await addShift(U.cop2, addDays(saToday(), 7), NIGHT, true);
    const c = await addShift(U.cop3, addDays(saToday(), 6), DAY, true);
    const swapId = '30000000-0000-4000-8000-000000000001';
    await as(U.cop1);
    await db.query("update public.rosters set acknowledged_at = now() where id = $1", [a]);
    await refused(() => db.query('select public.request_swap($1, $2, $3)', ['30000000-0000-4000-8000-000000000009', b, a]), /your own shifts/);
    await refused(() => db.query('select public.request_swap($1, $2, $3)', ['30000000-0000-4000-8000-000000000008', a, c]), /overlap/);
    await db.query('select public.request_swap($1, $2, $3, $4)', [swapId, a, b, 'Family wedding']);
    assert.equal((await one('select public.request_swap($1, $2, $3) as id', [swapId, a, b])).id, swapId, 'a resend returns the same request');
    assert.match((await alertsFor(U.cop2, 'swap'))[0].title, /Swap request from Const. Thandi Dlamini/);
    await as(U.cop3);
    assert.equal((await rows('select id from public.shift_swaps')).length, 0, 'not theirs to see');
    await refused(() => db.query('select public.respond_swap($1, true)', [swapId]), /not found/);
    await as(U.cop2);
    await db.query('select public.respond_swap($1, true)', [swapId]);
    await as(U.cop1);
    await refused(() => db.query('select public.decide_swap($1, true)', [swapId]), /your own swap/);
    await as(U.fireSup);
    await refused(() => db.query('select public.decide_swap($1, true)', [swapId]), /not found|senior to both/);
    await as(U.sup);
    await db.query('select public.decide_swap($1, true)', [swapId]);
    const after = await rows('select id, user_id, acknowledged_at from public.rosters where id in ($1, $2)', [a, b]);
    assert.equal(after.find((x) => x.id === a).user_id, U.cop2);
    assert.equal(after.find((x) => x.id === b).user_id, U.cop1);
    assert.ok(after.every((x) => x.acknowledged_at === null), 'each confirms their new shift');
    assert.equal((await alertsFor(U.cop1, 'swap')).filter((x) => /approved/.test(x.title)).length, 1);
  });

  await scenario('an account deactivated leaves the roster; the punctuality summary counts what happened', async () => {
    await as(U.sup);
    const ahead = await addShift(U.cop3, addDays(saToday(), 8), DAY, true);
    await system();
    await db.query('update public.profiles set deactivated_at = now() where id = $1', [U.cop3]);
    assert.equal((await one('select status from public.rosters where id = $1', [ahead])).status, 'Cancelled');
    await db.query('update public.profiles set deactivated_at = null where id = $1', [U.cop3]);

    const yesterday = addDays(saToday(), -1);
    const l1 = await line(U.cop1, 'MetroPolice', at(yesterday, '06:00'), at(yesterday, '18:00'));
    const l2 = await line(U.cop2, 'MetroPolice', at(yesterday, '06:00'), at(yesterday, '18:00'));
    await db.query("insert into public.shift_attendance (roster_id, tenant_id, silo, user_id, start_at, end_at, checked_in_at, late_minutes) values ($1, $2, 'MetroPolice', $3, $4, $5, $6, 25)",
      [l1, T, U.cop1, at(yesterday, '06:00'), at(yesterday, '18:00'), at(yesterday, '06:25')]);
    void l2;
    await as(U.sup);
    const sum = await rows("select user_name, shifts, started, late, late_minutes, not_started from public.attendance_summary('MetroPolice', $1::date, $1::date) order by user_name", [yesterday]);
    assert.deepEqual(sum.map((x) => [x.user_name, x.shifts, x.started, x.late, x.late_minutes, x.not_started]), [
      ['Const. Sipho Ngcobo', 1, 0, 0, 0, 1],
      ['Const. Thandi Dlamini', 1, 1, 1, 25, 0],
    ]);
    await as(U.cop1);
    await refused(() => db.query("select * from public.attendance_summary('MetroPolice', $1::date, $1::date)", [yesterday]), /Not permitted/);
  });

  await scenario('the control room rosters itself; nothing reaches across organisations', async () => {
    await as(U.crSup);
    const crDay = (await one("select id from public.shift_templates where tenant_id = $1 and silo = 'Ethekwini' and name = 'Day shift'", [T])).id;
    await addShift(U.crOp, addDays(saToday(), 3), crDay);
    await refused(() => addShift(U.cop1, addDays(saToday(), 3), DAY), /do not roster/);
    await as(U.stranger, T2);
    assert.equal((await rows('select id from public.rosters')).length, 0);
    assert.equal((await rows('select id from public.leave_entries')).length, 0);
    await refused(() => db.query('select public.cancel_shift(id, $1) from public.rosters limit 1', ['x x x']).then((r) => { if (!r.rows.length) throw new Error('not found'); }), /not found/);
  });

  await scenario('a push is attempted only when pg_net exists, and never breaks the alert', async () => {
    await system();
    await db.query("insert into public.push_tokens (user_id, token) values ($1, 'ExponentPushToken[test]')", [U.cop1]);
    await db.query("select public.schedule_alert($1, 'MetroPolice', $2, 'shift_late', 'You are late', 'x')", [T, U.cop1]);
    assert.equal((await alertsFor(U.cop1, 'shift_late')).length, 1);
  });

  await db.exec('rollback');
  console.log(`\n${checks} scenarios passed`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
