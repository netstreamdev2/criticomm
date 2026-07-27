import type { CriticomClient, Silo } from '@criticom/db';
import type { MentalCheckInput, VehicleChecklistInput } from '@criticom/db/schemas';

/** ShiftController.HasCompletedShiftStartTodayAsync */
export async function hasCompletedShiftStartToday(client: CriticomClient) {
  const { data, error } = await client.rpc('has_completed_shift_start_today');
  if (error) throw error;
  return Boolean(data);
}

/** ShiftController.SubmitMentalCheck */
export async function submitMentalCheck(
  client: CriticomClient,
  args: MentalCheckInput & { silo: Silo },
) {
  const { data, error } = await client
    .from('mental_checks')
    .insert({
      silo: args.silo,
      memory_recall: args.memory_recall,
      judgment: args.judgment,
      situational_awareness: args.situational_awareness,
      not_under_influence: args.not_under_influence,
      anger_check: args.anger_check,
      reflexes: args.reflexes,
      comments: args.comments ?? '',
    })
    .select()
    .single();
  if (error) throw error;

  const passed =
    args.memory_recall &&
    args.judgment &&
    args.situational_awareness &&
    args.not_under_influence &&
    args.anger_check &&
    args.reflexes;
  return { check: data, passed };
}

/** ShiftController.VehicleSelection — list of available vehicles in my silo */
export async function listAvailableVehicles(client: CriticomClient, silo: Silo) {
  const { data, error } = await client
    .from('apparatus')
    .select('*')
    .eq('silo', silo)
    .eq('status', 'Available')
    .order('unit_number');
  if (error) throw error;
  return data ?? [];
}

/** ShiftController.AssignVehicle */
export async function assignVehicle(client: CriticomClient, apparatusId: string) {
  const { data, error } = await client.rpc('assign_vehicle', { p_apparatus_id: apparatusId });
  if (error) throw error;
  return data;
}

/** ShiftController.UnitCompliance — today's mental checks + vehicle checklists */
export async function getUnitCompliance(client: CriticomClient, silo?: Silo) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const iso = todayStart.toISOString();

  let mc = client.from('mental_checks').select('*').gte('timestamp', iso)
    .order('timestamp', { ascending: false });
  let vc = client.from('vehicle_checklists')
    .select('*, apparatus:apparatus_id (unit_number, name)')
    .gte('checked_at', iso)
    .order('checked_at', { ascending: false });
  if (silo) {
    mc = mc.eq('silo', silo);
    vc = vc.eq('silo', silo);
  }
  const [mcRes, vcRes] = await Promise.all([mc, vc]);
  if (mcRes.error) throw mcRes.error;
  if (vcRes.error) throw vcRes.error;
  return { mentalChecks: mcRes.data ?? [], vehicleChecklists: vcRes.data ?? [] };
}

/** ShiftController.SubmitVehicleChecklist */
export async function submitVehicleChecklist(
  client: CriticomClient,
  args: VehicleChecklistInput & { silo: Silo },
) {
  const { data, error } = await client
    .from('vehicle_checklists')
    .insert({
      silo: args.silo,
      apparatus_id: args.apparatus_id,
      fuel_level: args.fuel_level,
      lights_functional: args.lights_functional,
      tires_condition_ok: args.tires_condition_ok,
      equipment_stocked: args.equipment_stocked,
      comms_working: args.comms_working,
      brakes_responsive: args.brakes_responsive,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
