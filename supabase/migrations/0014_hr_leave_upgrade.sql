-- =====================================================================
-- CRITICOMM V5 — 0014
--   Leave approval trail, HR hot-path indexes, leave entitlements
-- =====================================================================

-- ── APPROVAL TRAIL ───────────────────────────────────────────────────
-- Who granted what, when, and why the member asked — the three questions
-- every HR dispute turns on.
alter table public.leave_entries add column if not exists reason      text;
alter table public.leave_entries add column if not exists approved_by text;
alter table public.leave_entries add column if not exists approved_at timestamptz;

-- ── INDEXES ──────────────────────────────────────────────────────────
-- Balances read per user; calendars and coverage read per window; the HR
-- hub reads pending approvals per silo.
create index if not exists leave_entries_user_idx
  on public.leave_entries (user_id, eff_from desc);
create index if not exists leave_entries_silo_status_idx
  on public.leave_entries (silo, status);
create index if not exists leave_entries_window_idx
  on public.leave_entries (eff_from, eff_to);
create index if not exists rosters_silo_created_idx
  on public.rosters (silo, created_at desc);
create index if not exists certifications_expiry_idx
  on public.certifications (expiry_date);

-- ── ENTITLEMENTS ─────────────────────────────────────────────────────
-- Annual entitlement days per leave type, kept on the LeaveType config row
-- (detail3) so HR tunes them from Admin → Configuration. Values follow the
-- BCEA/public-service defaults; only null rows are touched so an admin's
-- existing customisation is never overwritten.
update public.command_records set detail3 = v.days
from (values
  ('Annual',                '22'),
  ('Sick',                  '30'),
  ('Family Responsibility', '3'),
  ('Maternity/Paternity',   '120'),
  ('Study',                 '5'),
  ('Special',               '5'),
  ('Unpaid',                '0')
) as v(name, days)
where command_records.module = 'LeaveType'
  and command_records.name = v.name
  and command_records.detail3 is null;
