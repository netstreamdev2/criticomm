import 'server-only';
import { revalidatePath } from 'next/cache';
import type { CriticomClient, Silo } from '@criticom/db';
import type { ActionResult } from '@/components/office/action-form';

/**
 * Run a duty office write and report it to the form. Access and every rule
 * are checked by the database function behind it; its refusal comes back as
 * the message.
 */
export async function attempt(work: () => Promise<string | void>, ...paths: string[]): Promise<ActionResult> {
  try {
    const message = await work();
    for (const p of paths) revalidatePath(p);
    return { ok: true, message: message || undefined };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not done' };
  }
}

export const field = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
export const optional = (fd: FormData, k: string) => field(fd, k) || null;

/**
 * The member typed into a "Staff no." box: their staff number, or the
 * "number — name" the list offers. Only members with an account can be
 * rostered, endorsed or given leave.
 */
export async function resolveMember(supabase: CriticomClient, silo: Silo, typed: string): Promise<string> {
  const badge = typed.split(' — ')[0]?.trim();
  if (!badge) throw new Error('Enter the staff number');
  const { data } = await supabase.from('personnel').select('user_id').eq('silo', silo).eq('badge_number', badge)
    .not('user_id', 'is', null).is('left_at', null).limit(2);
  if (!data || data.length === 0) throw new Error(`No member with an account has staff number ${badge}`);
  if (data.length > 1) throw new Error(`Staff number ${badge} is used twice in the register. Fix it in Staff Maintenance first.`);
  return data[0]?.user_id as string;
}
