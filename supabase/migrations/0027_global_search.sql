-- ============================================================================
-- 0027 — Global search
-- ============================================================================
--
-- Finding a record meant knowing which screen it lived on. An operator holding
-- a plate number, a case number or half a caller's surname had to decide first
-- whether that made it an incident, a vehicle, a person or a report, then go to
-- that module's list and filter. Under pressure that is the wrong order: you
-- have the string, you want the record.
--
-- Trigram matching rather than full-text search, deliberately. Postgres's text
-- search tokenises and stems, which is right for prose and wrong for almost
-- everything an operator actually types: `INC-20260804-0042`, `ND 123-456`,
-- `PSV-8891`. Those are identifiers, and `to_tsvector` mangles them — a
-- partial identifier matches nothing. pg_trgm matches substrings, which is
-- exactly the "I only have part of it" case, and it handles the misspelt
-- surname case too.
--
-- SECURITY INVOKER, emphatically. This function reads across seven tables and
-- every department; the only reason it is safe is that RLS runs for the calling
-- user on each one. Making it DEFINER for speed would turn one search box into
-- a cross-silo data leak.
-- ============================================================================

create extension if not exists pg_trgm;

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- GIN trigram indexes on the columns people actually search by. Without these
-- each ILIKE is a sequential scan, and the union of seven of them on a busy
-- incidents table would be slower than the module list it replaces.

create index if not exists incidents_search_number_trgm
  on public.incidents using gin (incident_number gin_trgm_ops);
create index if not exists incidents_search_address_trgm
  on public.incidents using gin (location_address gin_trgm_ops);
create index if not exists incidents_search_caller_trgm
  on public.incidents using gin (caller_name gin_trgm_ops);
create index if not exists incidents_search_type_trgm
  on public.incidents using gin (incident_type gin_trgm_ops);

create index if not exists personnel_search_last_trgm
  on public.personnel using gin (last_name gin_trgm_ops);
create index if not exists personnel_search_first_trgm
  on public.personnel using gin (first_name gin_trgm_ops);
create index if not exists personnel_search_badge_trgm
  on public.personnel using gin (badge_number gin_trgm_ops);

create index if not exists apparatus_search_unit_trgm
  on public.apparatus using gin (unit_number gin_trgm_ops);
create index if not exists apparatus_search_name_trgm
  on public.apparatus using gin (name gin_trgm_ops);

create index if not exists metro_reports_search_case_trgm
  on public.metro_reports using gin (case_number gin_trgm_ops);
create index if not exists firefighter_reports_search_number_trgm
  on public.firefighter_reports using gin (report_number gin_trgm_ops);

-- ── The search ──────────────────────────────────────────────────────────────

create or replace function public.search_everything(
  p_query text,
  p_limit int default 24
)
returns table (
  kind     text,
  id       text,
  title    text,
  subtitle text,
  meta     text,
  href     text,
  rank     real
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with q as (
    select
      trim(p_query)          as raw,
      '%' || trim(p_query) || '%' as like_pattern,
      greatest(1, least(coalesce(p_limit, 24), 50)) as lim
  )
  -- Incidents. Ranked so an identifier match beats a description match:
  -- somebody typing an incident number wants that incident first, not every
  -- call whose narrative happens to contain the digits.
  (
    select
      'incident'::text,
      i.id::text,
      i.incident_number || ' · ' || i.incident_type,
      i.location_address,
      i.status::text || ' · ' || i.incident_severity::text || ' · ' || i.silo::text,
      '/incidents/' || i.id::text,
      greatest(
        similarity(i.incident_number, (select raw from q)) * 2.0,
        similarity(coalesce(i.caller_name, ''), (select raw from q)),
        similarity(coalesce(i.location_address, ''), (select raw from q)),
        similarity(coalesce(i.incident_type, ''), (select raw from q))
      )::real
    from public.incidents i, q
    where i.incident_number  ilike q.like_pattern
       or i.incident_type    ilike q.like_pattern
       or i.location_address ilike q.like_pattern
       or i.caller_name      ilike q.like_pattern
       or i.caller_number    ilike q.like_pattern
       or i.call_description ilike q.like_pattern
    order by 7 desc, i.incident_created_at desc
    limit (select lim from q)
  )
  union all
  (
    select
      'person'::text,
      p.id::text,
      p.first_name || ' ' || p.last_name,
      coalesce(p.rank, 'Rank not set') || ' · ' || coalesce(p.badge_number, 'no badge'),
      coalesce(p.station, 'Station not set') || ' · ' || p.silo::text,
      '/admin/personnel',
      greatest(
        similarity(p.last_name, (select raw from q)),
        similarity(p.first_name, (select raw from q)),
        similarity(coalesce(p.badge_number, ''), (select raw from q)) * 2.0
      )::real
    from public.personnel p, q
    where p.first_name    ilike q.like_pattern
       or p.last_name     ilike q.like_pattern
       or p.badge_number  ilike q.like_pattern
       or coalesce(p.unit, '') ilike q.like_pattern
    order by 7 desc
    limit (select lim from q)
  )
  union all
  (
    select
      'vehicle'::text,
      a.id::text,
      a.unit_number || ' · ' || a.name,
      a.type || coalesce(' · ' || a.license_plate, ''),
      a.status::text || ' · ' || a.silo::text,
      '/admin/vehicles',
      greatest(
        similarity(a.unit_number, (select raw from q)) * 2.0,
        similarity(coalesce(a.license_plate, ''), (select raw from q)) * 2.0,
        similarity(a.name, (select raw from q))
      )::real
    from public.apparatus a, q
    where a.unit_number   ilike q.like_pattern
       or a.name          ilike q.like_pattern
       or a.license_plate ilike q.like_pattern
    order by 7 desc
    limit (select lim from q)
  )
  union all
  (
    select
      'police-report'::text,
      m.id::text,
      coalesce(m.case_number, 'No case number') || ' · ' || coalesce(m.incident_category, 'Uncategorised'),
      coalesce(m.location, 'Location not recorded'),
      coalesce(m.officer_name, 'Officer not recorded') || ' · ' || to_char(m.date_of_offense, 'DD Mon YYYY'),
      '/police/reports/' || m.id::text,
      greatest(
        similarity(coalesce(m.case_number, ''), (select raw from q)) * 2.0,
        similarity(coalesce(m.offender_name, ''), (select raw from q)),
        similarity(coalesce(m.location, ''), (select raw from q))
      )::real
    from public.metro_reports m, q
    where coalesce(m.case_number, '')    ilike q.like_pattern
       or coalesce(m.ticket_number, '')  ilike q.like_pattern
       or coalesce(m.offender_name, '')  ilike q.like_pattern
       or coalesce(m.location, '')       ilike q.like_pattern
    order by 7 desc
    limit (select lim from q)
  )
  union all
  (
    select
      'fire-report'::text,
      f.id::text,
      f.report_number || ' · ' || coalesce(f.type_of_incident, 'Type not recorded'),
      coalesce(f.location, 'Location not recorded'),
      to_char(f.date_of_incident, 'DD Mon YYYY') || ' · ' || f.silo::text,
      '/fire/reports/' || f.id::text,
      greatest(
        similarity(f.report_number, (select raw from q)) * 2.0,
        similarity(coalesce(f.location, ''), (select raw from q))
      )::real
    from public.firefighter_reports f, q
    where f.report_number             ilike q.like_pattern
       or coalesce(f.location, '')    ilike q.like_pattern
       or coalesce(f.type_of_incident, '') ilike q.like_pattern
    order by 7 desc
    limit (select lim from q)
  )
  union all
  (
    select
      'security-report'::text,
      s.id::text,
      s.guard_name || coalesce(' · SIRA ' || s.sira_number, ''),
      coalesce(s.location, 'Site not recorded'),
      coalesce(s.badge_number, 'no badge') || ' · ' || s.silo::text,
      '/police/security',
      greatest(
        similarity(s.guard_name, (select raw from q)),
        similarity(coalesce(s.sira_number, ''), (select raw from q)) * 2.0,
        similarity(coalesce(s.badge_number, ''), (select raw from q)) * 2.0
      )::real
    from public.security_reports s, q
    where s.guard_name                  ilike q.like_pattern
       or coalesce(s.sira_number, '')   ilike q.like_pattern
       or coalesce(s.badge_number, '')  ilike q.like_pattern
       or coalesce(s.location, '')      ilike q.like_pattern
    order by 7 desc
    limit (select lim from q)
  )
  order by 7 desc, 3
  limit (select lim from q);
$$;

comment on function public.search_everything(text, int) is
  'Cross-module search. SECURITY INVOKER so RLS scopes every branch to the caller''s department.';

-- A blank or one-character query would match most of the database and return a
-- meaningless slab of rows, so the client is expected to require two
-- characters. Guarding here as well would mean a second function signature for
-- no benefit — the LIMIT already bounds the cost.
revoke execute on function public.search_everything(text, int) from public, anon;
grant execute on function public.search_everything(text, int) to authenticated, service_role;
