import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import type { Silo, UserRole } from '@criticom/db/types';

/**
 * The words an invitation arrives in. Written to be read on a phone, by
 * someone who may not be expecting it. They name the inviter, the role and
 * the deadline, and never carry a badge, ID or personal number.
 */

export type InvitationMessageData = {
  fullName: string;
  role: UserRole;
  silo: Silo;
  organisation: string | null;
  invitedBy: string | null;
  expiresAt: string;
};

/** "Tuesday 6 October 2026 at 14:20", in South African time. */
export function formatDeadline(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')} at ${get('hour')}:${get('minute')}`;
}

/** Whole days until a deadline, for short messages ("within 3 days"). */
function daysLeft(iso: string, now = Date.now()) {
  return Math.max(1, Math.round((new Date(iso).getTime() - now) / 86_400_000));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function invitationEmail(data: InvitationMessageData, link: string) {
  const first = data.fullName.split(' ')[0] || data.fullName;
  const org = data.organisation ?? 'eThekwini Municipality';
  const inviter = data.invitedBy ?? 'An administrator';
  const department = DEPARTMENT_NAMES[data.silo] ?? data.silo;
  const deadline = formatDeadline(data.expiresAt);
  const subject = 'You’ve been invited to HikTech';

  const text = [
    `Hello ${first},`,
    '',
    `${inviter} has invited you to HikTech, ${org}’s emergency services platform.`,
    '',
    `Your role: ${data.role}, ${department}`,
    '',
    `Open your invitation: ${link}`,
    '',
    `The link works once and expires on ${deadline}. You’ll be asked for your badge number.`,
    'If you weren’t expecting this, ignore it; it expires on its own.',
  ].join('\n');

  const e = {
    first: escapeHtml(first), org: escapeHtml(org), inviter: escapeHtml(inviter), role: escapeHtml(data.role),
    department: escapeHtml(department), deadline: escapeHtml(deadline), link: escapeHtml(link),
  };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f1420;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d6dbe6;border-radius:12px;overflow:hidden;">
<tr><td style="background:#050510;color:#ffffff;padding:14px 20px;font-weight:700;font-size:16px;letter-spacing:.02em;">HikTech <span style="font-weight:400;color:#9ca3af;font-size:13px;">${e.org}</span></td></tr>
<tr><td style="padding:24px 20px 8px;font-size:15px;line-height:1.55;">
<p style="margin:0 0 12px;">Hello ${e.first},</p>
<p style="margin:0 0 16px;">${e.inviter} has invited you to HikTech, ${e.org}’s emergency services platform.</p>
<p style="margin:0 0 20px;padding:8px 12px;border-left:3px solid #cd2837;background:#f4f6fb;">Your role: <b>${e.role}</b>, ${e.department}</p>
<p style="margin:0 0 20px;"><a href="${e.link}" style="display:inline-block;background:#cd2837;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:7px;">Open your invitation</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#5a6478;">The link works once and expires on ${e.deadline}. You’ll be asked for your badge number.</p>
<p style="margin:0 0 20px;font-size:13px;color:#5a6478;">If you weren’t expecting this, ignore it; it expires on its own.</p>
</td></tr>
<tr><td style="padding:12px 20px 18px;font-size:12px;color:#5a6478;border-top:1px solid #d6dbe6;">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all;">${e.link}</span></td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  return { subject, text, html };
}

export function invitationSms(data: InvitationMessageData, link: string, now = Date.now()) {
  const inviter = data.invitedBy ?? 'An administrator';
  const days = daysLeft(data.expiresAt, now);
  const department = DEPARTMENT_NAMES[data.silo] ?? data.silo;
  return `HikTech: ${inviter} (${data.organisation ?? 'eThekwini'}) invited you as ${data.role}, ${department}. `
    + `Open within ${days} day${days === 1 ? '' : 's'}: ${link} You’ll need your badge number. Not expecting this? Ignore it.`;
}
