import type { CriticomClient, Database, Silo, UserRole } from '@criticom/db';

type Tables = Database['public']['Tables'];

// ── Users (DevAdminController.ManageSilo / SuperController) ──────────

export async function listAllProfiles(client: CriticomClient, silo?: Silo) {
  let q = client.from('profiles').select('*').order('full_name');
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function updateProfile(
  client: CriticomClient,
  id: string,
  patch: Tables['profiles']['Update'],
) {
  const { data, error } = await client
    .from('profiles').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function setUserRole(client: CriticomClient, id: string, role: UserRole) {
  return updateProfile(client, id, { role });
}

// ── Vehicles / apparatus ─────────────────────────────────────────────

export async function listApparatus(client: CriticomClient, silo?: Silo) {
  let q = client.from('apparatus').select('*').order('unit_number');
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createApparatus(client: CriticomClient, input: Tables['apparatus']['Insert']) {
  const { data, error } = await client.from('apparatus').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateApparatus(
  client: CriticomClient,
  id: string,
  patch: Tables['apparatus']['Update'],
) {
  const { data, error } = await client
    .from('apparatus').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ── Devices ──────────────────────────────────────────────────────────

export async function listDevices(client: CriticomClient, silo?: Silo) {
  let q = client.from('devices').select('*').order('enrolled_date', { ascending: false });
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createDevice(client: CriticomClient, input: Tables['devices']['Insert']) {
  const { data, error } = await client.from('devices').insert(input).select().single();
  if (error) throw error;
  return data;
}

// ── Cameras (CamerasController import list) ──────────────────────────

export async function listCameras(client: CriticomClient) {
  const { data, error } = await client
    .from('cameras')
    .select('*')
    .eq('disabled', false)
    .order('roadway_name');
  if (error) throw error;
  return data ?? [];
}

// ── Audit log (AuditLog views in DevAdmin/CaseManager) ───────────────

export async function listAuditLogs(
  client: CriticomClient,
  opts: { silo?: Silo; entityType?: string; entityId?: string; limit?: number } = {},
) {
  let q = client.from('audit_logs').select('*').order('timestamp', { ascending: false });
  if (opts.silo) q = q.eq('silo', opts.silo);
  if (opts.entityType) q = q.eq('entity_type', opts.entityType);
  if (opts.entityId) q = q.eq('entity_id', opts.entityId);
  const { data, error } = await q.limit(opts.limit ?? 200);
  if (error) throw error;
  return data ?? [];
}

export async function logAudit(client: CriticomClient, input: Tables['audit_logs']['Insert']) {
  const { error } = await client.from('audit_logs').insert(input);
  if (error) throw error;
}

// ── System profiles (SystemProfileController — operator records) ─────

export async function listSystemProfiles(client: CriticomClient) {
  const { data, error } = await client
    .from('system_profiles').select('*').order('last_name');
  if (error) throw error;
  return data ?? [];
}

/** SystemProfileController's NATO phonetic call-sign generator. */
export function generateCallSign(firstName: string, lastName: string): string {
  const NATO: Record<string, string> = {
    A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
    G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima',
    M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
    S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey',
    X: 'Xray', Y: 'Yankee', Z: 'Zulu',
  };
  const f = NATO[firstName.charAt(0).toUpperCase()] ?? 'Zulu';
  const l = NATO[lastName.charAt(0).toUpperCase()] ?? 'Zulu';
  const num = Math.floor(100 + Math.random() * 900);
  return `${f}-${l}-${num}`;
}
