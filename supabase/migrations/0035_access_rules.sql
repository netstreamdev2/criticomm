-- 0035 — Per-tenant, per-role module access rules
--
-- The SuperAdmin decides what each tenant's portal offers: hide a module for
-- the whole organisation, or deny it to specific roles. Rules are a
-- **deny-only overlay** — a row can remove access that the code's route
-- matrix grants, but nothing stored here can ever grant access the matrix
-- refuses. Three gates compose with AND:
--
--   feature flags   is the capability available to this tenant at all?
--   route matrix    may this role open this route? (code, not data)
--   access rules    has the SuperAdmin hidden it for this tenant/role?
--
-- role = '*' applies to every role — that is the "module visibility" switch
-- the command launcher and the sidebar honour tenant-wide.

create table if not exists public.access_rules (
  tenant_id  uuid not null default public.current_tenant(),
  href       text not null check (href ~ '^/[a-z0-9/\-]*$'),
  role       text not null default '*',
  allowed    boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, href, role)
);
alter table public.access_rules enable row level security;

-- Everyone reads their tenant's rules (the sidebar and middleware need them);
-- only the SuperAdmin writes. Cross-tenant administration goes through the
-- service role in the Access Control console, exactly like tenant admin.
create policy access_rules_read on public.access_rules for select to authenticated using (true);
create policy access_rules_write on public.access_rules for all to authenticated
  using (public.role_in('SuperAdmin') and tenant_id = public.current_tenant())
  with check (public.role_in('SuperAdmin') and tenant_id = public.current_tenant());

-- Tenant isolation, same RESTRICTIVE shape as everything else.
create index if not exists access_rules_tenant_idx on public.access_rules (tenant_id);
drop policy if exists tenant_isolation on public.access_rules;
create policy tenant_isolation on public.access_rules as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- Live updates: a SuperAdmin toggle should reshape open consoles without a
-- sign-out, the same way feature flags do.
alter publication supabase_realtime add table public.access_rules;
