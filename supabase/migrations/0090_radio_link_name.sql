-- ============================================================================
-- 0090 — The quick link to the Radio Desk is called RADIO
-- ============================================================================
--
-- Run after 0089.
--
-- 0013 brought V4's quick links across, one of them "REAL PTT", which opens
-- the Radio Desk (/dispatch/ptt). RealPTT is gone (0087) and screens do not
-- name platforms, so the link is simply RADIO. Only the name changes.
--
-- Safe to re-run.
-- ============================================================================

update public.command_records
   set name = 'RADIO'
 where module = 'OpsLink' and name = 'REAL PTT' and detail1 = '/dispatch/ptt';
