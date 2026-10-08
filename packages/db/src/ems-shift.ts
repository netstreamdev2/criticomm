import { FIRE_ESSENTIALS, FIRE_FUEL_LEVELS, type FireFuelLevel } from './fire-shift.ts';

/**
 * The V4 EMS start of shift: the vehicle checklist every department files,
 * then the Medical-only inventory check and the sanitisation question.
 * Unanswered is never the same as passed.
 */
export const EMS_VEHICLE_CHECKS = FIRE_ESSENTIALS;

export const EMS_EQUIPMENT = [
  ['oxygen_full', 'Oxygen Cylinders (Full)'],
  ['aed_battery_ok', 'Defibrillator / AED (Battery OK)'],
  ['suction_functional', 'Suction Unit (Functional)'],
  ['bvm_masks_ok', 'BVM & Masks (Adult/Ped)'],
] as const;

export const EMS_CONSUMABLES = [
  ['jump_bag_stocked', 'Jump Bag (Fully Stocked)'],
  ['iv_fluids_stocked', 'IV Fluids & Giving Sets'],
  ['drug_box_sealed', 'Drug Box (Seals Intact)'],
  ['gloves_ppe_stocked', 'Gloves & PPE'],
] as const;

export const EMS_STOCK = [...EMS_EQUIPMENT, ...EMS_CONSUMABLES];
export const EMS_CHECK_COUNT = EMS_VEHICLE_CHECKS.length + EMS_STOCK.length;

export type EmsVehicleKey = (typeof EMS_VEHICLE_CHECKS)[number][0];
export type EmsStockKey = (typeof EMS_STOCK)[number][0];
export type EmsVehicleAnswers = Partial<Record<EmsVehicleKey, boolean>>;
/** A ticked item is confirmed; anything not ticked is filed as not confirmed. */
export type EmsStock = Partial<Record<EmsStockKey, boolean>>;
export const EMS_FUEL_LEVELS = FIRE_FUEL_LEVELS;
export type EmsFuelLevel = FireFuelLevel;

export function emsFailedVehicle(answers: EmsVehicleAnswers): string[] {
  return EMS_VEHICLE_CHECKS.filter(([key]) => answers[key] === false).map(([, label]) => label);
}

export function emsShortStock(stock: EmsStock): string[] {
  return EMS_STOCK.filter(([key]) => stock[key] !== true).map(([, label]) => label);
}

/** The vehicle page: fuel and every one of the five answered. */
export function emsVehicleError(answers: EmsVehicleAnswers, fuel: string | null): string | null {
  if (!EMS_FUEL_LEVELS.includes(fuel as EmsFuelLevel)) return 'Choose the ambulance fuel level.';
  if (EMS_VEHICLE_CHECKS.some(([key]) => typeof answers[key] !== 'boolean')) {
    return 'Answer Yes or No for all 5 vehicle checks.';
  }
  return null;
}

/** The whole record, before the sanitisation question. */
export function emsChecklistError(
  answers: EmsVehicleAnswers, fuel: string | null, stock: EmsStock, notes: string, declared: boolean,
): string | null {
  const vehicle = emsVehicleError(answers, fuel);
  if (vehicle) return vehicle;
  if ((emsFailedVehicle(answers).length || emsShortStock(stock).length) && !notes.trim()) {
    return 'Say what failed or what stock is missing before filing.';
  }
  if (notes.length > 4000) return 'Keep notes within 4,000 characters.';
  if (!declared) return 'Confirm that you checked the ambulance and its stock yourself.';
  return null;
}

/** Cleared: every check passed and the ambulance is clean. */
export function emsCleared(answers: EmsVehicleAnswers, stock: EmsStock, requiresCleaning: boolean): boolean {
  return EMS_VEHICLE_CHECKS.every(([key]) => answers[key] === true)
    && EMS_STOCK.every(([key]) => stock[key] === true)
    && !requiresCleaning;
}

/** What a filed check means for the crew. */
export function emsOutcome(answers: EmsVehicleAnswers, stock: EmsStock, requiresCleaning: boolean): 'cleared' | 'off_road' | 'stock_short' {
  if (emsFailedVehicle(answers).length || requiresCleaning) return 'off_road';
  return emsShortStock(stock).length ? 'stock_short' : 'cleared';
}

export type EmsShiftStep =
  | 'intro' | 'readiness' | 'stood_down' | 'ambulance' | 'vehicle' | 'stock'
  | 'off_road' | 'stock_short' | 'complete';

/** Resume from server facts, including a failed declaration and an ambulance released by fleet. */
export function emsResumeStep(args: {
  readiness: boolean; vehicle: boolean; hasReadinessRecord: boolean; hasAmbulance: boolean;
}): EmsShiftStep {
  if (!args.readiness) return args.hasReadinessRecord ? 'stood_down' : 'intro';
  if (args.vehicle && args.hasAmbulance) return 'complete';
  return args.hasAmbulance ? 'vehicle' : 'ambulance';
}
