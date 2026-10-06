/** The V4 Fire & Rescue checklist. Unanswered is never the same as passed. */
export const FIRE_ESSENTIALS = [
  ['lights_functional', 'Emergency lights & siren functioning'],
  ['tires_condition_ok', 'Tyres — pressure and condition OK'],
  ['equipment_stocked', 'Emergency equipment stocked & accessible'],
  ['comms_working', 'Radio / GPS communications working'],
  ['brakes_responsive', 'Brakes responsive and in good condition'],
] as const;

export const FIRE_EQUIPMENT = [
  ['scba_checked', 'SCBA serviceable', 'Breathing apparatus charged & sealed'],
  ['water_tank_full', 'Water / booster tank full', 'Onboard water supply topped up'],
  ['pump_operational', 'Pump operational', 'Primes and holds pressure'],
  ['hoses_and_nozzles_stocked', 'Hoses & nozzles stocked', 'Attack and supply lines ready'],
  ['ladders_secured', 'Ladders secured', 'Mounted and locked in place'],
  ['turnout_gear_complete', 'Turnout gear / PPE complete', 'Protective equipment checked'],
] as const;

export const FIRE_CHECKS = [...FIRE_ESSENTIALS, ...FIRE_EQUIPMENT];
export type FireCheckKey = (typeof FIRE_CHECKS)[number][0];
export type FireAnswers = Partial<Record<FireCheckKey, boolean>>;
export const FIRE_FUEL_LEVELS = ['1/4', '1/2', '3/4', 'Full'] as const;
export type FireFuelLevel = (typeof FIRE_FUEL_LEVELS)[number];

export function fireChecksPassed(answers: FireAnswers): boolean {
  return FIRE_CHECKS.every(([key]) => answers[key] === true);
}

export function fireFailedChecks(answers: FireAnswers): string[] {
  return FIRE_CHECKS.filter(([key]) => answers[key] === false).map(([, label]) => label);
}

export function fireChecklistError(answers: FireAnswers, fuel: string | null, notes: string): string | null {
  if (!FIRE_FUEL_LEVELS.includes(fuel as FireFuelLevel)) return 'Choose the appliance fuel level.';
  if (FIRE_CHECKS.some(([key]) => typeof answers[key] !== 'boolean')) {
    return 'Answer Yes or No for all 11 appliance and equipment checks.';
  }
  if (fireFailedChecks(answers).length && !notes.trim()) return 'Describe the failed checks before filing the inspection.';
  if (notes.length > 4000) return 'Keep inspection notes within 4,000 characters.';
  return null;
}

export type FireShiftStep = 'intro' | 'readiness' | 'stood_down' | 'appliance' | 'checks' | 'sign' | 'appliance_failed' | 'complete';

/** Resume from server facts, including a failed declaration and an appliance released by fleet. */
export function fireResumeStep(args: {
  readiness: boolean; vehicle: boolean; hasReadinessRecord: boolean; hasAppliance: boolean;
}): FireShiftStep {
  if (!args.readiness) return args.hasReadinessRecord ? 'stood_down' : 'intro';
  if (args.vehicle && args.hasAppliance) return 'complete';
  return args.hasAppliance ? 'checks' : 'appliance';
}
