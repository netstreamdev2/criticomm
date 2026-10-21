-- ============================================================================
-- 0094 — The call logger: four screens, and their own calls only
-- ============================================================================
--
-- Run after 0093.
--
-- The call logger (IncidentLogger) now has four screens and no more: the
-- dashboard, Log incoming call, Log history (the calls they logged) and My
-- work. The console refuses every other page to them (canAccess, enforced in
-- the middleware). 0081 let them watch every call unfold, timeline and photos
-- included. Here the database follows: they read the calls they logged, and
-- the timeline, attachments, photos and files of those calls, and nothing of
-- anyone else's. Their dashboard's figures and map are their own calls.
--
-- One exception, kept narrow: the duplicate check while logging still looks
-- at every open call of the organisation in the last 12 hours, so a call
-- another logger already took is caught. It answers only the matching call's
-- number and why it matched.
--
-- The departments' reports they already cannot read (0081), nor the bodycams
-- (0054).
--
-- Restrictive policies: they narrow whatever already lets a read in, for the
-- call logger only. Everyone else reads exactly what they read before.
--
-- Safe to re-run.
-- ============================================================================

/** The call logger reads a call's detail only on the calls they logged; anyone else as before (0081's test). */
create or replace function public.may_read_call_detail(p_incident_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.may_add_to_incident(p_incident_id)
$$;
revoke all on function public.may_read_call_detail(uuid) from public, anon;
grant execute on function public.may_read_call_detail(uuid) to authenticated, service_role;

-- The calls themselves.
drop policy if exists incidents_logger_reads_own on public.incidents;
create policy incidents_logger_reads_own on public.incidents as restrictive for select to authenticated
  using (not public.role_in('IncidentLogger') or created_by = auth.uid());

-- The timeline.
drop policy if exists incident_updates_logger_reads_own on public.incident_updates;
create policy incident_updates_logger_reads_own on public.incident_updates as restrictive for select to authenticated
  using (public.may_read_call_detail(incident_id));

-- The attachments register.
drop policy if exists incident_attachments_logger_reads_own on public.incident_attachments;
create policy incident_attachments_logger_reads_own on public.incident_attachments as restrictive for select to authenticated
  using (public.may_read_call_detail(incident_id));

-- The files themselves: <silo>/<incident_id>/… in both evidence buckets. Other buckets are untouched.
drop policy if exists incident_files_logger_reads_own on storage.objects;
create policy incident_files_logger_reads_own on storage.objects as restrictive for select to authenticated
  using (
    bucket_id not in ('incident-media', 'incident-attachments')
    or public.may_read_call_detail(public.try_uuid((storage.foldername(name))[2]))
  );

-- The duplicate check (0062): every open call of the organisation in the last
-- 12 hours, whoever reads only their own, answering only the number and why.
create or replace function public.check_duplicate_incident(
  p_phone     text,
  p_location  text,
  p_type      text
) returns table (reason text, incident_id uuid, incident_number text, matched_at timestamptz)
language sql stable security definer set search_path = public as $$
  with recent as (
    select * from public.incidents
    where auth.uid() is not null
      and tenant_id = public.current_tenant()
      and call_timestamp >= now() - interval '12 hours'
      and status not in ('Closed', 'Resolved')
  ), phone as (
    select right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9) as tail
  )
  (select 'Caller'::text, r.id, r.incident_number, r.call_timestamp
   from recent r, phone
   where length(phone.tail) = 9
     and right(regexp_replace(coalesce(r.caller_number, ''), '[^0-9]', '', 'g'), 9) = phone.tail
   order by r.call_timestamp desc
   limit 1)
  union all
  (select 'Location'::text, id, incident_number, call_timestamp
   from recent
   where p_location is not null and p_type is not null
     and location_address = p_location and incident_type = p_type
   order by call_timestamp desc
   limit 1);
$$;
revoke all on function public.check_duplicate_incident(text, text, text) from public, anon;
grant execute on function public.check_duplicate_incident(text, text, text) to authenticated;

notify pgrst, 'reload schema';
