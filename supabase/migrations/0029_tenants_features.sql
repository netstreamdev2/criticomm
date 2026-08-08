-- ============================================================================
-- 0029 — Tenants and feature flags
-- ============================================================================
--
-- Criticomm becomes multi-tenant: one deployment, many organisations, each
-- with its own departments, users, incidents and configuration. eThekwini
-- becomes the first tenant rather than the assumption baked into every row.
--
-- The identity mechanism mirrors the one that already works for silos: the
-- tenant rides in JWT app metadata, a helper reads it, and the database —
-- never the application — enforces the boundary. `current_tenant()` falls
-- back to the founding tenant for sessions minted before this migration, so
-- nobody is locked out mid-shift by their own upgrade.
--
-- Feature flags live here too because they are per-tenant state: what is
-- switched on for one municipality is not a statement about another. The
-- catalogue of what CAN be toggled lives in code (packages/api/src/features);
-- this table stores only the deviations a SuperAdmin has chosen.
-- ============================================================================

-- ── Tenants ─────────────────────────────────────────────────────────────────

create table if not exists public.tenants (
  id         uuid primary key default uuid_generate_v4(),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  name       text not null,
  active     boolean not null default true,
  /** Free-form per-tenant metadata: region, contacts, contract notes. */
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tenants is
  'One row per organisation on the platform. Every operational table carries tenant_id (0030).';

insert into public.tenants (slug, name)
values ('ethekwini', 'eThekwini Municipality')
on conflict (slug) do nothing;

-- ── The tenant of the current session ───────────────────────────────────────

/**
 * STABLE so a query evaluates it once, and falls back to the founding tenant
 * for JWTs minted before tenancy existed. The fallback is what makes this
 * migration deployable against a live service: every existing session keeps
 * resolving to the data it could already see.
 *
 * SECURITY DEFINER is load-bearing, not a convenience: the fallback reads
 * `tenants`, and the RLS policy on `tenants` calls this function. As INVOKER
 * that is infinite recursion — policy → function → table → policy. DEFINER
 * makes the internal read bypass RLS and breaks the cycle; the JWT it reads
 * is still the caller's.
 */
create or replace function public.current_tenant()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid,
    (select id from public.tenants where slug = 'ethekwini')
  );
$$;

comment on function public.current_tenant() is
  'Tenant id from JWT app metadata, defaulting to the founding tenant for pre-tenancy sessions.';


alter table public.tenants enable row level security;

-- Everyone signed in may see their own tenant's row (name, branding context);
-- only the platform tier sees the register.
drop policy if exists tenants_read on public.tenants;
create policy tenants_read on public.tenants for select
  using (
    id = public.current_tenant()
    or public.role_in('SuperAdmin','SystemAdmin')
  );

drop policy if exists tenants_write on public.tenants;
create policy tenants_write on public.tenants for all
  using (public.role_in('SuperAdmin'))
  with check (public.role_in('SuperAdmin'));

-- Stamp every existing account with the founding tenant so future JWTs carry
-- it explicitly rather than leaning on the fallback forever.
update auth.users
   set raw_app_meta_data =
     coalesce(raw_app_meta_data, '{}'::jsonb)
     || jsonb_build_object('tenant_id', (select id::text from public.tenants where slug = 'ethekwini'))
 where raw_app_meta_data ->> 'tenant_id' is null;

-- ── Feature flags ───────────────────────────────────────────────────────────

create table if not exists public.feature_flags (
  tenant_id  uuid not null default public.current_tenant() references public.tenants (id) on delete cascade,
  key        text not null,
  enabled    boolean not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

comment on table public.feature_flags is
  'Per-tenant feature switches. Only deviations from the code catalogue''s defaults are stored.';

alter table public.feature_flags enable row level security;

-- Every signed-in user reads their tenant's flags — the clients need them to
-- decide what to render. Only a SuperAdmin writes them.
drop policy if exists feature_flags_read on public.feature_flags;
create policy feature_flags_read on public.feature_flags for select
  using (tenant_id = public.current_tenant());

drop policy if exists feature_flags_write on public.feature_flags;
create policy feature_flags_write on public.feature_flags for all
  using (public.role_in('SuperAdmin') and tenant_id = public.current_tenant())
  with check (public.role_in('SuperAdmin') and tenant_id = public.current_tenant());

-- Clients subscribe so a toggle lands without a reload.
do $$ begin
  alter publication supabase_realtime add table public.feature_flags;
exception when duplicate_object then null; end $$;
