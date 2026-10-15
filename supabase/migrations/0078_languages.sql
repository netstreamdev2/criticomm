-- ============================================================================
-- 0078 — Languages: each person's language, and the translations people check
-- ============================================================================
--
-- Run after 0077.
--
-- Every screen can be shown in South Africa's official written languages,
-- from translations that people have checked (docs/23, item 1):
--
--   profiles.language          The language a person chose (null: English, or
--                              the phone's own language when we have it).
--   profiles.translator_langs  The languages a person translates and approves.
--   translations               One row per sentence and language: a draft
--                              (from Criti or a person) until a translator for
--                              that language approves it. Only approved ones
--                              are shown on the screens.
--
-- Wording is the same for every organisation, so translations are shared.
-- Everyone signed in reads the approved ones; drafts are seen only by
-- translators and administrators. Nothing is written except through the
-- functions below, which check who is asking.
--
-- Safe to re-run.
-- ============================================================================

alter table public.profiles
  add column if not exists language text,
  add column if not exists translator_langs text[] not null default '{}';
comment on column public.profiles.language is 'The language the person chose for the screens (0078); null is English.';
comment on column public.profiles.translator_langs is 'The languages the person translates and approves (0078).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_language_check') then
    alter table public.profiles add constraint profiles_language_check
      check (language is null or language in ('en', 'zu', 'xh', 'af', 'nso', 'tn', 'st', 'ts', 'ss', 've', 'nr'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_translator_langs_check') then
    alter table public.profiles add constraint profiles_translator_langs_check
      check (translator_langs <@ array['zu', 'xh', 'af', 'nso', 'tn', 'st', 'ts', 'ss', 've', 'nr']::text[]);
  end if;
end $$;

create table if not exists public.translations (
  key              text not null check (length(key) between 1 and 600),
  lang             text not null check (lang in ('zu', 'xh', 'af', 'nso', 'tn', 'st', 'ts', 'ss', 've', 'nr')),
  text             text not null check (length(btrim(text)) between 1 and 2000),
  status           text not null default 'draft' check (status in ('draft', 'approved')),
  drafted_by       text not null default 'person' check (drafted_by in ('person', 'criti')),
  updated_by       uuid,
  updated_by_name  text,
  updated_at       timestamptz not null default now(),
  approved_by      uuid,
  approved_by_name text,
  approved_at      timestamptz,
  primary key (key, lang)
);
comment on table public.translations is
  'Each sentence''s translation per language (0078). The key is the English (with its context, if any). Written only by save_translation() and save_translation_drafts().';
create index if not exists translations_lang_status_idx on public.translations (lang, status);
alter table public.translations enable row level security;

/** The platform's and the organisation's administrators: they manage translators and may draft. */
create or replace function public.translation_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.role_in('SuperAdmin', 'SystemAdmin')
$$;

/** The signed-in person translates this language. */
create or replace function public.translates(p_lang text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select p_lang = any (pr.translator_langs) from public.profiles pr
                    where pr.id = auth.uid() and pr.deactivated_at is null), false)
$$;

create or replace function public.can_edit_translations(p_lang text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.translation_admin() or public.translates(p_lang)
$$;

drop policy if exists translations_read on public.translations;
create policy translations_read on public.translations for select to authenticated
  using (status = 'approved' or public.can_edit_translations(lang));
revoke all on public.translations from public, anon;
grant select on public.translations to authenticated;

/** Every {name} in the English must stay in the translation. */
create or replace function public.translation_keeps_placeholders(p_key text, p_text text)
returns boolean language sql immutable set search_path to 'public' as $$
  select not exists (
    select 1 from regexp_matches(split_part(p_key, chr(4), case when position(chr(4) in p_key) > 0 then 2 else 1 end),
                                 '\{([a-zA-Z][a-zA-Z0-9_]*)\}', 'g') as m
     where position('{' || m[1] || '}' in p_text) = 0)
$$;

/** The language a person sees the screens in. */
create or replace function public.set_my_language(p_lang text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_lang is not null and p_lang not in ('en', 'zu', 'xh', 'af', 'nso', 'tn', 'st', 'ts', 'ss', 've', 'nr') then
    raise exception 'That language is not offered' using errcode = '22023';
  end if;
  update public.profiles set language = nullif(p_lang, 'en') where id = auth.uid();
end $$;

/** Who translates which language: set by an administrator, for someone in their organisation. */
create or replace function public.set_translator_langs(p_user uuid, p_langs text[])
returns public.profiles language plpgsql security definer set search_path to 'public' as $$
declare
  v_target public.profiles;
  v_langs  text[];
  v_name   text;
begin
  perform public.require_role('SuperAdmin', 'SystemAdmin');
  select * into v_target from public.profiles where id = p_user;
  if not found or (v_target.tenant_id is distinct from public.current_tenant() and not public.role_in('SuperAdmin')) then
    raise exception 'No such person in your organisation' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(distinct l order by l), '{}') into v_langs from unnest(coalesce(p_langs, '{}')) l;
  if not v_langs <@ array['zu', 'xh', 'af', 'nso', 'tn', 'st', 'ts', 'ss', 've', 'nr']::text[] then
    raise exception 'That language is not offered' using errcode = '22023';
  end if;
  update public.profiles set translator_langs = v_langs where id = p_user returning * into v_target;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_target.silo, auth.uid(), v_name, v_target.silo::text, 'TRANSLATOR_SET', 'profiles', p_user::text,
    format('%s translates: %s', coalesce(v_target.full_name, 'a person'),
      coalesce(nullif(array_to_string(v_langs, ', '), ''), 'no languages')));
  return v_target;
end $$;

/**
 * Save one translation. A translator for the language may approve it (or
 * take an approval back by saving it as a draft); an administrator may only
 * draft, and never over an approved one.
 */
create or replace function public.save_translation(p_key text, p_lang text, p_text text, p_approve boolean default false)
returns public.translations language plpgsql security definer set search_path to 'public' as $$
declare
  v_row  public.translations;
  v_old  public.translations;
  v_name text;
  v_text text := btrim(coalesce(p_text, ''));
  v_was_approved boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_lang is null or p_lang not in ('zu', 'xh', 'af', 'nso', 'tn', 'st', 'ts', 'ss', 've', 'nr') then
    raise exception 'That language is not offered' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_key, '')), '') is null or length(p_key) > 600 then
    raise exception 'Which sentence?' using errcode = '22023';
  end if;
  if v_text = '' then raise exception 'Write the translation' using errcode = '22023'; end if;
  if length(v_text) > 2000 then raise exception 'The translation is too long' using errcode = '22023'; end if;
  if not public.translation_keeps_placeholders(p_key, v_text) then
    raise exception 'Keep every {name} from the English in the translation' using errcode = '22023';
  end if;

  if p_approve and not public.translates(p_lang) then
    raise exception 'Only a translator for this language approves it' using errcode = '42501';
  end if;
  if not public.can_edit_translations(p_lang) then
    raise exception 'Only translators and administrators change translations' using errcode = '42501';
  end if;
  select * into v_old from public.translations where key = p_key and lang = p_lang for update;
  v_was_approved := found and v_old.status = 'approved';
  if v_was_approved and not public.translates(p_lang) then
    raise exception 'Only a translator for this language changes an approved translation' using errcode = '42501';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.translations as t (key, lang, text, status, drafted_by, updated_by, updated_by_name, updated_at,
                                        approved_by, approved_by_name, approved_at)
  values (p_key, p_lang, v_text, case when p_approve then 'approved' else 'draft' end, 'person', auth.uid(), v_name, now(),
          case when p_approve then auth.uid() end, case when p_approve then v_name end, case when p_approve then now() end)
  on conflict (key, lang) do update
     set text = excluded.text, status = excluded.status, drafted_by = 'person',
         updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now(),
         approved_by = excluded.approved_by, approved_by_name = excluded.approved_by_name, approved_at = excluded.approved_at
  returning * into v_row;

  if p_approve or v_was_approved then
    insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
    values (public.current_silo(), auth.uid(), v_name, public.current_silo()::text,
      case when p_approve then 'TRANSLATION_APPROVED' else 'TRANSLATION_WITHDRAWN' end, 'translations',
      left(p_lang || ':' || p_key, 300), left(v_text, 300));
  end if;
  return v_row;
end $$;

/**
 * Drafts from Criti for one language: [{key, text}]. A sentence that already
 * has a person's draft or an approved translation is left as it is; one that
 * loses a {name} is skipped. Returns how many were saved.
 */
create or replace function public.save_translation_drafts(p_lang text, p_rows jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  r      jsonb;
  v_key  text;
  v_text text;
  v_name text;
  v_n    integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_lang is null or p_lang not in ('zu', 'xh', 'af', 'nso', 'tn', 'st', 'ts', 'ss', 've', 'nr') then
    raise exception 'That language is not offered' using errcode = '22023';
  end if;
  if not public.can_edit_translations(p_lang) then
    raise exception 'Only translators and administrators change translations' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 200 then
    raise exception 'Send at most 200 drafts at a time' using errcode = '22023';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_key := r ->> 'key';
    v_text := btrim(coalesce(r ->> 'text', ''));
    continue when v_key is null or length(v_key) > 600 or v_text = '' or length(v_text) > 2000;
    continue when not public.translation_keeps_placeholders(v_key, v_text);
    insert into public.translations as t (key, lang, text, status, drafted_by, updated_by, updated_by_name, updated_at)
    values (v_key, p_lang, v_text, 'draft', 'criti', auth.uid(), v_name, now())
    on conflict (key, lang) do update
       set text = excluded.text, updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now()
     where t.status = 'draft' and t.drafted_by = 'criti';
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

revoke all on function public.translation_admin() from public, anon;
revoke all on function public.translates(text) from public, anon;
revoke all on function public.can_edit_translations(text) from public, anon;
revoke all on function public.translation_keeps_placeholders(text, text) from public, anon;
revoke all on function public.set_my_language(text) from public, anon;
revoke all on function public.set_translator_langs(uuid, text[]) from public, anon;
revoke all on function public.save_translation(text, text, text, boolean) from public, anon;
revoke all on function public.save_translation_drafts(text, jsonb) from public, anon;
grant execute on function public.translation_admin() to authenticated, service_role;
grant execute on function public.translates(text) to authenticated, service_role;
grant execute on function public.can_edit_translations(text) to authenticated, service_role;
grant execute on function public.translation_keeps_placeholders(text, text) to authenticated, service_role;
grant execute on function public.set_my_language(text) to authenticated, service_role;
grant execute on function public.set_translator_langs(uuid, text[]) to authenticated, service_role;
grant execute on function public.save_translation(text, text, text, boolean) to authenticated, service_role;
grant execute on function public.save_translation_drafts(text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
