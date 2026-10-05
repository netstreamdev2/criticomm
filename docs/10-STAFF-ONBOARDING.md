# 10 — Staff onboarding: accounts by invitation

**Status:** agreed design (3 October 2026). Built: invitations (migration `0049`) and the staff-register import with role review, bulk invitations, leavers and the rollout page (migration `0050`, run it after `0049`).

The full design, with mock-ups of every screen, is one HTML handbook page:

- **Source:** [`apps/web/handbook/staff-onboarding.html`](../apps/web/handbook/staff-onboarding.html). Edit it there; it is the only copy that matters.
- **In the app:** `/admin/handbook/staff-onboarding`, for SuperAdmin, SystemAdmin and Admin only. The page is served by `app/(app)/admin/handbook/[slug]/route.ts`, with self-hosted fonts and the reader's console theme.
- **Shared copy:** the product owner keeps a private shared link for people who have no account yet. It is republished from the same file.

## The design in short

- Nobody signs themselves up. An administrator invites a person from the staff register, and the invitation fixes the role. The person proves who they are with their badge number, chooses their own password and accepts the POPIA notice. The account is created only then.
- The ladder, reasons and second-SystemAdmin approval from migration `0048` apply to invitations exactly as they do to role changes.
- Invitations go by email, by SMS, or as a printed activation code. Each works once and expires after 72 hours. Opening a link changes nothing, so mail scanners cannot use it up. Five wrong attempts lock the invitation.
- Staff without email sign in with their badge number.
- **Bringing existing staff across:** move people, not passwords.
  1. Import one staff list (from HR, checked against the current system) into the register. It is checked on screen first.
  2. Review roles.
  3. Pilot, then invite in waves before go-live, so that on go-live night everyone simply signs in.
  4. Administrator roles are never carried over; they are appointed fresh.

## Built: invitations (0049)

**Administrators** (SystemAdmin anywhere; a department Admin in their own department, department roles only):

- `/admin/invitations/new`: search the staff register, choose role and department (with what the role opens), choose email, SMS or printed code, give a reason. Admin, SystemAdmin and SystemController invitations wait on `/admin/approvals` for a second SystemAdmin; approving sends them.
- `/admin/invitations`: open, accepted and closed invitations. Send, Resend or New slip stop the previous link or code working. Cancel closes one for good. Nothing is deleted.
- A printed activation code is shown once, on the slip, and stored only as a keyed hash. A lost slip is replaced, never reprinted.

**The invited person:**

- From an email or SMS link: `/invite/[token]`. Opening it changes nothing (mail scanners cannot use it up). They confirm their badge number, choose a password and accept the POPIA notice, and only then is the account created and signed in.
- From a printed code: `/activate` on the web, or “I have an activation code” on the app's sign-in screen (`apps/mobile/app/activate.tsx`, through `/api/onboarding/check` and `/api/onboarding/activate`).
- Five wrong badge numbers lock an invitation. Each network address is also rate-limited. Passwords need 12+ characters and must not contain the person's name or badge. Passwords found in known breaches are refused (Pwned Passwords k-anonymity check; it fails open if the service is unreachable).
- Staff invited by SMS or printed code sign in with their badge number. Their sign-in address is `{badge}@{tenant-slug}.badge.internal`, which never receives mail. The sign-in screens assume the `ethekwini` tenant; other tenants need an organisation picker first.

**Where the code is:** `supabase/migrations/0049_account_invitations.sql` · `packages/db/src/onboarding.ts` (rules shared by web, app and SQL) · `packages/api/src/admin/invitations.ts` · `apps/web/lib/onboarding/` (secrets, delivery, the person's steps) · `apps/web/app/(app)/admin/invitations/` · `apps/web/app/invite/`, `apps/web/app/activate/`, `apps/web/app/legal/popia/`, `apps/web/app/api/onboarding/`.

**Settings** (server-only; see `.env.example`):

| Setting | Purpose |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | The mail server for invitation emails |
| `BULKSMS_TOKEN_ID`, `BULKSMS_TOKEN_SECRET` | SMS invitations (off until set) |
| `INVITATION_SECRET` | Key for the hashes of links and codes. Falls back to the service role key; give production its own. Changing it voids every unaccepted invitation |
| `INVITE_TTL_HOURS` | Link and code lifetime, 1–168 hours, default 72 |
| `NEXT_PUBLIC_APP_URL` | The address in invitation links; HTTPS outside localhost |
| `EXPO_PUBLIC_APP_URL` | The same address, for the app's activation screen |
| `NEXT_PUBLIC_APP_DOWNLOAD_URL` | Optional: shown to field staff once they activate |

Without a mail server, a development server shows the administrator the invitation link to pass on by hand. Production never does; it offers SMS and printed codes only.

**Tests:** `packages/db/src/onboarding.test.ts`, `packages/db/src/roles.test.ts`, `packages/api/src/admin/invitations.test.ts`, `apps/web/lib/onboarding/onboarding.test.ts`. The migration was also run against a Postgres (PGlite) copy of the schema, covering tenant walls, the ladder, approvals, lockout and the full accept path.

**Not yet:** password resets. Retiring the separate SuperAdmin → SystemAdmin invitation (`/auth/invite`, `/accept-invite`), which waits for the SuperAdmin work.

## Built: the staff register and HR's staff list (0050)

**1. The template and HR's list.** An administrator downloads the template from Admin → Personnel → *Template for HR* (`/admin/personnel/template`). It is built on request from the current columns:

- First names, Surname, Badge number, Rank and Department are required.
- Station, Work email, Work cellphone and Role in current system are optional. The last is only used to suggest a role.
- The workbook has a Department drop-down, and its badge and cellphone columns are formatted as text, so Excel keeps leading zeros.
- An Instructions sheet asks for nothing else: no ID numbers, addresses or salaries.

HR's own exports work too, as long as the headings are recognisable (`STAFF_LIST_COLUMNS` lists the alternative names accepted).

**2. Importing** (`/admin/personnel/import`, SystemAdmins only):

- The file is read in the administrator's browser (`apps/web/lib/register/`). It handles Excel `.xlsx` (first sheet named for staff, else the first with recognisable headings) and CSV in UTF-8, Windows-1252 or UTF-16. Old `.xls` files are refused with instructions.
- The headings may sit below a title row.
- Every row is checked against the register (`checkStaffList` in `packages/db/src/register.ts`) and sorted into: ready to add, will update, unchanged, copies merged, needs attention, or skipped.
- Anyone the list leaves out, in the departments it covers, is shown for review.
- Problem rows are fixed on screen or skipped, and never block the rest. The fixes are: choose department, type rank, import without the email or number, "same person: update", or skip.
- Only confirmed rows are sent, 500 at a time. The database checks every row again (`import_staff_rows`).
- Matching is by normalised badge number, so a re-import updates in place and never duplicates.
- A blank cell never erases what the register holds.
- An account holder's department is never changed by an import; that is a role change on their account page.
- Someone marked as left who appears in a list comes back.
- Importing creates no accounts.
- Every import is recorded in `staff_imports` (who, when, file name, SHA-256, reason, counts) and in the audit log.

**3. Role review** on `/admin/personnel`:

- Imported people arrive with a suggested role from their old one (the handbook's table), never an administrator role.
- An administrator filters, selects and confirms a role in bulk (`set_register_roles`): a SystemAdmin for anyone, a department Admin for department roles in their own department.
- Administrator roles are never set in bulk; they are invited one at a time with approval.

**4. Inviting in bulk** from the register:

- Only people with a confirmed role, no account and no open invitation.
- The server re-reads each person and chooses the route: email if HR gave one, SMS if there is only a cellphone and SMS is set up, otherwise a printed code.
- Each invitation goes through `create_account_invitation` like a manual one.
- Runs a few at a time with progress. Printed codes come out together, ready for the shift briefing.

**5. Rollout** (`/admin/rollout`):

- Activated / invited / not invited, overall and by department and station.
- A chase list, filterable by station, with "send again" for everyone who has not opened theirs. People part-way through activating are left alone.

**6. Leavers:**

- *Mark as left* needs a reason. It cancels open invitations, and the person stays in the register as a record.
- Someone with an active account must have it deactivated first (0048).
- *Bring back* undoes a mistake, also with a reason.

**Badge numbers:** a badge number belongs to one current person.

- New duplicates, from the form, an import or renumbering, are refused, naming the current holder.
- Duplicates already in a register keep working and are listed on the Personnel page for cleanup.
- Once there are none, re-running 0050 adds a unique index.

**Tests:** `packages/db/src/register.test.ts`, `apps/web/lib/register/register-files.test.ts` (a workbook in Excel's own shape, every CSV encoding, the template round trip) and `packages/api/src/admin/register.test.ts`. The migration was run against PGlite with 58 checks. The 0049 suite still passes with 0050 applied.

## Agreed decisions

1. HikTech sends its own invitation emails through a mail server.
2. Invitations last 72 hours.
3. The badge number proves identity.
4. Staff without email sign in with their badge number.
5. Administrators issue printed codes.

## Still open with eThekwini

1. Which system holds the staff list.
2. Who the two SystemAdmins are, nominated in writing.
3. The pilot station and the go-live date.
4. Whether desk staff use Microsoft 365 accounts, for a possible "Sign in with Microsoft".
5. The mail server and BulkSMS account. The old BulkSMS token was exposed and must be replaced.
6. The POPIA notice at `/legal/popia` (version 1.0) is our draft. eThekwini's Information Officer must review it before go-live. A new version changes `POPIA_NOTICE_VERSION`, and each account records the version it accepted.

## Supersedes

§2 of [04-SECURITY-MIGRATION.md](04-SECURITY-MIGRATION.md): the lazy migration of V4 password hashes. See the note there for why.

## Adding another handbook page

1. Put a standalone HTML file in `apps/web/handbook/`. Wrap its Google Fonts links in `<!-- handbook:fonts -->` … `<!-- /handbook:fonts -->` so the app can swap in its own fonts.
2. Register the page in `HANDBOOK` (`apps/web/lib/handbook/index.ts`).
3. The tests in `apps/web/lib/handbook/handbook.test.ts` check that every registered file exists and loads nothing from third parties in the app.
