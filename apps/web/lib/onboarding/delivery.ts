import 'server-only';
import nodemailer from 'nodemailer';
import { sendSms } from '@/lib/sms';

/**
 * Getting an invitation to a person. Email goes through the municipality's
 * own mail server (SMTP_*), SMS through BulkSMS. Both are optional; when one
 * is not set up the invite form says so and offers the other ways.
 */

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function smsConfigured() {
  return Boolean(process.env.BULKSMS_TOKEN_ID && process.env.BULKSMS_TOKEN_SECRET);
}

/**
 * On a development machine with no mail server, the administrator is shown
 * the link to deliver by hand. Never in production: there, a link that only
 * the administrator saw would defeat the point of the person receiving it.
 */
export function showLinkInsteadOfEmail() {
  return !emailConfigured() && process.env.NODE_ENV !== 'production';
}

let transport: nodemailer.Transporter | null = null;
function mailer() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

export async function sendEmail(to: string, message: { subject: string; text: string; html: string }) {
  if (!emailConfigured()) throw new Error('Email is not set up on this server (SMTP_HOST, SMTP_FROM).');
  await mailer().sendMail({ from: process.env.SMTP_FROM, to, subject: message.subject, text: message.text, html: message.html });
}

export async function sendTextMessage(to: string, body: string) {
  const result = await sendSms(to, body);
  if (!result.ok) {
    throw new Error(result.reason === 'unconfigured'
      ? 'SMS is not set up on this server (BULKSMS_TOKEN_ID, BULKSMS_TOKEN_SECRET).'
      : `The SMS was not accepted${result.detail ? `: ${result.detail.slice(0, 160)}` : ''}.`);
  }
}
