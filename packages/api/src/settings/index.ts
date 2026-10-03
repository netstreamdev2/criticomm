import type { CriticomClient } from '@criticom/db';

/**
 * Operational settings — the knobs an emergency service tunes to its own SOPs
 * without waiting for a deploy: SLA clocks, alert behaviour, the ETA model,
 * map defaults.
 *
 * Design rules, in order of importance:
 *   1. The app must never break because a setting is missing or garbage.
 *      Every key has a code default and a validator; reads always return a
 *      complete, sane object.
 *   2. One round trip. `getOperationalSettings` fetches the whole (tiny)
 *      table once and merges it over the defaults.
 *   3. The catalogue is the contract. New knobs are added HERE (key, type,
 *      bounds, default, description) and the admin UI renders them from it —
 *      no page edits needed. That is the future-proofing.
 */

export type SettingType = 'number' | 'boolean' | 'choice';

export type SettingDef = {
  key: OperationalSettingKey;
  label: string;
  description: string;
  category: 'Response SLAs' | 'Alerts & sound' | 'Dispatch & ETA' | 'Map & board';
  type: SettingType;
  default: number | boolean | string;
  /** number bounds */
  min?: number;
  max?: number;
  unit?: string;
  /** choice options */
  options?: readonly string[];
};

export type OperationalSettingKey =
  | 'sla.clock_warn_seconds'
  | 'sla.clock_critical_seconds'
  | 'sla.response_target_minutes'
  | 'sla.call_duration_target_minutes'
  | 'alerts.modal_min_severity'
  | 'alerts.sound_enabled'
  | 'alerts.toast_seconds'
  | 'dispatch.eta_speed_kmh'
  | 'dispatch.eta_road_factor'
  | 'duty.max_shift_hours'
  | 'map.default_basemap'
  | 'board.feed_items'
  | 'board.volume_days';

export const OPERATIONAL_SETTINGS: readonly SettingDef[] = [
  // ── Response SLAs ──
  {
    key: 'sla.clock_warn_seconds',
    label: 'Intake clock — warn',
    description: 'Seconds on the call-intake response clock before it turns amber.',
    category: 'Response SLAs', type: 'number', default: 90, min: 15, max: 900, unit: 's',
  },
  {
    key: 'sla.clock_critical_seconds',
    label: 'Intake clock — critical',
    description: 'Seconds before the intake clock turns red and pulses.',
    category: 'Response SLAs', type: 'number', default: 180, min: 30, max: 1800, unit: 's',
  },
  {
    key: 'sla.response_target_minutes',
    label: 'Response-time target',
    description: 'Target minutes from dispatch to arrival — drives the dashboard gauge.',
    category: 'Response SLAs', type: 'number', default: 30, min: 5, max: 120, unit: 'min',
  },
  {
    key: 'sla.call_duration_target_minutes',
    label: 'Call-duration target',
    description: 'Target minutes from call to closure — drives the dashboard gauge.',
    category: 'Response SLAs', type: 'number', default: 120, min: 10, max: 720, unit: 'min',
  },

  // ── Alerts & sound ──
  {
    key: 'alerts.modal_min_severity',
    label: 'Blocking pop-up from',
    description: 'Lowest severity that interrupts the screen with a must-acknowledge pop-up; anything below is a corner toast.',
    category: 'Alerts & sound', type: 'choice', default: 'High',
    options: ['Critical', 'High', 'Medium', 'Low'] as const,
  },
  {
    key: 'alerts.sound_enabled',
    label: 'Alert sound',
    description: 'Play the attention tone when an alert or new call lands.',
    category: 'Alerts & sound', type: 'boolean', default: true,
  },
  {
    key: 'alerts.toast_seconds',
    label: 'Toast duration',
    description: 'Seconds a routine toast stays on screen before auto-dismissing.',
    category: 'Alerts & sound', type: 'number', default: 8, min: 3, max: 60, unit: 's',
  },

  // ── Dispatch & ETA ──
  {
    key: 'dispatch.eta_speed_kmh',
    label: 'ETA — average speed',
    description: 'Assumed urban response speed for the straight-line ETA estimate.',
    category: 'Dispatch & ETA', type: 'number', default: 42, min: 10, max: 120, unit: 'km/h',
  },
  {
    key: 'dispatch.eta_road_factor',
    label: 'ETA — road factor',
    description: 'Multiplier converting straight-line distance to road distance (urban ≈ 1.35).',
    category: 'Dispatch & ETA', type: 'number', default: 1.35, min: 1, max: 3,
  },
  {
    key: 'duty.max_shift_hours',
    label: 'Auto off-duty after',
    description: 'Hours after going on duty in the app before an officer who never signed off is taken off duty (never mid-call). Read by the database sweep, migration 0041.',
    category: 'Dispatch & ETA', type: 'number', default: 14, min: 4, max: 24, unit: 'h',
  },

  // ── Map & board ──
  {
    key: 'map.default_basemap',
    label: 'Default basemap',
    description: 'Tiles the dispatch maps open with.',
    category: 'Map & board', type: 'choice', default: 'satellite',
    options: ['satellite', 'street'] as const,
  },
  {
    key: 'board.feed_items',
    label: 'Ops feed length',
    description: 'How many events the Live Operations Feed shows.',
    category: 'Map & board', type: 'number', default: 6, min: 3, max: 20,
  },
  {
    key: 'board.volume_days',
    label: 'Call-volume window',
    description: 'Days of history in the total-calls sparkline.',
    category: 'Map & board', type: 'number', default: 10, min: 5, max: 31, unit: 'days',
  },
] as const;

export type OperationalSettings = {
  'sla.clock_warn_seconds': number;
  'sla.clock_critical_seconds': number;
  'sla.response_target_minutes': number;
  'sla.call_duration_target_minutes': number;
  'alerts.modal_min_severity': 'Critical' | 'High' | 'Medium' | 'Low';
  'alerts.sound_enabled': boolean;
  'alerts.toast_seconds': number;
  'dispatch.eta_speed_kmh': number;
  'dispatch.eta_road_factor': number;
  'duty.max_shift_hours': number;
  'map.default_basemap': 'satellite' | 'street';
  'board.feed_items': number;
  'board.volume_days': number;
};

const DEFS = new Map(OPERATIONAL_SETTINGS.map((d) => [d.key, d]));

export const DEFAULT_SETTINGS: OperationalSettings = Object.fromEntries(
  OPERATIONAL_SETTINGS.map((d) => [d.key, d.default]),
) as OperationalSettings;

/** Accept a stored value only if it matches the definition and its bounds. */
function sanitise(def: SettingDef, raw: unknown): number | boolean | string {
  switch (def.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return def.default;
      if (def.min !== undefined && n < def.min) return def.min;
      if (def.max !== undefined && n > def.max) return def.max;
      return n;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : def.default;
    case 'choice':
      return typeof raw === 'string' && def.options?.includes(raw) ? raw : def.default;
  }
}

/**
 * The complete, validated settings object in one query. Unknown rows are
 * ignored; invalid values are clamped or replaced — callers never need a
 * fallback of their own.
 */
export async function getOperationalSettings(client: CriticomClient): Promise<OperationalSettings> {
  const merged = { ...DEFAULT_SETTINGS };
  try {
    const { data, error } = await client.from('app_settings').select('key, value');
    if (error) throw error;
    for (const row of data ?? []) {
      const def = DEFS.get(row.key as OperationalSettingKey);
      if (!def) continue;
      (merged as Record<string, number | boolean | string>)[def.key] = sanitise(def, row.value);
    }
  } catch {
    // Table unreachable → code defaults. The board must render regardless.
  }
  return merged;
}

/** Admin write, validated against the catalogue before it is stored. */
export async function updateOperationalSetting(
  client: CriticomClient,
  key: OperationalSettingKey,
  value: number | boolean | string,
  updatedBy?: string,
) {
  const def = DEFS.get(key);
  if (!def) throw new Error(`Unknown setting "${key}"`);
  const clean = sanitise(def, value);
  const { error } = await client.from('app_settings').upsert({
    key,
    value: clean as never,
    updated_by: updatedBy ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return clean;
}

/** Reset a key to its code default by deleting the override row. */
export async function resetOperationalSetting(client: CriticomClient, key: OperationalSettingKey) {
  await client.from('app_settings').delete().eq('key', key);
  return DEFS.get(key)?.default;
}
