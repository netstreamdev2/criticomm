-- ============================================================================
-- 0023 — Duty posts: the establishment a shift has to fill
-- ============================================================================
--
-- 0021 gave `rosters` a day, a post name and a draft/publish boundary, but the
-- post was free text. That is enough to record who was allocated where; it is
-- not enough to answer the question a duty officer actually asks at handover —
-- "what is NOT covered right now".
--
-- A gap only exists relative to an establishment. So posts become rows: the
-- sector vehicles, station cover and control-room desks a department is
-- supposed to man, each with how many bodies it needs. An allocation board can
-- then show an empty post in red, which is the whole point of building it
-- post-first.
--
-- `min_staff` is the crewing requirement (a pump needs four, a patrol car two),
-- so "short-crewed" is distinguishable from "unmanned" — operationally those
-- are very different problems.
-- ============================================================================

create table if not exists public.duty_posts (
  id            uuid primary key default gen_random_uuid(),
  silo          public.silo not null,
  name          text not null,
  station       text,
  sector        text,
  vehicle       text,
  call_sign     text,
  /** What this post does — mirrors rosters.activity_type. */
  activity_type text,
  /** Bodies required to consider the post properly manned. */
  min_staff     integer not null default 1 check (min_staff between 1 and 50),
  /** Retired posts stay for history but drop off the board. */
  active        boolean not null default true,
  sort_order    integer not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint duty_posts_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists duty_posts_board_idx on public.duty_posts (silo, active, sort_order, name);

alter table public.duty_posts enable row level security;

-- Everyone in the department can see the establishment — a member should be
-- able to see what posts exist and which are short.
drop policy if exists duty_posts_read on public.duty_posts;
create policy duty_posts_read on public.duty_posts for select
  using (silo = public.current_silo() or public.is_global());

-- Defining the establishment is a supervisory act.
drop policy if exists duty_posts_write on public.duty_posts;
create policy duty_posts_write on public.duty_posts for all
  using (
    public.role_in('Supervisor','Captain','Chief','FireChief','SystemAdmin','SuperAdmin','Admin')
    and (silo = public.current_silo() or public.can_write_global())
  )
  with check (
    public.role_in('Supervisor','Captain','Chief','FireChief','SystemAdmin','SuperAdmin','Admin')
    and (silo = public.current_silo() or public.can_write_global())
  );

drop trigger if exists duty_posts_touch on public.duty_posts;
create trigger duty_posts_touch before update on public.duty_posts
  for each row execute function public.touch_updated_at();

-- Link allocations to the post they fill. Nullable: ad-hoc duties that don't
-- correspond to a standing post are still legitimate, they just don't count
-- towards covering one.
alter table public.rosters
  add column if not exists post_id uuid references public.duty_posts(id) on delete set null;

create index if not exists rosters_post_day_idx on public.rosters (post_id, duty_date);

-- Seed a starting establishment per department from the stations already in
-- use, so the board is not empty on first open. Supervisors edit from there.
insert into public.duty_posts (silo, name, station, activity_type, min_staff, sort_order)
select distinct
  r.silo,
  coalesce(nullif(r.station, ''), 'Unassigned') || ' — ' || coalesce(nullif(r.activity_type, ''), 'General duty'),
  nullif(r.station, ''),
  nullif(r.activity_type, ''),
  1,
  0
from public.rosters r
where r.station is not null
  and not exists (
    select 1 from public.duty_posts p
    where p.silo = r.silo
      and p.name = coalesce(nullif(r.station, ''), 'Unassigned') || ' — ' || coalesce(nullif(r.activity_type, ''), 'General duty')
  );

-- Point existing allocations at the seeded posts where the pairing is obvious.
update public.rosters r
   set post_id = p.id
  from public.duty_posts p
 where r.post_id is null
   and p.silo = r.silo
   and p.station is not distinct from nullif(r.station, '')
   and p.activity_type is not distinct from nullif(r.activity_type, '');
