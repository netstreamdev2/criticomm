import type { Metadata } from 'next';
import { AcceptFlow } from '@/components/onboarding/accept-flow';
import { OnboardingNotice, OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { previewInvitationLink } from '@/lib/onboarding/server';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
// The token is in the address: never index it, never pass it on as a referrer.
export const metadata: Metadata = {
  title: 'Your invitation · HikTech',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const TITLES: Record<string, string> = {
  unknown: 'This invitation link isn’t valid',
  expired: 'This invitation has expired',
  used: 'This invitation has already been used',
  locked: 'This invitation is locked',
  closed: 'This invitation has been closed',
  busy: 'Please wait a moment',
  error: 'We couldn’t open your invitation',
};

/**
 * An invitation link. Opening it only shows what it offers: a mail scanner
 * that opens it first uses nothing up. Everything else is the person's own
 * button presses.
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await previewInvitationLink(token);

  let signedInAs: string | null = null;
  try {
    const { data: { user } } = await (await getServerSupabase()).auth.getUser();
    signedInAs = user?.email ?? null;
  } catch {
    signedInAs = null;
  }

  return (
    <OnboardingShell>
      {preview.state === 'ok' ? (
        <AcceptFlow kind="link" secret={token} preview={preview} signedInAs={signedInAs} />
      ) : (
        <OnboardingNotice
          title={TITLES[preview.state] ?? TITLES.error!}
          message={preview.message}
          action={preview.state === 'used'
            ? <a href="/login" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Sign in</a>
            : undefined}
        />
      )}
    </OnboardingShell>
  );
}
