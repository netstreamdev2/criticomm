/**
 * Radios as HikTech shows them: the register (whose radio it is) joined to
 * what each push-to-talk platform says about it right now (online, battery,
 * last position). Pure: no database, no network, so it can be tested.
 *
 * The platforms (PocStar through Constellations, RealPTT) know a radio by
 * their own account. The register (0082) says whose it is.
 */

export type RadioProvider = 'pocstar' | 'realptt';
export type RadioKind = 'radio' | 'hard_hat' | 'dispatcher';

export const RADIO_PROVIDERS: ReadonlyArray<{ id: RadioProvider; label: string; console: string; tone: string }> = [
  { id: 'pocstar', label: 'PocStar', console: 'Constellations', tone: '#f97316' },
  { id: 'realptt', label: 'RealPTT', console: 'RealPTT', tone: '#38bdf8' },
];
export const RADIO_KINDS: ReadonlyArray<{ id: RadioKind; label: string }> = [
  { id: 'radio', label: 'Radio' },
  { id: 'hard_hat', label: 'Hard hat' },
  { id: 'dispatcher', label: 'Dispatcher seat' },
];
export const providerLabel = (p: string) => RADIO_PROVIDERS.find((x) => x.id === p)?.label ?? p;
export const kindLabel = (k: string) => RADIO_KINDS.find((x) => x.id === k)?.label ?? k;

/** What a platform says about one of its accounts. */
export type LiveRadio = {
  provider: RadioProvider;
  account: string;
  providerUserId: string | null;
  name: string | null;
  online: boolean;
  battery: number | null;
  lat: number | null;
  lng: number | null;
  /** When the position was taken. */
  fixAt: string | null;
  speedKmh: number | null;
  /** When the platform last saw it online. */
  lastOnlineAt: string | null;
  /** A dispatcher login rather than a radio, as the platform reports it. */
  dispatcher: boolean;
};

/** A platform's answer: connected or why not, and what it reported. */
export type ProviderPicture = {
  provider: RadioProvider;
  /** A login is set on this deployment. */
  configured: boolean;
  /** The platform answered. */
  ok: boolean;
  /** In plain words, for the screen. */
  message: string;
  radios: LiveRadio[];
  checkedAt: string;
};

export type RegisterEntry = {
  id: string;
  provider: RadioProvider;
  kind: RadioKind;
  account: string;
  label: string | null;
  silo: string;
  personnel_id: string | null;
  apparatus_id: string | null;
  active: boolean;
  /** Joined for the screen. */
  personName?: string | null;
  unitNumber?: string | null;
};

/** A radio on the screen: whose it is, and what its platform says now. */
export type RadioView = {
  key: string;
  provider: RadioProvider;
  account: string;
  kind: RadioKind;
  /** The person, else the vehicle, else the platform's name, else the account. */
  title: string;
  register: RegisterEntry | null;
  live: LiveRadio | null;
  freshness: Freshness;
};

/** How current a position is: live (under 2 minutes), recent (under 30), old, or none. */
export type Freshness = 'live' | 'recent' | 'old' | 'none';

export function freshness(fixAt: string | null | undefined, now = Date.now()): Freshness {
  if (!fixAt) return 'none';
  const t = Date.parse(fixAt);
  if (Number.isNaN(t)) return 'none';
  const age = now - t;
  if (age < 2 * 60_000) return 'live';
  if (age < 30 * 60_000) return 'recent';
  return 'old';
}

export const FRESHNESS_TONE: Record<Freshness, string> = { live: '#22c55e', recent: '#f59e0b', old: '#94a3b8', none: '#64748b' };

/** Battery colour: red under 20%, amber under 50%, green above. */
export function batteryTone(level: number | null | undefined): string {
  if (level === null || level === undefined) return '#64748b';
  if (level < 20) return '#ef4444';
  if (level < 50) return '#f59e0b';
  return '#22c55e';
}

const key = (provider: string, account: string) => `${provider}:${account.trim().toLowerCase()}`;

/**
 * The register joined to the platforms' reports. Every active registered
 * radio appears, even when its platform says nothing about it; a platform
 * account not in the register appears too, flagged, so an administrator can
 * add it. Online first, then by name.
 */
export function joinRadios(register: readonly RegisterEntry[], live: readonly LiveRadio[], now = Date.now()): RadioView[] {
  const byKey = new Map(live.map((l) => [key(l.provider, l.account), l]));
  const seen = new Set<string>();
  const views: RadioView[] = [];
  for (const r of register) {
    if (!r.active) continue;
    const k = key(r.provider, r.account);
    seen.add(k);
    const l = byKey.get(k) ?? null;
    views.push({
      key: k,
      provider: r.provider,
      account: r.account,
      kind: r.kind,
      title: r.personName || r.unitNumber || r.label || l?.name || r.account,
      register: r,
      live: l,
      freshness: freshness(l?.fixAt, now),
    });
  }
  for (const l of live) {
    const k = key(l.provider, l.account);
    if (seen.has(k)) continue;
    seen.add(k);
    views.push({
      key: k,
      provider: l.provider,
      account: l.account,
      kind: l.dispatcher ? 'dispatcher' : 'radio',
      title: l.name || l.account,
      register: null,
      live: l,
      freshness: freshness(l.fixAt, now),
    });
  }
  return views.sort((a, b) => Number(Boolean(b.live?.online)) - Number(Boolean(a.live?.online)) || a.title.localeCompare(b.title));
}

/** The counts the desk's tiles show. */
export function radioCounts(views: readonly RadioView[]) {
  const field = views.filter((v) => v.kind !== 'dispatcher');
  return {
    total: field.length,
    online: field.filter((v) => v.live?.online).length,
    lowBattery: field.filter((v) => v.live?.online && v.live.battery !== null && v.live.battery < 20).length,
    unregistered: views.filter((v) => !v.register).length,
    hardHats: field.filter((v) => v.kind === 'hard_hat').length,
  };
}

/** "2026-08-18 20:37:02" in South African time, as RealPTT writes it, to an instant. Null for "-" or nothing. */
export function saPlatformTime(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s || s === '-' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  const t = Date.parse(`${s.replace(' ', 'T')}${s.length === 16 ? ':00' : ''}+02:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

type RealPttUser = {
  user_id?: number | string; user_account?: string; user_name?: string; user_online?: number | string;
  battery?: number | string; client_type?: number | string; last_online_time?: string;
};
type RealPttFix = { userId?: string; userAccount?: string; userName?: string; lat?: string; lng?: string; time?: string; speed?: string };

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * RealPTT's user list and GPS list as live radios. client_type 5 is a
 * dispatcher login; a 0,0 position is no position.
 */
export function realPttRadios(users: readonly RealPttUser[], fixes: readonly RealPttFix[]): LiveRadio[] {
  const fixByAccount = new Map(fixes.filter((f) => f.userAccount).map((f) => [f.userAccount!.toLowerCase(), f]));
  return users.filter((u) => u.user_account).map((u) => {
    const f = fixByAccount.get(u.user_account!.toLowerCase());
    const lat = num(f?.lat);
    const lng = num(f?.lng);
    const hasFix = lat !== null && lng !== null && !(lat === 0 && lng === 0);
    const battery = num(u.battery);
    return {
      provider: 'realptt' as const,
      account: u.user_account!,
      providerUserId: u.user_id === undefined ? null : String(u.user_id),
      name: u.user_name?.trim() || null,
      online: num(u.user_online) === 1,
      battery: battery === null ? null : Math.max(0, Math.min(100, battery)),
      lat: hasFix ? lat : null,
      lng: hasFix ? lng : null,
      fixAt: hasFix ? saPlatformTime(f?.time) : null,
      speedKmh: hasFix ? num(f?.speed) : null,
      lastOnlineAt: saPlatformTime(u.last_online_time),
      dispatcher: num(u.client_type) === 5,
    };
  });
}
