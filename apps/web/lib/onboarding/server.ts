import 'server-only';
import { headers } from 'next/headers';
import {
  abandonDirectAccount, checkInvitationBadge, completeAccountInvitation, completeDirectAccount, createDirectAccount,
  getInvitation, hitKeyedRateLimit, issueInvitationSecret,
  previewInvitation, recordInvitationDeliveryFailure, reportInvitation,
  type InvitationPreview, type InvitationState, type IssuedInvitation,
} from '@criticom/api';
import {
  DEPARTMENT_NAMES, maskEmail, maskPhone, passwordAcceptable, POPIA_NOTICE_VERSION,
  type CriticomClient, type Silo, type UserRole,
} from '@criticom/db';
import { getServiceSupabase } from '@/lib/supabase';
import { emailConfigured, sendEmail, sendTextMessage, showLinkInsteadOfEmail, smsConfigured } from './delivery';
import { isLeakedPassword } from './leaked';
import { invitationEmail, invitationSms } from './messages';
import {
  hashInvitationSecret, looksLikeActivationCode, looksLikeLinkToken, newActivationCode, newLinkToken,
  type SecretKind,
} from './secrets';

/**
 * Invitations on the server: issuing and delivering them for administrators,
 * and the steps the invited person takes. Shared by the web pages, their
 * server actions and the phone app's API, so every door behaves the same.
 */

function secretKey() {
  const key = process.env.INVITATION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('INVITATION_SECRET is not set.');
  return key;
}

export function invitationTtlHours() {
  const hours = Number(process.env.INVITE_TTL_HOURS ?? 72);
  return Number.isFinite(hours) ? Math.min(168, Math.max(1, Math.round(hours))) : 72;
}

/** The address invitation links point at: HTTPS, or plain HTTP on this machine for development. */
export function appOrigin() {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) throw new Error('Set NEXT_PUBLIC_APP_URL before sending invitations.');
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('NEXT_PUBLIC_APP_URL must be an HTTPS address (or HTTP localhost for development).');
  }
  return url.origin;
}

// ── Administrators: issue and deliver ──────────────────────────────────

export type ActivationSlip = {
  code: string; fullName: string; badge: string; role: UserRole; department: string;
  organisation: string; expiresAt: string; issuedBy: string;
};

export type DeliveryOutcome =
  | { status: 'sent'; channel: 'email' | 'sms'; to: string }
  | { status: 'link'; link: string; note: string }
  | { status: 'slip'; slip: ActivationSlip }
  | { status: 'failed'; error: string };

/** Which ways in this server can deliver right now. */
export function deliveryOptions() {
  return { email: emailConfigured() || showLinkInsteadOfEmail(), emailIsLinkOnly: !emailConfigured(), sms: smsConfigured() };
}

/**
 * Issue a fresh link or code for an invitation and get it to the person.
 * Runs with the administrator's own session, so the database decides whether
 * they may. Sending again cancels the previous link or code.
 */
export async function deliverInvitation(supabase: CriticomClient, invitationId: string): Promise<DeliveryOutcome> {
  const current = await getInvitation(supabase, invitationId);
  if (!current) return { status: 'failed', error: 'No such invitation in your organisation.' };
  if (current.channel === 'direct') return { status: 'failed', error: 'This account is created directly, not sent.' };
  if (current.channel === 'sms' && !smsConfigured()) {
    return { status: 'failed', error: 'SMS is not set up on this server yet. Cancel this invitation and use email or a printed code.' };
  }
  if (current.channel === 'email' && !emailConfigured() && !showLinkInsteadOfEmail()) {
    return { status: 'failed', error: 'Email is not set up on this server yet. Cancel this invitation and use a printed code.' };
  }

  const kind: SecretKind = current.channel === 'code' ? 'code' : 'link';
  // Check the link's address before issuing anything, so a misconfigured
  // server never marks as sent a link it could not build.
  let origin = '';
  if (kind === 'link') {
    try {
      origin = appOrigin();
    } catch (e) {
      return { status: 'failed', error: (e as Error).message };
    }
  }
  const secret = kind === 'code' ? newActivationCode() : newLinkToken();
  let issued: IssuedInvitation;
  try {
    issued = await issueInvitationSecret(supabase, {
      invitationId, secretHash: hashInvitationSecret(kind, secret, secretKey()), ttlHours: invitationTtlHours(),
    });
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }

  if (kind === 'code') {
    return {
      status: 'slip',
      slip: {
        code: secret, fullName: issued.full_name, badge: issued.badge_number, role: issued.role,
        department: DEPARTMENT_NAMES[issued.silo as Silo] ?? issued.silo,
        organisation: issued.organisation ?? 'eThekwini Municipality', expiresAt: issued.expires_at,
        issuedBy: issued.sent_by_name ?? issued.invited_by_name ?? 'an administrator',
      },
    };
  }

  const link = `${origin}/invite/${secret}`;
  const data = {
    fullName: issued.full_name, role: issued.role, silo: issued.silo as Silo, organisation: issued.organisation,
    invitedBy: issued.invited_by_name, expiresAt: issued.expires_at,
  };
  try {
    if (issued.channel === 'email') {
      if (!emailConfigured()) {
        return {
          status: 'link', link,
          note: 'Email is not set up on this development server, so pass this link on yourself. In production it is always emailed and never shown here.',
        };
      }
      await sendEmail(issued.email!, invitationEmail(data, link));
      return { status: 'sent', channel: 'email', to: maskEmail(issued.email) };
    }
    await sendTextMessage(issued.phone!, invitationSms(data, link));
    return { status: 'sent', channel: 'sms', to: maskPhone(issued.phone) };
  } catch (e) {
    const reason = (e as Error).message;
    await recordInvitationDeliveryFailure(supabase, invitationId, reason).catch(() => {});
    return { status: 'failed', error: `Not delivered: ${reason}` };
  }
}

// ── The invited person ─────────────────────────────────────────────────

export type PersonState = InvitationState | 'busy' | 'error';

const STATE_MESSAGES: Record<PersonState, string> = {
  ok: '',
  unknown: 'This invitation link or code is not valid. Check it, or ask your administrator for a new one.',
  expired: 'This invitation has expired. Ask your administrator to send a new one.',
  used: 'This invitation has already been used. Sign in instead.',
  locked: 'This invitation is locked after too many wrong badge numbers. Ask your administrator to send a new one.',
  closed: 'This invitation has been closed. Ask your administrator if you still need an account.',
  wrong: 'That badge number does not match the staff record.',
  busy: 'Too many attempts from this connection. Wait a few minutes, then try again.',
  error: 'We could not check your invitation just now. Try again shortly.',
};

export function stateMessage(state: PersonState, triesLeft?: number) {
  if (state === 'wrong' && triesLeft !== undefined) {
    return `${STATE_MESSAGES.wrong} ${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left.`;
  }
  return STATE_MESSAGES[state];
}

async function clientAddress() {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown').slice(0, 64);
}

/** Per-address limits on the signed-out steps. Each invitation also locks after five wrong badge numbers. */
async function allowed(bucket: string, limit: number, windowSeconds: number) {
  try {
    return await hitKeyedRateLimit(getServiceSupabase(), `${bucket}:${await clientAddress()}`, limit, windowSeconds);
  } catch {
    // The limiter is a second line; the per-invitation lock still holds.
    return true;
  }
}

function hashOf(kind: SecretKind, secret: string) {
  const valid = kind === 'link' ? looksLikeLinkToken(secret) : looksLikeActivationCode(secret);
  return valid ? hashInvitationSecret(kind, secret, secretKey()) : null;
}

export type PersonPreview = Omit<InvitationPreview, 'email'> & { state: PersonState; email?: string; message: string };

function present(preview: InvitationPreview | { state: PersonState }): PersonPreview {
  const p = preview as InvitationPreview & { state: PersonState };
  return { ...p, email: p.email ? maskEmail(p.email) : undefined, message: stateMessage(p.state, p.tries_left) };
}

/** What a link offers. Changes nothing, so a mail scanner opening it uses nothing up. */
export async function previewInvitationLink(token: string): Promise<PersonPreview> {
  const hash = hashOf('link', token);
  if (!hash) return present({ state: 'unknown' });
  if (!(await allowed('invite-view', 60, 600))) return present({ state: 'busy' });
  try {
    return present(await previewInvitation(getServiceSupabase(), hash));
  } catch {
    return present({ state: 'error' });
  }
}

export type BadgeCheck =
  | { ok: true; fullName: string; signIn: 'email' | 'badge'; signInAs: string; preview: PersonPreview }
  | { ok: false; state: PersonState; message: string; triesLeft?: number };

/** Confirm the badge number. For a printed code this is the first step, so it also returns what the code offers. */
export async function confirmBadge(kind: SecretKind, secret: string, badge: string): Promise<BadgeCheck> {
  const hash = hashOf(kind, secret);
  if (!hash) return { ok: false, state: 'unknown', message: stateMessage('unknown') };
  if (!(await allowed('invite-badge', 15, 900))) return { ok: false, state: 'busy', message: stateMessage('busy') };
  try {
    const service = getServiceSupabase();
    const preview = present(await previewInvitation(service, hash));
    if (preview.state !== 'ok') return { ok: false, state: preview.state, message: preview.message };
    const check = await checkInvitationBadge(service, hash, badge);
    if (!check.ok) {
      return { ok: false, state: check.state, message: stateMessage(check.state, check.tries_left), triesLeft: check.tries_left };
    }
    return {
      ok: true, fullName: check.full_name ?? '', signIn: check.sign_in ?? 'email',
      // An email is shown in full now the person has proven who they are; a badge sign-in as the badge.
      signInAs: check.sign_in === 'badge' ? badge.trim().toUpperCase() : (check.login_email ?? ''),
      preview,
    };
  } catch {
    return { ok: false, state: 'error', message: stateMessage('error') };
  }
}

export type Activation =
  | { ok: true; loginEmail: string; signIn: 'email' | 'badge'; signInAs: string; role: UserRole; silo: Silo; fullName: string }
  | { ok: false; message: string; state?: PersonState };

/**
 * Create the account: re-check the invitation and badge, check the password,
 * create the sign-in with it, then let the database make the profile. If the
 * database refuses, the sign-in is removed again, so nothing is left half-made.
 */
export async function activateAccount(args: {
  kind: SecretKind; secret: string; badge: string; password: string; accepted: boolean;
}): Promise<Activation> {
  const hash = hashOf(args.kind, args.secret);
  if (!hash) return { ok: false, state: 'unknown', message: stateMessage('unknown') };
  if (!args.accepted) return { ok: false, message: 'Accept the POPIA notice and the terms of use to continue.' };
  if (!(await allowed('invite-activate', 10, 900))) return { ok: false, state: 'busy', message: stateMessage('busy') };

  const service = getServiceSupabase();
  let check: Awaited<ReturnType<typeof checkInvitationBadge>>;
  try {
    check = await checkInvitationBadge(service, hash, args.badge);
  } catch {
    return { ok: false, state: 'error', message: stateMessage('error') };
  }
  if (!check.ok || !check.login_email) {
    return { ok: false, state: check.state, message: stateMessage(check.state, check.tries_left) };
  }
  if (!passwordAcceptable(args.password, { name: check.full_name, badge: args.badge })) {
    return { ok: false, message: 'Your password does not meet the rules shown. Choose another.' };
  }
  if (await isLeakedPassword(args.password)) {
    return { ok: false, message: 'This password has appeared in a data breach elsewhere, so it is not safe. Choose a different one.' };
  }

  const { data, error } = await service.auth.admin.createUser({
    email: check.login_email,
    password: args.password,
    email_confirm: true,
    user_metadata: { full_name: check.full_name },
  });
  if (error || !data.user) {
    const msg = error?.message ?? '';
    if (/already|registered|exists/i.test(msg)) {
      return { ok: false, message: 'An account already uses this sign-in. Speak to your administrator.' };
    }
    if (/password/i.test(msg)) return { ok: false, message: `Choose a different password: ${msg}` };
    return { ok: false, state: 'error', message: stateMessage('error') };
  }

  try {
    const done = await completeAccountInvitation(service, {
      secretHash: hash, badge: args.badge, userId: data.user.id, policyVersion: POPIA_NOTICE_VERSION,
    });
    return {
      ok: true, loginEmail: done.login_email, signIn: done.sign_in,
      signInAs: done.sign_in === 'badge' ? args.badge.trim().toUpperCase() : done.login_email,
      role: done.role, silo: done.silo, fullName: done.full_name,
    };
  } catch (e) {
    await service.auth.admin.deleteUser(data.user.id).catch(() => {});
    return { ok: false, message: (e as { message?: string }).message ?? stateMessage('error') };
  }
}

export type DirectAccount =
  | { ok: true; fullName: string; loginEmail: string; role: UserRole; silo: Silo }
  | { ok: false; message: string };

/**
 * Create an account with a password the administrator chose (migration 0055).
 * The database checks the administrator and opens a short-lived record with
 * their own session; the sign-in is then made here and the profile by the
 * database. Any failure after the record opens closes it again and removes
 * the sign-in, so nothing is left half-made.
 */
export async function createAccountDirectly(
  supabase: CriticomClient,
  args: { personnelId: string; role: UserRole; silo: Silo; email: string; password: string; reason: string },
): Promise<DirectAccount> {
  const opened = await createDirectAccount(supabase, {
    personnelId: args.personnelId, role: args.role, silo: args.silo, email: args.email, reason: args.reason,
  });
  const service = getServiceSupabase();
  const abandon = (note: string) => abandonDirectAccount(service, opened.invitation_id, note).catch(() => {});

  if (!passwordAcceptable(args.password, { name: opened.full_name, badge: opened.badge_number })) {
    await abandon('password did not meet the rules');
    return { ok: false, message: 'The password does not meet the rules shown. Choose another.' };
  }
  if (await isLeakedPassword(args.password)) {
    await abandon('password found in a data breach');
    return { ok: false, message: 'This password has appeared in a data breach elsewhere, so it is not safe. Choose a different one.' };
  }

  const { data, error } = await service.auth.admin.createUser({
    email: opened.login_email,
    password: args.password,
    email_confirm: true,
    user_metadata: { full_name: opened.full_name },
  });
  if (error || !data.user) {
    const msg = error?.message ?? 'no account returned';
    await abandon(msg);
    if (/already|registered|exists/i.test(msg)) return { ok: false, message: `An account already uses ${opened.login_email}.` };
    if (/password/i.test(msg)) return { ok: false, message: `Choose a different password: ${msg}` };
    return { ok: false, message: `The sign-in could not be created: ${msg}` };
  }

  try {
    const done = await completeDirectAccount(service, opened.invitation_id, data.user.id);
    return { ok: true, fullName: done.full_name, loginEmail: done.login_email, role: done.role, silo: done.silo };
  } catch (e) {
    await service.auth.admin.deleteUser(data.user.id).catch(() => {});
    const message = (e as { message?: string }).message ?? 'unknown error';
    await abandon(message);
    return { ok: false, message };
  }
}

/** "This isn't me": close the invitation and tell whoever sent it. */
export async function reportInvitationLink(token: string, note: string): Promise<{ ok: boolean; message: string }> {
  const hash = hashOf('link', token);
  if (!hash) return { ok: false, message: stateMessage('unknown') };
  if (!(await allowed('invite-report', 10, 900))) return { ok: false, message: stateMessage('busy') };
  try {
    const res = await reportInvitation(getServiceSupabase(), hash, note.slice(0, 300));
    return res.ok
      ? { ok: true, message: 'Thank you. The invitation is closed and the person who sent it has been told.' }
      : { ok: false, message: stateMessage(res.state ?? 'closed') };
  } catch {
    return { ok: false, message: stateMessage('error') };
  }
}
