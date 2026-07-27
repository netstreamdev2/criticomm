-- =====================================================================
-- Role alignment with V4: DbInitializer seeds a "Responder" role and
-- HR/Leave areas authorize a "Staff" role — both were missing from the
-- V5 user_role enum.
-- =====================================================================
alter type user_role add value if not exists 'Responder';
alter type user_role add value if not exists 'Staff';
