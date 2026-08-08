-- 0033 — Command platform modules
--
-- Everything the command dashboard needs that the schema did not yet have:
--
--   sections             the operational areas officers are posted to (NR, DR, B…)
--   duty_tasks           "Duty Maintenance" — numbered DM- tasks with due dates
--   attendance_events    Time & Attendance clock register (append-only)
--   fines                enforcement: traffic/bylaw fines (FN-)
--   charges              enforcement: criminal charges (CH-)
--   charge_transactions  payments/bail/fees against a fine or charge
--   warrants             arrest and search warrants (WA-)
--   summonses            court summonses (SM-)
--   mail_messages        internal mail between operators
--   firearm_checklists   armoury checklist captured on the phone
--
-- Plus doc_counters/next_doc_number() for per-tenant document numbering, and
-- the SystemController role (added in 0032) folded into the global-read and
-- global-write helper functions.
--
-- Every table follows the house RLS shape: permissive silo/role policies OR
-- together, then one RESTRICTIVE tenant_isolation policy ANDs on top.

-- ── SystemController joins the global tiers ─────────────────────────────────
-- is_global(): cross-silo SELECT. can_write_global(): cross-silo writes.
-- The controller is a command seat over every department, so it gets both.

create or replace function public.is_global()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','IncidentLogger','Viewer','System','SystemController')
     from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.can_write_global()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select role in ('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','System','SystemController')
     from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ── Document numbering ──────────────────────────────────────────────────────
-- One counter per (tenant, prefix): DM-0001, FN-0001, CH-0001, WA-0001,
-- SM-0001. Unlike incident numbers these do not reset daily — a fine number
-- is quoted in court months later, so it must stay unique forever.

create table if not exists public.doc_counters (
  tenant_id uuid not null default public.current_tenant(),
  prefix    text not null,
  last_seq  int  not null default 0,
  primary key (tenant_id, prefix)
);
alter table public.doc_counters enable row level security;
-- No user-facing policies: only next_doc_number() (DEFINER) touches it.

create or replace function public.next_doc_number(p_prefix text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.current_tenant();
  v_seq int;
begin
  if p_prefix !~ '^[A-Z]{2,4}$' then
    raise exception 'Invalid document prefix';
  end if;

  insert into public.doc_counters (tenant_id, prefix, last_seq)
  values (v_tenant, p_prefix, 1)
  on conflict (tenant_id, prefix)
    do update set last_seq = public.doc_counters.last_seq + 1
  returning last_seq into v_seq;

  return p_prefix || '-' || lpad(v_seq::text, 4, '0');
end $$;

revoke execute on function public.next_doc_number(text) from public, anon;
grant execute on function public.next_doc_number(text) to authenticated, service_role;

-- ── Sections ────────────────────────────────────────────────────────────────
-- The operational areas that appear beside every officer on the duty board:
-- "NR — North Region", "B — Beachfront". Owned by admin, read by everyone.

create table if not exists public.sections (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default public.current_tenant(),
  silo       silo not null default 'MetroPolice',
  code       text not null check (code ~ '^[A-Z0-9]{1,6}$'),
  name       text not null,
  region     text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, silo, code)
);
alter table public.sections enable row level security;

create policy sections_read on public.sections for select to authenticated using (true);
create policy sections_write on public.sections for all to authenticated
  using (public.role_in('SystemAdmin','SuperAdmin','Admin','SystemController','System'))
  with check (public.role_in('SystemAdmin','SuperAdmin','Admin','SystemController','System'));

-- The founding tenant's Metro Police sections, exactly as posted on the board.
insert into public.sections (silo, code, name, region) values
  ('MetroPolice', 'NR', 'North Region',                 'North'),
  ('MetroPolice', 'W',  'Inner West',                   'West'),
  ('MetroPolice', 'DR', 'Durban Central',               'Central'),
  ('MetroPolice', 'B',  'Beachfront',                   'Central'),
  ('MetroPolice', 'CH', 'Chatsworth',                   'South'),
  ('MetroPolice', 'OR', 'Operational Response Services','Metro-wide')
on conflict (tenant_id, silo, code) do nothing;

-- ── Duty tasks ("Duty Maintenance") ─────────────────────────────────────────
-- Numbered station tasks with an assignee, a due date and a progress bar:
-- vehicle inspections, CCTV checks, radio calibration, restocks.

create table if not exists public.duty_tasks (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.current_tenant(),
  silo             silo not null default public.current_silo(),
  task_number      text not null,
  title            text not null,
  details          text,
  assigned_user_id uuid references public.profiles (id) on delete set null,
  assigned_name    text,
  unit_ref         text,
  section_code     text,
  due_date         date,
  status           text not null default 'Pending'
                     check (status in ('Pending','In Progress','Completed','Cancelled')),
  progress         int  not null default 0 check (progress between 0 and 100),
  created_by       uuid,
  created_name     text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (tenant_id, task_number)
);
create index if not exists duty_tasks_due_idx on public.duty_tasks (due_date);
create index if not exists duty_tasks_assignee_idx on public.duty_tasks (assigned_user_id);
alter table public.duty_tasks enable row level security;

create policy duty_tasks_read on public.duty_tasks for select to authenticated
  using (silo = public.current_silo() or public.is_global() or assigned_user_id = auth.uid());
-- Supervisors run the board…
create policy duty_tasks_write on public.duty_tasks for all to authenticated
  using (public.role_in('Supervisor','Captain','Chief','FireChief','Admin','SystemAdmin','SuperAdmin','SystemController','System')
         and (silo = public.current_silo() or public.is_global()))
  with check (silo = public.current_silo() or public.is_global());
-- …and the person a task is assigned to may advance it.
create policy duty_tasks_update_own on public.duty_tasks for update to authenticated
  using (assigned_user_id = auth.uid())
  with check (assigned_user_id = auth.uid());

-- ── Time & Attendance ───────────────────────────────────────────────────────
-- An append-only clock register. No update or delete policy exists on
-- purpose: an attendance record that can be edited is not an attendance
-- record. Corrections are new events, visible as such.

create table if not exists public.attendance_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default public.current_tenant(),
  silo       silo not null default public.current_silo(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  user_name  text,
  kind       text not null check (kind in ('clock_in','clock_out')),
  at         timestamptz not null default now(),
  source     text not null default 'console' check (source in ('console','mobile')),
  note       text
);
create index if not exists attendance_user_at_idx on public.attendance_events (user_id, at desc);
create index if not exists attendance_at_idx on public.attendance_events (at desc);
alter table public.attendance_events enable row level security;

create policy attendance_insert_self on public.attendance_events for insert to authenticated
  with check (user_id = auth.uid());
create policy attendance_read on public.attendance_events for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_global()
    or (silo = public.current_silo()
        and public.role_in('Supervisor','Captain','Chief','FireChief','Admin','SystemAdmin','SuperAdmin','SystemController','System'))
  );

-- ── Enforcement suite ───────────────────────────────────────────────────────
-- Metro Police paperwork: fines, charges, the money that moves against them,
-- warrants and summonses. All silo-scoped to MetroPolice by default; the
-- shared read/write shape mirrors metro_reports.

create table if not exists public.fines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default public.current_tenant(),
  silo                silo not null default 'MetroPolice',
  fine_number         text not null,
  offender_name       text not null,
  offender_id_number  text,
  vehicle_reg         text,
  offence_code        text,
  offence_description text not null,
  amount              numeric(12,2) not null check (amount >= 0),
  location            text,
  incident_id         uuid references public.incidents (id) on delete set null,
  issued_by           uuid,
  issued_by_name      text,
  issued_at           timestamptz not null default now(),
  due_date            date,
  status              text not null default 'Unpaid'
                        check (status in ('Unpaid','Partially Paid','Paid','Disputed','Cancelled')),
  notes               text,
  unique (tenant_id, fine_number)
);

create table if not exists public.charges (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default public.current_tenant(),
  silo               silo not null default 'MetroPolice',
  charge_number      text not null,
  accused_name       text not null,
  accused_id_number  text,
  charge_code        text,
  description        text not null,
  statute            text,
  severity           text not null default 'Serious' check (severity in ('Minor','Serious','Severe')),
  status             text not null default 'Open'
                       check (status in ('Open','Referred to Court','Withdrawn','Convicted','Acquitted')),
  officer_id         uuid,
  officer_name       text,
  opened_at          timestamptz not null default now(),
  court_name         text,
  court_date         date,
  case_ref           text,
  incident_id        uuid references public.incidents (id) on delete set null,
  notes              text,
  unique (tenant_id, charge_number)
);

create table if not exists public.charge_transactions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),
  silo          silo not null default 'MetroPolice',
  charge_id     uuid references public.charges (id) on delete cascade,
  fine_id       uuid references public.fines (id) on delete cascade,
  tx_type       text not null check (tx_type in ('Payment','Bail','Court Fee','Refund','Adjustment')),
  amount        numeric(12,2) not null,
  method        text not null default 'EFT' check (method in ('Cash','Card','EFT','Other')),
  reference     text,
  recorded_by   uuid,
  recorded_name text,
  recorded_at   timestamptz not null default now(),
  note          text,
  check (charge_id is not null or fine_id is not null)
);
create index if not exists charge_tx_charge_idx on public.charge_transactions (charge_id);
create index if not exists charge_tx_fine_idx on public.charge_transactions (fine_id);

create table if not exists public.warrants (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default public.current_tenant(),
  silo              silo not null default 'MetroPolice',
  warrant_number    text not null,
  subject_name      text not null,
  subject_id_number text,
  warrant_type      text not null default 'Arrest' check (warrant_type in ('Arrest','Search')),
  issued_by_court   text,
  issue_date        date not null default current_date,
  expiry_date       date,
  status            text not null default 'Active'
                      check (status in ('Active','Executed','Cancelled','Expired')),
  executed_at       timestamptz,
  executing_officer text,
  address           text,
  notes             text,
  unique (tenant_id, warrant_number)
);

create table if not exists public.summonses (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default public.current_tenant(),
  silo                silo not null default 'MetroPolice',
  summons_number      text not null,
  recipient_name      text not null,
  recipient_id_number text,
  offence             text not null,
  court_name          text,
  court_date          date,
  address             text,
  status              text not null default 'Issued'
                        check (status in ('Issued','Served','Court Date Set','Concluded','Withdrawn')),
  served_at           timestamptz,
  served_by           text,
  notes               text,
  unique (tenant_id, summons_number)
);

do $$
declare t text;
begin
  foreach t in array array['fines','charges','charge_transactions','warrants','summonses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using (silo = public.current_silo() or public.is_global())',
      t || '_read', t
    );
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (public.role_in(''Police'',''Officer'',''Captain'',''Metro'',''Security'',''Supervisor'',''Admin'',''SystemAdmin'',''SuperAdmin'',''SystemController'',''System'') '
      || '       and (silo = public.current_silo() or public.is_global())) '
      || 'with check (silo = public.current_silo() or public.is_global())',
      t || '_write', t
    );
  end loop;
end $$;

-- ── Internal mail ───────────────────────────────────────────────────────────
-- Operator-to-operator messages inside the tenant. Sender and recipient are
-- the only readers; the recipient marks read. Deliberately not e-mail: it
-- never leaves the platform, so it is subject to the audit trail and RLS.

create table if not exists public.mail_messages (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant(),
  from_user uuid not null default auth.uid(),
  from_name text,
  to_user   uuid not null references public.profiles (id) on delete cascade,
  to_name   text,
  subject   text not null,
  body      text not null,
  sent_at   timestamptz not null default now(),
  read_at   timestamptz
);
create index if not exists mail_to_idx on public.mail_messages (to_user, sent_at desc);
create index if not exists mail_from_idx on public.mail_messages (from_user, sent_at desc);
alter table public.mail_messages enable row level security;

create policy mail_read on public.mail_messages for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());
create policy mail_send on public.mail_messages for insert to authenticated
  with check (from_user = auth.uid());
create policy mail_mark_read on public.mail_messages for update to authenticated
  using (to_user = auth.uid())
  with check (to_user = auth.uid());

alter publication supabase_realtime add table public.mail_messages;

-- ── Firearm checklists ──────────────────────────────────────────────────────
-- The armoury checklist an officer completes on the phone when a firearm is
-- issued, returned or inspected. The id is client-generated so the offline
-- outbox can replay the insert idempotently (a duplicate key means it already
-- landed). `passed` is computed — an officer cannot claim a pass while a
-- safety check is unticked.

create table if not exists public.firearm_checklists (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default public.current_tenant(),
  silo              silo not null default 'MetroPolice',
  user_id           uuid not null default auth.uid(),
  user_name         text,
  kind              text not null default 'Inspection' check (kind in ('Issue','Return','Inspection')),
  serial_number     text not null,
  make_model        text,
  serial_verified   boolean not null default false,
  barrel_clear      boolean not null default false,
  action_functional boolean not null default false,
  safety_functional boolean not null default false,
  sights_secure     boolean not null default false,
  cleaned           boolean not null default false,
  magazines         int not null default 0 check (magazines between 0 and 20),
  rounds_issued     int not null default 0 check (rounds_issued between 0 and 500),
  rounds_returned   int check (rounds_returned between 0 and 500),
  defects           text,
  passed            boolean generated always as
                      (serial_verified and barrel_clear and action_functional
                       and safety_functional and sights_secure) stored,
  created_at        timestamptz not null default now()
);
create index if not exists firearm_checklists_user_idx on public.firearm_checklists (user_id, created_at desc);
create index if not exists firearm_checklists_serial_idx on public.firearm_checklists (serial_number);
alter table public.firearm_checklists enable row level security;

create policy firearm_checklists_insert on public.firearm_checklists for insert to authenticated
  with check (user_id = auth.uid() and silo = public.current_silo());
create policy firearm_checklists_read on public.firearm_checklists for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_global()
    or (silo = public.current_silo()
        and public.role_in('Captain','Supervisor','Admin','SystemAdmin','SuperAdmin','SystemController','System'))
  );

-- ── Tenant isolation (RESTRICTIVE) for every table above ────────────────────
-- Same shape as 0030: the permissive policies decide who may act, this one
-- ANDs "…and only within your tenant" on top.

do $$
declare t text;
begin
  foreach t in array array[
    'sections','duty_tasks','attendance_events',
    'fines','charges','charge_transactions','warrants','summonses',
    'mail_messages','firearm_checklists'
  ] loop
    execute format('create index if not exists %I on public.%I (tenant_id)', t || '_tenant_idx', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all to authenticated '
      || 'using (tenant_id = public.current_tenant()) '
      || 'with check (tenant_id = public.current_tenant())',
      t
    );
  end loop;
end $$;
