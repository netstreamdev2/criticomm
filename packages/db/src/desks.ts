import type { Silo } from './types.generated';

/**
 * Which dispatch desks a call goes to (migration 0068). The call taker tags
 * them; this is only the starting suggestion from what they chose, so the
 * right desks are already marked: a Crime or Traffic code is Police, Fire is
 * Fire & Rescue, Medical is EMS, Disaster is Disaster Management, and anyone
 * hurt brings EMS in too. The call taker adds or removes before sending.
 */

export type DeskSilo = Exclude<Silo, 'Ethekwini'>;

/** The four dispatch desks, in the order the intake console shows them. */
export const DESK_SILOS: readonly DeskSilo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

/** Incident code groups as configured (Admin → Configuration → Incident categories). */
const GROUP_DESK: Record<string, DeskSilo> = {
  crime: 'MetroPolice',
  traffic: 'MetroPolice',
  'public order': 'MetroPolice',
  fire: 'MetroFire',
  medical: 'Medical',
  disaster: 'EthekwiniDisaster',
};

/** For a group added later under another name: what its words say. */
const WORDS: Array<[RegExp, DeskSilo]> = [
  [/fire|blaze|smoke|hazmat|explosion/i, 'MetroFire'],
  [/medic|ems|ambulance|cardiac|trauma|injur|overdose|matern/i, 'Medical'],
  [/disaster|flood|storm|landslide|evacuat|drought/i, 'EthekwiniDisaster'],
  [/police|crime|traffic|order|theft|robb|burgl|assault|hijack|protest|violen|shoot|stab/i, 'MetroPolice'],
];

export function suggestedDesks(args: {
  /** The code group, e.g. "Crime". */
  category?: string | null;
  /** The code itself, e.g. "Burglary". */
  incidentType?: string | null;
  /** Victims, when the call taker has said; with anyone hurt, EMS goes too. */
  victims?: number | null;
  emsNotRequired?: boolean;
}): DeskSilo[] {
  const out = new Set<DeskSilo>();
  const group = (args.category ?? '').trim().toLowerCase();
  const direct = GROUP_DESK[group];
  if (direct) out.add(direct);
  else {
    const text = `${args.category ?? ''} ${args.incidentType ?? ''}`;
    for (const [re, desk] of WORDS) if (re.test(text)) { out.add(desk); break; }
  }
  if (!args.emsNotRequired && (args.victims ?? 0) > 0) out.add('Medical');
  return DESK_SILOS.filter((d) => out.has(d));
}
