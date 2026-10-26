/**
 * The City's line functions and what each does during disaster operations,
 * in the words of the eThekwini Municipal Disaster Management Plan
 * (rev. 7 Aug 2012), "Council departmental pre-disaster management plans and
 * role responsibilities during disaster operations", pp. 20–32. The planning
 * obligations every department shares (compile plans, submit them, keep the
 * staff resources database) are kept apart for the readiness record; the
 * roles below are the ones a department carries out on an incident.
 *
 * The database (0113) checks the keys; keep them in step.
 */

export type LineFunction = {
  key: string;
  name: string;
  /** Who the Plan holds responsible. */
  head: string;
  /** "Role during disaster operations", as the Plan words them. */
  roles: string[];
  /** A few figures the desk keeps for this department on an incident. All optional. */
  figures: Array<{ key: string; label: string }>;
};

/** Every department's first duty on an incident (the Plan: "Provide a representative at the DOC if this has been activated"). */
export const DOC_REPRESENTATIVE = 'Provide a representative at the DOC if this has been activated';

/** Duties the Plan gives every line function before any incident. */
export const PLANNING_OBLIGATIONS = [
  'Compilation of pro-active departmental disaster risk management programmes to support disaster risk reduction',
  'Compilation of reactive departmental disaster management plans to ensure service continuation during emergency/disaster situations',
  'Submit departmental disaster management plans to the Head of Disaster Management and ensure regular review of such plans',
  DOC_REPRESENTATIVE,
  'Establish and maintain a departmental staff resources database of all staff in managerial positions, their post designations, areas of responsibility and contact details, and forward it to the Head of the Municipal Disaster Management Centre',
];

export const LINE_FUNCTIONS: LineFunction[] = [
  {
    key: 'disaster', name: 'Disaster Management and Emergency Control', head: 'Head: Disaster Management and Emergency Control',
    roles: [
      'When deemed necessary, consider the declaration of a local state of disaster as per the Disaster Management Act 57 of 2002',
      'Liaise with provincial and national officials [PDMC and NDMC]',
      'Activate the DOC and call the Strategic Coordination Group into session',
      'Secure resources as required',
      'Assist the Strategic Coordination Group in the decision making process',
      'Maintain ongoing assessment of the threat/hazard and co-ordinate appropriate responses',
    ],
    figures: [],
  },
  {
    key: 'emacc', name: 'Emergency Mobilizing and Communications Centre (EMACC)', head: 'Manager: EMACC',
    roles: [
      'Provide and support the disaster management centre with a twenty four hour communication facility for the notification of major incidents and any subsequent communication needs as determined by internal SOPs',
      'Providing support staff from EMACC during DOC operations',
      'Sourcing and mobilizing resources as required',
      'Updating the FCP/EOC and DOC with relevant information',
      'Maintain a comprehensive data base of senior council staff contact details and departmental standby rosters',
    ],
    figures: [],
  },
  {
    key: 'metro', name: 'Metropolitan Police', head: 'Head: Metropolitan Police',
    roles: [
      'Coordinating incident response with the South African Police Service and the other responding emergency and essential Services',
      'Protecting the safety of emergency responders, evacuated areas, affected communities and damaged or threatened properties',
      'In conjunction with the eThekwini Transport Authority, determine emergency response routes and safest/quickest evacuation routes for affected communities or communities under threat',
      'Implement the traffic management plan, cordon off roads and control access/egress to and from the affected areas',
      'Notify the public of evacuation procedures through alternate means such as vehicle public address systems, warning sirens or door to door notification',
      'Assist with directing the evacuation of public',
      'Assist the SAPS with securing the evacuated area',
      'Establish and control emergency resource vehicle and equipment staging points',
    ],
    figures: [{ key: 'roads_closed', label: 'Roads closed' }, { key: 'officers_deployed', label: 'Officers deployed' }],
  },
  {
    key: 'fire', name: 'Fire and Emergency Services', head: 'Head: Fire and Emergency Services',
    roles: [
      'Implement incident management procedures with all other responding safety, security, emergency and essential services',
      'Carry out fire and emergency services as dictated by legislation and internal procedures',
      'Maintain a minimum staffing level in accordance with an approved Operations Plan',
      'Notify public of evacuation procedures through alternate means such as vehicle public address systems, and liaise with other security, emergency and essential services to establish an FCP at Public Assembly Areas and/or Emergency Shelters',
      'Assist with plume dispersion modeling and tracking',
    ],
    figures: [{ key: 'people_rescued', label: 'People rescued' }, { key: 'appliances', label: 'Appliances on scene' }],
  },
  {
    key: 'health', name: 'Health Unit', head: 'Head: Health',
    roles: [
      'Determine health risks and prepare counter measures',
      'Assist with interpretation of technical information and provide guidance in terms of remedial/response procedures',
      'Assist with early warning to public, evacuation of people and liaise with Provincial and National Health Departments who are responsible for the provision of interventions during any major emergencies',
      'Assist with plume dispersion modeling and tracking',
      'Assist with the management of emergency shelter, evacuation assembly points and mass care facilities for persons displaced by emergencies or disasters',
      'Identify victims, responders or affected persons who may require medical follow-up and/or who may require psychological support. Facilitate this support which may be provided by the appropriate governmental and non-governmental agencies as applicable',
      'In collaboration with the Safer Cities Unit, assist with support programmes for indigent persons',
      'Consider the requirements for mortuary facilities in the event of mass fatalities',
    ],
    figures: [{ key: 'medical_followup', label: 'People referred for medical follow-up' }, { key: 'psychosocial', label: 'People referred for psychological support' }],
  },
  {
    key: 'safer', name: 'Safer Cities', head: 'Head: Safer Cities',
    roles: [
      'Deploy staff to selected Reception Centre[s] and manage the Centre, assisted by staff from Health, EMRS, SAPS, Parks and Recreation and Security Management and Community Participation',
      'In collaboration with the Health Unit, assist with support programmes for indigent persons',
    ],
    figures: [{ key: 'centres_staffed', label: 'Reception centres staffed' }],
  },
  {
    key: 'parks', name: 'Parks, Recreation and Cemeteries', head: 'Head: Parks, Recreation and Cemeteries',
    roles: [
      'Make available facilities for emergency assembly and/or shelter of persons displaced by emergencies or disasters',
      'Maintain a comprehensive list of all council halls, including contact details of contact people [key holders] and ensure the availability of halls and municipal facilities to serve as emergency public reception centres',
      'Plan and assist with the management of emergency shelters, evacuation assembly points and mass care facilities for persons displaced by emergencies or disasters',
      'Consider the requirements for mass burials if necessary',
    ],
    figures: [{ key: 'halls_opened', label: 'Halls made available' }],
  },
  {
    key: 'housing', name: 'Housing', head: 'Head: Housing',
    roles: ['Coordinate the provision of temporary shelter where Community Halls are unavailable to house displaced persons'],
    figures: [{ key: 'temporary_shelters', label: 'Temporary shelters provided' }],
  },
  {
    key: 'fleet', name: 'City Fleet', head: 'Head: City Fleet',
    roles: [
      'Sourcing emergency modes of transportation to move evacuees to identified Reception Areas',
      'The provision of heavy construction plant equipment or heavy duty vehicles e.g excavators, tipper trucks etc. and transportation using lowbed trailers',
      'Technical mechanical support to maintain operational and response vehicles, plant and equipment on scene, the supply of fuel for vehicles, plant and equipment (mobile fuel tanker service)',
      'The hire of specialize equipment if need be',
      'Provision of transport for mass evacuation',
      'Live tracking and mapping of vehicles to coordinate the deployment of on scene resources',
    ],
    figures: [{ key: 'vehicles_sent', label: 'Vehicles sent' }, { key: 'people_moved', label: 'People moved' }],
  },
  {
    key: 'eta', name: 'eThekwini Transport Authority (ETA)', head: 'Head: ETA',
    roles: [
      'In conjunction with the Metro Police, determine emergency response routes and safest/quickest evacuation routes for affected communities or communities under threat',
      'Install directional sign-boards indicating evacuation routes',
      'Assist in sourcing emergency modes of transportation such as "Dial-a-Ride" to move physically challenged evacuees',
    ],
    figures: [],
  },
  {
    key: 'water', name: 'Water and Sanitation', head: 'Head: Water and Sanitation',
    roles: [
      'Identifying and prioritizing essential services that may require restoration as a result of an emergency or disaster',
      'Monitor pollution levels',
      'Maintain/divert water supply for fire fighting',
      'Provide a supply of water to assembly/reception areas',
      'Provide resources to meet sanitation requirements',
    ],
    figures: [{ key: 'water_tankers', label: 'Water tankers sent' }, { key: 'temporary_toilets', label: 'Temporary toilets set up' }],
  },
  {
    key: 'electricity', name: 'Electricity', head: 'Head: Electricity',
    roles: [
      'Identifying and prioritizing essential services that may require restoration as a result of an emergency or disaster',
      'Restoration of electrical power to the affected area',
      'Coordinating response with businesses and industries affected by the emergency',
      'Planning alternate electrical supply',
      'Provision of vehicles and staffing as required',
      'Set up temporary supply to evacuation assembly/reception points if required',
    ],
    figures: [{ key: 'homes_without_power', label: 'Homes without power' }],
  },
  {
    key: 'engineering', name: 'Engineering', head: 'Head: Engineering',
    roles: [
      'Identifying buildings which are unsafe',
      'Plan and ensure that risk reduction and disaster mitigation principles are adhered to in the recovery and redevelopment phases',
      'Ensure that risk reduction and mitigation principles are applied in all development projects',
      'Provide a heavy plant and equipment as required',
    ],
    figures: [{ key: 'unsafe_buildings', label: 'Unsafe buildings identified' }],
  },
  {
    key: 'waste', name: 'Solid Waste', head: 'Head: Solid Waste',
    roles: [
      'Advising of and providing facilities for the disposal of hazardous waste',
      'Advising of and providing facilities for incineration',
      'Provision of refuse bags and/or skips for the collection of debris and waste from affected area',
      'Maintain a schedule for waste removal from Assembly/Reception Area',
    ],
    figures: [{ key: 'skips', label: 'Skips provided' }],
  },
  {
    key: 'security', name: 'Security Management', head: 'Head: Security Management',
    roles: [
      'Coordinating incident response with the South African Police Service and other responding Emergency and Essential Services',
      'Assist with the protection of emergency responders, evacuated areas, affected communities and damaged or threatened Council properties',
      'Deploy a team/s to secure the facilities which serve as Assembly/Reception Areas',
      'Maintain order at these points where these points are Council owned',
      'Deploy contract guards for protracted incident/s',
    ],
    figures: [],
  },
  {
    key: 'communications', name: 'Communications and Public Relations', head: 'Head: Communications',
    roles: [
      'Establishing a media liaison point and setting up media briefing arrangements',
      'Nominating a media liaison officer and oversee all aspects of media response',
      'Liaise with media liaison officer from the agency on whose premises the incident occurred so as to ensure consolidated media information management',
      'Establish press conferences and prepare media briefings and press releases',
      'Liaise with public broadcasters and local radio stations. Prepare public notification messages ensuring that the public is regularly informed throughout the incident including information on public protective strategies and follow up messages',
    ],
    figures: [],
  },
  {
    key: 'gipo', name: 'Geographic Information and Policy (GIPO)', head: 'Head: GIPO',
    roles: [
      'Ensure that adequate disaster recovery procedures for IT infrastructure and information management is undertaken',
      'Supplying IT infrastructure and assets, including GIS operators and IT systems which can assist in disaster risk management',
    ],
    figures: [],
  },
  {
    key: 'dpem', name: 'Development Planning, Environment and Management', head: 'Head: Development Planning, Environment and Management',
    roles: [
      'Ensure that risk reduction and mitigation principles are applied as part of the environmental input into all development projects, including the identification of possible environmental disasters',
      'Include the reduction of natural disasters as an element in environmental education programmes',
    ],
    figures: [],
  },
  {
    key: 'treasury', name: 'Treasury', head: 'DCM: Finance',
    roles: [
      'Have available funds to cover all costs that may be incurred as a result of a major emergency or disaster occurring',
      'Review the requirements for emergency procurement where such procurement cannot follow the normal SCM procurement procedures',
      'Develop a process that will allow the DOC and municipal departments to access emergency funding',
    ],
    figures: [],
  },
];

export const lineFunction = (key: string) => LINE_FUNCTIONS.find((d) => d.key === key) ?? null;

/** How far each duty has got on the incident. */
export const DUTY_STATES = ['Done', 'Under way', 'Not needed'] as const;
export type DutyState = (typeof DUTY_STATES)[number];
export const REPORT_STATES = ['Not started', 'In progress', 'Done'] as const;
export type ReportState = (typeof REPORT_STATES)[number];

/**
 * The departments an incident needs, from its hazard: Metro Police always
 * (road control and cordons on every incident), Disaster Management always,
 * then those the Plan gives the work to. The desk adds or leaves out any.
 */
export function departmentsFor(hazard: string | null | undefined): string[] {
  const h = hazard ?? '';
  const base = ['disaster', 'metro'];
  const add = (() => {
    if (/Flood|Storm tide|Severe storm|Cyclone/.test(h)) return ['fire', 'engineering', 'water', 'electricity', 'safer', 'parks', 'health', 'housing', 'fleet', 'waste', 'communications'];
    if (/informal settlement fire|Wildfire|Arson/.test(h)) return ['fire', 'safer', 'parks', 'health', 'housing', 'electricity', 'waste'];
    if (/Hazardous materials|Industrial|Nuclear/.test(h)) return ['fire', 'health', 'water', 'communications', 'dpem', 'security'];
    if (/Landslip|sinkhole|Structural collapse|Earthquake|Erosion|Dam failure/.test(h)) return ['engineering', 'fire', 'housing', 'safer', 'parks', 'health'];
    if (/Epidemic|Animal disease|Emerging|Insect|Food and crop/.test(h)) return ['health', 'communications', 'safer', 'water'];
    if (/Civil disturbance|Terrorist|Shooting|Sabotage/.test(h)) return ['security', 'communications', 'health'];
    if (/Failure of critical infrastructure|IT virus/.test(h)) return ['electricity', 'water', 'engineering', 'gipo', 'communications'];
    if (/Drought|Extreme temperature/.test(h)) return ['water', 'health', 'communications'];
    if (/transport accident|Aeronautical/.test(h)) return ['fire', 'health', 'eta'];
    return [];
  })();
  return [...new Set([...base, ...add])];
}

/** The hazard a call type from the call-taking catalogue means (the Plan's list). */
export function hazardForCallType(type: string | null | undefined, text?: string | null): string | null {
  const t = `${type ?? ''}`.toLowerCase();
  const said = `${text ?? ''}`.toLowerCase();
  if (/flood/.test(t)) return 'Flood';
  if (/storm|tree fallen/.test(t)) return 'Severe storm';
  if (/landslide|mudslide/.test(t)) return 'Landslip or debris flow';
  if (/sinkhole/.test(t)) return 'Major sinkhole';
  if (/coastal surge|high seas/.test(t)) return 'Storm tide';
  if (/informal settlement fire|shack/.test(t)) return 'Structure or informal settlement fire';
  if (/chemical|hazmat|gas leak/.test(t)) return 'Hazardous materials accident';
  if (/building collapse|collapse/.test(t)) return 'Structural collapse';
  if (/transformer|substation|power line|electric/.test(`${t} ${said}`)) return 'Failure of critical infrastructure or services';
  if (/fire/.test(t)) return 'Structure or informal settlement fire';
  return null;
}

/** How people were moved (sitrep). */
export const MOVED_BY = ['On foot', 'City Fleet bus', 'Municipal vehicle', 'Ambulance', 'Boat', 'Helicopter', 'Own transport', 'Other'] as const;

/** A shelter's supplies, as the desk reports them. */
export const SUPPLY_STATES = ['Enough', 'Running low', 'None'] as const;
export const WATER_SUPPLY = ['Mains', 'Water tanker', 'Bottled', 'None'] as const;
