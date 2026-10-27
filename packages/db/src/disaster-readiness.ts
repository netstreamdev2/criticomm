import { PRIORITY_RISKS, priorityRisk } from './disaster-plan.ts';

/**
 * Readiness and the IDP figures (0120), counted from the records (revision 2,
 * section 11). The readiness score is the Directorate's proposed measure
 * for IDP indicator FD2.1, which has no baseline yet: eight measures from the
 * plan, each counted equally. The IDP figures count a financial year, July
 * to June. Pure: tested on its own (disaster-readiness.test.ts).
 */

/** The Advisory Forum's five task teams (revision 2, section 13). The database checks the keys. */
export const TASK_TEAMS = [
  { key: 'early_warning', label: 'Community-Based Risk Assessment and Early Warning' },
  { key: 'mhi', label: 'Major Hazard Installations off-site emergency' },
  { key: 'social_relief', label: 'Social Relief' },
  { key: 'adaptation', label: 'Municipal Adaptation Planning' },
  { key: 'rehabilitation', label: 'Post-Disaster Rehabilitation and Reconstruction' },
] as const;
export type TaskTeamKey = (typeof TASK_TEAMS)[number]['key'];

export type Measure = { key: string; label: string; pct: number; detail: string; vars?: Record<string, string | number> };

export type ReadinessInput = {
  now: Date;
  /** Is there a JOC duty chair for this month? */
  chairThisMonth: boolean;
  /** Duties held by people on duty or standby right now. */
  dutiesNow: string[];
  /** Departments (keys) and which have a JOC representative recorded. */
  departments: string[];
  withRepresentative: string[];
  /** Each department's last plan review (ISO date), where known. */
  planReviewed: Record<string, string | null>;
  /** The reception centres in the register. */
  halls: Array<{ capacity: number; keyHolderPhone: string | null; active: boolean }>;
  /** The four relief materials: in storage and minimum. */
  stock: Array<{ key: string; quantity: number; minimum: number }>;
  /** When the Advisory Forum last met (ISO date), if ever. */
  lastForum: string | null;
  /** The task teams with a chair. */
  teamsWithChair: string[];
};

const DAY = 24 * 3600_000;
const share = (n: number, of: number) => (of > 0 ? Math.round((100 * n) / of) : 0);

/**
 * The eight measures. A hall is ready when it has room and a key holder to
 * phone; stock counts once a minimum is set for it; the Forum meets every
 * quarter, so a meeting in the last 92 days counts.
 */
export function readinessMeasures(x: ReadinessInput): Measure[] {
  const standby = x.dutiesNow.includes('Principal Disaster Management Stand-by Officer');
  const duty = x.dutiesNow.includes('MDMC Duty Officer');
  const others = x.departments.filter((d) => d !== 'disaster');
  const reps = others.filter((d) => x.withRepresentative.includes(d)).length;
  const reviewed = x.departments.filter((d) => {
    const on = x.planReviewed[d];
    return on != null && x.now.getTime() - Date.parse(on) <= 366 * DAY;
  }).length;
  const halls = x.halls.filter((h) => h.active);
  const ready = halls.filter((h) => h.capacity > 0 && Boolean(h.keyHolderPhone));
  const stocked = x.stock.filter((s) => s.minimum > 0 && s.quantity >= s.minimum).length;
  const forumDays = x.lastForum ? Math.floor((x.now.getTime() - Date.parse(x.lastForum)) / DAY) : null;
  return [
    { key: 'chair', label: 'JOC duty chair rostered for this month', pct: x.chairThisMonth ? 100 : 0, detail: x.chairThisMonth ? 'Rostered' : 'Not rostered' },
    {
      key: 'standby', label: 'Principal stand-by officer and duty officer named', pct: (standby ? 50 : 0) + (duty ? 50 : 0),
      detail: standby && duty ? 'Both on the roster now' : standby ? 'No duty officer now' : duty ? 'No stand-by officer now' : 'Not named',
    },
    { key: 'reps', label: 'Every department has a JOC representative', pct: share(reps, others.length), detail: '{n} of {all}', vars: { n: reps, all: others.length } },
    { key: 'plans', label: 'Departmental plans reviewed in the last 12 months', pct: share(reviewed, x.departments.length), detail: '{n} of {all}', vars: { n: reviewed, all: x.departments.length } },
    {
      key: 'halls', label: 'Community halls ready for evacuation and shelter', pct: share(ready.length, halls.length),
      detail: '{n} ready, capacity {cap}', vars: { n: ready.length, cap: ready.reduce((s, h) => s + h.capacity, 0) },
    },
    { key: 'stock', label: 'Relief stock at or above minimum levels', pct: share(stocked, 4), detail: '{n} of {all} items', vars: { n: stocked, all: 4 } },
    {
      key: 'forum', label: 'Advisory Forum meeting every quarter', pct: forumDays != null && forumDays <= 92 ? 100 : 0,
      detail: forumDays == null ? 'No meeting recorded' : 'Last met {d} days ago', vars: forumDays == null ? undefined : { d: forumDays },
    },
    { key: 'teams', label: 'Each of the five task teams has a chair', pct: share(x.teamsWithChair.length, 5), detail: '{n} of {all}', vars: { n: x.teamsWithChair.length, all: 5 } },
  ];
}

export const readinessScore = (m: Measure[]) => (m.length ? Math.round(m.reduce((s, x) => s + x.pct, 0) / m.length) : 0);

export type IdpIncident = {
  hazard: string | null; informalSettlement: boolean;
  /** The latest sitrep figures (people_affected, dead, households_affected, homes_destroyed, homes_damaged …). */
  figures: Record<string, number>;
  /** Deceased in the casualty register. */
  deceased: number;
  /** People affected given when the incident was added. */
  victims: number | null;
};

export type IdpInput = {
  incidents: IdpIncident[];
  /** People on the ward beneficiary lists this year (C69). */
  wardPeople: number;
  population: number | null;
  warningsL4: number;
  readinessSessions: number;
  reviewsSignedOff: number;
};

export type IdpFigures = {
  c69: number;
  deaths: number;
  fd12: number | null;
  c73: number;
  c74: number;
  byRisk: Array<{ risk: string; incidents: number; affected: number; deaths: number }>;
  warningsL4: number; readinessSessions: number; reviewsSignedOff: number;
};

const deathsOf = (i: IdpIncident) => Math.max(i.figures.dead ?? 0, i.deceased);
const affectedOf = (i: IdpIncident) => Math.max(i.figures.people_affected ?? 0, i.victims ?? 0);
const dwellingsOf = (i: IdpIncident) =>
  Math.max(i.figures.households_affected ?? 0, (i.figures.homes_destroyed ?? 0) + (i.figures.homes_damaged ?? 0));

/** The IDP's disaster figures for one financial year (revision 2, section 11). */
export function idpFigures(x: IdpInput): IdpFigures {
  const deaths = x.incidents.reduce((s, i) => s + deathsOf(i), 0);
  const fires = x.incidents.filter((i) => priorityRisk(i.hazard) === 'Fires in formal and informal settlements' && i.informalSettlement);
  return {
    c69: x.wardPeople,
    deaths,
    fd12: x.population ? Math.round((deaths / x.population) * 100_000 * 100) / 100 : null,
    c73: fires.length,
    c74: fires.reduce((s, i) => s + dwellingsOf(i), 0),
    byRisk: PRIORITY_RISKS.map((risk) => {
      const mine = x.incidents.filter((i) => priorityRisk(i.hazard) === risk);
      return { risk, incidents: mine.length, affected: mine.reduce((s, i) => s + affectedOf(i), 0), deaths: mine.reduce((s, i) => s + deathsOf(i), 0) };
    }),
    warningsL4: x.warningsL4, readinessSessions: x.readinessSessions, reviewsSignedOff: x.reviewsSignedOff,
  };
}
