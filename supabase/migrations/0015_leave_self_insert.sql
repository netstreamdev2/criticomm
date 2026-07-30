-- =====================================================================
-- CRITICOMM V5 — 0015
-- Members file their own leave.
--
-- 0002 only gave leave_entries writes to the supervisory tier, which meant
-- an ordinary responder or dispatcher could not submit the "Apply for leave"
-- form at all. A member may insert a request FOR THEMSELVES and only in the
-- Pending state — decisions stay with the supervisory tier's existing policy.
-- =====================================================================

create policy leave_self_insert on public.leave_entries for insert
  with check (user_id = auth.uid() and status = 'Pending');
