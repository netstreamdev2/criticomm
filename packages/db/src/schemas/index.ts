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

/** E.164: + then the country code and number, 8 to 15 digits (0062). */
const E164 = /^\+[1-9]\d{7,14}$/;
const NUMBER_RULE = 'Enter the caller number with its country code, e.g. +27 82 123 4567';
const DESKS_RULE = 'Choose the department this call is for: Police, Fire & Rescue, EMS or Disaster Management';
/** The injuries the call taker ticked (0076). */
const injuriesList = z.array(z.string().min(1).max(60)).max(12);

/** Incoming-call form (ControlRoomController.LogNew). */
const logIncomingCallObject = z.object({
  silo: siloEnum,
  caller_name: z.string().min(1, 'Caller name is required').max(100),
  /** E.164: + then the country code and number, 8 to 15 digits (0062). */
  caller_number: z.string().regex(E164, NUMBER_RULE),
  call_description: z.string().min(1, 'Description is required').max(2000),
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
  /** Asked only on a medical call (0076): EMS is among the departments. */
  is_caller_patient: z.boolean().nullable().optional(),
  patient_name: z.string().optional().nullable(),
  number_of_victims: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
  /** The category group the 10-code belongs to. */
  incident_category: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  /**
   * The dispatch desks this call goes to (0068): only those departments'
   * dispatchers receive it. At least one, never the control room itself.
   */
  tagged_silos: z.array(siloEnum.exclude(['Ethekwini'])).min(1, DESKS_RULE),
  injuries: injuriesList.optional().nullable(),
  /** Made once per call on the form, so a second press never logs it twice. */
  client_ref: z.string().uuid().optional().nullable(),
});

export const logIncomingCallSchema = logIncomingCallObject.refine(
  (v) => !v.tagged_silos.includes('Medical') || typeof v.is_caller_patient === 'boolean',
  { message: 'Say whether the caller is the patient', path: ['is_caller_patient'] },
);

export type LogIncomingCallInput = z.infer<typeof logIncomingCallSchema>;

/**
 * Sending an urgent call to dispatch before the form is complete (0076): the
 * type, the place on the map, at least one department, and High or Critical.
 * Whatever is already known goes with it; the rest follows on the same call.
 */
export const sendCallEarlySchema = z.object({
  silo: siloEnum,
  incident_type: z.string().min(1, 'Choose the incident type').max(100),
  incident_category: z.string().optional().nullable(),
  incident_severity: z.enum(['High', 'Critical'], {
    errorMap: () => ({ message: 'Only a High or Critical call is sent before the form is complete' }),
  }),
  location_address: z.string().min(1, 'Place the incident on the map').max(200),
  location_lat: z.number().min(-90).max(90),
  location_lng: z.number().min(-180).max(180),
  suburb: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  tagged_silos: z.array(siloEnum.exclude(['Ethekwini'])).min(1, DESKS_RULE),
  caller_name: z.string().max(100).optional().nullable(),
  caller_number: z.string().regex(E164, NUMBER_RULE).optional().nullable(),
  call_description: z.string().max(2000).optional().nullable(),
  is_caller_patient: z.boolean().nullable().optional(),
  patient_name: z.string().max(200).optional().nullable(),
  number_of_victims: z.number().int().nonnegative().optional().nullable(),
  medical_type: z.string().optional().nullable(),
  injuries: injuriesList.optional().nullable(),
  notes: z.string().optional().nullable(),
  client_ref: z.string().uuid(),
});
export type SendCallEarlyInput = z.infer<typeof sendCallEarlySchema>;

/**
 * The details added to a call already sent (0076). Only what changed is sent;
 * an empty string clears nothing, it is simply not sent.
 */
export const completeCallIntakeSchema = z.object({
  caller_name: z.string().min(1).max(100).optional(),
  caller_number: z.string().regex(E164, NUMBER_RULE).optional(),
  call_description: z.string().min(1).max(2000).optional(),
  is_caller_patient: z.boolean().optional(),
  patient_name: z.string().max(200).optional(),
  number_of_victims: z.number().int().nonnegative().optional(),
  medical_type: z.string().max(100).optional(),
  injuries: injuriesList.optional(),
  notes: z.string().max(2000).optional(),
  incident_severity: severityEnum.optional(),
  incident_type: z.string().min(1).max(100).optional(),
  incident_category: z.string().max(100).optional(),
  location_address: z.string().min(1).max(200).optional(),
  location_lat: z.number().min(-90).max(90).optional(),
  location_lng: z.number().min(-180).max(180).optional(),
  suburb: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  region: z.string().max(40).optional(),
}).strict();
export type CompleteCallIntakeInput = z.infer<typeof completeCallIntakeSchema>;

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
  /**
   * When the responder actually pressed the button. Only sent by the mobile
   * outbox, for updates that were queued without signal — the server bounds it
   * to the last 12 hours and never accepts a future time (migration 0024).
   * Omitted from the console, where the two are the same moment.
   */
  occurred_at: z.string().datetime().optional(),
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
