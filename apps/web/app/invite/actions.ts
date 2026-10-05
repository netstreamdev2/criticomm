'use server';

import {
  activateAccount, confirmBadge, reportInvitationLink, type Activation, type BadgeCheck,
} from '@/lib/onboarding/server';
import { getServerSupabase } from '@/lib/supabase';

/**
 * The invited person's steps, for the web pages. Anyone can call a server
 * action, so each one checks everything again on the server and in the
 * database; nothing here trusts the page that called it.
 */

type Kind = 'link' | 'code';
const kindOf = (k: string): Kind => (k === 'code' ? 'code' : 'link');

export async function confirmBadgeAction(kind: string, secret: string, badge: string): Promise<BadgeCheck> {
  return confirmBadge(kindOf(kind), String(secret ?? ''), String(badge ?? ''));
}

export async function activateAction(input: {
  kind: string; secret: string; badge: string; password: string; accepted: boolean;
}): Promise<Activation & { signedIn?: boolean }> {
  const result = await activateAccount({
    kind: kindOf(input.kind),
    secret: String(input.secret ?? ''),
    badge: String(input.badge ?? ''),
    password: String(input.password ?? ''),
    accepted: input.accepted === true,
  });
  if (!result.ok) return result;

  // Sign the new account in here. Anyone else signed in on this browser is
  // signed out first, so the new account never inherits their session.
  const supabase = await getServerSupabase();
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  const { error } = await supabase.auth.signInWithPassword({ email: result.loginEmail, password: input.password });
  return { ...result, signedIn: !error };
}

export async function reportAction(token: string, note: string) {
  return reportInvitationLink(String(token ?? ''), String(note ?? ''));
}
