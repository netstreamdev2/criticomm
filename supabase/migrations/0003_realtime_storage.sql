-- =====================================================================
-- Criticom V5 — Realtime publication + Storage buckets + Storage RLS
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- REALTIME — tables whose row-level changes are pushed to clients
-- ─────────────────────────────────────────────────────────────────────
-- Drop default publication and recreate scoped
drop publication if exists supabase_realtime;
create publication supabase_realtime;

alter publication supabase_realtime add table public.incidents;
alter publication supabase_realtime add table public.incident_updates;
alter publication supabase_realtime add table public.incident_attachments;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.personnel;
alter publication supabase_realtime add table public.rosters;
alter publication supabase_realtime add table public.shifts;
alter publication supabase_realtime add table public.disaster_logs;

-- ─────────────────────────────────────────────────────────────────────
-- STORAGE BUCKETS
-- ─────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values
  ('avatars',              'avatars',              true),
  ('incident-media',       'incident-media',       false),
  ('incident-attachments', 'incident-attachments', false),
  ('certifications',       'certifications',       false),
  ('pdf-exports',          'pdf-exports',          false)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────
-- STORAGE RLS — storage.objects
-- ─────────────────────────────────────────────────────────────────────

-- AVATARS: public read, self-write
create policy avatars_public_read on storage.objects for select using (bucket_id = 'avatars');
create policy avatars_self_write on storage.objects for insert with check (
  bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1]
);
create policy avatars_self_update on storage.objects for update using (
  bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1]
);
create policy avatars_self_delete on storage.objects for delete using (
  bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1]
);

-- INCIDENT MEDIA: authenticated users, silo-scoped via path convention
-- Path convention: {silo}/{incident_id}/{kind}/{filename}
-- e.g. MetroPolice/abcd-…-1234/image/photo1.jpg
create policy incident_media_read on storage.objects for select using (
  bucket_id = 'incident-media'
  and (
    public.is_global()
    or public.current_silo()::text = (storage.foldername(name))[1]
  )
);
create policy incident_media_insert on storage.objects for insert with check (
  bucket_id = 'incident-media'
  and auth.uid() is not null
  and (
    public.is_global()
    or public.current_silo()::text = (storage.foldername(name))[1]
  )
);
create policy incident_media_delete on storage.objects for delete using (
  bucket_id = 'incident-media'
  and (public.role_in('Supervisor','SystemAdmin','SuperAdmin') or public.is_global())
);

-- INCIDENT ATTACHMENTS: same shape as incident-media (for signed-URL flows)
create policy incident_attachments_read on storage.objects for select using (
  bucket_id = 'incident-attachments'
  and (public.is_global() or public.current_silo()::text = (storage.foldername(name))[1])
);
create policy incident_attachments_insert on storage.objects for insert with check (
  bucket_id = 'incident-attachments'
  and auth.uid() is not null
  and (public.is_global() or public.current_silo()::text = (storage.foldername(name))[1])
);

-- CERTIFICATIONS: personnel-self + their supervisors
-- Path convention: {silo}/{personnel_id}/{filename}
create policy certifications_read on storage.objects for select using (
  bucket_id = 'certifications'
  and (
    public.is_global()
    or public.role_in('Supervisor','FireChief','Chief','Captain','SystemAdmin','SuperAdmin','Admin')
    or (
      public.current_silo()::text = (storage.foldername(name))[1]
      and exists (
        select 1 from public.personnel p
        where p.id::text = (storage.foldername(name))[2]
          and p.user_id = auth.uid()
      )
    )
  )
);
create policy certifications_write on storage.objects for insert with check (
  bucket_id = 'certifications'
  and public.role_in('Supervisor','FireChief','Chief','Captain','SystemAdmin','SuperAdmin','Admin','Officer','Police','Firefighter','Paramedic')
);

-- PDF-EXPORTS: read by silo, write by service role only (Edge Functions)
create policy pdf_exports_read on storage.objects for select using (
  bucket_id = 'pdf-exports'
  and (public.is_global() or public.current_silo()::text = (storage.foldername(name))[1])
);
-- (No insert policy → service role only)

-- ─────────────────────────────────────────────────────────────────────
-- REALTIME RLS NOTE
-- ─────────────────────────────────────────────────────────────────────
-- The RLS policies on the public.* tables defined in 0002_rls.sql are
-- automatically honored by Realtime's "postgres_changes" subscriptions —
-- a client only sees row events for rows they could SELECT. No extra config.
