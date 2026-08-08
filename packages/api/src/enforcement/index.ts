import type { CriticomClient, Database } from '@criticom/db';

/**
 * The enforcement suite (migration 0033): fines, charges, the transactions
 * that move money against them, warrants and summonses — Metro Police
 * paperwork with per-tenant document numbers (FN-/CH-/WA-/SM-) that never
 * reset, because a fine number gets quoted in court months later.
 *
 * Who may write is RLS's decision (police roles within their silo, plus the
 * global tier); nothing here re-implements it.
 */

export type Fine = Database['public']['Tables']['fines']['Row'];
export type FirearmChecklist = Database['public']['Tables']['firearm_checklists']['Row'];
export type Charge = Database['public']['Tables']['charges']['Row'];
export type ChargeTransaction = Database['public']['Tables']['charge_transactions']['Row'];
export type Warrant = Database['public']['Tables']['warrants']['Row'];
export type Summons = Database['public']['Tables']['summonses']['Row'];

async function nextNumber(client: CriticomClient, prefix: 'FN' | 'CH' | 'WA' | 'SM') {
  const { data, error } = await client.rpc('next_doc_number', { p_prefix: prefix });
  if (error) throw error;
  return data as string;
}

/* ── Firearm checklists ───────────────────────────────────────────────── */
// Captured on the phone (through the offline outbox); the console reads.

export async function listFirearmChecklists(
  client: CriticomClient,
  args: { serial?: string; limit?: number } = {},
): Promise<FirearmChecklist[]> {
  let q = client
    .from('firearm_checklists')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(args.limit ?? 200);
  if (args.serial) q = q.eq('serial_number', args.serial);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/* ── Fines ────────────────────────────────────────────────────────────── */

export async function listFines(
  client: CriticomClient,
  args: { status?: Fine['status']; limit?: number } = {},
): Promise<Fine[]> {
  let q = client.from('fines').select('*').order('issued_at', { ascending: false }).limit(args.limit ?? 200);
  if (args.status) q = q.eq('status', args.status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function issueFine(
  client: CriticomClient,
  args: {
    offenderName: string;
    offenderIdNumber?: string;
    vehicleReg?: string;
    offenceCode?: string;
    offenceDescription: string;
    amount: number;
    location?: string;
    dueDate?: string;
    incidentId?: string;
    issuedBy?: string;
    issuedByName?: string;
    notes?: string;
  },
): Promise<Fine> {
  if (!args.offenderName.trim()) throw new Error('The offender name is required.');
  if (!args.offenceDescription.trim()) throw new Error('The offence description is required.');
  if (!Number.isFinite(args.amount) || args.amount < 0) throw new Error('The amount must be zero or more.');
  const fineNumber = await nextNumber(client, 'FN');
  const { data, error } = await client
    .from('fines')
    .insert({
      fine_number: fineNumber,
      offender_name: args.offenderName.trim(),
      offender_id_number: args.offenderIdNumber?.trim() || null,
      vehicle_reg: args.vehicleReg?.trim().toUpperCase() || null,
      offence_code: args.offenceCode?.trim() || null,
      offence_description: args.offenceDescription.trim(),
      amount: args.amount,
      location: args.location?.trim() || null,
      due_date: args.dueDate || null,
      incident_id: args.incidentId || null,
      issued_by: args.issuedBy || null,
      issued_by_name: args.issuedByName || null,
      notes: args.notes?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setFineStatus(
  client: CriticomClient,
  args: { id: string; status: Fine['status'] },
): Promise<void> {
  const { error } = await client.from('fines').update({ status: args.status }).eq('id', args.id);
  if (error) throw error;
}

/* ── Charges ──────────────────────────────────────────────────────────── */

export async function listCharges(
  client: CriticomClient,
  args: { status?: Charge['status']; limit?: number } = {},
): Promise<Charge[]> {
  let q = client.from('charges').select('*').order('opened_at', { ascending: false }).limit(args.limit ?? 200);
  if (args.status) q = q.eq('status', args.status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getCharge(client: CriticomClient, id: string): Promise<Charge | null> {
  const { data, error } = await client.from('charges').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function openCharge(
  client: CriticomClient,
  args: {
    accusedName: string;
    accusedIdNumber?: string;
    chargeCode?: string;
    description: string;
    statute?: string;
    severity?: Charge['severity'];
    officerId?: string;
    officerName?: string;
    courtName?: string;
    courtDate?: string;
    caseRef?: string;
    incidentId?: string;
    notes?: string;
  },
): Promise<Charge> {
  if (!args.accusedName.trim()) throw new Error('The accused name is required.');
  if (!args.description.trim()) throw new Error('The charge description is required.');
  const chargeNumber = await nextNumber(client, 'CH');
  const { data, error } = await client
    .from('charges')
    .insert({
      charge_number: chargeNumber,
      accused_name: args.accusedName.trim(),
      accused_id_number: args.accusedIdNumber?.trim() || null,
      charge_code: args.chargeCode?.trim() || null,
      description: args.description.trim(),
      statute: args.statute?.trim() || null,
      severity: args.severity ?? 'Serious',
      officer_id: args.officerId || null,
      officer_name: args.officerName || null,
      court_name: args.courtName?.trim() || null,
      court_date: args.courtDate || null,
      case_ref: args.caseRef?.trim() || null,
      incident_id: args.incidentId || null,
      notes: args.notes?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setChargeStatus(
  client: CriticomClient,
  args: { id: string; status: Charge['status']; courtName?: string; courtDate?: string },
): Promise<void> {
  const patch: Database['public']['Tables']['charges']['Update'] = { status: args.status };
  if (args.courtName !== undefined) patch.court_name = args.courtName || null;
  if (args.courtDate !== undefined) patch.court_date = args.courtDate || null;
  const { error } = await client.from('charges').update(patch).eq('id', args.id);
  if (error) throw error;
}

/* ── Charge transactions ──────────────────────────────────────────────── */

export async function listTransactions(
  client: CriticomClient,
  args: { chargeId?: string; fineId?: string; limit?: number } = {},
): Promise<ChargeTransaction[]> {
  let q = client
    .from('charge_transactions')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(args.limit ?? 200);
  if (args.chargeId) q = q.eq('charge_id', args.chargeId);
  if (args.fineId) q = q.eq('fine_id', args.fineId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function recordTransaction(
  client: CriticomClient,
  args: {
    chargeId?: string;
    fineId?: string;
    txType: ChargeTransaction['tx_type'];
    amount: number;
    method?: ChargeTransaction['method'];
    reference?: string;
    recordedBy?: string;
    recordedName?: string;
    note?: string;
  },
): Promise<void> {
  if (!args.chargeId && !args.fineId) {
    throw new Error('A transaction must reference a charge or a fine.');
  }
  if (!Number.isFinite(args.amount)) throw new Error('The amount is required.');
  const { error } = await client.from('charge_transactions').insert({
    charge_id: args.chargeId || null,
    fine_id: args.fineId || null,
    tx_type: args.txType,
    amount: args.amount,
    method: args.method ?? 'EFT',
    reference: args.reference?.trim() || null,
    recorded_by: args.recordedBy || null,
    recorded_name: args.recordedName || null,
    note: args.note?.trim() || null,
  });
  if (error) throw error;
}

/**
 * Settle a fine from its ledger: paid in full flips the fine to Paid,
 * anything on the ledger short of the amount is Partially Paid.
 */
export function fineBalance(fine: Fine, txs: ChargeTransaction[]): number {
  const paid = txs
    .filter((t) => t.fine_id === fine.id && (t.tx_type === 'Payment' || t.tx_type === 'Adjustment'))
    .reduce((sum, t) => sum + Number(t.amount), 0);
  return Math.max(0, Number(fine.amount) - paid);
}

/* ── Warrants ─────────────────────────────────────────────────────────── */

export async function listWarrants(
  client: CriticomClient,
  args: { status?: Warrant['status']; limit?: number } = {},
): Promise<Warrant[]> {
  let q = client.from('warrants').select('*').order('issue_date', { ascending: false }).limit(args.limit ?? 200);
  if (args.status) q = q.eq('status', args.status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function issueWarrant(
  client: CriticomClient,
  args: {
    subjectName: string;
    subjectIdNumber?: string;
    warrantType?: Warrant['warrant_type'];
    issuedByCourt?: string;
    expiryDate?: string;
    address?: string;
    notes?: string;
  },
): Promise<Warrant> {
  if (!args.subjectName.trim()) throw new Error('The subject name is required.');
  const warrantNumber = await nextNumber(client, 'WA');
  const { data, error } = await client
    .from('warrants')
    .insert({
      warrant_number: warrantNumber,
      subject_name: args.subjectName.trim(),
      subject_id_number: args.subjectIdNumber?.trim() || null,
      warrant_type: args.warrantType ?? 'Arrest',
      issued_by_court: args.issuedByCourt?.trim() || null,
      expiry_date: args.expiryDate || null,
      address: args.address?.trim() || null,
      notes: args.notes?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setWarrantStatus(
  client: CriticomClient,
  args: { id: string; status: Warrant['status']; executingOfficer?: string },
): Promise<void> {
  const patch: Database['public']['Tables']['warrants']['Update'] = { status: args.status };
  if (args.status === 'Executed') {
    patch.executed_at = new Date().toISOString();
    patch.executing_officer = args.executingOfficer || null;
  }
  const { error } = await client.from('warrants').update(patch).eq('id', args.id);
  if (error) throw error;
}

/* ── Summonses ────────────────────────────────────────────────────────── */

export async function listSummonses(
  client: CriticomClient,
  args: { status?: Summons['status']; limit?: number } = {},
): Promise<Summons[]> {
  let q = client.from('summonses').select('*').order('court_date', { ascending: true, nullsFirst: false }).limit(args.limit ?? 200);
  if (args.status) q = q.eq('status', args.status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function issueSummons(
  client: CriticomClient,
  args: {
    recipientName: string;
    recipientIdNumber?: string;
    offence: string;
    courtName?: string;
    courtDate?: string;
    address?: string;
    notes?: string;
  },
): Promise<Summons> {
  if (!args.recipientName.trim()) throw new Error('The recipient name is required.');
  if (!args.offence.trim()) throw new Error('The offence is required.');
  const summonsNumber = await nextNumber(client, 'SM');
  const { data, error } = await client
    .from('summonses')
    .insert({
      summons_number: summonsNumber,
      recipient_name: args.recipientName.trim(),
      recipient_id_number: args.recipientIdNumber?.trim() || null,
      offence: args.offence.trim(),
      court_name: args.courtName?.trim() || null,
      court_date: args.courtDate || null,
      address: args.address?.trim() || null,
      notes: args.notes?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setSummonsStatus(
  client: CriticomClient,
  args: { id: string; status: Summons['status']; servedBy?: string },
): Promise<void> {
  const patch: Database['public']['Tables']['summonses']['Update'] = { status: args.status };
  if (args.status === 'Served') {
    patch.served_at = new Date().toISOString();
    patch.served_by = args.servedBy || null;
  }
  const { error } = await client.from('summonses').update(patch).eq('id', args.id);
  if (error) throw error;
}
