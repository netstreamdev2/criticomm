#!/usr/bin/env node
/**
 * Comprehensive demo seed for Criticom V5 — logins + operational data.
 * Mirrors the intent of the V4 seeders (DbInitializer, RoleDataSeeder,
 * DemoDataSeeder, DutyRosterSeeder, PerformanceSeeder, HistoricalIncidentSeeder)
 * against the Supabase schema. Idempotent: clears seeded data tables and
 * upserts users each run. Config/KPI/partner seeds from migrations are kept.
 *
 * Usage:  (source .env first, or set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *   node scripts/seed-all.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }

const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PASSWORD = 'Test123!';
const nowIso = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000);
const pick = (arr, i) => arr[i % arr.length];
const rand = (n) => Math.floor(Math.random() * n);

// Durban-ish coordinates jitter helper.
const DURBAN = { lat: -29.8587, lng: 31.0218 };
const jitter = () => ({
  lat: DURBAN.lat + (Math.random() - 0.5) * 0.35,
  lng: DURBAN.lng + (Math.random() - 0.5) * 0.35,
});

// ── LOGIN MATRIX ──────────────────────────────────────────────────────
// Every role × silo the app enforces. V4 seeded departmental logins with
// this same password; here we add the master-hub control-room roles too.
const USERS = [
  // Master hub (Ethekwini)
  ['sysadmin@criticom.gov.za',        'SystemAdmin',    'Ethekwini',         'Sipho Admin'],
  ['superadmin@criticom.gov.za',      'SuperAdmin',     'Ethekwini',         'Thandi Super'],
  ['dispatch@criticom.gov.za',        'Dispatcher',     'Ethekwini',         'Naledi Dispatch'],
  ['control@criticom.gov.za',         'ControlRoom',    'Ethekwini',         'Kagiso Control'],
  ['logger@criticom.gov.za',          'IncidentLogger', 'Ethekwini',         'Lerato Logger'],
  ['casemanager@criticom.gov.za',     'CaseManager',    'Ethekwini',         'Ayanda Case'],
  ['supervisor@criticom.gov.za',      'Supervisor',     'Ethekwini',         'Mandla Supervisor'],
  ['viewer@criticom.gov.za',          'Viewer',         'Ethekwini',         'Zinhle Viewer'],
  // Police
  ['admin.metro@criticom.gov.za',     'Admin',          'MetroPolice',       'Bongani Metro'],
  ['dispatch.metro@criticom.gov.za',  'Dispatcher',     'MetroPolice',       'Nomsa Metro'],
  ['captain.metro@criticom.gov.za',   'Captain',        'MetroPolice',       'Capt. Dube'],
  ['police01.metro@criticom.gov.za',  'Police',         'MetroPolice',       'Const. Khumalo'],
  ['security.metro@criticom.gov.za',  'Security',       'MetroPolice',       'Guard Nkosi'],
  // Fire
  ['admin.fire@criticom.gov.za',      'Admin',          'MetroFire',         'Pieter Fire'],
  ['dispatch.fire@criticom.gov.za',   'Dispatcher',     'MetroFire',         'Fire Control'],
  ['fire.chief@criticom.gov.za',      'FireChief',      'MetroFire',         'Chief Naidoo'],
  ['firefighter01@criticom.gov.za',   'Firefighter',    'MetroFire',         'FF Botha'],
  // Medical
  ['admin.med@criticom.gov.za',       'Admin',          'Medical',           'Priya Medical'],
  ['dispatch.med@criticom.gov.za',    'Dispatcher',     'Medical',           'EMS Control'],
  ['paramedic01.med@criticom.gov.za', 'Paramedic',      'Medical',           'Medic Pillay'],
  ['doctor.med@criticom.gov.za',      'Doctor',         'Medical',           'Dr. Reddy'],
  // Disaster
  ['admin.disaster@criticom.gov.za',  'Admin',          'EthekwiniDisaster', 'Disaster Admin'],
  ['dispatch.disaster@criticom.gov.za','Dispatcher',    'EthekwiniDisaster', 'DM Control'],
  ['disaster01@criticom.gov.za',      'Disaster',       'EthekwiniDisaster', 'DM Officer Zulu'],
];

async function upsertUsers() {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const byEmail = new Map((list?.users ?? []).map((u) => [u.email?.toLowerCase(), u]));
  const created = [];
  for (const [email, role, silo, fullName] of USERS) {
    let id = byEmail.get(email.toLowerCase())?.id;
    if (id) {
      await db.auth.admin.updateUserById(id, {
        app_metadata: { silo, role }, user_metadata: { full_name: fullName },
      });
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email, password: PASSWORD, email_confirm: true,
        app_metadata: { silo, role }, user_metadata: { full_name: fullName },
      });
      if (error) { console.error(`createUser ${email}:`, error.message); continue; }
      id = data.user.id;
    }
    created.push({ id, email, role, silo, fullName });
  }
  // Upsert profiles.
  const badge = (i) => `B${String(1000 + i).padStart(4, '0')}`;
  const { error } = await db.from('profiles').upsert(created.map((u, i) => ({
    id: u.id, silo: u.silo, role: u.role, full_name: u.fullName, email: u.email,
    badge_number: badge(i), rank: u.role, station: 'Durban Central', status: 'Active',
    call_sign: `${u.fullName.split(' ')[0]}-${100 + i}`,
    is_on_duty: ['Police', 'Firefighter', 'Paramedic', 'Disaster'].includes(u.role),
    last_login: nowIso(),
  })));
  if (error) console.error('profiles upsert:', error.message);
  console.log(`✓ ${created.length} users + profiles`);
  return created;
}

async function clearData() {
  const tables = [
    'performance_scores', 'performance_plans', 'endorsements', 'rosters', 'shifts',
    'incident_updates', 'incident_attachments', 'metro_offenses', 'metro_reports',
    'firefighter_reports', 'paramedic_reports', 'disaster_logs', 'post_mortem_reports',
    'legal_handovers', 'ambulance_restocks', 'relief_stocks', 'firearm_authorizations',
    'security_reports', 'hydrants', 'training_records', 'certifications', 'leave_entries',
    'mental_checks', 'vehicle_checklists', 'notifications', 'audit_logs',
    'incidents', 'personnel', 'apparatus', 'devices',
  ];
  for (const t of tables) {
    const { error } = await db.from(t).delete().not('id', 'is', null);
    if (error && !/does not exist/.test(error.message)) console.warn(`clear ${t}: ${error.message}`);
  }
  console.log('✓ cleared seed data tables');
}

const SILOS = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];
const VEHICLE_TYPES = {
  MetroPolice: ['Patrol vehicle', 'Motorcycle', 'K9 unit'],
  MetroFire: ['Fire engine', 'Ladder truck', 'Water tanker', 'Rescue unit'],
  Medical: ['Ambulance', 'Response car', 'Rescue unit'],
  EthekwiniDisaster: ['Command vehicle', 'Rescue unit', 'Water tanker'],
};

async function seedApparatus() {
  const rows = [];
  for (const silo of SILOS) {
    const types = VEHICLE_TYPES[silo];
    for (let i = 0; i < 5; i++) {
      rows.push({
        silo, unit_number: `${silo.slice(0, 3).toUpperCase()}-${100 + i}`,
        name: `${pick(types, i)} ${i + 1}`, type: pick(types, i),
        make: pick(['Toyota', 'Isuzu', 'MAN', 'Mercedes'], i), model: pick(['Hilux', 'FTR', 'TGM', 'Atego'], i),
        year: 2019 + (i % 5), license_plate: `ND ${10000 + rand(89999)}`,
        status: 'Available', station_number: 'Durban Central', department_name: silo,
        fuel_level: 'Full',
      });
    }
  }
  const { data, error } = await db.from('apparatus').insert(rows).select('id, silo, unit_number, name');
  if (error) { console.error('apparatus:', error.message); return []; }
  console.log(`✓ ${data.length} apparatus`);
  return data;
}

async function seedPersonnel(users, apparatus) {
  const rows = [];
  // Link created field users to a personnel record.
  const field = users.filter((u) => ['Police', 'Firefighter', 'Paramedic', 'Disaster', 'Captain', 'FireChief', 'Doctor', 'Security'].includes(u.role));
  field.forEach((u, i) => {
    const [first, ...rest] = u.fullName.split(' ');
    const siloVeh = apparatus.filter((a) => a.silo === u.silo);
    rows.push({
      silo: u.silo, user_id: u.id, first_name: first, last_name: rest.join(' ') || 'Officer',
      badge_number: `P${2000 + i}`, rank: u.role, unit: pick(['Alpha', 'Bravo', 'Charlie'], i),
      assigned_apparatus_id: siloVeh[i % Math.max(1, siloVeh.length)]?.id ?? null,
      is_on_duty: true, station: 'Durban Central', platoon: pick(['A', 'B', 'C', 'D'], i),
      service_number: `SVC${5000 + i}`, force_number: `F${700 + i}`,
      latitude: jitter().lat, longitude: jitter().lng, last_login: nowIso(),
    });
  });
  // Extra unlinked personnel per silo for roster depth.
  const firstNames = ['Sanele', 'Nokuthula', 'Themba', 'Precious', 'Sbu', 'Anele', 'Lwazi', 'Ntcombi'];
  const lastNames = ['Mkhize', 'Zulu', 'Cele', 'Ngcobo', 'Mthembu', 'Shabalala', 'Buthelezi', 'Gumede'];
  SILOS.forEach((silo) => {
    for (let i = 0; i < 6; i++) {
      rows.push({
        silo, first_name: pick(firstNames, i + silo.length), last_name: pick(lastNames, i),
        badge_number: `${silo.slice(0, 2).toUpperCase()}${3000 + i}`, rank: pick(['Constable', 'Sergeant', 'Officer'], i),
        unit: pick(['Alpha', 'Bravo', 'Charlie'], i), is_on_duty: i % 2 === 0, station: 'Durban Central',
        platoon: pick(['A', 'B', 'C', 'D'], i), service_number: `SVC${6000 + i}${silo.length}`, force_number: `F${800 + i}`,
      });
    }
  });
  const { data, error } = await db.from('personnel').insert(rows).select('id, silo, first_name, last_name, badge_number');
  if (error) { console.error('personnel:', error.message); return []; }
  console.log(`✓ ${data.length} personnel`);
  return data;
}

const CATEGORY_TREE = {
  Crime: ['Assault', 'Robbery', 'Burglary'],
  Traffic: ['Motor Vehicle Accident', 'Traffic Violation'],
  Fire: ['Structure Fire', 'Veld/Wildland Fire'],
  Medical: ['Cardiac', 'Trauma'],
  'Public Order': ['Protest'],
  Disaster: ['Flooding'],
};
const SILO_CATEGORIES = {
  MetroPolice: ['Crime', 'Traffic', 'Public Order'],
  MetroFire: ['Fire'],
  Medical: ['Medical'],
  EthekwiniDisaster: ['Disaster'],
};
const REGIONS = ['Central', 'North', 'South', 'West', 'Outer'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const SUBURBS = ['Umlazi', 'Pinetown', 'Umhlanga', 'Chatsworth', 'Phoenix', 'Berea', 'Morningside', 'KwaMashu'];

async function seedIncidents(users, apparatus) {
  const dispatchers = users.filter((u) => ['Dispatcher', 'ControlRoom', 'IncidentLogger'].includes(u.role));
  const responders = users.filter((u) => ['Police', 'Firefighter', 'Paramedic', 'Disaster'].includes(u.role));
  const rows = [];
  let seq = 0;
  for (const silo of SILOS) {
    const cats = SILO_CATEGORIES[silo];
    const siloVeh = apparatus.filter((a) => a.silo === silo);
    const N = 18;
    for (let i = 0; i < N; i++) {
      seq++;
      const created = daysAgo(rand(120) + Math.random());
      const category = pick(cats, i);
      const type = pick(CATEGORY_TREE[category], i);
      const g = jitter();
      // Lifecycle: ~55% closed, ~30% active, ~15% pending.
      const roll = Math.random();
      let status, dispatch_time = null, arrived_timestamp = null, closed_at = null;
      const dispatcher = pick(dispatchers, i);
      const responder = pick(responders, i);
      if (roll < 0.55) {
        status = pick(['Closed', 'Resolved'], i);
        dispatch_time = new Date(created.getTime() + (3 + rand(12)) * 60000).toISOString();
        arrived_timestamp = new Date(created.getTime() + (10 + rand(25)) * 60000).toISOString();
        closed_at = new Date(created.getTime() + (40 + rand(120)) * 60000).toISOString();
      } else if (roll < 0.85) {
        status = pick(['Dispatched', 'En Route', 'On Scene', 'Arrived', 'Transporting'], i);
        dispatch_time = new Date(created.getTime() + (3 + rand(12)) * 60000).toISOString();
        if (status !== 'Dispatched' && status !== 'En Route') {
          arrived_timestamp = new Date(created.getTime() + (10 + rand(25)) * 60000).toISOString();
        }
      } else {
        status = 'Pending Dispatch';
      }
      rows.push({
        silo, incident_number: `${silo.slice(0, 3).toUpperCase()}-${created.toISOString().slice(0, 10).replace(/-/g, '')}-${100 + seq}`,
        source: 'Master',
        caller_name: `${pick(['Mr', 'Ms', 'Mrs'], i)} ${pick(SUBURBS, i)}`,
        caller_number: `07${rand(9)}${1000000 + rand(8999999)}`,
        call_description: `${type} reported at ${pick(SUBURBS, i + 1)}. Units requested.`,
        incident_type: type, incident_category: category,
        incident_severity: pick(SEVERITIES, roll < 0.2 ? 3 : i),
        region: pick(REGIONS, i), location_address: `${100 + rand(900)} ${pick(['Smith', 'West', 'Point', 'Marine'], i)} St, ${pick(SUBURBS, i)}`,
        suburb: pick(SUBURBS, i), city: 'Durban', location_lat: g.lat, location_lng: g.lng,
        status, call_timestamp: created.toISOString(), incident_created_at: created.toISOString(),
        dispatch_time, arrived_timestamp, closed_at,
        unit_id: dispatch_time ? (siloVeh[i % Math.max(1, siloVeh.length)]?.id ?? null) : null,
        unit_type: dispatch_time ? silo : null,
        responding_officer: dispatch_time ? responder?.fullName ?? null : null,
        call_taken_by: dispatcher?.fullName ?? null,
        dispatched_by: dispatch_time ? dispatcher?.fullName ?? null : null,
        number_of_victims: rand(4),
      });
    }
  }
  const { data, error } = await db.from('incidents').insert(rows).select('id, silo, incident_number, status');
  if (error) { console.error('incidents:', error.message); return []; }
  console.log(`✓ ${data.length} incidents`);
  // A couple of updates per recent incident.
  const updates = [];
  data.slice(0, 40).forEach((inc) => {
    updates.push({ silo: inc.silo, incident_id: inc.id, message: 'Unit dispatched to scene.', created_by_name: 'Dispatcher', timestamp: nowIso() });
    if (inc.status === 'Closed' || inc.status === 'Resolved') {
      updates.push({ silo: inc.silo, incident_id: inc.id, message: 'Incident resolved and closed.', created_by_name: 'Case Manager', timestamp: nowIso() });
    }
  });
  await db.from('incident_updates').insert(updates);
  return data;
}

async function seedShiftsAndRosters(users, personnel, apparatus) {
  // One BYLAWS UNIT A style shift per silo today.
  const shiftRows = SILOS.map((silo) => ({
    silo, shift_name: silo === 'MetroPolice' ? 'BYLAWS UNIT A' : `${silo} Day Shift`,
    activity_type: 'Patrol', start_time: new Date(new Date().setHours(7, 0, 0, 0)).toISOString(),
    end_time: new Date(new Date().setHours(19, 0, 0, 0)).toISOString(),
    department: silo, created_by_supervisor_name: 'Mandla Supervisor',
  }));
  const { data: shifts, error: sErr } = await db.from('shifts').insert(shiftRows).select('id, silo, shift_name');
  if (sErr) { console.error('shifts:', sErr.message); return; }

  const rosterRows = [];
  for (const silo of SILOS) {
    const shift = shifts.find((s) => s.silo === silo);
    const people = personnel.filter((p) => p.silo === silo);
    const veh = apparatus.filter((a) => a.silo === silo);
    // rosters.user_id is NOT NULL → attribute each line to a real user in the silo
    // (fall back to any user). The line's own name/badge come from the personnel record.
    const siloUsers = users.filter((u) => u.silo === silo);
    const fallbackUsers = siloUsers.length ? siloUsers : users;
    people.slice(0, 6).forEach((p, i) => {
      rosterRows.push({
        silo, user_id: fallbackUsers[i % fallbackUsers.length].id,
        user_name: `${p.first_name} ${p.last_name}`, badge_number: p.badge_number,
        shift_id: shift?.id ?? null, station: 'Durban Central', activity_type: 'Patrol',
        call_sign: `${silo.slice(0, 2)}-${10 + i}`, vehicle: veh[i % Math.max(1, veh.length)]?.unit_number ?? '',
        sector: pick(REGIONS, i), shift_group_code: pick(['A', 'B'], i),
        special_instructions: i === 0 ? 'Court attendance 09:00' : null, status: 'Present',
        created_by_supervisor_name: 'Mandla Supervisor',
      });
    });
  }
  const { error: rErr } = await db.from('rosters').insert(rosterRows);
  if (rErr) console.error('rosters:', rErr.message);
  console.log(`✓ ${shifts.length} shifts + ${rosterRows.length} roster entries`);
}

async function seedEndorsements(personnel) {
  const types = ['Court Attendance', 'Special Event', 'Special Instruction', 'Restriction'];
  const rows = [];
  personnel.filter((p) => p.silo === 'MetroPolice').slice(0, 4).forEach((p, i) => {
    rows.push({
      silo: 'MetroPolice', employee_name: `${p.first_name} ${p.last_name}`, badge_number: p.badge_number,
      type: pick(types, i), details: pick(['Durban Magistrate Court, Case 4471', 'Beachfront festival deployment', 'No night shifts — medical', 'Firearm competency renewal due'], i),
      start_date: daysAgo(2).toISOString().slice(0, 10),
      end_date: i % 2 ? null : daysAgo(-14).toISOString().slice(0, 10),
      is_active: true, created_by: 'Mandla Supervisor',
    });
  });
  await db.from('endorsements').insert(rows);
  console.log(`✓ ${rows.length} endorsements`);
}

async function seedLeaveTrainingCerts(users, personnel) {
  const leave = users.slice(0, 8).map((u, i) => ({
    silo: u.silo === 'Ethekwini' ? 'MetroPolice' : u.silo, user_id: u.id, rank: u.role,
    service_no: `SVC${5000 + i}`, absence: pick(['Annual', 'Sick', 'Study', 'Family Responsibility'], i),
    eff_from: daysAgo(-3 - i).toISOString().slice(0, 10), eff_to: daysAgo(-5 - i).toISOString().slice(0, 10),
    status: pick(['Approved', 'Pending', 'Approved'], i),
  }));
  await db.from('leave_entries').insert(leave);

  const tr = personnel.slice(0, 10).map((p, i) => ({
    silo: p.silo, personnel_id: p.id, training_name: pick(['Firearm Competency', 'First Aid Level 3', 'Crowd Control', 'HAZMAT Awareness', 'Advanced Driving'], i),
    date_completed: daysAgo(30 + i * 10).toISOString().slice(0, 10), notes_learned: 'Passed with distinction.',
  }));
  await db.from('training_records').insert(tr);

  const certs = personnel.slice(0, 8).map((p, i) => ({
    silo: p.silo, personnel_id: p.id, name: pick(['SAPS Firearm Cert', 'HPCSA Registration', 'SIRA Grade C', 'Fire Fighter II'], i),
    issued_by: pick(['SAPS', 'HPCSA', 'PSIRA', 'IFSAC'], i),
    date_achieved: daysAgo(400 + i * 20).toISOString().slice(0, 10),
    expiry_date: daysAgo(-30 - i * 25).toISOString().slice(0, 10), remarks: 'Renewal reminder set.',
  }));
  await db.from('certifications').insert(certs);
  console.log(`✓ ${leave.length} leave, ${tr.length} training, ${certs.length} certs`);
}

async function seedHydrants() {
  const rows = Array.from({ length: 12 }, (_, i) => {
    const g = jitter();
    return {
      silo: 'MetroFire', location_name: `Hydrant ${pick(SUBURBS, i)} #${i + 1}`,
      latitude: g.lat, longitude: g.lng,
      status: pick(['Operational', 'Operational', 'Operational', 'Maintenance Required', 'Out of Service'], i),
      last_inspected: daysAgo(rand(90)).toISOString(),
    };
  });
  await db.from('hydrants').insert(rows);
  console.log(`✓ ${rows.length} hydrants`);
}

async function seedSiloReports(incidents) {
  const police = incidents.filter((i) => i.silo === 'MetroPolice').slice(0, 4);
  await db.from('metro_reports').insert(police.map((inc, i) => ({
    silo: 'MetroPolice', incident_id: inc.id, case_number: `MP-${2000 + i}`,
    incident_category: pick(['Arrest', 'Accident', 'Vehicle', 'Incident'], i),
    date_of_offense: daysAgo(i * 3).toISOString().slice(0, 10), location: pick(SUBURBS, i),
    station: 'Durban Central', officer_name: 'Const. Khumalo', badge_number: 'P2000',
    officer_narrative: 'Suspect apprehended without incident. Evidence logged.',
    offender_name: pick(['J. Dlamini', 'S. Naidoo', 'T. Mkhize'], i), arrest_made: 'Yes',
    fine_amount: pick([500, 1500, 2500], i), vehicle_impounded: i % 2 ? 'Yes' : 'No',
  })));

  const fire = incidents.filter((i) => i.silo === 'MetroFire').slice(0, 3);
  await db.from('firefighter_reports').insert(fire.map((inc, i) => ({
    silo: 'MetroFire', incident_id: inc.id, report_number: `FR-${3000 + i}`,
    date_of_incident: daysAgo(i * 4).toISOString().slice(0, 10), time_of_incident: '14:30',
    location: pick(SUBURBS, i), type_of_incident: pick(['Structure Fire', 'Veld/Wildland Fire'], i),
    fire_department_name: 'eThekwini Fire & Emergency Services', station_number: 'DBN-1',
    narrative_summary: 'Fire contained to single structure. No fatalities.',
    property_value: 850000, damage_estimate: 120000, civilian_injuries: rand(2),
    reporting_officer_name: 'Chief Naidoo', reporting_officer_rank: 'Chief',
  })));

  const med = incidents.filter((i) => i.silo === 'Medical').slice(0, 3);
  await db.from('paramedic_reports').insert(med.map((inc, i) => ({
    silo: 'Medical', incident_id: inc.id, patient_name: pick(['Patient A', 'Patient B', 'Patient C'], i),
    age: 30 + i * 8, gender: pick(['Male', 'Female'], i), chief_complaint: pick(['Chest pain', 'MVA trauma', 'Difficulty breathing'], i),
    mechanism_of_injury: pick(['Medical — non-trauma', 'MVA', 'Fall'], i), destination_hospital: pick(['Addington', 'King Edward VIII', 'Netcare Umhlanga'], i),
    transport_mode: 'Ambulance', level_of_care: pick(['ALS', 'ILS', 'BLS'], i),
    treatment_narrative: 'Patient stabilised and transported.', paramedic_names: 'Medic Pillay',
  })));

  const dis = incidents.filter((i) => i.silo === 'EthekwiniDisaster').slice(0, 3);
  await db.from('disaster_logs').insert(dis.map((inc, i) => ({
    silo: 'EthekwiniDisaster', incident_id: inc.id, incident_number: inc.incident_number,
    incident_type: 'Flooding', location: pick(SUBURBS, i), description: 'Flash flooding, households displaced.',
    resource_type: pick(['Rescue teams', 'Relief supplies', 'Water & sanitation'], i),
    updates: [{ timestamp: nowIso(), text: 'Rescue teams deployed.' }],
  })));

  await db.from('relief_stocks').insert([
    { silo: 'EthekwiniDisaster', item_name: 'Blankets', category: 'Shelter', quantity: 240, unit_of_measure: 'each' },
    { silo: 'EthekwiniDisaster', item_name: 'Bottled Water', category: 'Water', quantity: 8, unit_of_measure: 'pallet' },
    { silo: 'EthekwiniDisaster', item_name: 'Food Parcels', category: 'Food', quantity: 60, unit_of_measure: 'box' },
  ]);
  console.log('✓ silo reports (metro/fire/pcr/disaster) + relief stock');
}

async function seedPerformance(users, incidents) {
  const cycleYear = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const { data: kpis } = await db.from('performance_kpis').select('id, title').eq('cycle_year', cycleYear).eq('is_active', true);
  const plans = users.map((u, i) => ({
    silo: u.silo, user_id: u.id, employee_name: u.fullName, badge_number: `B${1000 + i}`,
    department: u.silo, cycle_year: cycleYear, status: pick(['Active', 'MidYearApproved', 'Active'], i),
  }));
  const { data: planRows, error } = await db.from('performance_plans').insert(plans).select('id, user_id, status');
  if (error) { console.error('plans:', error.message); return; }
  // Mid-year scores for the ~half whose plans are past Active.
  const scores = [];
  planRows.forEach((p, idx) => {
    if (p.status === 'Active') return;
    (kpis ?? []).forEach((k) => {
      scores.push({
        silo: users[idx]?.silo ?? 'Ethekwini', plan_id: p.id, kpi_id: k.id, kpi_title: k.title,
        stage: 'MidYear', score: 3 + rand(3), comments: 'Meets expectations.', scored_by: 'Mandla Supervisor',
        approved: true, approved_by: 'Mandla Supervisor', approved_at: nowIso(),
      });
    });
  });
  if (scores.length) await db.from('performance_scores').insert(scores);
  console.log(`✓ ${planRows.length} performance plans, ${scores.length} scores`);
}

async function seedAuditAndNotifications(users, incidents) {
  // Logon events feed the operational-KPI logon report.
  const logons = [];
  for (let d = 0; d < 30; d++) {
    users.forEach((u) => {
      if (Math.random() < 0.35) {
        logons.push({
          silo: u.silo, timestamp: daysAgo(d + Math.random()).toISOString(), user_name: u.fullName,
          department: u.silo, action_type: 'Logon', details: 'Signed in',
        });
      }
    });
  }
  // Lifecycle audit rows for closed incidents.
  incidents.filter((i) => i.status === 'Closed' || i.status === 'Resolved').slice(0, 30).forEach((inc) => {
    logons.push({
      silo: inc.silo, timestamp: nowIso(), user_name: 'Ayanda Case', department: inc.silo,
      action_type: 'CaseClosed', entity_type: 'incident', entity_id: inc.id, details: 'Case closed after review.',
    });
  });
  // insert in chunks
  for (let i = 0; i < logons.length; i += 500) {
    await db.from('audit_logs').insert(logons.slice(i, i + 500));
  }

  const notes = incidents.slice(0, 15).map((inc) => ({
    silo: inc.silo, arrived: 'Yes', unit_type: inc.silo, responder_name: 'Field Unit',
    location: 'Durban', time: new Date().toLocaleTimeString(),
  }));
  await db.from('notifications').insert(notes);
  console.log(`✓ ${logons.length} audit events, ${notes.length} notifications`);
}

// ── RUN ───────────────────────────────────────────────────────────────
console.log('Seeding Criticom V5 demo data...\n');
const users = await upsertUsers();
await clearData();
const apparatus = await seedApparatus();
const personnel = await seedPersonnel(users, apparatus);
const incidents = await seedIncidents(users, apparatus);
await seedShiftsAndRosters(users, personnel, apparatus);
await seedEndorsements(personnel);
await seedLeaveTrainingCerts(users, personnel);
await seedHydrants();
await seedSiloReports(incidents);
await seedPerformance(users, incidents);
await seedAuditAndNotifications(users, incidents);

console.log('\n✓ Seed complete.');
console.log(`  Logins: ${USERS.length} accounts, password "${PASSWORD}"`);
console.log('  e.g. sysadmin@criticom.gov.za (SystemAdmin), dispatch@criticom.gov.za (Dispatcher),');
console.log('       captain.metro@criticom.gov.za, fire.chief@criticom.gov.za, paramedic01.med@criticom.gov.za');
