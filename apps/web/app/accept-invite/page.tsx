import { cookies } from 'next/headers';
import { CheckCircle2, Mail, ShieldCheck } from 'lucide-react';
import { getVerifiedInvitation } from '@/lib/invitations/server';
import { INVITATION_COOKIE } from '@/lib/invitations/receipt';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create your account · HikTech', robots: { index: false, follow: false } };

export default async function AcceptInvitePage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  let invitation: Awaited<ReturnType<typeof getVerifiedInvitation>> = null;
  let unavailable = error === 'unavailable';
  if (!error) {
    try { invitation = await getVerifiedInvitation((await cookies()).get(INVITATION_COOKIE)?.value); }
    catch { unavailable = true; }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-bg-card p-8 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">HikTech</p>
        <h1 className="mt-3 text-3xl font-bold">Create your account</h1>
        {invitation ? (
          <div className="mt-6 space-y-5">
            <p className="flex items-center gap-2 text-sm text-severity-low-ink"><CheckCircle2 className="size-5" aria-hidden="true" />Invitation verified</p>
            <p className="text-sm text-muted-foreground">Welcome, {invitation.name}. You have been invited to manage {invitation.tenantName}.</p>
            <div>
              <label htmlFor="invited-email" className="flex items-center gap-2 text-sm font-medium"><Mail className="size-4" aria-hidden="true" />Invited email</label>
              <input id="invited-email" type="email" value={invitation.email} readOnly aria-describedby="email-help"
                className="mt-2 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-sm" />
              <p id="email-help" className="mt-2 text-xs text-muted-foreground">This is the email address invited by your administrator.</p>
            </div>
            <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4 text-sm">
              <div><dt className="text-muted-foreground">Organisation</dt><dd className="mt-1 font-medium">{invitation.tenantName}</dd></div>
              <div><dt className="text-muted-foreground">Invited role</dt><dd className="mt-1 flex items-center gap-1 font-medium"><ShieldCheck className="size-4" aria-hidden="true" />SystemAdmin</dd></div>
            </dl>
            <p className="rounded-lg bg-bg-soft p-4 text-sm text-muted-foreground">Your invitation is confirmed. Account setup is pending.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-3" role="alert">
            <h2 className="font-semibold">{unavailable ? 'Unable to check your invitation' : error ? 'Invitation link unavailable' : 'Open your invitation email'}</h2>
            <p className="text-sm text-muted-foreground">
              {unavailable ? 'Please try again shortly. If this continues, contact your administrator.'
                : error ? 'This link may be invalid, expired, or already used. Ask your administrator to check the invitation.'
                  : 'Use the link in your HikTech invitation to confirm your email address. This page is available only with a verified invitation.'}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
