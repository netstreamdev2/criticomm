import type { CoordinationLevel } from './disaster-plan.ts';

/**
 * Levels, the JOC and after the response (0117), as data for the desk, in
 * the words of the Directorate's process (Disaster incident management,
 * revision 2, October 2026, sections 2, 4, 6, 9, 10 and 12). The database
 * checks the same keys; keep them in step.
 */

export type Trigger = { key: string; label: string; auto?: boolean };

export const LEVEL_TRIGGERS: Record<CoordinationLevel, Trigger[]> = {
  Bronze: [
    { key: 'b_emacc', label: 'Incident reported to EMACC', auto: true },
    { key: 'b_sops', label: 'EMACC dispatched designated services under its SOPs', auto: true },
    { key: 'b_fcp', label: 'More than one service on scene, coordinating through an FCP' },
  ],
  Silver: [
    { key: 's_site_plan', label: 'Incident at a National Key Point or major hazard installation whose emergency plan opens an EOC' },
    { key: 's_declared', label: 'On-scene commander declares the incident is escalating or threatening to' },
    { key: 's_unified', label: 'Several agencies need a unified command at the site' },
    { key: 's_eoc', label: 'A joint EOC has been set up at or near the scene' },
  ],
  Gold: [
    { key: 'g_saws4', label: 'SA Weather Service impact-based warning at Level 4 or higher' },
    { key: 'g_no_plan', label: 'Major incident or disaster at premises with no emergency plan or EOC' },
    { key: 'g_strategic', label: 'Strategic coordination of City resources is needed' },
    { key: 'g_many', label: 'Response needs several departments, units, clusters and external bodies' },
    { key: 'g_exceeds', label: 'Impact exceeds what those affected and responders can handle with their own resources' },
    { key: 'g_public', label: 'Public protective actions, warnings or mass evacuation are needed' },
    { key: 'g_declare', label: 'A local state of disaster may need to be declared' },
    { key: 'g_event', label: 'Pre-planned major event approved by Disaster Management' },
  ],
};

export const triggerLabel = (key: string) =>
  Object.values(LEVEL_TRIGGERS).flat().find((t) => t.key === key)?.label ?? key;

/** Who decides at each level, and what the desk records (revision 2, section 1). */
export const LEVEL_DECIDES: Record<CoordinationLevel, string> = {
  Bronze: 'No decision needed: every logged incident starts at Bronze.',
  Silver: 'The on-scene commander declares it, or it is automatic under a site emergency plan. The EOC commander tells EMACC.',
  Gold: 'The Principal Disaster Management Stand-by Officer; in their absence the Head, Deputy Head or a Senior Manager of Disaster Management, or the Duty Officer.',
};

/** Who may authorise the JOC. */
export const JOC_AUTHORISERS = [
  'Principal Disaster Management Stand-by Officer', 'Head of Disaster Management', 'Deputy Head of Disaster Management',
  'Senior Manager: Disaster Management', 'Duty Officer',
] as const;

/** The duties on the roster whose holder may authorise the JOC. */
export const ROSTER_AUTHORISERS: Record<string, (typeof JOC_AUTHORISERS)[number]> = {
  'Principal Disaster Management Stand-by Officer': 'Principal Disaster Management Stand-by Officer',
  'MDMC Duty Officer': 'Duty Officer',
};

export type Check = { key: string; label: string };

/** Step 6: the Silver checklist (the 2012 plan). */
export const SILVER_CHECKS: Check[] = [
  { key: 'silver_emacc', label: 'EMACC notified' },
  { key: 'silver_duty', label: 'Duty Officer and Principal Stand-by Officer informed' },
  { key: 'silver_resources', label: 'Resources assessed' },
  { key: 'silver_heads', label: 'Heads of departments on standby' },
  { key: 'silver_sitreps', label: 'Sitreps flowing' },
];

/** Step 8: the JOC's core team and who is told. */
export const JOC_ACTIVATION: Check[] = [
  { key: 'joc_core_team', label: 'Core team called in: Principal Stand-by Officer, Duty Officer, EMACC operator, CCTV operator, incident logger' },
  { key: 'joc_dcm', label: 'Deputy City Manager on stand-by informed' },
  { key: 'joc_bulk_sms', label: 'Bulk SMS sent with the reason' },
  { key: 'joc_pdmc', label: 'Provincial Disaster Management Centre told' },
];

/** Step 11: the JOC's duties. */
export const JOC_DUTIES: Check[] = [
  { key: 'duty_meet', label: 'Meet daily, or as needed, on the extent of damage and each department’s progress' },
  { key: 'duty_resources', label: 'Decide on extra services, resources and mutual aid agreements' },
  { key: 'duty_public', label: 'Decide public protective actions; issue warnings, evacuation alerts and advisories through Communications' },
  { key: 'duty_pdmc', label: 'Update the Provincial Disaster Management Centre' },
  { key: 'duty_declare', label: 'Assess the need for a local disaster declaration and recommend it to the PDMC' },
  { key: 'duty_report', label: 'Report to the Portfolio Committee, EXCO and the PDMC (for the NDMC)' },
];

/** Step 9: who may sit on the JOC. Ward councillors of the affected wards are added by name. */
export const JOC_INTERNAL_UNITS = [
  'CCTV', 'EMACC', 'Security Management', 'Safer Cities', 'Communications and Community Participation', 'Disaster Management',
  'Electricity', 'Engineering', 'Treasury', 'Development Planning and Environment', 'Fire and Emergency Services', 'Health',
  'Human Settlements', 'IT and GIS (GIPO)', 'Metro Police', 'Solid Waste and Cleansing', 'Waste Water', 'Water',
  'Parks, Recreation and Culture', 'City Fleet', 'eThekwini Transport Authority',
] as const;
export const JOC_EXTERNAL_AGENCIES = [
  'Social Development, Agriculture and Education', 'Emergency Medical Rescue Services', 'Provincial Health', 'SA Police Service',
  'SA Weather Service', 'Transport and Road Traffic Inspectorate', 'SANRAL', 'NGOs and relief organisations',
  'Religious and welfare organisations', 'Technical specialists and academia',
] as const;
export const JOC_MEMBER_KINDS = ['Internal unit', 'External agency', 'Ward councillor'] as const;

/** Section 12: the incident's status for Disaster Management, and where each may go next. */
export const DM_STATUSES = ['Active', 'Stood down', 'In recovery', 'Closed'] as const;
export type DmStatus = (typeof DM_STATUSES)[number];
export const NEXT_STATUS: Record<DmStatus, DmStatus[]> = {
  Active: ['Stood down', 'Closed'],
  'Stood down': ['In recovery', 'Closed', 'Active'],
  'In recovery': ['Closed', 'Active'],
  Closed: ['Active'],
};
/** The button for each move, and who decides it (revision 2, section 2). */
export const STATUS_MOVE: Record<DmStatus, { label: string; decides: string }> = {
  Active: { label: 'Reopen', decides: 'Principal DM Stand-by Officer or Duty Officer' },
  'Stood down': { label: 'Stand down', decides: 'Principal DM Stand-by Officer or Duty Officer' },
  'In recovery': { label: 'Start recovery', decides: 'Director: Disaster Management or Duty Officer' },
  Closed: { label: 'Close the incident', decides: 'Director: Disaster Management or Duty Officer' },
};

export const RECOVERY_STATES = ['Not started', 'In progress', 'Done', 'Handed over'] as const;
export type RecoveryState = (typeof RECOVERY_STATES)[number];

/** Section 9: the eight recovery tasks, building back better. */
export const RECOVERY_TASKS: Array<{ key: string; label: string; owner: string }> = [
  { key: 'unsafe_buildings', label: 'Unsafe buildings identified', owner: 'Engineering' },
  { key: 'services', label: 'Essential services restored', owner: 'Water and Sanitation; Electricity' },
  { key: 'debris', label: 'Debris and waste cleared', owner: 'Durban Solid Waste' },
  { key: 'rehoused', label: 'Displaced people rehoused from reception centres', owner: 'Human Settlements; Safer Cities' },
  { key: 'risk_reduction', label: 'Risk reduction applied in rebuilding', owner: 'Engineering; Development Planning' },
  { key: 'funding', label: 'Recovery funding arranged', owner: 'Treasury' },
  { key: 'social_relief', label: 'Social relief provided to affected households', owner: 'Social Development; Safer Cities' },
  { key: 'reported', label: 'Rehabilitation progress reported to PDMC and NDMC', owner: 'Director: Disaster Management' },
];

/** Tasks still open: not done and not handed over (closing from recovery asks about these). */
export function openRecoveryTasks(recovery: Record<string, { state?: string } | undefined>): number {
  return RECOVERY_TASKS.filter((t) => !['Done', 'Handed over'].includes(recovery[t.key]?.state ?? 'Not started')).length;
}

/** Section 10: the review's fields and its four sign-offs. */
export const REVIEW_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'what_happened', label: 'What happened' },
  { key: 'what_worked', label: 'What worked' },
  { key: 'to_improve', label: 'What needs to improve' },
  { key: 'lessons', label: 'Lessons learnt' },
  { key: 'recommendations', label: 'Recommended changes' },
];
export const REVIEW_SIGNOFFS: Check[] = [
  { key: 'shared', label: 'Report shared with stakeholders' },
  { key: 'pdmc_ndmc', label: 'Submitted to the PDMC and NDMC' },
  { key: 'forum', label: 'Plan changes referred to the Advisory Forum' },
  { key: 'director', label: 'Signed off by the Director: Disaster Management' },
];
