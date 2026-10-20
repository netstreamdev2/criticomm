'use server';

import { revalidatePath } from 'next/cache';
import { RADIO_ID_PATTERN, saveRadioDevice, type RadioKind } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

export type RadioFormState = { error?: string; done?: string } | null;

const text = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim();
  return v || null;
};

/**
 * Add or change a radio: save_radio_device() checks who may, and audits it
 * (0082, 0087). Nobody picks a platform: a Radio ID (HT-XXXX-XXXX) is a radio
 * running our app, any other name is the radio's own account on PocStar.
 */
export async function saveRadioAction(_prev: RadioFormState, formData: FormData): Promise<RadioFormState> {
  const { supabase } = await getSession();
  const id = text(formData, 'id');
  const account = text(formData, 'account') ?? '';
  try {
    const row = await saveRadioDevice(supabase, {
      id,
      provider: RADIO_ID_PATTERN.test(account.toUpperCase()) ? 'hiktech' : 'pocstar',
      kind: (text(formData, 'kind') ?? '') as RadioKind,
      account,
      label: text(formData, 'label'),
      providerUserId: text(formData, 'provider_user_id'),
      imei: text(formData, 'imei'),
      silo: (text(formData, 'silo') ?? '') as Silo,
      personnelId: text(formData, 'personnel_id'),
      apparatusId: text(formData, 'apparatus_id'),
      notes: text(formData, 'notes'),
      active: formData.get('active') !== 'false',
    });
    revalidatePath('/admin/radios');
    revalidatePath('/dispatch/ptt');
    return { done: `${(row as { account?: string } | null)?.account ?? 'The radio'} is ${id ? 'saved' : 'in the register'}.` };
  } catch (e) {
    const message = (e as { message?: string }).message ?? 'The radio could not be saved.';
    return { error: message.includes('row-level security') ? 'You may not change radios.' : message };
  }
}

/** Point Talk at its server: set_talk_server() lets only the system administrators (0083). */
export async function setTalkServerAction(_prev: RadioFormState, formData: FormData): Promise<RadioFormState> {
  const { supabase } = await getSession();
  const { error } = await supabase.rpc('set_talk_server', {
    p_url: text(formData, 'url') ?? '',
    p_api_key: text(formData, 'api_key') ?? '',
    p_api_secret: text(formData, 'api_secret') ?? '',
  });
  if (error) return { error: error.message.includes('Not permitted') ? 'Only a system administrator sets this.' : error.message };
  revalidatePath('/admin/radios');
  revalidatePath('/dispatch/ptt');
  return { done: 'Saved. Talk is ready.' };
}
