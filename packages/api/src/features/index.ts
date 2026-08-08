import type { CriticomClient, Database } from '@criticom/db';

/**
 * Feature flags (migration 0029).
 *
 * The catalogue below is the authority on what CAN be toggled; the database
 * stores only per-tenant deviations from these defaults. That split matters:
 * shipping a new feature adds a catalogue entry with its default, and every
 * tenant gets that default with no data migration — a row appears only when a
 * SuperAdmin actually flips the switch.
 *
 * Flags gate *availability*, never *authorization*. A disabled feature is
 * hidden and its pages refuse, but enabling one never grants a role anything
 * the route matrix and RLS would not — the two systems compose with AND.
 */

export type FeatureSurface = 'web' | 'mobile';

export type FeatureDef = {
  key: string;
  surface: FeatureSurface;
  label: string;
  /** What turning it OFF does, concretely — that is the decision being made. */
  description: string;
  defaultEnabled: boolean;
};

export const FEATURES: FeatureDef[] = [
  // ── Console ─────────────────────────────────────────────────────────
  {
    key: 'web.assistant', surface: 'web', label: 'Criti assistant',
    description: 'Off: the assistant dock and /assistant disappear, and the chat API refuses. Model spend stops entirely.',
    defaultEnabled: true,
  },
  {
    key: 'web.cameras', surface: 'web', label: 'CCTV cameras',
    description: 'Off: the camera wall and footage retrieval are hidden and their APIs refuse.',
    defaultEnabled: true,
  },
  {
    key: 'web.ptt', surface: 'web', label: 'Radio (PTT) console',
    description: 'Off: the PTT console is hidden and text-to-radio refuses.',
    defaultEnabled: true,
  },
  {
    key: 'web.search', surface: 'web', label: 'Global search',
    description: 'Off: ⌘K searches pages only and /search is hidden. Module lists still work.',
    defaultEnabled: true,
  },
  {
    key: 'web.reports_builder', surface: 'web', label: 'Custom report builder',
    description: 'Off: /reports/builder is hidden. Report Hub and the fixed reports remain.',
    defaultEnabled: true,
  },
  // ── Responder app ───────────────────────────────────────────────────
  {
    key: 'mobile.panic', surface: 'mobile', label: 'Officer-down (SOS)',
    description: 'Off: the SOS button is removed from every screen. Only turn this off for a tenant that has its own duress system.',
    defaultEnabled: true,
  },
  {
    key: 'mobile.assistant', surface: 'mobile', label: 'Criti on the phone',
    description: 'Off: the Criti entry disappears from the app.',
    defaultEnabled: true,
  },
  {
    key: 'mobile.leave', surface: 'mobile', label: 'Leave from the phone',
    description: 'Off: leave applications are console-only.',
    defaultEnabled: true,
  },
  {
    key: 'mobile.nearby', surface: 'mobile', label: 'Nearby incidents',
    description: 'Off: crews see only their assigned calls — no department-wide live list on the phone.',
    defaultEnabled: true,
  },
  {
    key: 'mobile.voice_notes', surface: 'mobile', label: 'Voice-note evidence',
    description: 'Off: evidence capture is photographs only.',
    defaultEnabled: true,
  },
  {
    key: 'mobile.alerts_inbox', surface: 'mobile', label: 'Alerts inbox tab',
    description: 'Off: the Alerts tab is hidden. Live banners and full-screen interrupts still fire.',
    defaultEnabled: true,
  },
];

const DEFAULTS: Record<string, boolean> = Object.fromEntries(
  FEATURES.map((f) => [f.key, f.defaultEnabled]),
);

export type FeatureMap = Record<string, boolean>;

/**
 * The effective map for the caller's tenant: catalogue defaults overlaid with
 * stored deviations. Unknown stored keys (a removed feature) are ignored, so
 * stale rows cannot resurrect dead switches.
 */
export async function getFeatureMap(client: CriticomClient): Promise<FeatureMap> {
  const map: FeatureMap = { ...DEFAULTS };
  const { data, error } = await client.from('feature_flags').select('key, enabled');
  if (error) {
    // Fail open to the defaults: a flags outage must never blank a console.
    return map;
  }
  for (const row of data ?? []) {
    if (row.key in map) map[row.key] = row.enabled;
  }
  return map;
}

/** True unless explicitly known to be off. Callers treat missing as default. */
export function featureEnabled(map: FeatureMap, key: string): boolean {
  return map[key] ?? DEFAULTS[key] ?? true;
}

/** SuperAdmin toggle. RLS enforces the role; this just writes the deviation. */
export async function setFeature(
  client: CriticomClient,
  args: { key: string; enabled: boolean; byName?: string },
) {
  if (!(args.key in DEFAULTS)) throw new Error(`Unknown feature "${args.key}"`);
  const { error } = await client.from('feature_flags').upsert({
    key: args.key,
    enabled: args.enabled,
    updated_by: args.byName ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export type FeatureFlagRow = Database['public']['Tables']['feature_flags']['Row'];

/** Live flag changes for this tenant, so a toggle lands without a reload. */
export function subscribeFeatureFlags(
  client: CriticomClient,
  onChange: (row: FeatureFlagRow) => void,
) {
  const channel = client
    .channel(`feature_flags:${Math.random().toString(36).slice(2, 8)}`)
    .on(
      'postgres_changes' as never,
      { event: '*', schema: 'public', table: 'feature_flags' },
      (payload: { new: FeatureFlagRow }) => { if (payload.new?.key) onChange(payload.new); },
    )
    .subscribe();
  return () => { void client.removeChannel(channel); };
}
