-- =====================================================================
-- CRITICOMM V5 — 0017
-- Department branding: each silo carries its own identity — official name,
-- colours and crest — so a Metro Police screen looks like Metro Police.
--
-- Logos are UPLOADED by administrators (Admin → Departments) rather than
-- shipped with the app: these are official municipal and service insignia,
-- and the municipality owns them. Until one is uploaded the UI renders a
-- monogram badge in the department's colours, so nothing ever looks broken.
-- =====================================================================

create table if not exists public.department_branding (
  silo          silo primary key,
  official_name text not null,
  short_name    text not null,
  -- Monogram shown when no logo has been uploaded (e.g. "MP", "F&R").
  monogram      text not null,
  -- Hex, used for the badge, accents and PDF headers.
  primary_color text not null default '#3b82f6',
  accent_color  text not null default '#1d4ed8',
  -- Path inside the `department-logos` bucket; null ⇒ monogram fallback.
  logo_path     text,
  motto         text,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

alter table public.department_branding enable row level security;

-- Every signed-in user reads branding (it drives the chrome everywhere);
-- only the admin tier changes it.
create policy department_branding_read on public.department_branding for select
  using (auth.role() = 'authenticated');

create policy department_branding_write on public.department_branding for all
  using (public.role_in('Admin','SystemAdmin','SuperAdmin'))
  with check (public.role_in('Admin','SystemAdmin','SuperAdmin'));

-- Branding changes should reach open screens without a redeploy.
alter publication supabase_realtime add table public.department_branding;

-- ── SEED ─────────────────────────────────────────────────────────────
-- Colours follow each service's operational convention: police blue,
-- fire red, EMS green, disaster amber, control-room slate.
insert into public.department_branding
  (silo, official_name, short_name, monogram, primary_color, accent_color, motto)
values
  ('Ethekwini',         'eThekwini Emergency Services',            'Control Room',  'ES',  '#64748b', '#334155',
   'Unified command for the metro'),
  ('MetroPolice',       'eThekwini Metropolitan Police Service',   'Metro Police',  'MP',  '#3b82f6', '#1d4ed8',
   'Serve and protect'),
  ('MetroFire',         'eThekwini Fire & Emergency Services',     'Fire & Rescue', 'F&R', '#dc3545', '#991b1b',
   'Courage under fire'),
  ('Medical',           'eThekwini Emergency Medical Services',    'EMS',           'EMS', '#10b981', '#047857',
   'Every second counts'),
  ('EthekwiniDisaster', 'eThekwini Disaster Management Centre',    'Disaster Mgmt', 'DM',  '#f59e0b', '#b45309',
   'Prepared for the worst')
on conflict (silo) do nothing;

-- ── STORAGE ──────────────────────────────────────────────────────────
-- Public read: the badge renders in the app shell on every page, and for
-- unauthenticated surfaces like the citizen GPS-share page.
insert into storage.buckets (id, name, public) values
  ('department-logos', 'department-logos', true)
on conflict (id) do nothing;

create policy dept_logos_public_read on storage.objects for select
  using (bucket_id = 'department-logos');

create policy dept_logos_admin_write on storage.objects for insert
  with check (bucket_id = 'department-logos' and public.role_in('Admin','SystemAdmin','SuperAdmin'));

create policy dept_logos_admin_update on storage.objects for update
  using (bucket_id = 'department-logos' and public.role_in('Admin','SystemAdmin','SuperAdmin'));

create policy dept_logos_admin_delete on storage.objects for delete
  using (bucket_id = 'department-logos' and public.role_in('Admin','SystemAdmin','SuperAdmin'));
