/**
 * The slip: what the infringer is handed (or what is left on the vehicle),
 * as one HTML page. The phone prints or shares it as a PDF; the console
 * serves the same page to print. One builder, so the paper never differs.
 *
 * Every value is escaped, and a signature is rebuilt from its path data
 * rather than trusted as markup — the page is opened on the console's origin.
 */

import type { Fine } from './fines.ts';
import { amountDue, noticeInfo, rand } from './fines.ts';
import type { FineNoticeType } from './types.generated';

export type SlipCharge = {
  ref: string;
  noticeNumber?: string | null;
  code?: string | null;
  legalRef?: string | null;
  description: string;
  amount: number;
  discount: number;
  demerit: number;
};

export type SlipData = {
  noticeType: FineNoticeType;
  /** Set while the phone has not delivered it: the reference is the phone's. */
  provisional?: boolean;
  issuingAuthority: string;
  issuedAt: string;
  offenceAt?: string | null;
  officerName: string;
  officerNo?: string | null;
  infringer: {
    name: string;
    idType?: string | null;
    idNumber?: string | null;
    dob?: string | null;
    gender?: string | null;
    licenceCode?: string | null;
    prdp?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  vehicle: {
    reg?: string | null;
    disc?: string | null;
    type?: string | null;
    makeModel?: string | null;
    colour?: string | null;
  };
  place: {
    street?: string | null;
    suburb?: string | null;
    city?: string | null;
    province?: string | null;
    direction?: string | null;
    lat?: number | null;
    lng?: number | null;
    description?: string | null;
  };
  charges: SlipCharge[];
  courtName?: string | null;
  courtDate?: string | null;
  payBy?: string | null;
  magisterialDistrict?: string | null;
  officerSignature?: string | null;
  infringerSignature?: string | null;
  infringerRefused?: boolean;
  cancelled?: { reason: string; by: string | null; at: string } | null;
};

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * A signature as the signature pad writes it, rebuilt from its path data —
 * or null when it is not one. Mirrors is_signature_svg() (0057).
 */
export function safeSignatureSvg(svg: string | null | undefined): string | null {
  if (!svg) return null;
  const box = svg.match(/viewBox="([0-9. ]{1,40})"/)?.[1];
  const d = svg.match(/<path d="([ML0-9. -]*)"/)?.[1];
  if (!box || d === undefined || /<script|on\w+=|href|foreignObject/i.test(svg)) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="xMidYMid meet"><path d="${d}" fill="none" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** A signature's drawing — its view box and path — for rendering as SVG elements, or null. */
export function signaturePath(svg: string | null | undefined): { viewBox: string; d: string } | null {
  const safe = safeSignatureSvg(svg);
  if (!safe) return null;
  const viewBox = safe.match(/viewBox="([^"]*)"/)?.[1];
  const d = safe.match(/ d="([^"]*)"/)?.[1];
  return viewBox && d !== undefined ? { viewBox, d } : null;
}

const when = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-ZA', {
        timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—';
const day = (date?: string | null) =>
  date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

/** The slip for the charges served together on one notice. */
export function slipFromFines(rows: Fine[]): SlipData {
  const sorted = [...rows].sort((a, b) => a.charge_seq - b.charge_seq);
  const f = sorted[0];
  if (!f) throw new Error('No fine to print.');
  return {
    noticeType: f.notice_type,
    issuingAuthority: f.issuing_authority ?? 'Metro Police',
    issuedAt: f.issued_at,
    offenceAt: f.offence_at,
    officerName: f.issued_by_name ?? '—',
    officerNo: f.officer_infrastructure_no,
    infringer: {
      name: f.offender_name, idType: f.offender_id_type, idNumber: f.offender_id_number, dob: f.offender_dob,
      gender: f.offender_gender, licenceCode: f.offender_licence_code, prdp: f.offender_prdp_code,
      phone: f.offender_phone, address: f.offender_address,
    },
    vehicle: {
      reg: f.vehicle_reg, disc: f.vehicle_licence_disc, type: f.vehicle_type,
      makeModel: [f.vehicle_make, f.vehicle_model].filter(Boolean).join(' ') || null, colour: f.vehicle_colour,
    },
    place: {
      street: [f.street_a, f.street_b].filter(Boolean).join(' / ') || null, suburb: f.suburb, city: f.city,
      province: f.province, direction: f.direction, lat: f.latitude, lng: f.longitude, description: f.location,
    },
    charges: sorted.map((r) => ({
      ref: r.fine_number, noticeNumber: r.notice_number, code: r.offence_code, legalRef: r.legal_ref,
      description: r.offence_description, amount: Number(r.amount), discount: Number(r.discount_amount),
      demerit: r.demerit_points,
    })),
    courtName: f.court_name,
    courtDate: f.court_date,
    payBy: f.due_date,
    magisterialDistrict: f.magisterial_district,
    officerSignature: f.officer_signature,
    infringerSignature: f.infringer_signature,
    infringerRefused: f.infringer_refused,
    cancelled: f.status === 'Cancelled' && f.cancel_reason
      ? { reason: f.cancel_reason, by: f.cancelled_by_name, at: f.cancelled_at ?? f.issued_at }
      : null,
  };
}

function row(label: string, value: unknown) {
  return `<tr><th>${esc(label)}</th><td>${value === null || value === undefined || value === '' ? '—' : esc(value)}</td></tr>`;
}

function whatToDo(s: SlipData): string {
  const total = s.charges.reduce((sum, c) => sum + c.amount, 0);
  const discounted = s.charges.reduce((sum, c) => sum + c.amount - c.discount, 0);
  const quote = s.provisional ? 'the reference on this slip' : 'the notice number for each charge';
  if (s.noticeType === 'AARTO 01') {
    return `
      <p><b>Pay ${esc(rand(discounted))} by ${esc(day(s.payBy))}</b> — the discounted amount (50%) applies when paid within 32 days of service. Quote ${quote}.</p>
      <p>Pay at the issuing authority, a vehicle licensing office or driving licence testing centre, or online through the RTIA (www.aarto.gov.za).</p>
      <p>Within the same 32 days you may instead apply to pay in instalments (form AARTO 04) or make a representation (form AARTO 08), for each charge separately.</p>
      <p>If you do nothing within 32 days a courtesy letter follows: the discount falls away and a fee is added (full amount ${esc(rand(total))}). After that an enforcement order may stop the renewal of your driving licence and vehicle licence.</p>`;
  }
  if (s.noticeType === 'Section 56') {
    return `
      <p><b>You must appear at ${esc(s.courtName ?? 'the court named')} on ${esc(day(s.courtDate))}.</b></p>
      <p>Instead of appearing you may pay the admission of guilt amount of <b>${esc(rand(total))}</b> before that date at the issuing authority, quoting ${quote}.</p>
      <p><b>Important:</b> paying an admission of guilt is a conviction and may give you a criminal record. You may choose to appear in court instead.</p>
      <p>If you neither pay nor appear, a warrant may be issued for your arrest.</p>`;
  }
  return `
    <p><b>Pay ${esc(rand(total))} by ${esc(day(s.payBy))}</b> at the issuing authority, quoting ${quote}.</p>
    <p>If it is not paid by then, the owner of the vehicle may be summoned to appear in court.</p>`;
}

export function buildFineSlipHtml(s: SlipData): string {
  const info = noticeInfo(s.noticeType);
  const officerSig = safeSignatureSvg(s.officerSignature);
  const infringerSig = safeSignatureSvg(s.infringerSignature);
  const isAarto = s.noticeType === 'AARTO 01';
  const total = s.charges.reduce((sum, c) => sum + c.amount, 0);
  const totalDiscount = s.charges.reduce((sum, c) => sum + c.discount, 0);
  const title = isAarto ? 'AARTO 01 · Infringement notice'
    : s.noticeType === 'Section 56' ? 'Section 56 · Written notice to appear' : 'Section 341 · Notice to owner';
  const gps = s.place.lat !== null && s.place.lat !== undefined && s.place.lng !== null && s.place.lng !== undefined
    ? `${Number(s.place.lat).toFixed(5)}, ${Number(s.place.lng).toFixed(5)}` : null;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.charges.map((c) => c.ref).join(', '))} · ${esc(title)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; font-size: 11.5px; line-height: 1.4; background: #fff; }
  .slip { max-width: 186mm; margin: 0 auto; border: 1.5px solid #0f172a; border-radius: 6px; overflow: hidden; }
  .band { background: #0f172a; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  .band h1 { margin: 0; font-size: 16px; letter-spacing: .3px; }
  .band .auth { font-size: 11px; opacity: .85; text-transform: uppercase; letter-spacing: 1.2px; }
  .band .law { font-size: 10px; opacity: .75; margin-top: 2px; }
  .refs { text-align: right; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
  .refs b { font-size: 15px; display: block; }
  .warn { background: #fef3c7; color: #78350f; padding: 7px 14px; font-weight: 600; border-bottom: 1px solid #f59e0b; }
  .void { background: #fee2e2; color: #7f1d1d; padding: 7px 14px; font-weight: 700; border-bottom: 1px solid #ef4444; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; }
  section { padding: 8px 14px; border-top: 1px solid #cbd5e1; }
  .grid section:nth-child(odd) { border-right: 1px solid #cbd5e1; }
  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #475569; margin: 0 0 4px; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv th { text-align: left; font-weight: 600; color: #475569; width: 32mm; padding: 1.5px 6px 1.5px 0; vertical-align: top; }
  table.kv td { padding: 1.5px 0; font-weight: 600; }
  table.charges { width: 100%; border-collapse: collapse; margin-top: 2px; }
  table.charges th { font-size: 9.5px; text-transform: uppercase; letter-spacing: .6px; color: #475569; text-align: left; border-bottom: 1px solid #94a3b8; padding: 3px 4px; }
  table.charges td { border-bottom: 1px solid #e2e8f0; padding: 4px; vertical-align: top; }
  table.charges td.num, table.charges th.num { text-align: right; white-space: nowrap; }
  table.charges tfoot td { font-weight: 800; border-bottom: none; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .todo { background: #f1f5f9; }
  .todo p { margin: 3px 0; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .sig { border: 1px solid #cbd5e1; border-radius: 4px; height: 70px; display: flex; align-items: center; justify-content: center; background: #f8fafc; }
  .sig svg { max-height: 64px; max-width: 100%; }
  .sig .none { color: #94a3b8; font-style: italic; }
  .sig .refused { color: #b91c1c; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
  .caption { font-size: 10px; color: #475569; margin-top: 3px; }
  footer { padding: 7px 14px; border-top: 1px solid #cbd5e1; font-size: 9.5px; color: #475569; }
</style></head>
<body><div class="slip">
  <div class="band">
    <div>
      <div class="auth">${esc(s.issuingAuthority)}</div>
      <h1>${esc(title)}</h1>
      <div class="law">${esc(info.law)}</div>
    </div>
    <div class="refs">${s.charges.map((c) => `<b>${esc(c.ref)}</b>${c.noticeNumber ? `<span>No. ${esc(c.noticeNumber)}</span>` : ''}`).join('')}
      <div>Served ${esc(when(s.issuedAt))}</div></div>
  </div>
  ${s.provisional ? `<div class="warn">Provisional slip — the officer's phone was offline. Quote the reference above; the register gives the final number when the phone reconnects.</div>` : ''}
  ${s.cancelled ? `<div class="void">CANCELLED ${esc(when(s.cancelled.at))}${s.cancelled.by ? ` by ${esc(s.cancelled.by)}` : ''} — ${esc(s.cancelled.reason)}</div>` : ''}
  <div class="grid">
    <section>
      <h2>${info.personPresent ? 'Infringer' : 'Owner'}</h2>
      <table class="kv">
        ${row('Name', s.infringer.name)}
        ${info.personPresent ? row(s.infringer.idType ?? 'Identification', s.infringer.idNumber) : ''}
        ${info.personPresent ? row('Date of birth', s.infringer.dob ? day(s.infringer.dob) : null) : ''}
        ${info.personPresent ? row('Sex', s.infringer.gender) : ''}
        ${isAarto ? row('Licence code', [s.infringer.licenceCode, s.infringer.prdp ? `PrDP ${s.infringer.prdp}` : null].filter(Boolean).join(' · ')) : ''}
        ${info.personPresent ? row('Address', s.infringer.address) : ''}
        ${info.personPresent ? row('Phone', s.infringer.phone) : ''}
      </table>
    </section>
    <section>
      <h2>Vehicle</h2>
      <table class="kv">
        ${row('Registration', s.vehicle.reg)}
        ${row('Licence disc', s.vehicle.disc)}
        ${row('Type', s.vehicle.type)}
        ${row('Make / model', s.vehicle.makeModel)}
        ${row('Colour', s.vehicle.colour)}
      </table>
    </section>
  </div>
  <section>
    <h2>Place and time</h2>
    <table class="kv">
      ${row('Where', [s.place.street, s.place.suburb, s.place.city, s.place.province].filter(Boolean).join(', ') || s.place.description)}
      ${s.place.direction ? row('Direction travelled', s.place.direction) : ''}
      ${gps ? row('GPS', gps) : ''}
      ${row('When', when(s.offenceAt ?? s.issuedAt))}
      ${s.magisterialDistrict ? row('Magisterial district', s.magisterialDistrict) : ''}
    </table>
  </section>
  <section>
    <h2>${s.charges.length === 1 ? 'Charge' : `Charges (${s.charges.length})`}</h2>
    <table class="charges">
      <thead><tr><th>Ref</th><th>Code</th><th>Offence</th><th class="num">Penalty</th>${isAarto ? '<th class="num">Discount</th><th class="num">Points</th>' : ''}</tr></thead>
      <tbody>${s.charges.map((c) => `<tr>
        <td class="mono">${esc(c.ref)}</td>
        <td class="mono">${esc(c.code ?? '—')}</td>
        <td>${esc(c.description)}${c.legalRef ? `<div class="caption">${esc(c.legalRef)}</div>` : ''}</td>
        <td class="num">${esc(rand(c.amount))}</td>
        ${isAarto ? `<td class="num">${esc(rand(c.discount))}</td><td class="num">${esc(c.demerit)}</td>` : ''}
      </tr>`).join('')}</tbody>
      ${s.charges.length > 1 ? `<tfoot><tr><td colspan="3">Total</td><td class="num">${esc(rand(total))}</td>${isAarto ? `<td class="num">${esc(rand(totalDiscount))}</td><td></td>` : ''}</tr></tfoot>` : ''}
    </table>
  </section>
  <section class="todo">
    <h2>What to do now</h2>
    ${whatToDo(s)}
  </section>
  <section>
    <div class="sigs">
      <div>
        <div class="sig">${officerSig ?? '<span class="none">Not signed</span>'}</div>
        <div class="caption">Officer: <b>${esc(s.officerName)}</b>${s.officerNo ? ` · Infrastructure no. ${esc(s.officerNo)}` : ''}</div>
      </div>
      <div>
        <div class="sig">${infringerSig ?? (s.infringerRefused ? '<span class="refused">Refused to sign</span>' : `<span class="none">${info.personPresent ? 'Not signed' : 'Left on the vehicle'}</span>`)}</div>
        <div class="caption">${info.personPresent ? 'Infringer' : 'Owner'}: <b>${esc(s.infringer.name)}</b></div>
      </div>
    </div>
  </section>
  <footer>${info.personPresent
    ? 'The officer confirms that this notice was personally served on the person named, and that its content and the options open to them were explained.'
    : 'This notice was left on the vehicle described above.'}
    Keep this slip: you will need the reference to pay or to respond.</footer>
</div></body></html>`;
}

/** What the infringer owes on the slip right now (discount while it runs). */
export function slipAmountDue(rows: Fine[], now: Date = new Date()): number {
  return rows.filter((r) => r.status !== 'Cancelled').reduce((sum, r) => sum + amountDue(r, now), 0);
}

// ── The statement (0058) ────────────────────────────────────────────────

export type StatementPayment = {
  fineNumber: string;
  paidOn: string | null;
  recordedAt: string;
  type: 'Payment' | 'Bail' | 'Court Fee' | 'Refund' | 'Adjustment';
  method: string;
  receipt: string | null;
  amount: number;
};

/**
 * A person's or a vehicle's account: every fine on the register, every
 * payment with its date, and what is owed today. For command staff to print
 * or hand over.
 */
export function buildFineStatementHtml(input: {
  issuingAuthority: string;
  subject: string;
  fines: Fine[];
  paid: ReadonlyMap<string, number>;
  payments: StatementPayment[];
  stageOf: (f: Fine) => string;
  owingOf: (f: Fine) => number;
  printedBy: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const live = input.fines.filter((f) => f.status !== 'Cancelled');
  const issued = live.reduce((s, f) => s + Number(f.amount), 0);
  const paid = [...input.paid.values()].reduce((s, v) => s + v, 0);
  const owing = live.reduce((s, f) => s + input.owingOf(f), 0);
  const day = (iso: string | null | undefined) =>
    iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Statement · ${esc(input.subject)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; font-size: 11.5px; margin: 0; background: #fff; }
  .wrap { max-width: 186mm; margin: 0 auto; }
  .band { background: #0f172a; color: #fff; padding: 12px 16px; border-radius: 6px 6px 0 0; }
  .band .auth { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; opacity: .8; }
  .band h1 { margin: 2px 0 0; font-size: 17px; }
  .band p { margin: 2px 0 0; opacity: .85; }
  .totals { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #cbd5e1; border-top: none; }
  .totals div { padding: 10px 14px; border-left: 1px solid #cbd5e1; }
  .totals div:first-child { border-left: none; }
  .totals span { display: block; font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px; color: #475569; }
  .totals b { font-size: 16px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: #475569; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .6px; color: #475569; border-bottom: 1px solid #94a3b8; padding: 4px; }
  td { border-bottom: 1px solid #e2e8f0; padding: 5px 4px; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .muted { color: #64748b; }
  .late { color: #b91c1c; font-weight: 700; }
  .void td { color: #94a3b8; text-decoration: line-through; }
  footer { margin-top: 18px; font-size: 9.5px; color: #64748b; }
</style></head>
<body><div class="wrap">
  <div class="band">
    <div class="auth">${esc(input.issuingAuthority)}</div>
    <h1>Statement of fines</h1>
    <p>${esc(input.subject)} · as at ${esc(day(now.toISOString()))}</p>
  </div>
  <div class="totals">
    <div><span>Fines</span><b>${live.length}</b></div>
    <div><span>Issued</span><b>${esc(rand(issued))}</b></div>
    <div><span>Paid</span><b>${esc(rand(paid))}</b></div>
    <div><span>Owing today</span><b>${esc(rand(owing))}</b></div>
  </div>

  <h2>Fines</h2>
  <table>
    <thead><tr><th>Fine</th><th>Served</th><th>Offence</th><th>Vehicle</th><th>Where it stands</th><th class="num">Penalty</th><th class="num">Paid</th><th class="num">Owing</th></tr></thead>
    <tbody>${input.fines.map((f) => {
      const stage = input.stageOf(f);
      const late = /Overdue|Courtesy|Enforcement|passed/.test(stage);
      return `<tr class="${f.status === 'Cancelled' ? 'void' : ''}">
        <td class="mono">${esc(f.fine_number)}<div class="muted">${esc(f.notice_type)}</div></td>
        <td>${esc(day(f.issued_at))}</td>
        <td>${esc(f.offence_description)}</td>
        <td class="mono">${esc(f.vehicle_reg ?? '—')}</td>
        <td class="${late ? 'late' : ''}">${esc(stage)}${f.due_date && f.status !== 'Paid' && f.status !== 'Cancelled' ? `<div class="muted">pay by ${esc(day(f.due_date))}</div>` : ''}</td>
        <td class="num">${esc(rand(f.amount))}</td>
        <td class="num">${esc(rand(input.paid.get(f.id) ?? 0))}</td>
        <td class="num">${f.status === 'Cancelled' ? '—' : esc(rand(input.owingOf(f)))}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>

  <h2>Payments</h2>
  ${input.payments.length ? `<table>
    <thead><tr><th>Date paid</th><th>Fine</th><th>Type</th><th>Method</th><th>Receipt</th><th class="num">Amount</th></tr></thead>
    <tbody>${input.payments.map((p) => `<tr>
      <td>${esc(day(p.paidOn ?? p.recordedAt))}</td>
      <td class="mono">${esc(p.fineNumber)}</td>
      <td>${esc(p.type)}</td>
      <td>${esc(p.method)}</td>
      <td class="mono">${esc(p.receipt ?? '—')}</td>
      <td class="num">${p.type === 'Refund' ? '−' : ''}${esc(rand(p.amount))}</td>
    </tr>`).join('')}</tbody>
  </table>` : '<p class="muted">No payments recorded.</p>'}

  <footer>
    Owing today applies the AARTO discount where the 32 days have not run out. Amounts after a courtesy letter or
    enforcement order may include fees charged by the RTIA that are not on this register.
    Printed by ${esc(input.printedBy)}.
  </footer>
</div></body></html>`;
}
