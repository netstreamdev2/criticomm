# SystemAdmin invitations: email verification milestone

This milestone ends at **Create your account**, with the invited email read-only,
the tenant name and intended SystemAdmin role. It does not set a password or
activate SystemAdmin access. The recipient's browser does not receive an Auth
session, so opening the email while signed in as SuperAdmin preserves that login.

## Hosted Supabase setup for the current local app

Use the Supabase project named by `NEXT_PUBLIC_SUPABASE_URL` in
`apps/web/.env.local`. Do not change another project's Auth settings.
The local CLI configuration does not configure the hosted project automatically.

1. **Authentication → Sign In / Providers → Email**: enable Email. Keep
   **Allow new users to sign up** off and **Confirm email** on. Admin invitations
   use the server Auth Admin API; no public signup or Google OAuth is needed.
2. **Authentication → URL Configuration**: add the exact redirect URL
   `http://127.0.0.1:3000/auth/invite`. The current local app uses
   `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000`. On a dedicated development project,
   set Site URL to `http://127.0.0.1:3000` too. If the project is shared with another
   deployment, preserve that deployment's Site URL and add only the redirect.
3. **Authentication → Emails → Templates → Invite user**: set the subject to
   `You’re invited to Criticomm` and paste the entire contents of
   [`supabase/templates/invite.html`](../supabase/templates/invite.html).
   It uses `RedirectTo` and `TokenHash`, with `type=invite`. Do not substitute
   `ConfirmationURL`: this flow verifies the token on the server without signing
   the browser in. Do not manually invite from the Supabase Users screen for
   this test; the Criticomm form prepares the trusted tenant assignment.
4. Leave Email OTP Expiration at its current/default value for the test; Supabase
   invitations use that setting (the documented default is one hour).
5. Configure an email sender using one of the options below.

## Receiving the test in Gmail

The destination can be a Gmail address. That is separate from which service sends
the email. Use an address that is not already a Criticomm Auth user.

**Small test with Supabase's default sender:** use the Gmail address that already
belongs to your Supabase organisation's team. The default sender only permits team
addresses and currently allows two messages per hour. Do not grant clients access
to your Supabase team just to bypass this restriction. Gmail aliases are different
recipient addresses for this restriction; do not assume they will work.

**Other Gmail recipients:** configure **Authentication → Emails → SMTP Settings →
Enable custom SMTP**. Use the host, port, username, password and verified sender
provided by your email service. These credentials belong in Supabase, not the
browser, repo or chat.

If you choose to use a Gmail account as the sender for this local test, and Google
allows App Passwords on that account:

| Supabase SMTP field | Test value |
| --- | --- |
| Sender email | Your sending Gmail address |
| Sender name | Criticomm |
| Host | `smtp.gmail.com` |
| Port | `587` (TLS/STARTTLS) |
| Username | Your complete sending Gmail address |
| Password | A Google App Password for this integration |

Google requires 2-Step Verification for App Passwords. Use an App Password, not
your usual Gmail password. Some managed or protected Google accounts do not offer
this option; use an SMTP service supported by Supabase in that case. This sender
credential has no connection to the invited user's future Criticomm password.

## Walkthrough and expected result

1. Start the web app and browse to `http://127.0.0.1:3000/admin/tenants`.
2. Sign in as SuperAdmin. In **Invite a SystemAdmin**, select the active test
   tenant, enter the recipient's full name and unused Gmail address, then send.
3. Supabase creates an unconfirmed Auth account. Its `app_metadata` records
   `invitation_pending: true`, the intended role and tenant in
   `system_admin_invitation`, and a non-admin `role: Viewer`. No application
   profile or password is created by this workflow. The pending account is
   prepared before the email is sent.
4. Open the email on the **same computer** running the dev server. Check Spam
   if needed. Click **View your invitation**.
5. The app verifies the single-use token with Supabase and redirects to
   `/accept-invite` without the token in the address bar. You should see the
   exact invited email (read-only), recipient name, tenant and intended
   SystemAdmin role. There are no password fields or continuation button.
6. The email becomes confirmed in Supabase Auth. The account remains pending;
   reaching this screen does not activate administrative access. Your existing
   SuperAdmin session is preserved.

The confirmation screen can be refreshed for one hour using its signed,
HttpOnly invitation receipt. The receipt only permits reading the invitation;
it is not an Auth session. Reopening the consumed email link gives an error.

## Retry and troubleshooting

- **SMTP error:** the pending account remains. Fix the sender and submit the same
  email and tenant again. It reuses that account rather than moving/promoting an
  unrelated one. The original recipient name is retained on a resend.
- **Expired, unused invite:** resubmit the same email and tenant; use the newest
  email. Observe your project's email rate limits.
- **Email already exists:** this form rejects active/confirmed accounts and
  pending invitations belonging to another tenant. Do not repurpose an existing
  real account for testing. Once a test invitation is verified, use a different
  unused email for a new test, or revisit the existing confirmation screen while
  its receipt is still valid.
- **Email address not authorized:** the hosted default sender only delivers to
  Supabase team addresses; configure custom SMTP for other recipients.
- **Link goes to the wrong screen:** check the exact redirect allowlist and the
  Invite user template. Keep `127.0.0.1` and `localhost` consistent. Both reach the
  local machine but have different browser cookies.
- **Local link fails on a phone:** localhost refers to the device opening it.
  Test on the development computer. External client tests need a public staging
  URL and that callback added to Supabase's allowlist.
- **Unavailable/used link:** email scanners can consume single-use links. Check
  Auth logs. If already verified, refresh the confirmation page in that browser;
  otherwise request a fresh invitation. Do not paste invitation tokens into logs
  or issue reports.

No database migration is required. Invitation intent is stored in trusted Auth
app metadata; requested/sent/failed/verified events use the existing tenant-scoped
audit log with the actual actor ID. This milestone does not replace the pending
work on profile/role authorization elsewhere in the platform.

## References

- [Supabase invitations](https://supabase.com/docs/guides/auth/users)
- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase SMTP restrictions and settings](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google App Passwords](https://support.google.com/accounts/answer/185833)
- [Google SMTP settings](https://support.google.com/a/answer/176600)
