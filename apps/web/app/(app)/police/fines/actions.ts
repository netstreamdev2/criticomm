'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
  cancelFine, importFinePayments, issueFines, listFineOffences, paidByFine, recordTransaction, saveFineOffence,
  setFineNoticeNumber, setFineStatus, type Fine, type PaymentImportResult,
} from '@criticom/api';
import {
  amountDue, canIssueFines, canManageFineOffences, canViewAllFines, initialsOf, noticeProblems, normaliseReg, saDate,
  type FineNoticeType, type PaymentRow,
} from '@criticom/db';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';

/**
 * The fines register (migration 0057). Every write goes through a database
 * function that checks the caller and keeps the record: issue_fines(),
 * cancel_fine(), set_fine_status(), set_fine_notice_number() and the payment
 * ledger. The checks here only give a clearer message sooner.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const failed = (e: unknown, fallback = 'That did not work. Try again.') => {
  const err = e as { code?: string; message?: string };
  if (err?.code === '42501' && /row-level security/i.test(err.message ?? '')) {
    return { ok: false as const, error: 'Your role cannot do that on the fines register.' };
  }
  if (err?.code === '23505') {
    return { ok: false as const, error: 'That notice number is already on the register.' };
  }
  return { ok: false as const, error: invitationErrorMessage(e, fallback) };
};

function refresh(id?: string) {
  revalidatePath('/police/fines');
  revalidatePath('/dashboard');
  if (id) revalidatePath(`/police/fines/${id}`);
}

/* ── Capturing a notice written in a paper book ───────────────────────── */

export type CaptureInput = {
  noticeType: FineNoticeType;
  noticeNumber: string;
  servedAt: string;
  surname: string;
  firstNames: string;
  idType: 'RSA ID' | 'Passport' | 'Driving licence' | 'Foreign ID' | '';
  idNumber: string;
  licenceCode: string;
  phone: string;
  address: string;
  reg: string;
  make: string;
  model: string;
  colour: string;
  street: string;
  streetB: string;
  suburb: string;
  place: string;
  courtName: string;
  courtDate: string;
  notes: string;
  charges: Array<{ offenceId: string; description: string; amount: string }>;
};

export async function captureFineAction(input: CaptureInput): Promise<Result<{ id: string }>> {
  const { supabase, role, silo } = await getSession();
  if (!canIssueFines({ role, silo })) return { ok: false, error: 'Only Metro Police officers, supervisors and captains capture fines.' };
  // The charge book as the database holds it, not as the browser last saw it.
  const offences = await listFineOffences(supabase, { activeOnly: true }).catch(() => []);

  const charges = input.charges.filter((c) => c.offenceId || c.description.trim());
  const problems = noticeProblems({
    noticeType: input.noticeType, capturedFrom: 'paper', noticeNumber: input.noticeNumber,
    surname: input.surname, firstNames: input.firstNames, idType: input.idType || null, idNumber: input.idNumber,
    vehicleReg: input.reg, street: input.street, place: input.place, courtName: input.courtName, courtDate: input.courtDate,
    charges: charges.map((c) => ({ offenceId: c.offenceId || null, description: c.description, amount: c.amount })),
  }, offences);
  if (problems.length) return { ok: false, error: problems.map((p) => p.message).join(' ') };

  const served = input.servedAt ? new Date(`${input.servedAt}:00+02:00`) : new Date();
  if (Number.isNaN(served.getTime())) return { ok: false, error: 'Enter when the notice was served.' };

  try {
    const person = input.noticeType !== 'Section 341';
    const rows = await issueFines(supabase, {
      clientRef: randomUUID(),
      occurredAt: served.toISOString(),
      notice: {
        notice_type: input.noticeType,
        captured_from: 'paper',
        notice_number: input.noticeNumber.trim(),
        offender_surname: person ? input.surname.trim() : null,
        offender_first_names: person ? input.firstNames.trim() : null,
        offender_initials: person ? initialsOf(input.firstNames) : null,
        offender_id_type: person ? input.idType || null : null,
        offender_id_number: person ? input.idNumber.trim() : null,
        offender_licence_code: person ? input.licenceCode || null : null,
        offender_phone: person ? input.phone.trim() : null,
        offender_address: person ? input.address.trim() : null,
        vehicle_reg: normaliseReg(input.reg) || null,
        vehicle_make: input.make.trim() || null,
        vehicle_model: input.model.trim() || null,
        vehicle_colour: input.colour.trim() || null,
        street_a: input.street.trim() || null,
        street_b: input.streetB.trim() || null,
        suburb: input.suburb.trim() || null,
        location: input.place.trim() || null,
        court_name: input.noticeType === 'Section 56' ? input.courtName.trim() : null,
        court_date: input.noticeType === 'Section 56' ? input.courtDate : null,
        offence_at: served.toISOString(),
        notes: input.notes.trim() || null,
      },
      charges: charges.map((c) => ({
        offence_id: c.offenceId || null,
        description: c.description.trim(),
        amount: c.amount.trim() ? Number(c.amount) : null,
      })),
    });
    refresh();
    const first = rows[0];
    if (!first) return { ok: false, error: 'The register did not return the new fine.' };
    return { ok: true, id: first.id };
  } catch (e) {
    return failed(e, 'The notice could not be captured.');
  }
}

/* ── Command staff ────────────────────────────────────────────────────── */

export async function cancelFineAction(id: string, reason: string): Promise<Result> {
  const { supabase, role, silo } = await getSession();
  if (!canViewAllFines({ role, silo })) return { ok: false, error: 'Only command staff may cancel a fine.' };
  if (reason.trim().length < 10) return { ok: false, error: 'Give the reason for cancelling (at least 10 characters).' };
  try {
    await cancelFine(supabase, { id, reason: reason.trim() });
    refresh(id);
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

export async function setFineStatusAction(id: string, status: 'Disputed' | 'Unpaid', note: string): Promise<Result> {
  const { supabase, role, silo } = await getSession();
  if (!canViewAllFines({ role, silo })) return { ok: false, error: 'Only command staff may change a fine’s status.' };
  try {
    await setFineStatus(supabase, { id, status, note: note.trim() || undefined });
    refresh(id);
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

export async function setFineNoticeNumberAction(id: string, number: string): Promise<Result> {
  const { supabase } = await getSession();
  try {
    await setFineNoticeNumber(supabase, { id, number });
    refresh(id);
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

export async function recordFinePaymentAction(input: {
  fineId: string;
  txType: 'Payment' | 'Refund' | 'Adjustment';
  amount: string;
  method: 'Cash' | 'Card' | 'EFT' | 'Other';
  reference: string;
  note: string;
  /** The date on the receipt (0058). */
  paidOn: string;
}): Promise<Result> {
  const { supabase, userId, fullName, role, silo } = await getSession();
  if (!canViewAllFines({ role, silo })) return { ok: false, error: 'Only command staff record payments.' };
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter the amount received.' };
  if (!input.reference.trim()) return { ok: false, error: 'Enter the receipt or payment reference.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) return { ok: false, error: 'Enter the date on the receipt.' };
  try {
    await recordTransaction(supabase, {
      fineId: input.fineId, txType: input.txType, amount, method: input.method,
      reference: input.reference, recordedBy: userId, recordedName: fullName, note: input.note, paidOn: input.paidOn,
    });
    refresh(input.fineId);
    revalidatePath('/police/transactions');
    return { ok: true };
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') return { ok: false, error: 'That receipt is already recorded against this fine.' };
    return failed(e);
  }
}

/* ── The charge book ──────────────────────────────────────────────────── */

export type OffenceInput = {
  id?: string;
  regime: 'AARTO' | 'By-law';
  code: string;
  description: string;
  legalRef: string;
  penaltyAmount: string;
  demeritPoints: string;
  active: boolean;
  verified: boolean;
};

export async function saveFineOffenceAction(input: OffenceInput): Promise<Result> {
  const { supabase, role, silo } = await getSession();
  if (!canManageFineOffences({ role, silo })) return { ok: false, error: 'Only the admin tier keeps the charge book.' };
  const amount = input.penaltyAmount.trim() === '' ? null : Number(input.penaltyAmount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return { ok: false, error: 'The penalty must be a number.' };
  if (input.verified && amount === null) return { ok: false, error: 'Enter the penalty amount before verifying.' };
  try {
    await saveFineOffence(supabase, {
      id: input.id, regime: input.regime, code: input.code, description: input.description, legalRef: input.legalRef,
      penaltyAmount: amount, demeritPoints: Number(input.demeritPoints) || 0, active: input.active, verified: input.verified,
    });
    revalidatePath('/police/fines/offences');
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string };
    if (err?.code === '23505') return { ok: false, error: 'That code or description is already in the charge book.' };
    return failed(e);
  }
}

/* ── Payments from a file (0058) ──────────────────────────────────────── */

export type PaymentMatch = {
  id: string;
  fineNumber: string;
  noticeNumber: string | null;
  noticeType: string;
  status: string;
  who: string;
  vehicleReg: string | null;
  issuedOn: string;
  dueNow: number;
  paid: number;
};

/** The fines a file's references point at, for the preview. Nothing is written. */
export async function previewPaymentsAction(refs: string[]): Promise<Result<{ matches: Record<string, PaymentMatch[]> }>> {
  const { supabase, role, silo } = await getSession();
  if (!canViewAllFines({ role, silo })) return { ok: false, error: 'Only command staff record payments.' };
  const clean = [...new Set(refs.map((r) => r.replace(/[^A-Za-z0-9-]/g, '').toUpperCase()).filter(Boolean))].slice(0, 2000);
  try {
    const found: Fine[] = [];
    for (let i = 0; i < clean.length; i += 100) {
      const list = clean.slice(i, i + 100).join(',');
      const { data, error } = await supabase.from('fines').select('*').or(`fine_number.in.(${list}),notice_number.in.(${list})`);
      if (error) throw error;
      found.push(...(data ?? []));
    }
    const paid = await paidByFine(supabase, found.map((f) => f.id)).catch(() => new Map<string, number>());
    const matches: Record<string, PaymentMatch[]> = {};
    for (const f of found) {
      const m: PaymentMatch = {
        id: f.id, fineNumber: f.fine_number, noticeNumber: f.notice_number, noticeType: f.notice_type, status: f.status,
        who: f.offender_name, vehicleReg: f.vehicle_reg, issuedOn: saDate(f.issued_at),
        dueNow: f.status === 'Paid' || f.status === 'Cancelled' ? 0 : Math.max(0, amountDue(f) - (paid.get(f.id) ?? 0)),
        paid: paid.get(f.id) ?? 0,
      };
      for (const key of [f.fine_number.toUpperCase(), f.notice_number?.toUpperCase()].filter((k): k is string => Boolean(k))) {
        if (clean.includes(key)) (matches[key] ??= []).push(m);
      }
    }
    return { ok: true, matches };
  } catch (e) {
    return failed(e, 'The fines could not be looked up.');
  }
}

export async function importPaymentsAction(
  rows: PaymentRow[],
  meta: { fileName: string; fileSha256: string },
): Promise<Result<{ result: PaymentImportResult }>> {
  const { supabase, role, silo } = await getSession();
  if (!canViewAllFines({ role, silo })) return { ok: false, error: 'Only command staff record payments.' };
  if (!rows.length) return { ok: false, error: 'There are no payments ready to record.' };
  try {
    const result = await importFinePayments(supabase, { rows, fileName: meta.fileName, fileSha256: meta.fileSha256 });
    refresh();
    revalidatePath('/police/transactions');
    return { ok: true, result };
  } catch (e) {
    return failed(e, 'The payments could not be recorded.');
  }
}
