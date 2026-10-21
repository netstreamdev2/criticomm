-- ============================================================================
-- 0095 — Talk wakes the radios: no one has to open Talk to hear the console
-- ============================================================================
--
-- Run after 0094. Needs 0083 (Talk) and 0088 (who may speak on All call).
--
-- A radio, and a hard hat with no screen to open, used to hear the console
-- only while someone had Talk open on it. Now the console calls them: holding
-- to talk with no radio listening sends a wake-up for that talk group. Every
-- radio that may listen to the group (talk_access) is told at once, joins by
-- itself, even with its screen off, and plays the console through its
-- speaker. It stays on a minute after the last word, then leaves: the voice
-- server is paid by the minute, so radios are only on it while there is
-- talk.
--
--   talk_wakes      each time the radios of a talk group were called: which
--                   group, by whom, and until when they stay on. Read by
--                   whoever may listen to that group; written only below.
--   call_radios()   calls (or keeps on) the radios of a talk group. Only
--                   those who may speak in it; one open call per group, kept
--                   on by each new press; a new call is audited.
--   open_talk_wakes() the open calls this person may hear (the radio asks
--                   again when its live link dropped).
--
-- Nothing is recorded (recording is on hold, docs/25-RADIOS.md).
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.talk_wakes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  channel         text not null check (length(channel) <= 80),
  called_by       uuid not null,
  called_by_name  text,
  started_at      timestamptz not null default now(),
  until           timestamptz not null,
  check (until >= started_at)
);
create index if not exists talk_wakes_open_idx on public.talk_wakes (tenant_id, channel, until desc);

alter table public.talk_wakes enable row level security;
revoke all on public.talk_wakes from anon;
revoke insert, update, delete on public.talk_wakes from authenticated;
grant select on public.talk_wakes to authenticated;

drop policy if exists tenant_isolation on public.talk_wakes;
create policy tenant_isolation on public.talk_wakes as restrictive for all to authenticated
  using (tenant_id = public.current_tenant());

-- Seen by whoever may listen to the group: its radios, and the desk.
drop policy if exists talk_wakes_read on public.talk_wakes;
create policy talk_wakes_read on public.talk_wakes for select to authenticated
  using (coalesce((public.talk_access(channel) ->> 'listen')::boolean, false));

/**
 * Call the radios of a talk group, or keep them on: a minute from now. One
 * open call per group; a press while it is open only extends it (at most one
 * write every 15 seconds). Only those who may speak in the group.
 */
create or replace function public.call_radios(p_channel text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_access jsonb;
  v_row    public.talk_wakes;
  v_name   text;
begin
  if auth.uid() is null or public.current_tenant() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_access := public.talk_access(p_channel);
  if not coalesce((v_access ->> 'speak')::boolean, false) then
    raise exception 'You may not speak in that talk group' using errcode = '42501';
  end if;

  -- One call per group at a time: two presses at once make one call.
  perform pg_advisory_xact_lock(hashtextextended(public.current_tenant()::text || ':talk-wake:' || p_channel, 0));

  select * into v_row from public.talk_wakes
   where tenant_id = public.current_tenant() and channel = p_channel and until > now()
   order by until desc limit 1;
  if found then
    if v_row.until < now() + interval '45 seconds' then
      update public.talk_wakes set until = now() + interval '60 seconds'
       where id = v_row.id returning * into v_row;
    end if;
    return jsonb_build_object('id', v_row.id, 'until', v_row.until, 'new', false);
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.talk_wakes (tenant_id, channel, called_by, called_by_name, until)
  values (public.current_tenant(), p_channel, auth.uid(), v_name, now() + interval '60 seconds')
  returning * into v_row;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_row.tenant_id, public.current_silo(), auth.uid(), v_name, 'TalkRadiosCalled', 'talk_group', p_channel,
          format('%s called the radios on %s', coalesce(v_name, 'Someone'), coalesce(v_access ->> 'name', p_channel)));
  return jsonb_build_object('id', v_row.id, 'until', v_row.until, 'new', true);
end $$;
revoke all on function public.call_radios(text) from public, anon;
grant execute on function public.call_radios(text) to authenticated;

/** The open calls this person may hear, newest first: the radio asks again when its live link dropped. */
create or replace function public.open_talk_wakes()
returns jsonb language sql stable security invoker set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'channel', w.channel, 'until', w.until) order by w.until desc), '[]'::jsonb)
    from public.talk_wakes w
   where w.until > now()
$$;
revoke all on function public.open_talk_wakes() from public, anon;
grant execute on function public.open_talk_wakes() to authenticated;

-- The radios hear of a call the moment it is made.
do $$
begin
  alter publication supabase_realtime add table public.talk_wakes;
exception when duplicate_object then null;
          when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
