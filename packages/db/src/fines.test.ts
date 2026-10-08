import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountDue, discountFor, fineFigures, initialsOf, isValidRsaId, maskId, noticeProblems, normaliseReg, payByDate,
  rand, rsaIdDetails, saDate, type Fine, type NoticeDraft,
} from './fines.ts';
import { buildFineSlipHtml, safeSignatureSvg, slipFromFines } from './fine-slip.ts';
import { canAccess, canIssueFines, canManageFineOffences, canViewAllFines } from './roles.ts';

const SIG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180"><path d="M12.5 40L20 41.2" fill="none" stroke="#1e293b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

test('South African ID numbers: length, date and Luhn check digit', () => {
  assert.equal(isValidRsaId('8001015009087'), true);
  assert.equal(isValidRsaId('800101 5009 087'), true, 'spaces are ignored');
  assert.equal(isValidRsaId('8001015009088'), false, 'wrong check digit');
  assert.equal(isValidRsaId('8013015009087'), false, 'month 13');
  assert.equal(isValidRsaId('800101500908'), false, 'twelve digits');
  assert.equal(isValidRsaId(''), false);
  assert.equal(isValidRsaId(null), false);
});

test('an RSA ID fills in date of birth, gender and citizenship', () => {
  const today = new Date('2026-10-07T10:00:00Z');
  assert.deepEqual(rsaIdDetails('8001015009087', today), { dob: '1980-01-01', gender: 'Male', citizen: true });
  // 05 is this century; a female sequence (< 5000).
  const id = '0503154800083';
  assert.equal(isValidRsaId(id), true);
  assert.deepEqual(rsaIdDetails(id, today), { dob: '2005-03-15', gender: 'Female', citizen: true });
  assert.equal(rsaIdDetails('123', today), null);
});

test('registrations, initials, money and masking', () => {
  assert.equal(normaliseReg('nd 123-456'), 'ND123456');
  assert.equal(initialsOf('  bongani  sipho '), 'BS');
  assert.equal(rand(1500), 'R1 500.00');
  assert.equal(maskId('8001015009087'), '•••• 9087');
  assert.equal(maskId(null), '—');
});

test('AARTO halves the amount for 32 days; by-law notices have no discount', () => {
  assert.equal(discountFor('AARTO 01', 500), 250);
  assert.equal(discountFor('AARTO 01', 333.33), 166.67);
  assert.equal(discountFor('Section 56', 500), 0);
  assert.equal(discountFor('Section 341', 500), 0);
});

test('pay-by dates are counted from the South African day of service', () => {
  // 23:30 UTC on the 1st is already the 2nd in Durban.
  assert.equal(saDate('2026-10-01T23:30:00Z'), '2026-10-02');
  assert.equal(payByDate('AARTO 01', '2026-10-01T23:30:00Z'), '2026-11-03');
  assert.equal(payByDate('Section 341', '2026-10-07T08:00:00Z'), '2026-11-06');
  assert.equal(payByDate('Section 56', '2026-10-07T08:00:00Z', '2026-12-01'), '2026-12-01');
});

test('amount due: discounted inside the 32 days, full after', () => {
  const fine = { notice_type: 'AARTO 01' as const, amount: 500, discount_amount: 250, issued_at: '2026-10-01T08:00:00Z' };
  assert.equal(amountDue(fine, new Date('2026-10-20T08:00:00Z')), 250);
  assert.equal(amountDue(fine, new Date('2026-11-05T08:00:00Z')), 500);
  assert.equal(amountDue({ ...fine, notice_type: 'Section 56', discount_amount: 0 }, new Date('2026-10-02')), 500);
});

const base: NoticeDraft = {
  noticeType: 'AARTO 01', surname: 'Dlamini', idType: 'RSA ID', idNumber: '8001015009087', vehicleReg: 'ND 123-456',
  street: 'Anton Lembede St', officerSignature: SIG, infringerSignature: SIG,
  charges: [{ offenceId: 'o1' }],
};
const catalogue = [
  { id: 'o1', regime: 'AARTO' as const, penalty_amount: 500 },
  { id: 'o2', regime: 'AARTO' as const, penalty_amount: null },
  { id: 'o3', regime: 'By-law' as const, penalty_amount: 300 },
];

test('a complete AARTO 01 notice has no problems', () => {
  assert.deepEqual(noticeProblems(base, catalogue, '2026-10-07'), []);
});

test('the form names what issue_fines() would refuse, by step', () => {
  const steps = (d: NoticeDraft) => noticeProblems(d, catalogue, '2026-10-07').map((p) => p.step);
  assert.deepEqual(steps({ ...base, surname: '' }), ['infringer']);
  assert.deepEqual(steps({ ...base, idNumber: '8001015009088' }), ['infringer']);
  assert.deepEqual(steps({ ...base, vehicleReg: ' - ' }), ['vehicle']);
  assert.deepEqual(steps({ ...base, street: '' }), ['offence']);
  assert.deepEqual(steps({ ...base, charges: [{ offenceId: 'o2' }] }), ['offence'], 'no amount in the charge book');
  assert.deepEqual(steps({ ...base, charges: [{ offenceId: 'o2', amount: '750' }] }), []);
  assert.deepEqual(steps({ ...base, charges: [{ offenceId: 'o3' }] }), ['offence'], 'by-law offence on AARTO');
  assert.deepEqual(steps({ ...base, charges: [] }), ['offence']);
  assert.deepEqual(steps({ ...base, charges: [{}, {}, {}, {}].map(() => ({ offenceId: 'o1' })) }), ['offence']);
  assert.deepEqual(steps({ ...base, officerSignature: null }), ['sign']);
  assert.deepEqual(steps({ ...base, infringerSignature: null }), ['sign']);
  assert.deepEqual(steps({ ...base, infringerSignature: null, infringerRefused: true }), []);
  assert.deepEqual(steps({ ...base, capturedFrom: 'paper', officerSignature: null, infringerSignature: null }), ['notice']);
  assert.deepEqual(steps({ ...base, capturedFrom: 'paper', noticeNumber: 'B-001', officerSignature: null, infringerSignature: null }), []);
});

test('Section 56 needs a later court date; Section 341 needs no person', () => {
  const s56: NoticeDraft = { ...base, noticeType: 'Section 56', vehicleReg: '', charges: [{ offenceId: 'o3' }] };
  assert.deepEqual(noticeProblems(s56, catalogue, '2026-10-07').map((p) => p.message), ['Give the court and the date to appear.']);
  assert.equal(noticeProblems({ ...s56, courtName: 'Durban', courtDate: '2026-10-07' }, catalogue, '2026-10-07').length, 1);
  assert.deepEqual(noticeProblems({ ...s56, courtName: 'Durban', courtDate: '2026-11-20' }, catalogue, '2026-10-07'), []);
  const s341: NoticeDraft = {
    noticeType: 'Section 341', vehicleReg: 'NU 55 GP', place: 'Bay 14', officerSignature: SIG,
    charges: [{ description: 'Expired bay', amount: '150' }],
  };
  assert.deepEqual(noticeProblems(s341, catalogue, '2026-10-07'), []);
});

const fine = (over: Partial<Fine>): Fine => ({
  id: 'f1', tenant_id: 't', silo: 'MetroPolice', fine_number: 'FN-0001', offender_name: 'Bongani Dlamini',
  offender_id_number: '8001015009087', vehicle_reg: 'ND123456', offence_code: '1234', offence_description: 'Driver not wearing a seatbelt',
  amount: 500, location: 'Anton Lembede St', incident_id: null, issued_by: 'u', issued_by_name: 'Sipho Ndlovu',
  issued_at: '2026-10-07T08:00:00Z', due_date: '2026-11-08', status: 'Unpaid', notes: null,
  notice_type: 'AARTO 01', notice_number: null, group_ref: 'g', charge_seq: 1, captured_from: 'device',
  offender_surname: 'Dlamini', offender_first_names: 'Bongani', offender_initials: 'B', offender_id_type: 'RSA ID',
  offender_id_country: null, offender_dob: '1980-01-01', offender_gender: 'Male', offender_licence_code: 'B',
  offender_prdp_code: null, offender_phone: null, offender_email: null, offender_address: null,
  vehicle_licence_disc: null, vehicle_type: null, vehicle_make: 'Toyota', vehicle_model: 'Corolla', vehicle_colour: 'White',
  province: 'KwaZulu-Natal', city: 'Durban', suburb: 'Durban Central', street_a: 'Anton Lembede St', street_b: null,
  direction: null, latitude: -29.8587, longitude: 31.0218, offence_at: '2026-10-07T07:55:00Z', offence_id: null,
  legal_ref: null, amount_source: 'catalogue', discount_amount: 250, demerit_points: 0, court_name: null, court_date: null,
  issuing_authority: 'eThekwini Metro Police', magisterial_district: null, officer_infrastructure_no: 'MP1001',
  officer_signature: SIG, infringer_signature: SIG, infringer_refused: false, observations: {},
  cancelled_at: null, cancelled_by: null, cancelled_by_name: null, cancel_reason: null, recorded_at: '2026-10-07T08:00:05Z',
  ...over,
});

test('figures: today, this month, value, outstanding after payments, cancelled left out', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const fines = [
    fine({ id: 'a' }),
    fine({ id: 'b', status: 'Partially Paid' }),
    fine({ id: 'c', status: 'Cancelled' }),
    fine({ id: 'd', issued_at: '2026-09-15T08:00:00Z', status: 'Paid', notice_type: 'Section 56', discount_amount: 0 }),
  ];
  const f = fineFigures(fines, new Map([['b', 100], ['d', 500]]), now);
  assert.equal(f.total, 4);
  assert.equal(f.today, 3);
  assert.equal(f.thisMonth, 3);
  assert.equal(f.value, 1500);
  assert.equal(f.valueThisMonth, 1000);
  assert.equal(f.outstanding, 250 + 150);
  assert.equal(f.paid, 600);
  assert.equal(f.cancelled, 1);
  assert.equal(f.byType['Section 56'], 1);
  assert.equal(f.byStatus.Cancelled, 1);
});

test('who issues, who sees the register, who keeps the charge book', () => {
  assert.equal(canIssueFines({ role: 'Police', silo: 'MetroPolice' }), true);
  assert.equal(canIssueFines({ role: 'Police', silo: 'Ethekwini' }), true);
  assert.equal(canIssueFines({ role: 'Firefighter', silo: 'MetroFire' }), false);
  assert.equal(canIssueFines({ role: 'Captain', silo: 'MetroFire' }), false);
  assert.equal(canIssueFines({ role: 'Admin', silo: 'MetroPolice' }), false, 'admins keep the register, they do not serve notices');

  assert.equal(canViewAllFines({ role: 'Captain', silo: 'MetroPolice' }), true);
  assert.equal(canViewAllFines({ role: 'Supervisor', silo: 'Ethekwini' }), true);
  assert.equal(canViewAllFines({ role: 'Admin', silo: 'MetroFire' }), false);
  assert.equal(canViewAllFines({ role: 'SystemAdmin', silo: 'Ethekwini' }), true);
  assert.equal(canViewAllFines({ role: 'Police', silo: 'MetroPolice' }), false);
  assert.equal(canViewAllFines({ role: 'Dispatcher', silo: 'Ethekwini' }), false);

  assert.equal(canManageFineOffences({ role: 'Admin', silo: 'MetroPolice' }), true);
  assert.equal(canManageFineOffences({ role: 'Captain', silo: 'MetroPolice' }), false);
  assert.equal(canManageFineOffences({ role: 'SystemAdmin', silo: 'Ethekwini' }), true);

  assert.equal(canAccess('/police/fines', 'Police', 'MetroPolice'), true);
  assert.equal(canAccess('/police/fines', 'Supervisor', 'MetroPolice'), true);
  assert.equal(canAccess('/police/fines/FN-1', 'Captain', 'MetroPolice'), true);
  assert.equal(canAccess('/police/fines', 'Dispatcher', 'Ethekwini'), false);
  assert.equal(canAccess('/police/fines', 'Firefighter', 'MetroFire'), false);
  assert.equal(canAccess('/police/fines/offences', 'Police', 'MetroPolice'), false);
  assert.equal(canAccess('/police/fines/offences', 'Admin', 'MetroPolice'), true);
  assert.equal(canAccess('/police/fines', 'SystemController', 'Ethekwini'), true);
});

test('a signature is rebuilt from its path; anything else is dropped', () => {
  const safe = safeSignatureSvg(SIG);
  assert.ok(safe?.includes('d="M12.5 40L20 41.2"'));
  assert.equal(safeSignatureSvg('<svg viewBox="0 0 1 1" onload="alert(1)"><path d="M1 1"/></svg>'), null);
  assert.equal(safeSignatureSvg('<svg viewBox="0 0 1 1"><path d="M1 1" /><script>x</script></svg>'), null);
  assert.equal(safeSignatureSvg('<svg viewBox="0 0 1 1"><path d="javascript:1"/></svg>'), null);
  assert.equal(safeSignatureSvg(null), null);
});

test('the slip escapes everything and carries what the notice type requires', () => {
  const rows = [
    fine({ offender_name: '<script>alert(1)</script>', offender_surname: 'x' }),
    fine({ id: 'f2', fine_number: 'FN-0002', charge_seq: 2, offence_description: 'Holding a cellphone while driving', amount: 1000, discount_amount: 500 }),
  ];
  const html = buildFineSlipHtml(slipFromFines(rows));
  assert.ok(!html.includes('<script>alert(1)'), 'name is escaped');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('AARTO 01 · Infringement notice'));
  assert.ok(html.includes('FN-0001') && html.includes('FN-0002'));
  assert.ok(html.includes('R750.00'), 'discounted total of both charges');
  assert.ok(html.includes('R1 500.00'), 'full total');
  assert.ok(html.includes('AARTO 08'));

  const s56 = buildFineSlipHtml(slipFromFines([fine({ notice_type: 'Section 56', court_name: 'Durban Magistrate', court_date: '2026-12-01', discount_amount: 0 })]));
  assert.ok(s56.includes('You must appear at Durban Magistrate'));
  assert.ok(s56.includes('criminal record'), 'the admission of guilt warning is printed');

  const refused = buildFineSlipHtml(slipFromFines([fine({ infringer_signature: null, infringer_refused: true })]));
  assert.ok(refused.includes('Refused to sign'));

  const cancelled = buildFineSlipHtml(slipFromFines([fine({ status: 'Cancelled', cancel_reason: 'Wrong registration', cancelled_by_name: 'Capt. Naidoo', cancelled_at: '2026-10-07T09:00:00Z' })]));
  assert.ok(cancelled.includes('CANCELLED') && cancelled.includes('Wrong registration'));

  const provisional = buildFineSlipHtml({ ...slipFromFines([fine({})]), provisional: true });
  assert.ok(provisional.includes('Provisional slip'));
});

/* ── 0058: stages, overdue, payments from a file ─────────────────────── */

import {
  amountDueOn, checkPaymentRows, fineStage, isOverdue, parsePaymentDate, parseRandAmount,
} from './fines.ts';

test('stages follow AARTO: discount period, courtesy letter, enforcement order', () => {
  const f = fine({ issued_at: '2026-10-01T08:00:00Z', due_date: '2026-11-02' });
  assert.equal(fineStage(f, '2026-10-20'), 'Discount period');
  assert.equal(fineStage(f, '2026-11-02'), 'Discount period', 'the 32nd day still has the discount');
  assert.equal(fineStage(f, '2026-11-03'), 'Courtesy letter');
  assert.equal(fineStage(f, '2026-12-04'), 'Courtesy letter', 'day 64 is the last of the courtesy letter period');
  assert.equal(fineStage(f, '2026-12-05'), 'Enforcement order');
  assert.equal(fineStage({ ...f, status: 'Paid' }, '2026-12-04'), 'Paid');
  assert.equal(fineStage({ ...f, status: 'Disputed' }, '2026-12-04'), 'Representation');
  assert.equal(fineStage({ ...f, status: 'Cancelled' }, '2026-12-04'), 'Cancelled');
  assert.equal(fineStage({ ...f, notice_type: 'Section 56', court_date: '2026-11-20' }, '2026-11-20'), 'Awaiting court');
  assert.equal(fineStage({ ...f, notice_type: 'Section 56', court_date: '2026-11-20' }, '2026-11-21'), 'Court date passed');
  assert.equal(fineStage({ ...f, notice_type: 'Section 341', due_date: '2026-10-31' }, '2026-11-01'), 'Overdue');
});

test('overdue is open past the pay-by date; a representation pauses it', () => {
  const f = fine({ due_date: '2026-11-08' });
  assert.equal(isOverdue(f, '2026-11-08'), false);
  assert.equal(isOverdue(f, '2026-11-09'), true);
  assert.equal(isOverdue({ ...f, status: 'Partially Paid' }, '2026-11-09'), true);
  assert.equal(isOverdue({ ...f, status: 'Disputed' }, '2026-11-09'), false);
  assert.equal(isOverdue({ ...f, status: 'Paid' }, '2026-11-09'), false);
});

test('the discount is judged on South African days, through day 32', () => {
  const f = { notice_type: 'AARTO 01' as const, amount: 500, discount_amount: 250, issued_at: '2026-10-01T23:30:00Z' };
  // Served on 2 October in Durban: the discount runs to 3 November.
  assert.equal(amountDueOn(f, '2026-11-03'), 250);
  assert.equal(amountDueOn(f, '2026-11-04'), 500);
});

test('figures count overdue fines and what they still owe', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  const f = fineFigures([
    fine({ id: 'a', issued_at: '2026-10-01T08:00:00Z', due_date: '2026-11-02' }),
    fine({ id: 'b', issued_at: '2026-10-01T08:00:00Z', due_date: '2026-11-02', status: 'Partially Paid' }),
    fine({ id: 'c', issued_at: '2026-11-25T08:00:00Z', due_date: '2026-12-27' }),
  ], new Map([['b', 100]]), now);
  assert.equal(f.overdue, 2);
  assert.equal(f.overdueOwing, 500 + 400);
});

test('rand amounts and receipt dates as cashiers write them', () => {
  assert.equal(parseRandAmount('R1 234,50'), 1234.5);
  assert.equal(parseRandAmount('1,234.50'), 1234.5);
  assert.equal(parseRandAmount('250'), 250);
  assert.equal(parseRandAmount('R 250.00'), 250);
  assert.equal(parseRandAmount('abc'), null);
  assert.equal(parseRandAmount(''), null);
  assert.equal(parsePaymentDate('2026-10-07'), '2026-10-07');
  assert.equal(parsePaymentDate('07/10/2026'), '2026-10-07', 'day first, as in South Africa');
  assert.equal(parsePaymentDate('7 Oct 2026'), '2026-10-07');
  assert.equal(parsePaymentDate('46302'), '2026-10-07', 'an Excel serial day');
  assert.equal(parsePaymentDate('31/02/2026'), null);
  assert.equal(parsePaymentDate('yesterday'), null);
});

test('a payments file: ready rows, and what is wrong with the rest', () => {
  const out = checkPaymentRows([
    { line: 2, reference: 'fn-0042 ', amount: 'R250', paid_on: '07/10/2026', receipt: 'RC1', method: 'cash' },
    { line: 3, reference: 'FN-0043', amount: '0', paid_on: '2026-10-07', receipt: 'RC2' },
    { line: 4, reference: 'FN-0044', amount: '100', paid_on: '2026-12-31', receipt: 'RC3' },
    { line: 5, reference: 'FN-0045', amount: '100', paid_on: '2026-10-07' },
    { line: 6, reference: 'FN-0042', amount: '250', paid_on: '2026-10-07', receipt: 'rc1' },
    { line: 7, reference: 'FN-0046', amount: '100', paid_on: '2026-10-07', receipt: 'RC4', method: 'cheque' },
  ], '2026-10-07');
  assert.deepEqual(out[0]!.row, { line: 2, reference: 'FN-0042', amount: 250, paid_on: '2026-10-07', receipt: 'RC1', method: 'Cash', note: '' });
  assert.match(out[1]!.problem ?? '', /above zero/);
  assert.match(out[2]!.problem ?? '', /future/);
  assert.match(out[3]!.problem ?? '', /receipt/);
  assert.match(out[4]!.problem ?? '', /twice/);
  assert.match(out[5]!.problem ?? '', /Cash, Card, EFT or Other/);
});

test('a person\'s account and the payments import are for command staff', () => {
  assert.equal(canAccess('/police/fines/account', 'Captain', 'MetroPolice'), true);
  assert.equal(canAccess('/police/fines/payments', 'Admin', 'MetroPolice'), true);
  assert.equal(canAccess('/police/fines/payments', 'SystemAdmin', 'Ethekwini'), true);
  assert.equal(canAccess('/police/fines/account', 'Police', 'MetroPolice'), false);
  assert.equal(canAccess('/police/fines/payments', 'Police', 'MetroPolice'), false);
  assert.equal(canAccess('/police/fines/account', 'Dispatcher', 'Ethekwini'), false);
  assert.equal(canAccess('/police/fines/payments', 'Admin', 'MetroFire'), false);
});
