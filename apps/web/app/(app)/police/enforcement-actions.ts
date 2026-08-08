'use server';

import { revalidatePath } from 'next/cache';
import {
  issueFine, issueSummons, issueWarrant, logAudit, openCharge, recordTransaction,
  setChargeStatus, setFineStatus, setSummonsStatus, setWarrantStatus,
} from '@criticom/api';
import { getSession } from '@/lib/session';

const S = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? undefined : v;
};
const N = (fd: FormData, k: string) => Number(fd.get(k) ?? 0);

/* ── Fines ────────────────────────────────────────────────────────────── */

export async function issueFineAction(formData: FormData) {
  const { supabase, userId, fullName } = await getSession();
  const fine = await issueFine(supabase, {
    offenderName: S(formData, 'offender_name') ?? '',
    offenderIdNumber: S(formData, 'offender_id_number'),
    vehicleReg: S(formData, 'vehicle_reg'),
    offenceCode: S(formData, 'offence_code'),
    offenceDescription: S(formData, 'offence_description') ?? '',
    amount: N(formData, 'amount'),
    location: S(formData, 'location'),
    dueDate: S(formData, 'due_date'),
    issuedBy: userId,
    issuedByName: fullName,
    notes: S(formData, 'notes'),
  });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'FineIssued', entity_type: 'fine',
    entity_id: fine.id, user_name: fullName,
    details: `${fine.fine_number} ${fine.offender_name} R${fine.amount}`,
  }).catch(() => {});
  revalidatePath('/police/fines');
}

export async function setFineStatusAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const id = String(formData.get('id'));
  const status = String(formData.get('status')) as
    'Unpaid' | 'Partially Paid' | 'Paid' | 'Disputed' | 'Cancelled';
  await setFineStatus(supabase, { id, status });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'FineStatusChanged', entity_type: 'fine',
    entity_id: id, user_name: fullName, details: status,
  }).catch(() => {});
  revalidatePath('/police/fines');
}

/* ── Charges ──────────────────────────────────────────────────────────── */

export async function openChargeAction(formData: FormData) {
  const { supabase, userId, fullName } = await getSession();
  const charge = await openCharge(supabase, {
    accusedName: S(formData, 'accused_name') ?? '',
    accusedIdNumber: S(formData, 'accused_id_number'),
    chargeCode: S(formData, 'charge_code'),
    description: S(formData, 'description') ?? '',
    statute: S(formData, 'statute'),
    severity: S(formData, 'severity') as 'Minor' | 'Serious' | 'Severe' | undefined,
    officerId: userId,
    officerName: fullName,
    courtName: S(formData, 'court_name'),
    courtDate: S(formData, 'court_date'),
    caseRef: S(formData, 'case_ref'),
    notes: S(formData, 'notes'),
  });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'ChargeOpened', entity_type: 'charge',
    entity_id: charge.id, user_name: fullName,
    details: `${charge.charge_number} ${charge.accused_name}`,
  }).catch(() => {});
  revalidatePath('/police/charges');
}

export async function setChargeStatusAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const id = String(formData.get('id'));
  const status = String(formData.get('status')) as
    'Open' | 'Referred to Court' | 'Withdrawn' | 'Convicted' | 'Acquitted';
  await setChargeStatus(supabase, {
    id, status,
    courtName: S(formData, 'court_name'),
    courtDate: S(formData, 'court_date'),
  });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'ChargeStatusChanged', entity_type: 'charge',
    entity_id: id, user_name: fullName, details: status,
  }).catch(() => {});
  revalidatePath('/police/charges');
  revalidatePath(`/police/charges/${id}`);
}

/* ── Transactions ─────────────────────────────────────────────────────── */

export async function recordTransactionAction(formData: FormData) {
  const { supabase, userId, fullName } = await getSession();
  await recordTransaction(supabase, {
    chargeId: S(formData, 'charge_id'),
    fineId: S(formData, 'fine_id'),
    txType: String(formData.get('tx_type')) as
      'Payment' | 'Bail' | 'Court Fee' | 'Refund' | 'Adjustment',
    amount: N(formData, 'amount'),
    method: S(formData, 'method') as 'Cash' | 'Card' | 'EFT' | 'Other' | undefined,
    reference: S(formData, 'reference'),
    recordedBy: userId,
    recordedName: fullName,
    note: S(formData, 'note'),
  });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'TransactionRecorded', entity_type: 'charge_transaction',
    user_name: fullName, details: `${formData.get('tx_type')} R${formData.get('amount')}`,
  }).catch(() => {});
  revalidatePath('/police/transactions');
  revalidatePath('/police/fines');
  const chargeId = S(formData, 'charge_id');
  if (chargeId) revalidatePath(`/police/charges/${chargeId}`);
}

/* ── Warrants ─────────────────────────────────────────────────────────── */

export async function issueWarrantAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const warrant = await issueWarrant(supabase, {
    subjectName: S(formData, 'subject_name') ?? '',
    subjectIdNumber: S(formData, 'subject_id_number'),
    warrantType: S(formData, 'warrant_type') as 'Arrest' | 'Search' | undefined,
    issuedByCourt: S(formData, 'issued_by_court'),
    expiryDate: S(formData, 'expiry_date'),
    address: S(formData, 'address'),
    notes: S(formData, 'notes'),
  });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'WarrantIssued', entity_type: 'warrant',
    entity_id: warrant.id, user_name: fullName,
    details: `${warrant.warrant_number} ${warrant.subject_name}`,
  }).catch(() => {});
  revalidatePath('/police/warrants');
}

export async function setWarrantStatusAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const id = String(formData.get('id'));
  const status = String(formData.get('status')) as 'Active' | 'Executed' | 'Cancelled' | 'Expired';
  await setWarrantStatus(supabase, { id, status, executingOfficer: fullName });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'WarrantStatusChanged', entity_type: 'warrant',
    entity_id: id, user_name: fullName, details: status,
  }).catch(() => {});
  revalidatePath('/police/warrants');
}

/* ── Summonses ────────────────────────────────────────────────────────── */

export async function issueSummonsAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const summons = await issueSummons(supabase, {
    recipientName: S(formData, 'recipient_name') ?? '',
    recipientIdNumber: S(formData, 'recipient_id_number'),
    offence: S(formData, 'offence') ?? '',
    courtName: S(formData, 'court_name'),
    courtDate: S(formData, 'court_date'),
    address: S(formData, 'address'),
    notes: S(formData, 'notes'),
  });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'SummonsIssued', entity_type: 'summons',
    entity_id: summons.id, user_name: fullName,
    details: `${summons.summons_number} ${summons.recipient_name}`,
  }).catch(() => {});
  revalidatePath('/police/summons');
}

export async function setSummonsStatusAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const id = String(formData.get('id'));
  const status = String(formData.get('status')) as
    'Issued' | 'Served' | 'Court Date Set' | 'Concluded' | 'Withdrawn';
  await setSummonsStatus(supabase, { id, status, servedBy: fullName });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'SummonsStatusChanged', entity_type: 'summons',
    entity_id: id, user_name: fullName, details: status,
  }).catch(() => {});
  revalidatePath('/police/summons');
}
