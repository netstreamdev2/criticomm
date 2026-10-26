import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { listSignInDevices, noKitRegister, signInPinBoard } from '@criticom/api';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { SignInBoard } from './sign-in-board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PIN sign-in · HikTech' };

/** The tables or functions of 0108 are not there yet. */
const notSetUp = (e: unknown) => noKitRegister(e) || /sign_in/.test((e as { message?: string }).message ?? '');

/**
 * PIN sign-in (0108): the devices registered for it, and which officers have
 * a PIN, which are locked. A supervisor removes a lost device (every sign-in
 * made on it ends), unlocks a PIN after five wrong tries, or resets a
 * forgotten one. Devices are registered on the device itself, in the app.
 */
export default async function SignInPinsPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  let missing = false;
  const [devices, officers] = await Promise.all([
    listSignInDevices(supabase).catch((e) => { missing ||= notSetUp(e); return []; }),
    signInPinBoard(supabase).catch((e) => { missing ||= notSetUp(e); return []; }),
  ]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg">
            <KeyRound className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">{t('PIN sign-in')}</h1>
            <p className="text-sm text-muted-foreground">{t('Officers sign in on a registered radio or phone with a 6-digit PIN.')}</p>
          </div>
        </div>
        <Link href="/kit" className="text-sm font-semibold text-primary hover:underline">{t('Hard hats & radios')}</Link>
      </header>

      {missing ? (
        <p className="frost rounded-xl border border-amber-500/40 p-4 text-sm">
          {t('PIN sign-in is not set up yet. Run migration 0108 in Supabase, then reload.')}
        </p>
      ) : (
        <SignInBoard devices={devices} officers={officers} />
      )}
    </div>
  );
}
