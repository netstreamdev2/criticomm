-- ============================================================================
-- 0030 — Tenant isolation on every operational table
-- ============================================================================
--
-- Mechanism, and why this exact shape:
--
--   • `tenant_id uuid not null default public.current_tenant()`. The default
--     is the whole trick: every INSERT the application already performs picks
--     up the session's tenant with no application change, and the ALTER's
--     table rewrite stamps every existing row with the founding tenant
--     (current_tenant() with no JWT resolves to the fallback).
--
--   • One RESTRICTIVE policy per table. Postgres ORs permissive policies
--     together, so adding tenancy as another permissive policy would WIDEN
--     access — the opposite of isolation. A restrictive policy is ANDed with
--     everything else: whatever a silo policy grants, the row must still
--     belong to the caller's tenant. The existing per-table policies did not
--     change and did not need to.
--
--   • service_role and SECURITY DEFINER functions bypass RLS entirely, which
--     is why 0031 exists: each privileged function carries its own tenant
--     guard.
--
-- Deliberately excluded: `automation_*` and `rate_limit_buckets` (platform
-- internals — rules are engine-owned, limits are user-keyed), `crime_stats`
-- (shared national SAPS reference data), `alert_reads` (a join table already
-- scoped to auth.uid(), and its parent alert is tenant-scoped).
-- ============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'system_profiles', 'personnel', 'reporting_lines',
    'incidents', 'incident_updates', 'incident_attachments',
    'incident_number_counters', 'citizen_share_tokens',
    'apparatus', 'devices', 'cameras', 'hydrants',
    'metro_reports', 'metro_offenses', 'firearm_authorizations',
    'security_reports',
    'firefighter_reports', 'public_incident_reports',
    'paramedic_reports', 'medical_histories', 'assessment_findings',
    'vital_signs', 'interventions', 'legal_handovers', 'ambulance_restocks',
    'disaster_logs', 'post_mortem_reports', 'relief_stocks',
    'mutual_aid_partners',
    'shifts', 'rosters', 'duty_posts', 'endorsements',
    'mental_checks', 'vehicle_checklists',
    'leave_entries', 'training_records', 'certifications',
    'performance_kpis', 'performance_plans', 'performance_scores',
    'alerts', 'notifications', 'push_tokens',
    'command_records', 'app_settings', 'integration_settings',
    'department_branding', 'report_definitions',
    'audit_logs'
  ];
begin
  foreach t in array tables loop
    execute format(
      'alter table public.%I add column if not exists tenant_id uuid not null default public.current_tenant()',
      t
    );
    execute format(
      'create index if not exists %I on public.%I (tenant_id)',
      t || '_tenant_idx', t
    );
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all to authenticated '
      || 'using (tenant_id = public.current_tenant()) '
      || 'with check (tenant_id = public.current_tenant())',
      t
    );
  end loop;
end $$;

-- ── Uniqueness that was implicitly per-deployment becomes per-tenant ────────

-- Incident numbers: unique per silo per day WITHIN a tenant. Two
-- municipalities may both hold INC-20260804-0001.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.incidents'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) like '%silo%incident_number%';
  if c is not null then
    execute format('alter table public.incidents drop constraint %I', c);
  end if;
end $$;
create unique index if not exists incidents_tenant_silo_number_key
  on public.incidents (tenant_id, silo, incident_number);

-- Call signs collide only within an organisation.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.profiles'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) like '%call_sign%';
  if c is not null then
    execute format('alter table public.profiles drop constraint %I', c);
  end if;
end $$;
create unique index if not exists profiles_tenant_call_sign_key
  on public.profiles (tenant_id, call_sign) where call_sign is not null;

-- Keyed configuration tables: the key is now per tenant. The application's
-- upserts name the conflict target explicitly, so those are updated in step
-- with this migration (settings, branding).
alter table public.app_settings drop constraint if exists app_settings_pkey;
alter table public.app_settings add primary key (tenant_id, key);

alter table public.integration_settings drop constraint if exists integration_settings_pkey;
alter table public.integration_settings add primary key (tenant_id, key);

alter table public.department_branding drop constraint if exists department_branding_pkey;
alter table public.department_branding add primary key (tenant_id, silo);

-- The incident-number counter serialises per tenant per silo per day.
alter table public.incident_number_counters
  drop constraint if exists incident_number_counters_pkey;
alter table public.incident_number_counters add primary key (tenant_id, silo, day);
