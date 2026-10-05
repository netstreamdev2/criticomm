import type { Metadata } from 'next';
import { POPIA_NOTICE_VERSION } from '@criticom/db';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';

export const metadata: Metadata = { title: 'POPIA notice · HikTech' };

/**
 * The notice every person accepts when they activate their account. The
 * version accepted is recorded with the account. Changing the substance of
 * this page means a new POPIA_NOTICE_VERSION in packages/db/src/onboarding.ts.
 *
 * Drafted for review by eThekwini Municipality's Information Officer before
 * go-live.
 */
export default function PopiaNoticePage() {
  return (
    <OnboardingShell wide>
      <article className="space-y-5 text-sm leading-relaxed">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Version {POPIA_NOTICE_VERSION}</p>
          <h1 className="text-2xl font-bold">How HikTech handles personal information</h1>
          <p className="text-muted-foreground">
            A notice under the Protection of Personal Information Act, 2013 (POPIA), for everyone who uses HikTech on
            behalf of eThekwini Municipality.
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Who is responsible</h2>
          <p>
            eThekwini Municipality is the responsible party for the personal information in HikTech. Questions or
            requests go to the Municipality’s Information Officer.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">What HikTech holds</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>About you as a member of staff:</b> your name, badge or force number, rank, department, station, work contact details, your shifts and duty status, your location while you are on duty, and a record of what you do in the system.</li>
            <li><b>About members of the public:</b> what callers report, incident locations, and the details officers, firefighters, paramedics and disaster officials record while responding, which can include health information and information about children.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Why</h2>
          <p>
            To receive and dispatch emergencies, keep responders safe, keep the records the law requires, and show
            the work was done properly. Information is used only for those purposes.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Who can see it</h2>
          <p>
            Only staff whose role needs it, inside their own department unless their role covers more, and only
            within eThekwini Municipality. Every change is recorded with who made it and when. Information is not
            sold or shared outside the services that need it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">How long it is kept</h2>
          <p>
            As long as the law and the Municipality’s records policies require: for example, medical records for
            the legally required period, and location pings only for a short time. Records of decisions are kept
            permanently.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Your rights</h2>
          <p>
            You may ask what information is held about you and ask for it to be corrected. You may complain to the
            Information Regulator (South Africa).
          </p>
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-bg-soft p-4">
          <h2 className="text-base font-semibold">Terms of use</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Use HikTech only for your official duties.</li>
            <li>Keep your password to yourself. Nobody from the Municipality or HikTech will ever ask for it.</li>
            <li>Look only at the information your work needs, and never share it outside your duties.</li>
            <li>Tell your supervisor at once if you think someone else has used your account.</li>
          </ul>
        </section>
      </article>
    </OnboardingShell>
  );
}
