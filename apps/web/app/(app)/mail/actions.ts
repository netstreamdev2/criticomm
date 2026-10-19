'use server';

import { revalidatePath } from 'next/cache';
import { logAudit, markMailRead, sendMail, sendNotification } from '@criticom/api';
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

  // A mail lands as a notification for the recipient alone, phone included.
  const subject = String(formData.get('subject') ?? '').trim();
  await sendNotification(supabase, { audience: 'person', userId: toUser }, {
    kind: 'mail',
    title: `Mail from ${fullName}`.slice(0, 140),
    body: subject ? subject.slice(0, 1000) : null,
    link: '/mail',
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
