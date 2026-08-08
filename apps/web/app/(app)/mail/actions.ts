'use server';

import { revalidatePath } from 'next/cache';
import { logAudit, markMailRead, raiseAlert, sendMail } from '@criticom/api';
import { getSession } from '@/lib/session';

export async function sendMailAction(formData: FormData) {
  const { supabase, silo, fullName } = await getSession();
  const toUser = String(formData.get('to_user') ?? '');
  const toName = String(formData.get('to_name') ?? '').trim() || undefined;
  if (!toUser) return;

  await sendMail(supabase, {
    toUser,
    toName,
    subject: String(formData.get('subject') ?? ''),
    body: String(formData.get('body') ?? ''),
    fromName: fullName,
  });

  // A mail lands as a low-priority alert too, so it reaches the phone.
  await raiseAlert(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    targetUserId: toUser,
    kind: 'info',
    severity: 'Low',
    title: `Mail from ${fullName}`,
    body: String(formData.get('subject') ?? ''),
    link: '/mail',
    createdByName: fullName,
  }).catch(() => {});

  await logAudit(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    action_type: 'MailSent', entity_type: 'mail_message',
    user_name: fullName, details: toName ?? toUser,
  }).catch(() => {});

  revalidatePath('/mail');
}

export async function markReadAction(formData: FormData) {
  const { supabase } = await getSession();
  await markMailRead(supabase, String(formData.get('id')));
  revalidatePath('/mail');
}
