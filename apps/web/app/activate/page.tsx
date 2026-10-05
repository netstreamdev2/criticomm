import type { Metadata } from 'next';
import { AcceptFlow } from '@/components/onboarding/accept-flow';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';

export const metadata: Metadata = {
  title: 'Activate your account · HikTech',
  robots: { index: false, follow: false },
};

/** For staff given a printed activation slip: the code and their badge number open it. */
export default function ActivatePage() {
  return (
    <OnboardingShell>
      <AcceptFlow kind="code" />
      <p className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
        Already activated? <a href="/login" className="font-semibold text-primary hover:underline">Sign in</a>
      </p>
    </OnboardingShell>
  );
}
