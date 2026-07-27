/**
 * Zod schemas mirroring DB tables. Used by web + mobile forms via react-hook-form.
 */

import { z } from 'zod';

export const siloEnum = z.enum([
  'Ethekwini',
  'MetroPolice',
  'MetroFire',
  'Medical',
  'EthekwiniDisaster',
]);

export const severityEnum = z.enum(['Low', 'Medium', 'High', 'Critical']);

export const statusEnum = z.enum([
  'New', 'Pending', 'Pending Dispatch', 'Pending Analysis',
  'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active',
  'Closed', 'Resolved',
]);

/** Incoming-call form (ControlRoomController.LogNew). */
export const logIncomingCallSchema = z.object({
  silo: siloEnum,
  caller_name: z.string().min(1, 'Caller name is required').max(100),
  caller_number: z.string().min(1, 'Caller number is required').max(15),
  call_description: z.string().min(1, 'Description is required').max(500),
  incident_type: z.string().min(1).max(100),
  incident_severity: severityEnum,
  location_address: z.string().min(1).max(200),
  location_lat: z.number().min(-90).max(90),
  location_lng: z.number().min(-180).max(180),
  suburb: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  fire_incident_type: z.string().optional().nullable(),
  medical_type: z.string().optional().nullable(),
  disaster_type: z.string().optional().nullable(),
  is_caller_patient: z.boolean().optional().nullable(),
  patient_name: z.string().optional().nullable(),
  number_of_victims: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type LogIncomingCallInput = z.infer<typeof logIncomingCallSchema>;

/** Dispatch form (DispatchController.Create POST). */
export const dispatchUnitSchema = z.object({
  incident_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  unit_type: z.string().min(1),
  target_silos: z.array(siloEnum).min(1),
});
export type DispatchUnitInput = z.infer<typeof dispatchUnitSchema>;

/** Status flip (ResponderController.UpdateStatus). */
export const updateResponderStatusSchema = z.object({
  incident_id: z.string().uuid(),
  status: statusEnum,
});
export type UpdateResponderStatusInput = z.infer<typeof updateResponderStatusSchema>;

/** Mental check (ShiftController.SubmitMentalCheck). */
export const mentalCheckSchema = z.object({
  memory_recall: z.boolean(),
  judgment: z.boolean(),
  situational_awareness: z.boolean(),
  not_under_influence: z.boolean(),
  anger_check: z.boolean(),
  reflexes: z.boolean(),
  comments: z.string().optional().default(''),
});
export type MentalCheckInput = z.infer<typeof mentalCheckSchema>;

/** Vehicle checklist (ShiftController.SubmitVehicleChecklist). */
export const vehicleChecklistSchema = z.object({
  apparatus_id: z.string().uuid(),
  fuel_level: z.enum(['1/4', '1/2', '3/4', 'Full']),
  lights_functional: z.boolean(),
  tires_condition_ok: z.boolean(),
  equipment_stocked: z.boolean(),
  comms_working: z.boolean(),
  brakes_responsive: z.boolean(),
});
export type VehicleChecklistInput = z.infer<typeof vehicleChecklistSchema>;

/** Citizen GPS update (CitizenController.SaveLocation). */
export const citizenLocationSchema = z.object({
  token: z.string().min(8),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type CitizenLocationInput = z.infer<typeof citizenLocationSchema>;
