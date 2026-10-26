'use server';

import { revalidatePath } from 'next/cache';
import { removeSignInDevice, resetSignInPin, unlockSignInPin } from '@criticom/api';
import { getSession } from '@/lib/session';

export type PinFormState = { error?: string; done?: string } | null;

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const plain = (e: unknown, fallback: string) => {
  const message = (e as { message?: string }).message ?? fallback;
  return message.includes('row-level security') || message.includes('permission denied') ? 'You may not change PIN sign-in.' : message;
};

/** A lost or retired device stops working; every sign-in made on it ends (0108). */
export async function removeDeviceAction(_prev: PinFormState, formData: FormData): Promise<PinFormState> {
  const { supabase } = await getSession();
  try {
    await removeSignInDevice(supabase, text(formData, 'id'), text(formData, 'reason'));
    revalidatePath('/kit/sign-in');
    return { done: 'Removed. It no longer signs anyone in.' };
  } catch (e) {
    return { error: plain(e, 'It could not be removed.') };
  }
}

/** A forgotten PIN: cleared; the officer chooses a new one after signing in with their password (0108). */
export async function resetPinAction(_prev: PinFormState, formData: FormData): Promise<PinFormState> {
  const { supabase } = await getSession();
  try {
    await resetSignInPin(supabase, text(formData, 'user_id'), text(formData, 'reason'));
    revalidatePath('/kit/sign-in');
    return { done: 'PIN reset. They choose a new one after signing in with their password.' };
  } catch (e) {
    return { error: plain(e, 'The PIN could not be reset.') };
  }
}

/** Unlocked after five wrong tries (0108). */
export async function unlockPinAction(_prev: PinFormState, formData: FormData): Promise<PinFormState> {
  const { supabase } = await getSession();
  try {
    await unlockSignInPin(supabase, text(formData, 'user_id'));
    revalidatePath('/kit/sign-in');
    return { done: 'Unlocked.' };
  } catch (e) {
    return { error: plain(e, 'The PIN could not be unlocked.') };
  }
}
