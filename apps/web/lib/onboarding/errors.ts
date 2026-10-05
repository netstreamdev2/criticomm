/**
 * A database error from the invitation and staff-register screens, in words
 * an administrator can act on. PostgREST reports a missing table (PGRST205),
 * function (PGRST202) or column (42703) when a migration has not been run on
 * this database yet.
 */
export function invitationErrorMessage(e: unknown, fallback = 'That did not work. Try again.'): string {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === 'PGRST202' || err?.code === 'PGRST205' || err?.code === '42703') {
    if (/asset_import|shift_end|end_shift|firearm_status|receive_firearm|return_shift_firearm|vehicle_status|import_firearms|import_vehicles|status_note|last_inspection|firearms\.station|can_manage_(armoury|fleet)/i.test(err.message ?? '')) {
      return 'The armoury and fleet are not set up in this database yet: run migration 0051_armoury_fleet_end_of_shift.sql in Supabase, then try again.';
    }
    const register = /staff_import|personnel|register|work_email|proposed_role|left_at/i.test(err.message ?? '');
    return register
      ? 'The staff register is not set up in this database yet: run migration 0050_staff_register_import.sql in Supabase, then try again.'
      : 'Invitations are not set up in this database yet: run migration 0049_account_invitations.sql in Supabase, then try again.';
  }
  return err?.message || fallback;
}
