import type { CriticomClient, Database, OwingCheck } from '@criticom/db';

/**
 * The enforcement suite (migration 0033): fines, charges, the transactions
 * that move money against them, warrants and summonses — Metro Police
 * paperwork with per-tenant document numbers (FN-/CH-/WA-/SM-) that never
 * reset, because a fine number gets quoted in court months later.
 *
 * Fines are served through issue_fines() (0057); for the rest, who may write
 * is RLS's decision. Nothing here re-implements either.
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

/* ── Fines (0057) ─────────────────────────────────────────────────────── */
// Served through issue_fines() and changed only through cancel_fine(),
// set_fine_status() and the payment ledger: a fine is a legal document. RLS
// shows an officer their own fines and command staff the whole register.

export type FineOffence = Database['public']['Tables']['fine_offences']['Row'];

export type FineFilters = {
  status?: Fine['status'];
  noticeType?: Fine['notice_type'];
  /** Only this officer's fines (the phone, "mine" on the console). */
  issuedBy?: string;
  /** Inclusive dates, YYYY-MM-DD, by the day the notice was served. */
  from?: string;
  to?: string;
  /** A fine or notice number, registration, ID number or name. */
  search?: string;
  /** Exactly this ID number or registration: one person's or one vehicle's account. */
  idNumber?: string;
  vehicleReg?: string;
  /** Open and past the pay-by date (0058). */
  overdue?: boolean;
  limit?: number;
};

/** Characters that would change a PostgREST or() filter, stripped from a search. */
const cleanSearch = (q: string) => q.replace(/[,()*%\\:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

export async function listFines(client: CriticomClient, args: FineFilters = {}): Promise<Fine[]> {
  let q = client.from('fines').select('*').order('issued_at', { ascending: false }).limit(args.limit ?? 500);
  if (args.status) q = q.eq('status', args.status);
  if (args.noticeType) q = q.eq('notice_type', args.noticeType);
  if (args.issuedBy) q = q.eq('issued_by', args.issuedBy);
  // Days are South African days: every notice is served in Durban.
  if (args.from) q = q.gte('issued_at', `${args.from}T00:00:00+02:00`);
  if (args.to) q = q.lte('issued_at', `${args.to}T23:59:59.999+02:00`);
  if (args.idNumber) q = q.eq('offender_id_number', args.idNumber.replace(/s/g, '').toUpperCase());
  if (args.vehicleReg) q = q.eq('vehicle_reg', args.vehicleReg.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (args.overdue) {
    // South African today: the pay-by date is a Durban date.
    const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
    q = q.in('status', ['Unpaid', 'Partially Paid']).lt('due_date', today);
  }
  const term = args.search ? cleanSearch(args.search) : '';
  if (term) {
    const reg = term.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const like = `%${term}%`;
    q = q.or([
      `fine_number.ilike.${like}`, `notice_number.ilike.${like}`, `offender_name.ilike.${like}`,
      `offender_id_number.ilike.${like}`, `offence_description.ilike.${like}`, `issued_by_name.ilike.${like}`,
      ...(reg ? [`vehicle_reg.ilike.%${reg}%`] : []),
    ].join(','));
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getFine(client: CriticomClient, id: string): Promise<Fine | null> {
  const { data, error } = await client.from('fines').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Every charge served on the same notice as `fine` (itself included), in order. */
export async function listNoticeCharges(client: CriticomClient, fine: Fine): Promise<Fine[]> {
  if (!fine.group_ref) return [fine];
  const { data, error } = await client
    .from('fines').select('*').eq('group_ref', fine.group_ref).order('charge_seq');
  if (error) throw error;
  return data?.length ? data : [fine];
}

/** The charges the phone filed under one client reference, once delivered. */
export async function listFinesByRef(client: CriticomClient, clientRef: string): Promise<Fine[]> {
  const { data, error } = await client
    .from('fines').select('*').eq('group_ref', clientRef).order('charge_seq');
  if (error) throw error;
  return data ?? [];
}

export type FineChargeInput = {
  offence_id?: string | null;
  description?: string;
  amount?: number | null;
  code?: string;
  notice_number?: string;
};

/**
 * Serve a notice: one to three charges, each its own FN- number. Idempotent
 * on `clientRef`, so the phone's outbox can retry it safely after a dead zone.
 */
export async function issueFines(
  client: CriticomClient,
  args: {
    notice: Record<string, unknown>;
    charges: FineChargeInput[];
    clientRef: string;
    occurredAt?: string;
  },
): Promise<Fine[]> {
  const { data, error } = await client.rpc('issue_fines', {
    p_notice: args.notice,
    p_charges: args.charges,
    p_client_ref: args.clientRef,
    p_occurred_at: args.occurredAt ?? new Date().toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as Fine[];
}

export async function cancelFine(client: CriticomClient, args: { id: string; reason: string }): Promise<void> {
  const { error } = await client.rpc('cancel_fine', { p_id: args.id, p_reason: args.reason });
  if (error) throw error;
}

/** Representation lodged (Disputed) or decided against the infringer (Unpaid). */
export async function setFineStatus(
  client: CriticomClient,
  args: { id: string; status: 'Disputed' | 'Unpaid'; note?: string },
): Promise<void> {
  const { error } = await client.rpc('set_fine_status', { p_id: args.id, p_status: args.status, p_note: args.note ?? null });
  if (error) throw error;
}

export async function setFineNoticeNumber(client: CriticomClient, args: { id: string; number: string }): Promise<void> {
  const { error } = await client.rpc('set_fine_notice_number', { p_id: args.id, p_number: args.number });
  if (error) throw error;
}

/** Rand paid against each fine (payments and adjustments, less refunds). */
export async function paidByFine(client: CriticomClient, fineIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // Chunked: a long register would otherwise overflow the URL.
  for (let i = 0; i < fineIds.length; i += 150) {
    const { data, error } = await client
      .from('charge_transactions').select('fine_id, tx_type, amount').in('fine_id', fineIds.slice(i, i + 150));
    if (error) throw error;
    for (const t of data ?? []) {
      if (!t.fine_id) continue;
      const sign = t.tx_type === 'Refund' ? -1 : t.tx_type === 'Payment' || t.tx_type === 'Adjustment' ? 1 : 0;
      out.set(t.fine_id, (out.get(t.fine_id) ?? 0) + sign * Number(t.amount));
    }
  }
  return out;
}

/** Every ledger entry against these fines, newest first (chunked for long accounts). */
export async function listFineTransactions(client: CriticomClient, fineIds: string[]): Promise<ChargeTransaction[]> {
  const out: ChargeTransaction[] = [];
  for (let i = 0; i < fineIds.length; i += 150) {
    const { data, error } = await client
      .from('charge_transactions').select('*').in('fine_id', fineIds.slice(i, i + 150));
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out.sort((a, b) => (b.paid_on ?? b.recorded_at).localeCompare(a.paid_on ?? a.recorded_at));
}

/**
 * What a person (ID number) or vehicle (registration) owes on the register —
 * a summary for the roadside, every look-up audited (0058).
 */
export async function checkFinesOwing(
  client: CriticomClient,
  args: { idNumber?: string; vehicleReg?: string },
): Promise<OwingCheck> {
  const { data, error } = await client.rpc('check_fines_owing', {
    p_id_number: args.idNumber?.trim() || null,
    p_vehicle_reg: args.vehicleReg?.trim() || null,
  });
  if (error) throw error;
  return data as unknown as OwingCheck;
}

export type PaymentImportResult = {
  recorded: number;
  total: number;
  rows: Array<{
    line: number | null; reference: string | null; receipt: string | null; amount: number | null;
    outcome: string; fine_id: string | null; fine_number: string | null; status: Fine['status'] | null;
  }>;
};

/** Record payments from a file; a receipt already on a fine is skipped, so a file can be re-run (0058). */
export async function importFinePayments(
  client: CriticomClient,
  args: { rows: Array<{ line: number; reference: string; amount: number; paid_on: string; receipt: string; method: string; note?: string }>; fileName?: string; fileSha256?: string },
): Promise<PaymentImportResult> {
  const { data, error } = await client.rpc('import_fine_payments', {
    p_rows: args.rows,
    p_file_name: args.fileName ?? null,
    p_file_sha256: args.fileSha256 ?? null,
  });
  if (error) throw error;
  return data as unknown as PaymentImportResult;
}

/* ── The charge book ──────────────────────────────────────────────────── */

export async function listFineOffences(
  client: CriticomClient,
  args: { activeOnly?: boolean } = {},
): Promise<FineOffence[]> {
  let q = client.from('fine_offences').select('*').order('regime').order('description');
  if (args.activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function saveFineOffence(
  client: CriticomClient,
  args: {
    id?: string;
    regime: FineOffence['regime'];
    code?: string | null;
    description: string;
    legalRef?: string | null;
    penaltyAmount?: number | null;
    demeritPoints?: number;
    active?: boolean;
    verified?: boolean;
  },
): Promise<void> {
  if (args.description.trim().length < 3) throw new Error('Describe the offence.');
  if (args.penaltyAmount !== null && args.penaltyAmount !== undefined
    && (!Number.isFinite(args.penaltyAmount) || args.penaltyAmount < 0)) {
    throw new Error('The penalty must be zero or more.');
  }
  const row = {
    regime: args.regime,
    code: args.code?.trim().toUpperCase() || null,
    description: args.description.trim(),
    legal_ref: args.legalRef?.trim() || null,
    penalty_amount: args.penaltyAmount ?? null,
    demerit_points: Math.max(0, Math.min(6, Math.round(args.demeritPoints ?? 0))),
    active: args.active ?? true,
    verified: args.verified ?? false,
  };
  const { error } = args.id
    ? await client.from('fine_offences').update(row).eq('id', args.id)
    : await client.from('fine_offences').insert(row);
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
    /** The date on the receipt (fine payments, 0058); today when absent. */
    paidOn?: string;
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
    ...(args.paidOn ? { paid_on: args.paidOn } : {}),
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
