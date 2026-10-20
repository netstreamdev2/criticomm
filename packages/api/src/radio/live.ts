/**
 * Radios as HikTech shows them: the register (whose radio it is) joined to
 * what each push-to-talk platform says about it right now (online, battery,
 * last position). Pure: no database, no network, so it can be tested.
 *
 * The platform (PocStar, through Constellations) knows a radio by its own
 * account. The register (0082) says whose it is.
 *
 * The HikTech app on the same radio is the backup (0087): PocStar first,
 * and when PocStar is not answering for a radio, the app's own report of it.
 */

export type RadioProvider = 'pocstar' | 'hiktech';
export type RadioKind = 'radio' | 'hard_hat' | 'dispatcher';

export const RADIO_PROVIDERS: ReadonlyArray<{ id: RadioProvider; label: string; console: string; tone: string }> = [
  { id: 'pocstar', label: 'PocStar', console: 'Constellations', tone: '#f97316' },
  { id: 'hiktech', label: 'HikTech app', console: 'Radio Desk', tone: '#14b8a6' },
];

/** The push-to-talk radios we know by model. Any phone can run the app; only these count as radios on their own. */
export const RADIO_MODELS = ['E977', 'E966'] as const;
/** The smart hard hats we know by model, matched exactly (a short name like "H1" is part of other models). */
export const HARD_HAT_MODELS = ['H1'] as const;
export const isHardHatModel = (model: string | null | undefined) =>
  Boolean(model && (HARD_HAT_MODELS as readonly string[]).includes(model.trim().toUpperCase()));
/** A radio or a hard hat: field kit that counts on its own, not just a phone with the app. */
export const isRadioModel = (model: string | null | undefined) =>
  Boolean(model && (RADIO_MODELS.some((m) => model.toUpperCase().includes(m)) || isHardHatModel(model)));

/** The app reports every 30 seconds while open or on duty; silent longer than this, it is offline. */
export const PRESENCE_ONLINE_MS = 2 * 60_000;

/** The Radio ID the app shows: HT- and eight letters or digits, without I, L, O or U. */
export const RADIO_ID_PATTERN = /^HT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
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
  /** The HikTech app reports these too: whose it is, and how it is. */
  userId?: string | null;
  personnelId?: string | null;
  charging?: boolean | null;
  network?: 'wifi' | 'cellular' | 'none' | 'other' | null;
  /** The talk group it is in, and whether it is on the air now. */
  talkChannel?: string | null;
  talking?: boolean;
  accuracyM?: number | null;
  /** Positions recorded with no signal, still on the radio waiting to be sent. */
  queued?: number | null;
  model?: string | null;
  appVersion?: string | null;
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
  /** What is shown: the radio's own platform, or the app standing in for it. */
  live: LiveRadio | null;
  /** Where `live` came from. */
  source: RadioProvider;
  /** The app is standing in because the radio's platform is not answering for it. */
  fallback: boolean;
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

const heardAt = (l: LiveRadio | null | undefined) => Math.max(Date.parse(l?.lastOnlineAt ?? '') || 0, Date.parse(l?.fixAt ?? '') || 0);

/**
 * PocStar first, the app as the backup. The radio's own platform while it
 * says the radio is online; otherwise the app, when the app is online; when
 * neither is, whichever was heard from last.
 */
export function chooseSource(primary: LiveRadio | null, backup: LiveRadio | null): { live: LiveRadio | null; fallback: boolean } {
  if (!backup || primary?.online) return { live: primary, fallback: false };
  if (backup.online || !primary) return { live: backup, fallback: true };
  return heardAt(backup) > heardAt(primary) ? { live: backup, fallback: true } : { live: primary, fallback: false };
}

/** Of one person's devices running the app, the best backup: online, a radio rather than a phone, the latest. */
function backupOrder(a: LiveRadio, b: LiveRadio): number {
  return Number(Boolean(b.online)) - Number(Boolean(a.online))
    || Number(isRadioModel(b.model)) - Number(isRadioModel(a.model))
    || heardAt(b) - heardAt(a);
}

/**
 * The register joined to the platforms' reports. Every active registered
 * radio appears, even when its platform says nothing about it. A PocStar
 * radio whose person also runs the app has the app as its backup
 * (chooseSource). A platform account not in the register appears too,
 * flagged, so an administrator can add it; an app not in the register only
 * when it runs on a radio (an ordinary phone is not a radio). Online first,
 * then by name.
 */
export function joinRadios(register: readonly RegisterEntry[], live: readonly LiveRadio[], now = Date.now()): RadioView[] {
  const byKey = new Map(live.map((l) => [key(l.provider, l.account), l]));
  const active = register.filter((r) => r.active);
  // An app registered as a radio in its own right is that radio, not someone's backup.
  const ownRight = new Set(active.filter((r) => r.provider === 'hiktech').map((r) => key(r.provider, r.account)));
  const appByPerson = new Map<string, LiveRadio>();
  for (const a of live.filter((l) => l.provider === 'hiktech' && !ownRight.has(key(l.provider, l.account))).sort(backupOrder)) {
    if (a.personnelId && !appByPerson.has(a.personnelId)) appByPerson.set(a.personnelId, a);
  }

  const seen = new Set<string>();
  const views: RadioView[] = [];
  for (const r of active) {
    const k = key(r.provider, r.account);
    seen.add(k);
    const primary = byKey.get(k) ?? null;
    const backup = r.provider !== 'hiktech' && r.personnel_id ? appByPerson.get(r.personnel_id) ?? null : null;
    // Matched to a radio, the person's app is not listed again on its own.
    if (backup) seen.add(key(backup.provider, backup.account));
    const { live: l, fallback } = chooseSource(primary, backup);
    views.push({
      key: k,
      provider: r.provider,
      account: r.account,
      kind: r.kind,
      title: r.personName || r.unitNumber || r.label || l?.name || r.account,
      register: r,
      live: l,
      source: l?.provider ?? r.provider,
      fallback,
      freshness: freshness(l?.fixAt, now),
    });
  }
  for (const l of live) {
    const k = key(l.provider, l.account);
    if (seen.has(k)) continue;
    seen.add(k);
    if (l.provider === 'hiktech' && !isRadioModel(l.model)) continue;
    views.push({
      key: k,
      provider: l.provider,
      account: l.account,
      kind: l.dispatcher ? 'dispatcher' : isHardHatModel(l.model) ? 'hard_hat' : 'radio',
      title: l.name || l.account,
      register: null,
      live: l,
      source: l.provider,
      fallback: false,
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
    onBackup: field.filter((v) => v.fallback && v.live?.online).length,
    talking: field.filter((v) => v.live?.online && v.live.talking).length,
  };
}

/** A row of radio_presence (0087), with the person's name joined for the screen. */
export type PresenceRow = {
  device_id: string;
  user_id: string;
  personnel_id: string | null;
  silo: string;
  model: string | null;
  app_version: string | null;
  battery: number | null;
  charging: boolean | null;
  network: string | null;
  talk_channel: string | null;
  talking: boolean;
  queued?: number | null;
  signed_in: boolean;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  fix_at: string | null;
  last_seen_at: string;
  personName?: string | null;
};

const NETWORKS = ['wifi', 'cellular', 'none', 'other'] as const;

/** The app's reports as live radios. Online: signed in and heard from in the last two minutes. */
export function presenceRadios(rows: readonly PresenceRow[], now = Date.now()): LiveRadio[] {
  return rows.map((r) => {
    const seen = Date.parse(r.last_seen_at);
    const online = r.signed_in && Number.isFinite(seen) && now - seen < PRESENCE_ONLINE_MS;
    const hasFix = r.lat !== null && r.lng !== null && Boolean(r.fix_at);
    return {
      provider: 'hiktech' as const,
      account: r.device_id,
      providerUserId: null,
      name: r.personName?.trim() || null,
      online,
      battery: r.battery === null ? null : Math.max(0, Math.min(100, Math.round(r.battery))),
      lat: hasFix ? r.lat : null,
      lng: hasFix ? r.lng : null,
      fixAt: hasFix ? r.fix_at : null,
      speedKmh: null,
      lastOnlineAt: r.last_seen_at,
      dispatcher: false,
      userId: r.user_id,
      personnelId: r.personnel_id,
      charging: r.charging,
      network: (NETWORKS as readonly string[]).includes(r.network ?? '') ? (r.network as LiveRadio['network']) : null,
      talkChannel: online ? r.talk_channel : null,
      talking: online && r.talking,
      accuracyM: hasFix ? r.accuracy : null,
      queued: r.queued ?? null,
      model: r.model,
      appVersion: r.app_version,
    };
  });
}

/** A fresh Radio ID for an install of the app, from any source of random numbers in [0, 1). */
export function newRadioId(random: () => number = Math.random): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const pick = () => ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return `HT-${Array.from({ length: 4 }, pick).join('')}-${Array.from({ length: 4 }, pick).join('')}`;
}
