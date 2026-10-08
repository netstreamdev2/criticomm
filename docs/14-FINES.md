# 14 — Fines

Built 2026-10-07. Migration `0057_fines_aarto.sql` must be run in Supabase (after 0056) before
any of it works. Until then the console's fines pages say so instead of failing, and a fine
issued on the phone waits in its outbox.

Metro Police officers issue fines at the roadside on the phone, hand the infringer a slip
(printed or as a PDF), and the fines land on a register that captains, supervisors and admins
can filter, export and manage. A served notice is a legal document: it can never be edited or
deleted, only cancelled with a reason.

## The law this follows

| Offence | Since | Notice | Paying and options |
|---|---|---|---|
| Road traffic (National Road Traffic Act) | 1 July 2026: eThekwini is in AARTO Phase 2 | **AARTO 01** infringement notice, served in person (AARTO Act s17(1)) | 50% discount if paid within 32 days. Instead, the infringer may apply to pay in instalments (AARTO 04) or make a representation (AARTO 08), per charge. After 32 days a courtesy letter adds a fee and the discount falls away; then an enforcement order blocks licence and registration renewals. Demerit points are recorded but the points system is not yet in force. |
| Municipal by-law, offender present | Unchanged | **Section 56** written notice to appear (Criminal Procedure Act) | Pay the admission of guilt amount before the court date, or appear. Paying is a conviction and may give a criminal record; the officer must say so, and the slip says so. |
| Municipal by-law, unattended vehicle | Unchanged | **Section 341** notice left on the vehicle | Pay by the date on the notice, or the owner may be summoned. |

The AARTO 01's fields (infringer, vehicle, place and time, charges, officer and infrastructure
number, both signatures, the notes page and the confirmation of service) are the ones the form
asks for. Sources: the AARTO 01 form (Government Gazette 43758, 2 October 2020), Proclamations
322 and 323 of 2026 (Phase 2, 62 municipalities including eThekwini).

**What this system is not:** it does not capture notices onto the RTIA's National Road Traffic
Offences Register, issue official AARTO notice numbers, send courtesy letters or enforcement
orders, or take payments. It keeps the city's own record. An official notice number can be
added to a fine once it is known, and payments are recorded by hand from receipts.

## What was built

| Where | What |
|---|---|
| **Police home** (app) | A **Fines** card under My performance: a big **Issue a fine** button, **My fines** with a count, and today / this month / value / paid. Shows "N waiting for signal" or "N refused" when the outbox holds notices. |
| **Issue a fine** `/fines/new` (app) | Notice → Infringer → Vehicle → Offence → Sign (Section 341 skips Infringer). Picks the notice type; checks an RSA ID number (check digit) and fills date of birth and gender from it; GPS with street and suburb; offences from the charge book (searchable, cached for no signal), up to three charges; court and date for Section 56; the notes page; review with the amount to pay and the pay-by date; "I explained the notice" tick; officer and infringer signatures, or "refused to sign". Links to one of the officer's open incidents. The draft is kept on the phone until issued. |
| **The slip** `/fines/[id]` (app) | A ticket view with the amount due now, **Print slip** (the phone's print dialog) and **Share PDF**. Works with no signal: a provisional slip with the phone's reference (`P-1A2B3C4D`), replaced by the FN- numbers once delivered. |
| **My fines** `/fines` (app) | The officer's notices, newest first, with figures, search (number, registration, name, offence) and status filters; notices waiting to send pinned on top. |
| **Fines register** `/police/fines` (web) | KPI tiles (charges, value issued, collected, outstanding, disputed, cancelled), a card per notice type, filters (search, type, status, period, dates, officer, "only mine"), the register table, **Export CSV** and **Capture paper notice**. Filters live in the URL. |
| **A notice** `/police/fines/[id]` (web) | Every charge on the notice, infringer, vehicle and place (GPS opens the map), notes, both signatures, the payment ledger and the audit history. Command staff record a payment or refund, mark Disputed (representation) or back to Unpaid, and cancel with a reason. The official notice number can be added once. |
| **Print slip** `/police/fines/[id]/slip` (web) | The same slip as the phone's, with a Print button. |
| **Capture paper notice** `/police/fines/new` (web) | For a notice written in a paper book: the printed number is required, signatures are on the paper. |
| **Charge book** `/police/fines/offences` (web) | The offences officers pick from: code, legal reference, penalty, demerit points, in use, verified. Admins add and edit; captains and supervisors read. |
| **Dashboards** (web) | Captain, supervisor and admin dashboards get a **Fines & tickets** panel: period, notice type and status filters, the figures, and the latest notices linking to their records. The Captain's link strip gets "Fines register". |
| Navigation | "Fines" and "Charge Book" under Departments; the officer sidebar keeps "Fines". |
| Feature switches | `web.enforcement` hides the register, the charge book and the dashboard panel. `mobile.fines` (new) takes Fines off the phone; queued notices still send. |

## Who can do what

The database decides (`can_issue_fines`, `can_view_all_fines`, `can_manage_fines`,
`can_manage_fine_offences`); the screens only hide buttons. Mirrored in
`packages/db/src/roles.ts` and tested in `packages/db/src/fines.test.ts`.

| | Issue | See | Cancel, status, payments | Charge book |
|---|---|---|---|---|
| Police officer | Yes | Their own fines | No | Read (to pick) |
| Captain, Supervisor | Yes | All in Metro Police | Yes | Read |
| Admin (Metro Police) | No | All in Metro Police | Yes | Keep |
| SystemAdmin, SuperAdmin, SystemController | No | The tenant's | Yes | Keep |
| Dispatcher, ControlRoom, Viewer, others | No | **None** (they used to read fines; fines hold ID numbers and addresses) | No | No |

"Metro Police" includes the Ethekwini control silo. The CSV export masks ID numbers except for
command staff, and every export goes on the audit trail.

## How it is kept straight

- **One row per charge.** AARTO numbers each charge separately, so each charge gets its own
  FN- number; charges served together share a `group_ref`.
- **Issued through `issue_fines()` only.** It checks the officer's role, the notice type's
  required fields, the RSA ID check digit, the signatures, and that the offences fit the notice
  (road traffic on AARTO 01, by-law on Section 56/341). The charge book's amount wins over the
  phone's: when the book has an amount, the officer cannot change it. When it has none, the
  officer's amount is used and the record says `amount_source = officer`.
- **Idempotent.** The phone's outbox id is the notice's client reference, so a retry after a
  dead zone returns the fines already filed instead of numbering them twice.
- **Time.** The served time is when the officer pressed Issue, not when the phone found signal.
  A future time (wrong phone clock) becomes now; a notice older than 30 days is refused.
- **Never edited, never deleted.** A trigger refuses any change except the status, a
  cancellation, and adding the official notice number once. A cancelled fine stays cancelled.
- **Cancelling** needs command staff and a reason of at least 10 characters; it is refused while
  money is recorded against the fine (refund first).
- **Payments** are ledger entries (`charge_transactions`), never edited or deleted. The ledger
  sets Paid or Partially Paid: an AARTO fine is paid at the discounted amount inside the 32 days.
- **Signatures** are only accepted in the exact form the phone's signature pad writes, and are
  redrawn from their path data wherever they are shown.
- **Audit trail:** issued, notice number added, status changed, cancelled, exported.

## Before the first real fine

1. Run `supabase/migrations/0057_fines_aarto.sql` in the Supabase SQL editor (after 0056).
2. Fill the **charge book**: 21 common offences are seeded **without codes or amounts, and
   unverified**, so nothing is charged from a guess. An admin enters the AARTO Schedule 3 charge
   code, legal reference, penalty and demerit points (and the by-law sections and admission of
   guilt amounts), then ticks Verified. Until an offence has an amount, officers type it.
3. Optional: set the issuing authority's name per tenant in `tenants.settings.issuing_authority`
   (default: "<tenant name> Metro Police").

## Test day

1. As a **Police** officer on the phone (shift started): Home → Fines → **Issue a fine**. AARTO 01,
   a valid RSA ID (try a wrong digit first: the form says so), a registration, "Use my location",
   one offence with an amount and one without, sign both, Issue. The slip opens: print or share
   the PDF.
2. Airplane mode, issue another: the slip says provisional (`P-…`). Turn signal back on: within
   seconds the slip shows FN- numbers, and My fines lists it.
3. Section 56 (by-law, court date) and Section 341 (no person, no infringer signature).
4. As a **Captain** on the web: Dashboard → Fines & tickets (filters), Open register → filter,
   export CSV, open a notice → Print slip, record a part payment (Partially Paid), the rest
   (Paid), mark another Disputed, cancel another with a reason.
5. As a **Dispatcher**: `/police/fines` is refused and the dashboard has no fines panel.
6. As an **Admin**: Charge book → edit an offence's code and amount, verify; on the phone the
   amount is fixed for that offence.

## Verification done

- 56 database checks against real Postgres (PGlite) on the migration: rights per role and
  tenant, idempotent replay, every refusal, immutability even for the table owner, the ledger,
  cancellation, the audit trail and the charge book's verification stamp.
- Unit tests: `packages/db/src/fines.test.ts` (ID numbers, dates, money, the form's problems by
  step, figures, roles and routes, signature sanitising, the slip) and the outbox's ordering in
  `apps/mobile/lib/outbox-policy.test.ts`.
- Typecheck and lint clean on web, mobile, `@criticom/db` and `@criticom/api`. The slip was
  rendered to PDF and checked by eye.
- **Not yet seen live:** the screens on a phone and in the console against the real database
  (the migration had not been run).

## Part 2: what is owed, payment dates, overdue (migration 0058)

Built 2026-10-07, the same day. Run `supabase/migrations/0058_fines_accounts.sql` after 0057.

| Where | What |
|---|---|
| **Check what someone owes** `/fines/check` (app), and inside Issue a fine | By ID number or registration: unpaid fines on the register from **every** officer, the total owing today, how many are overdue, and where each stands. In the issue form it runs by itself once a valid ID number is entered or the registration field is left. A summary only: fine numbers, offences, amounts, stages; no names or addresses from other officers' fines. Needs signal. |
| **Where a fine stands** (app and web) | AARTO 01: *Discount period* (to day 32), then *Courtesy letter* (to day 64, discount gone), then *Enforcement order*. Section 56: *Awaiting court*, then *Court date passed*. Section 341: *Open*, then *Overdue*. Plus *Representation*, *Paid*, *Cancelled*. Shown on My fines, the slip, the register, the notice, the account and the dashboard panel. |
| **Overdue** | Open and past its pay-by date (a representation pauses it). A filter and a KPI on the register, My fines and the dashboard panel; a column in the CSV with what is owing now. |
| **Payment date** | Every payment carries the date on the receipt (`paid_on`). A payment made inside the 32 days keeps the AARTO discount even when it is captured later. Not in the future, not before the fine. The same receipt cannot be recorded twice on a fine. |
| **Fines account** `/police/fines/account?id=…&reg=…` (web) | One person or one vehicle: every fine, every payment by date paid, issued / paid / owing today / overdue, and a **printable statement**. Linked from the register (name, registration) and from each notice. |
| **Import fine payments** `/police/fines/payments` (web) | Upload the cashier's or bank's file (xlsx or CSV; template provided): fine or notice number, amount, date paid, receipt, method. Every row is matched and checked in the browser (no match, cancelled, already paid, more than owing, bad date) before anything is recorded; then the good rows are recorded together and each fine's status updates. A receipt already on a fine is skipped, so the same file can be imported twice safely. |

**Who:** the owing check is for Police, Captain, Supervisor and command staff, limited to 120 checks an hour per person, every check audited with the ID masked. The account, statement and import are for Captain, Supervisor, Admin and the tenant-wide tier. Printing a statement and importing are audited.

**Verified:** 19 more database checks (stages, the owing check across officers with its limit and audit, payment dates and the late-captured discount, duplicate receipts, every import outcome, re-importing a file), unit tests for stages, dates, amounts and the payments file, and the statement rendered to PDF.

**Still not done:** RTIA courtesy-letter and enforcement-order fees are not added (the register shows the stage only); payments come in by hand or by file, not from a payment gateway.

## Not in this phase

- Photos on a fine (number plate, the offence). A fine can be linked to the officer's open
  incident, whose photos the phone already captures; the fine links to that incident.
- Fines on the incident page: the fine links to its incident, not yet the other way round.
- RTIA integration (official notice numbers, NRTOR capture, courtesy letters, enforcement
  orders, online payment). The register keeps space for the official number.
- Bluetooth thermal ticket printers: the slip prints through the phone's print dialog or as a
  PDF.
