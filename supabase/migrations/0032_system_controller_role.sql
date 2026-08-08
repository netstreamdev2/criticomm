-- 0032 — The SystemController role
--
-- A command-and-reporting seat: sees every module and every silo, runs the
-- command dashboard, but is not a SuperAdmin — it cannot toggle features or
-- administer tenants.
--
-- This file contains ONLY the enum addition. Postgres allows ALTER TYPE …
-- ADD VALUE inside a transaction, but forbids USING the new value in the same
-- transaction — so every policy and function that references
-- 'SystemController' lives in 0033, which runs as its own transaction.

alter type user_role add value if not exists 'SystemController';
