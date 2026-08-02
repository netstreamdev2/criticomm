import type { Database, Silo, UserRole } from '@criticom/db';

/** Every dataset must name a table that actually exists — checked at compile time. */
export type TableName = keyof Database['public']['Tables'];

/**
 * The reporting catalogue.
 *
 * Every queryable dataset, every field on it, and who may read it. This file
 * is the single source of truth for the report builder — the UI renders
 * whatever it finds here, so adding a dataset or a column is a data change,
 * not a code change in five places.
 *
 * It is also the security whitelist. The query builder in ./query.ts will only
 * ever emit a column name that came from this registry, and only with an
 * operator this registry says the field's type supports. Nothing a user types
 * reaches the query as an identifier — user input is confined to *values*,
 * which are always sent as bound parameters. That matters here: a report
 * builder is a feature whose whole purpose is letting people compose queries,
 * which is exactly the shape of an injection surface.
 */

export type FieldType = 'text' | 'number' | 'date' | 'timestamp' | 'boolean' | 'enum' | 'uuid';

export type FieldDef = {
  /** Real column name. Only ever chosen from this registry, never from input. */
  key: string;
  label: string;
  type: FieldType;
  /** Allowed values for `enum` fields — drives the filter dropdown. */
  options?: readonly string[];
  /** May be summed/averaged. Numbers and durations only. */
  aggregatable?: boolean;
  /** Sensible to group by. High-cardinality fields (ids, free text) are not. */
  groupable?: boolean;
  /** Available as a filter/column but not shown by default. */
  advanced?: boolean;
  /** Short note surfaced in the builder — what the field actually means. */
  hint?: string;
};

export type DatasetDef = {
  key: string;
  label: string;
  description: string;
  /** Real table name — the type makes a typo here a build failure. */
  table: TableName;
  /** Column used for department scoping, or null if the table is not siloed. */
  siloColumn: string | null;
  /** Default field for date-range filtering. */
  dateColumn: string | null;
  defaultColumns: readonly string[];
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  fields: readonly FieldDef[];
  /**
   * Roles permitted to query this dataset at all. Undefined means "anyone who
   * can reach the reports section". Sensitive datasets name their roles.
   */
  roles?: readonly UserRole[];
};

const SILOS: readonly string[] = ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

const INCIDENT_STATUS = [
  'New', 'Pending', 'Pending Dispatch', 'Pending Analysis', 'Dispatched', 'En Route',
  'Arrived', 'On Scene', 'Transporting', 'Active', 'Closed', 'Resolved',
] as const;

const SEVERITY = ['Low', 'Medium', 'High', 'Critical'] as const;

const ROLES = [
  'SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'Operator', 'ControlRoom',
  'IncidentLogger', 'Viewer', 'System', 'Captain', 'Police', 'Officer', 'Metro', 'Security',
  'Chief', 'FireChief', 'Firefighter', 'Paramedic', 'Doctor', 'Disaster', 'CaseManager',
  'Citizen', 'Responder', 'Staff',
] as const;

const APPARATUS_STATUS = [
  'Available', 'In Use', 'En Route', 'On Scene', 'Out of Service', 'Maintenance', 'Decommissioned',
] as const;

/* Role bundles, mirroring packages/db/src/roles.ts. */
const ADMIN = ['SystemAdmin', 'SuperAdmin', 'Admin'] as const;
const SUPERVISORY = [...ADMIN, 'Supervisor', 'Captain', 'Chief', 'FireChief'] as const;
const DESK = [...ADMIN, 'Dispatcher', 'Operator', 'ControlRoom', 'Supervisor'] as const;

export const DATASETS: readonly DatasetDef[] = [
  {
    key: 'incidents',
    label: 'Incidents',
    description: 'Every logged call and its response lifecycle. The core operational record.',
    table: 'incidents',
    siloColumn: 'silo',
    dateColumn: 'incident_created_at',
    defaultColumns: ['incident_number', 'incident_created_at', 'incident_type', 'incident_severity', 'status', 'location_address', 'region'],
    defaultSort: { field: 'incident_created_at', dir: 'desc' },
    fields: [
      { key: 'incident_number', label: 'Incident #', type: 'text' },
      { key: 'incident_created_at', label: 'Logged at', type: 'timestamp' },
      { key: 'call_timestamp', label: 'Call received', type: 'timestamp', advanced: true },
      { key: 'dispatch_time', label: 'Dispatched at', type: 'timestamp' },
      { key: 'arrived_timestamp', label: 'Arrived at', type: 'timestamp' },
      { key: 'closed_at', label: 'Closed at', type: 'timestamp' },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'status', label: 'Status', type: 'enum', options: INCIDENT_STATUS, groupable: true },
      { key: 'incident_severity', label: 'Severity', type: 'enum', options: SEVERITY, groupable: true },
      { key: 'incident_type', label: 'Type', type: 'text', groupable: true },
      { key: 'incident_category', label: 'Category', type: 'text', groupable: true },
      { key: 'region', label: 'Region', type: 'text', groupable: true },
      { key: 'suburb', label: 'Suburb', type: 'text', groupable: true },
      { key: 'city', label: 'City', type: 'text', groupable: true },
      { key: 'location_address', label: 'Address', type: 'text' },
      { key: 'source', label: 'Source', type: 'text', groupable: true },
      { key: 'call_taken_by', label: 'Call taken by', type: 'text', groupable: true },
      { key: 'dispatched_by', label: 'Dispatched by', type: 'text', groupable: true },
      { key: 'responding_officer', label: 'Responding officer', type: 'text', groupable: true },
      { key: 'unit_type', label: 'Unit type', type: 'text', groupable: true },
      { key: 'unit_status', label: 'Unit status', type: 'text', groupable: true },
      { key: 'number_of_victims', label: 'Victims', type: 'number', aggregatable: true },
      { key: 'caller_name', label: 'Caller name', type: 'text', advanced: true },
      { key: 'caller_number', label: 'Caller number', type: 'text', advanced: true },
      { key: 'patient_name', label: 'Patient name', type: 'text', advanced: true },
      { key: 'is_caller_patient', label: 'Caller is patient', type: 'boolean', advanced: true },
      { key: 'call_description', label: 'Description', type: 'text', advanced: true },
      { key: 'notes', label: 'Notes', type: 'text', advanced: true },
      { key: 'fire_incident_type', label: 'Fire type', type: 'text', groupable: true, advanced: true },
      { key: 'medical_type', label: 'Medical type', type: 'text', groupable: true, advanced: true },
      { key: 'disaster_type', label: 'Disaster type', type: 'text', groupable: true, advanced: true },
      { key: 'acceptance', label: 'Accepted', type: 'boolean', advanced: true },
      { key: 'location_lat', label: 'Latitude', type: 'number', advanced: true },
      { key: 'location_lng', label: 'Longitude', type: 'number', advanced: true },
    ],
  },
  {
    key: 'incident_updates',
    label: 'Incident activity',
    description: 'The running log against each incident — the evidentiary trail of a response.',
    table: 'incident_updates',
    siloColumn: 'silo',
    dateColumn: 'timestamp',
    defaultColumns: ['timestamp', 'created_by_name', 'message'],
    defaultSort: { field: 'timestamp', dir: 'desc' },
    fields: [
      { key: 'timestamp', label: 'At', type: 'timestamp' },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'created_by_name', label: 'By', type: 'text', groupable: true },
      { key: 'message', label: 'Entry', type: 'text' },
      { key: 'incident_id', label: 'Incident', type: 'uuid', advanced: true },
    ],
  },
  {
    key: 'rosters',
    label: 'Duty allocation',
    description: 'Who was posted where, on what vehicle and sector, for each shift.',
    table: 'rosters',
    siloColumn: 'silo',
    dateColumn: 'created_at',
    defaultColumns: ['user_name', 'badge_number', 'station', 'activity_type', 'vehicle', 'sector', 'status'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: [
      { key: 'created_at', label: 'Allocated at', type: 'timestamp' },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'user_name', label: 'Member', type: 'text', groupable: true },
      { key: 'badge_number', label: 'Badge', type: 'text' },
      { key: 'station', label: 'Station', type: 'text', groupable: true },
      { key: 'activity_type', label: 'Duty', type: 'text', groupable: true },
      { key: 'vehicle', label: 'Vehicle', type: 'text', groupable: true },
      { key: 'sector', label: 'Sector', type: 'text', groupable: true },
      { key: 'call_sign', label: 'Call sign', type: 'text', groupable: true },
      { key: 'status', label: 'Status', type: 'text', groupable: true },
      { key: 'shift_group_code', label: 'Shift group', type: 'text', groupable: true },
      { key: 'created_by_supervisor_name', label: 'Allocated by', type: 'text', groupable: true },
      { key: 'special_instructions', label: 'Instructions', type: 'text', advanced: true },
      { key: 'description', label: 'Notes', type: 'text', advanced: true },
    ],
  },
  {
    key: 'shifts',
    label: 'Shifts',
    description: 'Defined shift windows per department.',
    table: 'shifts',
    siloColumn: 'silo',
    dateColumn: 'start_time',
    defaultColumns: ['shift_name', 'start_time', 'end_time', 'department', 'activity_type'],
    defaultSort: { field: 'start_time', dir: 'desc' },
    fields: [
      { key: 'shift_name', label: 'Shift', type: 'text', groupable: true },
      { key: 'start_time', label: 'Starts', type: 'timestamp' },
      { key: 'end_time', label: 'Ends', type: 'timestamp' },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'department', label: 'Sub-department', type: 'text', groupable: true },
      { key: 'activity_type', label: 'Activity', type: 'text', groupable: true },
      { key: 'created_by_supervisor_name', label: 'Created by', type: 'text', groupable: true },
      { key: 'description', label: 'Description', type: 'text', advanced: true },
    ],
  },
  {
    key: 'leave_entries',
    label: 'Leave',
    description: 'Leave applications, approvals and absence history.',
    table: 'leave_entries',
    siloColumn: 'silo',
    dateColumn: 'eff_from',
    defaultColumns: ['rank', 'service_no', 'absence', 'eff_from', 'eff_to', 'status', 'approved_by'],
    defaultSort: { field: 'eff_from', dir: 'desc' },
    roles: [...SUPERVISORY, 'CaseManager'],
    fields: [
      { key: 'eff_from', label: 'From', type: 'date' },
      { key: 'eff_to', label: 'To', type: 'date' },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'absence', label: 'Leave type', type: 'text', groupable: true },
      { key: 'status', label: 'Status', type: 'text', groupable: true },
      { key: 'rank', label: 'Rank', type: 'text', groupable: true },
      { key: 'service_no', label: 'Service no.', type: 'text' },
      { key: 'approved_by', label: 'Approved by', type: 'text', groupable: true },
      { key: 'approved_at', label: 'Approved at', type: 'timestamp' },
      { key: 'created_at', label: 'Applied at', type: 'timestamp' },
      { key: 'reason', label: 'Reason', type: 'text', advanced: true },
      { key: 'staff', label: 'Staff no.', type: 'number', advanced: true },
      { key: 'force', label: 'Force no.', type: 'number', advanced: true },
    ],
  },
  {
    key: 'personnel',
    label: 'Personnel',
    description: 'Operational staff records — station, unit, duty state.',
    table: 'personnel',
    siloColumn: 'silo',
    dateColumn: 'created_at',
    defaultColumns: ['first_name', 'last_name', 'badge_number', 'rank', 'station', 'unit', 'is_on_duty'],
    defaultSort: { field: 'last_name', dir: 'asc' },
    roles: [...SUPERVISORY, 'CaseManager'],
    fields: [
      { key: 'first_name', label: 'First name', type: 'text' },
      { key: 'last_name', label: 'Surname', type: 'text' },
      { key: 'badge_number', label: 'Badge', type: 'text' },
      { key: 'rank', label: 'Rank', type: 'text', groupable: true },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'station', label: 'Station', type: 'text', groupable: true },
      { key: 'platoon', label: 'Platoon', type: 'text', groupable: true },
      { key: 'unit', label: 'Unit', type: 'text', groupable: true },
      { key: 'is_on_duty', label: 'On duty', type: 'boolean', groupable: true },
      { key: 'last_login', label: 'Last seen', type: 'timestamp' },
      { key: 'service_number', label: 'Service no.', type: 'text' },
      { key: 'force_number', label: 'Force no.', type: 'text', advanced: true },
      { key: 'created_at', label: 'Added', type: 'timestamp', advanced: true },
    ],
  },
  {
    key: 'profiles',
    label: 'Staff directory',
    description: 'All system accounts with role, rank and contact details.',
    table: 'profiles',
    siloColumn: 'silo',
    dateColumn: 'created_at',
    defaultColumns: ['full_name', 'role', 'rank', 'station', 'silo', 'is_on_duty', 'last_login'],
    defaultSort: { field: 'full_name', dir: 'asc' },
    roles: [...SUPERVISORY],
    fields: [
      { key: 'full_name', label: 'Name', type: 'text' },
      { key: 'role', label: 'Role', type: 'enum', options: ROLES, groupable: true },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'rank', label: 'Rank', type: 'text', groupable: true },
      { key: 'station', label: 'Station', type: 'text', groupable: true },
      { key: 'platoon', label: 'Platoon', type: 'text', groupable: true },
      { key: 'call_sign', label: 'Call sign', type: 'text' },
      { key: 'badge_number', label: 'Badge', type: 'text' },
      { key: 'is_on_duty', label: 'On duty', type: 'boolean', groupable: true },
      { key: 'status', label: 'Account status', type: 'text', groupable: true },
      { key: 'total_incidents', label: 'Incidents handled', type: 'number', aggregatable: true },
      { key: 'last_login', label: 'Last login', type: 'timestamp' },
      { key: 'email', label: 'Email', type: 'text', advanced: true },
      { key: 'contact_number', label: 'Contact', type: 'text', advanced: true },
      { key: 'created_at', label: 'Created', type: 'timestamp', advanced: true },
    ],
  },
  {
    key: 'training_records',
    label: 'Training',
    description: 'Completed training and competency records.',
    table: 'training_records',
    siloColumn: 'silo',
    dateColumn: 'date_completed',
    defaultColumns: ['training_name', 'date_completed', 'silo'],
    defaultSort: { field: 'date_completed', dir: 'desc' },
    roles: [...SUPERVISORY],
    fields: [
      { key: 'training_name', label: 'Course', type: 'text', groupable: true },
      { key: 'date_completed', label: 'Completed', type: 'date' },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'notes_learned', label: 'Notes', type: 'text', advanced: true },
    ],
  },
  {
    key: 'endorsements',
    label: 'Endorsements',
    description: 'Competencies and authorisations held by members.',
    table: 'endorsements',
    siloColumn: 'silo',
    dateColumn: 'start_date',
    defaultColumns: ['employee_name', 'badge_number', 'type', 'start_date', 'end_date', 'is_active'],
    defaultSort: { field: 'start_date', dir: 'desc' },
    roles: [...SUPERVISORY],
    fields: [
      { key: 'employee_name', label: 'Member', type: 'text', groupable: true },
      { key: 'badge_number', label: 'Badge', type: 'text' },
      { key: 'type', label: 'Endorsement', type: 'text', groupable: true },
      { key: 'start_date', label: 'From', type: 'date' },
      { key: 'end_date', label: 'Until', type: 'date' },
      { key: 'is_active', label: 'Active', type: 'boolean', groupable: true },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'created_by', label: 'Granted by', type: 'text', groupable: true },
      { key: 'details', label: 'Details', type: 'text', advanced: true },
    ],
  },
  {
    key: 'apparatus',
    label: 'Fleet',
    description: 'Vehicles and apparatus, their status and compliance dates.',
    table: 'apparatus',
    siloColumn: 'silo',
    dateColumn: 'created_at',
    defaultColumns: ['unit_number', 'name', 'type', 'status', 'station_number', 'disc_expiry'],
    defaultSort: { field: 'unit_number', dir: 'asc' },
    fields: [
      { key: 'unit_number', label: 'Unit #', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'type', label: 'Type', type: 'text', groupable: true },
      { key: 'status', label: 'Status', type: 'enum', options: APPARATUS_STATUS, groupable: true },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'station_number', label: 'Station', type: 'text', groupable: true },
      { key: 'department_name', label: 'Sub-department', type: 'text', groupable: true },
      { key: 'make', label: 'Make', type: 'text', groupable: true },
      { key: 'model', label: 'Model', type: 'text', groupable: true },
      { key: 'year', label: 'Year', type: 'number', groupable: true },
      { key: 'mileage', label: 'Mileage', type: 'number', aggregatable: true },
      { key: 'disc_expiry', label: 'Licence expiry', type: 'date' },
      { key: 'fuel_type', label: 'Fuel', type: 'text', groupable: true, advanced: true },
      { key: 'license_plate', label: 'Registration', type: 'text', advanced: true },
      { key: 'created_at', label: 'Added', type: 'timestamp', advanced: true },
    ],
  },
  {
    key: 'vehicle_checklists',
    label: 'Vehicle checks',
    description: 'Pre-shift vehicle inspections and defects.',
    table: 'vehicle_checklists',
    siloColumn: 'silo',
    dateColumn: 'checked_at',
    defaultColumns: ['checked_at', 'fuel_level', 'lights_functional', 'tires_condition_ok', 'equipment_stocked', 'comms_working', 'brakes_responsive'],
    defaultSort: { field: 'checked_at', dir: 'desc' },
    roles: [...SUPERVISORY],
    fields: [
      { key: 'checked_at', label: 'Checked at', type: 'timestamp' },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'fuel_level', label: 'Fuel level', type: 'text', groupable: true },
      { key: 'lights_functional', label: 'Lights OK', type: 'boolean', groupable: true },
      { key: 'tires_condition_ok', label: 'Tyres OK', type: 'boolean', groupable: true },
      { key: 'equipment_stocked', label: 'Equipment stocked', type: 'boolean', groupable: true },
      { key: 'comms_working', label: 'Comms OK', type: 'boolean', groupable: true },
      { key: 'brakes_responsive', label: 'Brakes OK', type: 'boolean', groupable: true },
    ],
  },
  {
    key: 'performance_scores',
    label: 'Performance scores',
    description: 'Scored KPI outcomes per member and cycle stage.',
    table: 'performance_scores',
    siloColumn: 'silo',
    dateColumn: 'scored_at',
    defaultColumns: ['kpi_title', 'stage', 'score', 'scored_by', 'scored_at', 'approved'],
    defaultSort: { field: 'scored_at', dir: 'desc' },
    roles: [...SUPERVISORY],
    fields: [
      { key: 'kpi_title', label: 'KPI', type: 'text', groupable: true },
      { key: 'stage', label: 'Stage', type: 'text', groupable: true },
      { key: 'score', label: 'Score', type: 'number', aggregatable: true },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'scored_by', label: 'Scored by', type: 'text', groupable: true },
      { key: 'scored_at', label: 'Scored at', type: 'timestamp' },
      { key: 'approved', label: 'Approved', type: 'boolean', groupable: true },
      { key: 'approved_by', label: 'Approved by', type: 'text', groupable: true },
      { key: 'comments', label: 'Comments', type: 'text', advanced: true },
    ],
  },
  {
    key: 'audit_logs',
    label: 'Audit trail',
    description: 'Every privileged action taken in the system. Compliance evidence.',
    table: 'audit_logs',
    siloColumn: 'silo',
    dateColumn: 'timestamp',
    defaultColumns: ['timestamp', 'user_name', 'action_type', 'entity_type', 'details'],
    defaultSort: { field: 'timestamp', dir: 'desc' },
    roles: [...ADMIN, 'CaseManager', 'Supervisor'],
    fields: [
      { key: 'timestamp', label: 'At', type: 'timestamp' },
      { key: 'user_name', label: 'User', type: 'text', groupable: true },
      { key: 'action_type', label: 'Action', type: 'text', groupable: true },
      { key: 'entity_type', label: 'Entity', type: 'text', groupable: true },
      { key: 'silo', label: 'Department', type: 'enum', options: SILOS, groupable: true },
      { key: 'department', label: 'Sub-department', type: 'text', groupable: true },
      { key: 'details', label: 'Detail', type: 'text' },
      { key: 'entity_id', label: 'Entity id', type: 'text', advanced: true },
    ],
  },
] as const;

/* ── Lookups ─────────────────────────────────────────────────────── */

export function getDataset(key: string): DatasetDef | undefined {
  return DATASETS.find((d) => d.key === key);
}

export function getField(dataset: DatasetDef, key: string): FieldDef | undefined {
  return dataset.fields.find((f) => f.key === key);
}

/** Datasets this role may query, in catalogue order. */
export function datasetsForRole(role: UserRole): DatasetDef[] {
  return DATASETS.filter((d) => !d.roles || (d.roles as readonly UserRole[]).includes(role));
}

export function canQueryDataset(dataset: DatasetDef, role: UserRole): boolean {
  return !dataset.roles || (dataset.roles as readonly UserRole[]).includes(role);
}

/** Whether a silo value is one this system knows about. */
export function isKnownSilo(v: string): v is Silo {
  return SILOS.includes(v);
}
