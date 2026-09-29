import { ShareLocationClient } from './share-client';

export const metadata = { title: 'Share your location · HikTech Emergency Services' };

/**
 * Public page (no auth) — citizens land here from the SMS deep link
 * sent by dispatch (V4 CitizenController / TriggerLocationSms).
 */
export default async function ShareLocationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-card p-6 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">
          eThekwini Emergency Services
        </p>
        <h1 className="mt-3 text-2xl font-bold">Share your live location</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A dispatcher asked for your position so responders can find you faster.
          Your location is shared only with the emergency team handling your call
          and the link expires after 24 hours.
        </p>
        <div className="mt-6">
          <ShareLocationClient token={token} />
        </div>
      </div>
    </main>
  );
}
