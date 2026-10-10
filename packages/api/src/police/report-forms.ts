/**
 * The seven Durban Metro Police (DMPS) report forms an officer completes when
 * a call is closed, field for field as the department files them:
 *
 *   12A     Arrest Report (DMPS 12(a))
 *   CR1     Crash Report
 *   VI      Vehicle Inspection
 *   216E    Use of Official Firearm (DMPS 216(e))
 *   SANRAL  Incident Report (SANRAL RIMS)
 *   211A    Tow In (DMPS 211(a))
 *   DOG     Dog Capture / Tackle
 *
 * The officer picks one or more for a call. Field keys here are local to their
 * form; report-types.ts prefixes them with the form id when it composes the
 * report, so two forms never collide.
 */
import type { ReportField, ReportSection } from './report-types.ts';

export type PoliceReportForm = {
  id: string;
  /** The form's number on paper. */
  code: string;
  label: string;
  /** One line under the form's name in the picker. */
  summary: string;
  sections: readonly ReportSection[];
};

/* ── Field helpers ────────────────────────────────────────────────────────── */

const t = (key: string, label: string, placeholder?: string): ReportField => ({ key, label, kind: 'text', placeholder });
const ml = (key: string, label: string, placeholder?: string): ReportField => ({ key, label, kind: 'multiline', placeholder });
const num = (key: string, label: string): ReportField => ({ key, label, kind: 'number' });
const date = (key: string, label: string): ReportField => ({ key, label, kind: 'date' });
const time = (key: string, label: string): ReportField => ({ key, label, kind: 'time' });
const yn = (key: string, label: string): ReportField => ({ key, label, kind: 'yesno' });
const pick = (key: string, label: string, options: readonly string[]): ReportField => ({ key, label, kind: 'choice', options });
const many = (key: string, label: string, options: readonly string[]): ReportField => ({ key, label, kind: 'multi', options });
const check = (key: string, label: string): ReportField => ({ key, label, kind: 'check', options: ['OK', 'Fault', 'NIL'] });
const req = (f: ReportField): ReportField => ({ ...f, required: true });

/* ── Shared lists ─────────────────────────────────────────────────────────── */

const SEX = ['Male', 'Female', 'Unknown'] as const;
const RACE = ['African', 'Coloured', 'Indian/Asian', 'White', 'Unknown'] as const;
const POPULATION = ['Black African', 'Coloured', 'Indian/Asian', 'White', 'Other', 'Unknown'] as const;
const RANKS_12A = [
  'Constable', 'Lance Corporal', 'Corporal', 'Sergeant', 'Warrant Officer', 'Lieutenant', 'Captain', 'Major',
  'Lieutenant Colonel', 'Colonel',
] as const;
const RANKS_216E = [
  'Constable', 'Lance Corporal', 'Corporal', 'Sergeant', 'Warrant Officer', 'Inspector', 'Captain', 'Major',
  'Lieutenant Colonel', 'Colonel', 'Brigadier', 'Major General', 'Lieutenant General', 'General',
] as const;
const CALIBRES = [
  '9mm Parabellum', '.38 Special', '.357 Magnum', '.40 S&W', '.45 ACP', '5.56×45mm NATO', '7.62×39mm',
  '7.62×51mm NATO', '12 Gauge', '.22 LR', '.308 Winchester', 'Other',
] as const;
const INJURY = ['Fatal', 'Serious', 'Slight', 'No injury'] as const;
const RESTRAINT = ['SB available used', 'SB available not used', 'H used', 'H not used', 'Unknown'] as const;

/* ── 12A Arrest Report ────────────────────────────────────────────────────── */

const ARREST: PoliceReportForm = {
  id: 'arrest', code: '12A', label: 'Arrest Report',
  summary: 'DMPS 12(a): the arrest, its references, the suspect and any recovered vehicle.',
  sections: [
    { title: 'Arresting officer', fields: [
      pick('off_rank', 'Rank', RANKS_12A), t('off_force', 'Force No.'), t('off_name', 'Name'),
      t('off_region', 'Region'), t('off_section', 'Section'),
    ] },
    { title: 'Arrest type', fields: [
      req(pick('arrest_type', 'Type of arrest', ['ARREST (Dog Tackle)', 'ARREST (DWD)', 'ARREST (OTHER)', 'ARREST (ASSIST)'])),
      pick('info_source', 'How was information obtained?', ['DMPS RADIO', 'SAPS RADIO', 'DMPS 84 / DMPS 20', 'COMMUNITY', 'OBSERVATION', 'INFORMANT']),
      ml('complaint', 'Complaint / informant details'),
    ] },
    { title: 'DMPS reference numbers', fields: [
      t('dmps_station', 'DMPS station'), t('ob_no', 'OB No.'), t('dog_reg', 'Dog Reg. No.'),
      t('firearm_reg', 'Firearm Reg. No.'), t('occ_no', 'OCC No.'), t('ref_no', 'REF. No.'),
    ] },
    { title: 'SAPS reference numbers', fields: [
      t('saps_station', 'SAPS station'), t('saps_cas', 'CAS No.'), t('saps14', 'SAPS 14 No.'), t('saps70', 'SAPS 70 No.'),
      t('saps13', 'SAPS 13 No.'), t('saps_ob', 'SAPS OB No.'), t('hosp_ref', 'Hospital Ref. No.'),
    ] },
    { title: 'Arresting details', fields: [
      date('arr_date', 'Date of arrest'), time('arr_time', 'Time of arrest'),
      t('taken_over', 'Taken over by SAPS', 'Name / station'), t('offence', 'Offence (if arrest made)'),
    ] },
    { title: 'Location of arrest', fields: [
      t('road', 'Road / street address no.'), t('house_no', 'House No.'), t('building', 'Building name'),
      t('floor', 'Floor / flat No.'), t('between', 'Between intersections', 'Between [Street A] and [Street B]'),
      t('gis', 'GIS / GPS reading'), t('district', 'District / region'), t('roadblock', 'Roadblock / operation at'),
    ] },
    { title: "Suspect's details", fields: [
      t('first_name', 'First name'), t('second_names', 'Second names'), t('surname', 'Surname'), num('age', 'Age'),
      pick('sex', 'Sex', SEX), pick('race', 'Race', ['African', 'White', 'Coloured', 'Indian/Asian', 'Other']),
      t('id_no', 'Identity No.'), ml('address', 'Full address'), t('postcode', 'Post code'),
    ] },
    { title: "Suspect's vehicle / recovered vehicle", fields: [
      t('veh_reg', 'Registration No.'),
      pick('veh_type', 'Type', ['Car/Sedan', 'Hatchback', 'Bakkie/Pickup', 'SUV/4x4', 'Minibus/Taxi', 'Truck', 'Bus', 'Motorcycle', 'Bicycle', 'Other']),
      pick('veh_colour', 'Colour', ['Black', 'White', 'Silver/Grey', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Brown', 'Gold/Champagne', 'Maroon', 'Other']),
      pick('veh_make', 'Make', ['Toyota', 'Volkswagen', 'Ford', 'Nissan', 'BMW', 'Mercedes-Benz', 'Hyundai', 'Kia', 'Renault', 'Chevrolet', 'Honda', 'Suzuki', 'Isuzu', 'Opel', 'Peugeot', 'Other']),
      num('veh_value', 'Value of recovered stolen vehicle (R)'), t('veh_other', 'Other details'),
    ] },
  ],
};

/* ── CR1 Crash Report ─────────────────────────────────────────────────────── */

const CR1_MAKES = [
  'Alfa Romeo', 'Audi', 'BMW', 'Chery', 'Chevrolet', 'Citroën', 'Daihatsu', 'Ford', 'GWM', 'Haval', 'Honda', 'Hyundai',
  'Isuzu', 'JAC', 'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Mahindra', 'Mazda', 'Mercedes-Benz', 'Mitsubishi', 'Nissan',
  'Opel', 'Peugeot', 'Porsche', 'Renault', 'Subaru', 'Suzuki', 'Toyota', 'Volkswagen', 'Volvo', 'Other',
] as const;
const CR1_VEHICLE_TYPES = [
  '01 Motor car/station wagon', '02 SUV', '03 Combi/minibus', '04 Midibus', '05 Bus', '06 Bus-train/Articulated',
  '07 Light delivery', '08 Panel van', '09 GVM>3500kg', '10 Truck: articulated', '11 Truck: articulated multiple',
  '12 125cc and under', '13 Above 125cc', '14 Tri-cycle', '15 Quad-cycle', '16 Bicycle', '17 Mobile equipment',
  '18 Caravan/trailer', '19 Tractor', '20 Animal-drawn', '21 New Energy Vehicles', '98 Other',
] as const;

const ACCIDENT: PoliceReportForm = {
  id: 'accident', code: 'CR1', label: 'Crash Report',
  summary: 'CR1: the crash, every vehicle and driver, casualties and contributory factors.',
  sections: [
    { title: 'Admin', fields: [
      t('saps_area', 'SAPS area where crash occurred'), t('cas_no', 'CAS No.'), t('cr_no', 'CR No.'),
      t('form_of', 'Form No.', 'e.g. 1 of 2'), num('no_appendices', 'No. of appendices'), t('incident_rpt_no', 'Incident Report No.'),
      date('crash_date', 'Crash date'), time('crash_time', 'Crash time (24h)'), num('no_vehicles', 'No. of vehicles involved'),
      t('capturing_no', 'Capturing number'), num('speed_limit', 'Speed limit on road (km/h)'),
      pick('province', 'Province', ['EC', 'FS', 'GP', 'KZN', 'MP', 'NW', 'NC', 'LM', 'WC']),
      t('road_number', 'Road number', 'e.g. N1, P39/1'), t('km_marker_no', 'Km marker No.'), yn('built_up', 'Built-up area?'),
    ] },
    { title: 'Crash location', fields: [
      t('street_road_name', 'Street / road name'), t('gps_x', 'GPS X co-ordinate'), t('gps_y', 'GPS Y co-ordinate'),
      t('at_intersection', 'At intersection with'), t('between_streets', 'Or between'), t('suburb', 'Suburb'),
      t('city_town', 'City / town'), t('between_city', 'Between (city/town)'),
      pick('freeway_rural', 'Freeway / rural', ['Freeway', 'Rural']), t('km_info', 'Kilometre marker: road no. / section'),
    ] },
    { key: 'drivers', title: 'Vehicle and driver', repeat: { noun: 'Vehicle', min: 2, max: 8, letters: true }, fields: [
      t('id_type', 'ID type', 'DL/LL/PP/etc.'), t('id_no', 'ID number'), num('age', 'Age'),
      t('id_country', 'Country of ID origin'), t('nationality', 'Nationality'), t('surname', 'Surname'),
      t('fullnames', 'Full names'), ml('address', 'Residential / home address'), t('cell', 'Cell phone'),
      t('work_address', 'Work / contact address'), pick('population', 'Population group', POPULATION), pick('gender', 'Sex', SEX),
      t('licence', 'Driving licence type', 'DL/LL'), date('licence_date', 'Date of issue'), t('licence_code', 'Licence code', 'A1/A/B/EC etc.'),
      pick('severity', 'Severity of injury', INJURY), t('ambulance', 'Ambulance / hospital ref'),
      pick('seatbelt', 'Seatbelt / helmet', RESTRAINT), yn('alcohol_susp', 'Alcohol use suspected'), yn('drug_susp', 'Drug use suspected'),
      pick('veh_type', 'Vehicle type', CR1_VEHICLE_TYPES), t('veh_colour', 'Colour'), pick('veh_make', 'Make', CR1_MAKES),
      t('veh_model', 'Model'), t('veh_licence', 'Vehicle licence & disc number'), t('vin', 'VIN number'),
      pick('veh_function', 'Vehicle special function', ['None', 'Taxi', 'Bus', 'Police', 'Military', 'EMS', 'Unknown', 'Other']),
      yn('passengers_reward', 'Carried passengers for reward?'), yn('priv_biz', 'Private / business use?'),
      t('breakdown', 'Breakdown company & driver', 'Company, tel, driver name'),
    ] },
    { title: 'Crash type and conditions', fields: [
      pick('traffic_control', 'Traffic control type', [
        'Traffic signal (TS)', 'Stop sign', 'Yield/Give Way', 'Officer', 'Uncontrolled Junction', 'Boom', 'Pedestrian Crossing',
        'Barrier line', 'Officer & traffic signal', 'Not at junction/crossing/barrier', 'All TS out of order', 'Some TS out of order', 'Flashing TS',
      ]),
      pick('road_signs', 'Road signs condition', ['Visible', 'Not visible', 'Damaged', 'Road signs missing', 'N/A', 'Other']),
      pick('road_marking', 'Road marking visibility', ['Good', 'Visible', 'Not visible', 'Not applicable']),
      pick('crash_type', 'Crash type', [
        'Head/rear end', 'Head on', 'Sideswipe: opposite directions', 'Sideswipe: same direction',
        'Approach at angle - both travelling straight', 'Overturned', 'Single vehicle: left road', 'Crash with pedestrian',
        'Crash with bicyclist', 'Crash with animal', 'Crash with train', 'Crash with fixed object',
      ]),
      yn('hit_run', 'Was this a hit & run crash?'),
      pick('road_func', 'Road functional classification', [
        'Freeway/Motorway', 'On/Off ramp', 'Dual carriageway', 'Single carriageway (two way - no median)', 'On-road parking/rank',
        'Off-road parking/rank', 'Urban 1-way', 'Urban 2-way', 'Outside build-up area', 'Restricted road', 'Other', 'Unknown',
      ]),
      pick('junction_type', 'Junction type', [
        'Cross roads', 'T-Junction', 'Staggered junction', 'Y-junction', 'Circle', 'Level Crossing', 'Not a junction or crossing',
        'On ramp/slipway', 'Off-ramp/slipway', 'Pedestrian Crossing', 'Property driveway/access', 'Other',
      ]),
      pick('light_condition', 'Light condition', ['Daylight (N/A)', 'Night + Street lights', 'Night + NO street lights', 'Sunset', 'Sunrise', 'Unknown']),
      pick('weather', 'Weather', ['Clear', 'Mist/Fog', 'Rain', 'Overcast', 'Sleet/Hail', 'Snow', 'Dust', 'Smog/Smoke', 'Unknown']),
      pick('road_surface_type', 'Road surface type', ['Tarmac', 'Concrete', 'Gravel/Dirt', 'Block pave', 'Other']),
      pick('road_surface_cond', 'Road surface condition', ['Dry', 'Wet', 'Damp', 'Ice', 'Snow', 'Frost', 'Slippery', 'Flooding', 'Loose gravel']),
      ml('crash_desc', 'Brief description of crash', 'It is alleged that…'),
    ] },
    { title: 'Summary of persons involved', fields: [
      num('fatal_count', 'No. of fatalities'), num('serious_count', 'Seriously injured'),
      num('slight_count', 'Slightly injured'), num('not_injured_count', 'Visibly not injured'),
    ] },
    { key: 'injured', title: 'Fatality / injured passenger', repeat: { noun: 'Person', min: 1, max: 10 }, fields: [
      t('seat', 'Seating position', 'Front/Rear/Other'), t('id', 'ID type / No. / age'), t('id_country', 'Country of ID'),
      t('surname', 'Surname & initials'), t('address', 'Home / contact address'), t('cell', 'Cell phone / other number'),
      pick('population', 'Population group', POPULATION), pick('gender', 'Sex', SEX), pick('severity', 'Severity of injury', INJURY),
      t('ambulance', 'Ambulance service / driver / ref / hospital'), pick('seatbelt', 'Seatbelt / helmet', RESTRAINT),
      yn('child_restraint', 'Child restraint used?'), yn('liquor_susp', 'Liquor / drug use suspected?'),
    ] },
    { key: 'uninjured', title: 'Passenger visibly not injured', repeat: { noun: 'Passenger', min: 1, max: 10 }, fields: [
      t('surname', 'Surname & initials'), t('id', 'ID number'), t('phone', 'Telephone / cellphone'), t('pax_no', 'Passenger No. / vehicle'),
    ] },
    { title: 'Alleged contributory factors', fields: [
      many('human_factors', 'Human factors', [
        'Cell phone holding/usage', 'Disregard for red traffic lights', 'Disregard for stop sign', 'Disregard for yield sign',
        'Fatigue: driver falling asleep', 'Followed vehicle too closely', 'Hit and run', 'Jay-walking pedestrian',
        'Overtook in face of oncoming traffic', 'Overtook across barrier line', 'Speed too high for circumstances',
        'Turned in front of oncoming traffic', 'U-turn', 'Other',
      ]),
      many('vehicle_factors', 'Vehicle factors', [
        'Bicycle no rear reflectors', 'Bicycle no head lamp', 'Brakes faulty', 'Brakes: lights dirty', 'Chevrons: dirty',
        'Chevrons: no reflective stripes', 'Headlights blinding', 'Headlights faulty', 'Headlights not switched on',
        'Overload Cargo', 'Overload: passengers', 'Steering: faulty', 'Tyres: burst prior to accident', 'Tyres: smooth', 'Other',
      ]),
      many('road_factors', 'Road & environmental factors', [
        'Animals: stray/wild', 'Blind corner', 'Blind rise', 'Lighting: poor', 'Road markings poor/inadequate/none',
        'Road traffic lane narrow', 'Road signs poor/inadequate/none', 'Road surface poor', 'Road surface wet/slippery',
        'Road works', 'Sharp bend', 'Traffic lights defective', 'Visibility poor', 'Visibility smoke/fog/rain/etc.', 'Other',
      ]),
    ] },
    { key: 'witnesses', title: 'Independent witness', repeat: { noun: 'Witness', min: 1, max: 6 }, fields: [
      t('surname', 'Surname & initials'), t('id', 'ID type / No.'), t('contact', 'Contact', 'Phone / address'),
    ] },
    { title: 'Completed by', fields: [
      t('comp_initials', 'Initials'), t('comp_rank', 'Rank'), t('comp_surname', 'Surname'), t('comp_service', 'Service number'),
      date('comp_date', 'Date'), t('completed_by', 'Completed by (driver / official)'),
    ] },
  ],
};

/* ── VI Vehicle Inspection ────────────────────────────────────────────────── */

const items = (title: string, keyPrefix: string, labels: readonly string[]): ReportSection => ({
  title,
  fields: labels.map((label) => check(`${keyPrefix}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`, label)),
});

const VEHICLE_INSPECTION: PoliceReportForm = {
  id: 'vehicle', code: 'VI', label: 'Vehicle Inspection',
  summary: 'The vehicle, item by item: OK, Fault or NIL.',
  sections: [
    { title: 'Vehicle and shift', fields: [
      req(t('ndm', 'NDM number', 'e.g. NDM-0042')), req(num('mileage', 'Current mileage (km)')),
      req(pick('shift', 'Shift', ['Day Shift', 'Night Shift', 'Morning', 'Afternoon'])), date('insp_date', 'Date'), time('insp_time', 'Time'),
    ] },
    items('External lights', 'ext', ['Brake', 'Park', 'Dim', 'Bright', 'Indicators', 'Hazard', 'Front Spots', 'Side Spots', 'Roof Spots', 'Blue Lights', 'Gizwacks']),
    items('Internal lights', 'int', ['Cab Interior', 'Van Interior', 'Dash Lights']),
    items('Other interior', 'oth', ['Mirror', 'Switches', 'Hooter', 'Upholstery', 'Handles', 'Handbrakes', 'Radio - Two Way']),
    items('Windows', 'win', ['Windscreen', 'Left Front Cab', 'Left Rear Cab', 'Right Front Cab', 'Right Rear Cab', 'Rear']),
    items('Grids', 'grid', ['Left Rear Cab', 'Right Rear Cab', 'Rear Canopy']),
    items('Panels', 'pnl', [
      'Bonnet', 'Right Front Arch', 'Right Front Door', 'Right Rear Door', 'Right Rear Arch', 'Rear Panel / Boot', 'Rear Door',
      'Left Front Arch', 'Left Front Door', 'Left Rear Door', 'Left Rear Arch',
    ]),
    items('Bumpers', 'bmp', ['Front Push Bars', 'Front', 'Rear']),
    items('Other', 'misc', ['Wiper Blades', 'Reflectors']),
    items('Fluids', 'fl', ['Engine Oil', 'Radiator Water', 'Windscreen Water', 'Brake Levels', 'Gearbox Levels', 'Clutch Levels', 'Battery Levels']),
    items('Tyres & tools', 'tyre', ['Left Front', 'Left Rear', 'Right Front', 'Right Rear', 'Spare', 'Jack', 'Wheel Spanner']),
    items('Equipment', 'eq', ['Spade', 'Fire Extinguisher', 'First Aid Kit', 'Crowbar', 'Broom', '6 x Cones', 'Blanket']),
    { title: 'Sign off', fields: [t('inspected_by', 'Inspected by'), ml('remarks', 'Remarks / faults found')] },
  ],
};

/* ── 216E Use of Official Firearm ─────────────────────────────────────────── */

const FIREARM: PoliceReportForm = {
  id: 'firearm', code: '216E', label: 'Use of Official Firearm',
  summary: 'DMPS 216(e): the shooting, members, firearms, targets, arrests and trauma counselling.',
  sections: [
    { title: 'Reference numbers', fields: [
      t('occ', 'OCC number'), t('cas', 'CAS number'), t('station', 'Station'), t('ipid', 'IPID number'),
      t('kzn_ref', 'KZN IPD reference number'), date('report_date', 'Date of report'),
      req(pick('shoot_type', 'Type of shooting', ['CROWD MANAGEMENT', 'OPERATIONAL SHOOTING', 'NEGLIGENT SHOOTING', 'SUICIDAL SHOOTING'])),
    ] },
    { title: 'Section 1 — The shooting incident', fields: [
      ml('description', '(a) Short description of the incident'), date('inc_date', '(b) Date of incident'), time('inc_time', 'Time of incident'),
      ml('location', '(c) Precise location of the incident'), ml('reason', '(d) Reason for the shooting incident'),
      ml('crime', '(e) Crime committed'), t('saps_cas', '(f) SAPS reference No. (CAS No.)'),
    ] },
    { key: 'members', title: 'Section 2 — Member (shottist)', repeat: { noun: 'Member', min: 1, max: 10 }, fields: [
      t('name', 'Name'), pick('rank', 'Rank', RANKS_216E), t('force', 'Force No.'), t('service', 'Service No.'),
      t('contact', 'Contact'), num('rounds', 'Rounds'),
    ] },
    { title: 'Section 2 — Conduct', fields: [
      yn('duty_status', '(b) Was member on duty?'), yn('own_initiative', '(c) Did member act on own initiative (not orders)?'),
      yn('prior_warning', '(d) Did member give prior verbal warning?'), num('warning_shots', '(e) Number of warning shots fired'),
      yn('min_force', '(f) Did member use minimum / reasonable force?'), num('shots_fired', '(g) Total number of shots fired'),
      yn('justified', '(h) Were actions justified?'),
    ] },
    { key: 'firearms', title: 'Section 3 — Firearm involved', repeat: { noun: 'Firearm', min: 1, max: 8 }, fields: [
      pick('type', 'Type', ['Pistol', 'Revolver', 'Semi-Automatic Rifle', 'Rifle', 'Shotgun', 'Machine Pistol', 'Sub-Machine Gun', 'Other']),
      pick('make', 'Make', [
        'Vektor (Z88)', 'Beretta', 'Glock', 'Smith & Wesson', 'Remington', 'Mossberg', 'CZ', 'Taurus', 'Sig Sauer', 'Heckler & Koch',
        'Browning', 'Winchester', 'FN Herstal', 'Norinco', 'Other',
      ]),
      t('serial', 'Serial No.'), pick('calibre', 'Calibre', CALIBRES), pick('ownership', 'Private / official', ['Official', 'Private']),
      pick('condition', 'Condition', ['Serviceable', 'Unserviceable', 'Damaged', 'Good', 'Fair']), t('licence', 'Licence No.'),
      num('rounds_issued', 'Rounds issued'), num('rounds_fired', 'Rounds fired'), num('rounds_remaining', 'Rounds remaining'),
    ] },
    { title: 'Section 3 — Shells', fields: [num('shells', '(b) Shells found at scene'), pick('shells_calibre', 'Calibre of shells', CALIBRES)] },
    { title: 'Section 4 — Target / suspect / victim', fields: [
      ml('target_nature', '(a) Nature and composition of target(s)', 'e.g. brick building, motor vehicle, person…'),
      yn('original_target', '(b) Was the original target shot at?'), ml('target_desc', 'If not, describe the involvement of the target(s)'),
      yn('intended_hit', '(c) Was the intended target hit?'), ml('hit_desc', 'Describe in detail where the target was hit'),
      ml('miss_desc', '(d) Where did shots go that missed the target?'),
    ] },
    { key: 'victims', title: 'Section 4 — Victim', repeat: { noun: 'Victim', min: 1, max: 10 }, fields: [
      t('surname', 'Surname'), t('initials', 'Initials'), pick('race', 'Race', RACE), pick('sex', 'Sex', SEX), num('age', 'Age'),
      pick('condition', 'Condition', ['Deceased', 'Injured — Critical', 'Injured — Serious', 'Injured — Minor', 'Uninjured', 'Unknown']),
    ] },
    { key: 'suspects', title: 'Section 5 — Arrest from the incident', repeat: { noun: 'Suspect', min: 1, max: 10 }, fields: [
      t('name', 'Suspect name'), pick('race', 'Race', RACE), pick('sex', 'Sex', SEX), num('age', 'Age'),
    ] },
    { title: 'Section 6 — Attendance of officer at scene', fields: [
      t('duty_officer', 'Duty officer name'), pick('duty_rank', 'Rank', RANKS_216E),
      ml('attendance_reason', 'If officer did not attend — give reasons'),
    ] },
    { title: 'Section 7 — Member completing this form', fields: [
      t('member_name', 'Name'), pick('member_rank', 'Rank', RANKS_216E), date('member_date', 'Date'), time('member_time', 'Time'),
    ] },
    { key: 'trauma', title: 'Section 8 — Trauma counselling', repeat: { noun: 'Member', min: 1, max: 10 }, fields: [
      t('name', 'Name'), t('force', 'Force No.'), t('service', 'Service No.'), t('contact', 'Contact'),
      pick('decision', 'Decision', ['Debriefing Required', 'Debriefing Not Required', 'Referred to Professional', 'Pending Assessment']),
    ] },
    { title: 'Section 8 — Debriefing', fields: [
      t('location_trauma', 'Location', 'Scene / station location'), date('trauma_date', 'Date'), time('trauma_time', 'Time'),
    ] },
  ],
};

/* ── SANRAL Incident Report ───────────────────────────────────────────────── */

const SERVICES = [
  ['traffic', 'Traffic Dept'], ['saps', 'SAPS'], ['fire', 'Fire & Rescue'], ['amb', 'Ambulance'],
  ['spec', 'Specialised'], ['route', 'Route Maintenance'],
] as const;

const INCIDENT: PoliceReportForm = {
  id: 'incident', code: 'SANRAL', label: 'Incident Report',
  summary: 'SANRAL RIMS: control room, location, injuries, road closure, services on scene and hazmat.',
  sections: [
    { title: 'Control room information', fields: [
      t('authority', 'Authority / RIMS', 'SANRAL Eastern Region'), t('day_date', 'Day / date', 'e.g. Friday 17/04/2026'), time('time', 'Time'),
      t('oar_ob_no', 'OAR/OB number'), t('incident_no', 'Incident number'), t('operator_name', "Operator's name"),
      t('caller_name', "Caller's name"),
      pick('info_via', 'Information received via', ['L/Line', 'Radio', 'Cell', 'Social Media', 'Other']),
      pick('caller_via', 'Caller info source', ['L/Line', 'Radio', 'DMPS', 'Other']),
    ] },
    { title: 'Location of incident', fields: [
      t('location', 'Location description', 'e.g. M1/N2 Bridge'), t('route', 'Route', 'e.g. N1, R101'), t('section', 'Section'),
      t('km_marker', 'Km marker'), pick('direction', 'Direction of travel', ['North', 'South', 'East', 'West']),
      ml('desc_location', 'Description of location', 'e.g. N2 South bound Chesterville Grit — near M1'),
    ] },
    { title: 'Type of incident', fields: [
      req(pick('incident_type', 'Type of incident', ['Collision', 'Secondary Collision', 'Hazardous Material', 'Breakdown', 'Other'])),
      t('incident_other', 'If other — specify'),
      pick('cause', 'Probable cause / reason', [
        'Slippery road', 'Head-on collision', 'Vehicle on fire', 'Fuel/oil spill', 'Mechanical Failure', 'Driver lost control', 'Speeding', 'Tyre Burst',
      ]),
      t('cause_other', 'If other — specify'),
    ] },
    { title: 'Injuries', fields: [
      yn('injuries', 'Injuries'), num('p1_serious', 'P1 Serious / Red'), num('p2_slight', 'P2 Slight / Yellow'),
      num('p3_minor', 'P3 Minor / Green'), num('p4_fatal', 'P4 Fatal / Blue'), num('total_injuries', 'Total injuries'),
      yn('entrapments', 'Entrapments'), num('entrap_total', 'Entrapment total'),
    ] },
    { title: 'Traffic information — road closure', fields: [
      yn('road_closure', 'Road closure'),
      pick('degree_closure', 'Degree of closure', ['Total Closure (all lanes)', 'Shoulder', 'Slow Lane', 'Fast Lane / Two Left Lanes', 'Partial']),
      time('time_begin', 'Time begin'), time('time_end', 'Time end'), ml('alt_route', 'Alternative route (if used)'),
      time('incident_cleared_time', 'Incident cleared — time'), date('cleared_date', 'Cleared date'),
    ] },
    { title: 'Scene co-ordination', fields: [
      t('coordinator', "Co-ordinator's name"), t('coord_team', 'Co-ordinating team'),
      ...SERVICES.flatMap(([k, label]) => [
        t(`${k}_township`, `${label} — township / dept`), t(`${k}_officer`, `${label} — officer in charge`),
        time(`${k}_on`, `${label} — on scene`), time(`${k}_off`, `${label} — off scene`),
      ]),
      pick('weather', 'Weather conditions', ['Sunny', 'Overcast', 'Mist', 'Drizzle', 'Clear']),
      pick('tar_condition', 'Tar condition', ['Wet', 'Dry']),
    ] },
    { title: 'Hazardous chemical spillage and fire', fields: [
      yn('hazmat', 'Hazmat'), t('vehicle_name', 'Name on vehicle'), t('chemical_name', 'Chemical(s) name'), t('chemical_code', 'Chemical code'),
      t('chemical_desc', 'Chemical description'), t('un_number', 'UN number'), t('sabs_code', 'SABS 0228 code'),
      t('protocol', 'Protocol used'), t('activated_by', 'Activated by'), time('protocol_time', 'Protocol time'),
      t('waste_extent', 'Waste extent'), t('multi_load', 'Multi load', 'Yes/No'), ml('waste_desc', 'Waste description'), yn('fire', 'Fire'),
    ] },
    { title: 'Tow operators, vehicles and damage', fields: [
      yn('tow_private', 'Private towing'), yn('tow_contractor', 'Traffic contractor'), t('tow_operator', 'Operator name'),
      t('tow_reg', 'Tow vehicle reg'), t('tow_dest', 'Destination'), t('damaged_reg', 'Damaged vehicle reg'),
      many('vehicles_involved', 'Vehicles / objects involved', [
        'Articulated vehicle', 'Rigid vehicle', 'Tanker', 'Light motor vehicle', 'Bakkie (LDV)', 'Motorcycle', 'Animal', 'Truck', 'Minibus', 'Bus', 'Other',
      ]),
      ml('incident_desc', 'Full incident description'), t('road_surface', 'Damage — road surface'), t('structures', 'Damage — structures'),
      t('guard_rail', 'Damage — guard rail'), t('sign_posts', 'Damage — sign posts'), t('sos_posts', 'Damage — SOS radio posts'),
      t('fence', 'Damage — fence'), ml('remarks', 'Remarks'), ml('chem_used', 'Chemical used to clean road'),
    ] },
  ],
};

/* ── 211A Tow In ──────────────────────────────────────────────────────────── */

const TOW: PoliceReportForm = {
  id: 'tow', code: '211A', label: 'Tow In',
  summary: 'DMPS 211(a): the vehicle towed, its condition, the operator, SAPS notification and release.',
  sections: [
    { title: 'Vehicle details', fields: [
      t('tow_no', 'Tow No.'), time('tow_time', 'Time of tow'), date('tow_date', 'Date'), req(t('reg_no', 'Motor vehicle registration No.')),
      pick('make', 'Make', [
        'Alfa Romeo', 'Audi', 'BMW', 'Chery', 'Chevrolet', 'Citroen', 'Datsun', 'Dodge', 'Fiat', 'Ford', 'GWM', 'Honda', 'Hyundai', 'Isuzu',
        'JAC', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Mahindra', 'Mazda', 'Mercedes-Benz', 'MG', 'Mitsubishi', 'Nissan', 'Opel', 'Peugeot',
        'Porsche', 'Renault', 'Skoda', 'Subaru', 'Suzuki', 'Toyota', 'Volkswagen', 'Volvo', 'Other',
      ]),
      t('model', 'Model'),
      pick('colour', 'Colour', [
        'Black', 'White', 'Silver', 'Grey', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Brown', 'Gold', 'Beige', 'Maroon',
        'Dark Blue', 'Dark Green', 'Purple', 'Other',
      ]),
      t('engine_no', 'Engine No.'), req(pick('pound', 'Towed to pound', ['VERULAM', 'QUEENSBURGH', 'CENTRAL'])),
      t('from_location', 'Towed from (location)'), ml('reason', 'Reason for towing'), t('fine_no', 'Spot fine / summons No.'),
    ] },
    { title: 'Vehicle condition', fields: [
      yn('locked', 'Was vehicle fully locked when found?'), yn('radio', 'Fitted radio / CD player?'), yn('key', 'Key present?'),
      t('loose_articles', 'Loose articles recorded in property register and handed to'), t('prop_reg', 'Property register ref No.'),
      ml('damage_before', '1. Damage observed prior to towing'), ml('damage_after', '2. Damage after vehicle tow to pound'),
    ] },
    { title: 'Completed by tow truck operator or police member', fields: [
      t('op_name', 'Name'), t('op_rank_force', 'Rank / force No.'), time('op_time', 'Time'), date('op_date', 'Date'), t('op_company', 'Company'),
    ] },
    { title: 'To be completed by police member', fields: [
      time('saps_notified_time', 'SAPS radio control notified — time'), date('saps_notified_date', 'Date of notification'),
      t('reported_to', 'To whom reported'), t('saps_ref', 'SAPS ref No.'),
    ] },
    { title: 'Release of vehicle and charges', fields: [
      time('towed_time', 'Vehicle towed to pound — time'), date('towed_date', 'Date'), time('claimed_time', 'Vehicle claimed — time'),
      date('claimed_date', 'Date'), num('towing_charges', 'Towing charges (R)'), num('storage_charges', 'Storage charges per day (R)'),
      num('towing_fee', 'Towing fee assessed (R)'), num('storage_fee', 'Storage fee assessed (R)'), t('receipt_no', 'Receipt No.'),
      t('release_name', 'Name'), t('release_rank', 'Rank / force No.'), ml('waived_reason', 'If fees waived — reason'),
    ] },
  ],
};

/* ── DOG Capture / Tackle ─────────────────────────────────────────────────── */

const DOG: PoliceReportForm = {
  id: 'dog', code: 'DOG', label: 'Dog Capture / Tackle',
  summary: 'The K9 deployment: the incident, members and dogs, victims, suspects and medical treatment.',
  sections: [
    { title: 'Details of the incident', fields: [
      req(ml('description', '1. Short description of the incident')), date('inc_date', '2. Date of incident'), time('inc_time', 'Time of incident'),
      ml('location', '3. Precise location of the incident'), ml('reason', '4. Reason for using the dog in the incident'),
      ml('crime', '5. Crime committed and circumstances surrounding the crime'),
    ] },
    { title: 'Reference numbers', fields: [
      t('saps_ref', '6. SAPS reference No. (CAS/OB No.)'), t('saps_station', 'SAPS station'), t('saps14', '7. SAPS 14 No.'),
      t('saps70', '8. SAPS 70 No.'), t('saps_ob', 'SAPS OB No.'), num('suspects_arrested', 'No. of suspects arrested'), t('saps13', 'SAPS 13 No.'),
      num('goods1', '9. Goods recovered — item 1 (R)'), num('goods2', 'Goods recovered — item 2 (R)'),
      num('goods3', 'Goods recovered — item 3 (R)'), num('total_val', 'Total estimated value (R)'),
    ] },
    { key: 'members', title: 'Member involved', repeat: { noun: 'Member', min: 1, max: 10 }, fields: [
      t('name', 'Member name'), t('rank', 'Rank'), t('force', 'Force No.'),
    ] },
    { key: 'dogs', title: 'Dog involved', repeat: { noun: 'Dog', min: 1, max: 6 }, fields: [t('name', "Dog's name"), t('force', 'Force No.')] },
    { title: 'Victim', fields: [
      yn('apprehended', '1. Was the intended suspect apprehended by the dog?'),
      ml('victim_desc', '2. If not, describe the involvement of the person', 'e.g. innocent pedestrian, part of a mob…'),
    ] },
    { key: 'victims', title: 'Victim details', repeat: { noun: 'Victim', min: 1, max: 10 }, fields: [
      t('surname', 'Surname'), t('initials', 'Initials'), pick('race', 'Race', RACE), pick('sex', 'Sex', SEX), num('age', 'Age'),
    ] },
    { title: 'Victim injuries', fields: [ml('injury_desc', 'Describe in detail where the victim sustained injuries')] },
    { key: 'suspects', title: 'Suspect', repeat: { noun: 'Suspect', min: 1, max: 10 }, fields: [
      t('name', 'Suspect name'), pick('race', 'Race', RACE), pick('sex', 'Sex', SEX), num('age', 'Age'),
    ] },
    { title: 'Suspect injuries', fields: [ml('suspect_injury', 'Describe in detail where the suspect sustained injuries')] },
    { title: 'Medical treatment', fields: [
      t('hospital', '1. Hospital treated at'), t('hosp_ref', '2. Hospital reference No.'),
      yn('released', 'Was the suspect released immediately after treatment?'),
      ml('no_treatment_reason', '3. If suspect not treated, give brief explanation'),
    ] },
    { title: 'Attendance of officer at scene', fields: [
      t('duty_officer', '1. Duty officer on call'), t('duty_rank', 'Rank'), ml('attend_reason', '2. If officer did not attend — give reasons'),
      ml('comments', 'Comments from attending officer'), ml('witness_info', 'Witness information'),
    ] },
  ],
};

/** The seven forms, in the order the department lists them. */
export const POLICE_REPORT_FORMS: readonly PoliceReportForm[] = [ARREST, ACCIDENT, VEHICLE_INSPECTION, FIREARM, INCIDENT, TOW, DOG];
