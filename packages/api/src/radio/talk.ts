/**
 * HikTech Talk: push-to-talk between radios, phones and the console (0083).
 * Pure helpers shared by the console and the app: the talk groups a person
 * is offered, and who has the channel. No network, so it can be tested.
 */

/** A transmission is cut at this length, so a stuck key cannot hold the channel. */
export const TALK_MAX_SECONDS = 60;

export const TALK_DEPARTMENTS = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini'] as const;

export const TALK_DEPARTMENT_LABELS: Record<string, string> = {
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS',
  EthekwiniDisaster: 'Disaster Management',
  Ethekwini: 'Control room',
};

export const TALK_TONES: Record<string, string> = {
  MetroPolice: '#3b82f6',
  MetroFire: '#ef4444',
  Medical: '#22c55e',
  EthekwiniDisaster: '#f59e0b',
  Ethekwini: '#a855f7',
  all: '#f97316',
  incident: '#06b6d4',
};

export const deptChannel = (silo: string) => `dept:${silo}`;
export const incidentChannel = (incidentId: string) => `incident:${incidentId}`;
export const ALL_CALL = 'all';

/** A talk group's colour: its department's, All call orange, a call's channel cyan. */
export function channelTone(channel: string): string {
  if (channel === ALL_CALL) return TALK_TONES.all!;
  if (channel.startsWith('incident:')) return TALK_TONES.incident!;
  return TALK_TONES[channel.slice(5)] ?? '#64748b';
}

/**
 * The talk groups to offer, best first: your own department, All call, then
 * (for the roles that see every department) the others. The database still
 * decides; this is only what to ask it about.
 */
export function talkChannelsToOffer(me: { silo: string; seesAll: boolean }): string[] {
  const own = deptChannel(me.silo);
  const others = me.seesAll ? TALK_DEPARTMENTS.filter((d) => d !== me.silo).map(deptChannel) : [];
  return [own, ALL_CALL, ...others];
}

export type TalkPerson = {
  identity: string;
  name: string;
  role: string | null;
  silo: string | null;
  me: boolean;
  talking: boolean;
};

/** A participant's metadata ({"role","silo"}) as the pass wrote it; nothing when it is not that. */
export function readTalkMetadata(metadata: string | undefined | null): { role: string | null; silo: string | null } {
  try {
    const m = JSON.parse(metadata ?? '') as { role?: unknown; silo?: unknown };
    return { role: typeof m.role === 'string' ? m.role : null, silo: typeof m.silo === 'string' ? m.silo : null };
  } catch {
    return { role: null, silo: null };
  }
}

/** Who has the channel: the first other person talking, else me. */
export function whoHasTheChannel(people: readonly TalkPerson[]): TalkPerson | null {
  return people.find((p) => p.talking && !p.me) ?? people.find((p) => p.talking && p.me) ?? null;
}

/** May I key up now? A clear channel, or priority (the desk talks over a radio). */
export function mayKeyUp(people: readonly TalkPerson[], priority: boolean): 'clear' | 'override' | 'busy' {
  const other = people.find((p) => p.talking && !p.me);
  if (!other) return 'clear';
  return priority ? 'override' : 'busy';
}

/** The order the people list shows: whoever is talking, then me, then by name. */
export function sortTalkPeople(people: TalkPerson[]): TalkPerson[] {
  return [...people].sort((a, b) => Number(b.talking) - Number(a.talking) || Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
}
