import Link from 'next/link';
import { ArrowLeft, Video } from 'lucide-react';
import { getIncident, listIncidentResponders, searchBodycamBookings, type BodycamBooking } from '@criticom/api';
import { canAccess, canWatchBodycam } from '@criticom/db/roles';
import { windowFor } from '@criticom/db/bodycams';
import { requireFeaturePage } from '@/lib/features';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';
import { FootageBrowser, type FootageBooking } from './footage-browser';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Body Cam Footage · HikTech' };

const HOUR = 3_600_000;
const validIso = (v: string | undefined) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null);

/**
 * Body Cam Footage (migration 0054): find recorded video by who had which
 * bodycam and when — for an incident, an officer, or a stretch of time — and
 * play it here. Each playback asks why and goes on the record.
 */
export default async function BodyCamFootagePage({ searchParams }: {
  searchParams: Promise<{ incident?: string; officer?: string; from?: string; to?: string }>;
}) {
  const { t } = await requestT();
  await requireFeaturePage('web.cameras');
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  const now = new Date();

  let incident: { id: string; number: string } | null = null;
  let window = { from: new Date(now.getTime() - 12 * HOUR).toISOString(), to: now.toISOString() };
  let userIds: string[] | undefined;
  let capped = false;

  if (params.incident) {
    const inc = await getIncident(supabase, params.incident).catch(() => null);
    if (inc) {
      incident = { id: inc.id, number: inc.incident_number };
      const w = windowFor(inc.incident_created_at, inc.closed_at ?? inc.resolved_at ?? null, now);
      window = { from: w.from, to: w.to };
      capped = w.capped;
      const responders = await listIncidentResponders(supabase, inc.id).catch(() => []);
      userIds = [...new Set([...responders.map((r) => r.user_id), ...(inc.assigned_to ? [inc.assigned_to] : [])])];
    }
  } else {
    const from = validIso(params.from);
    const to = validIso(params.to);
    if (from && to && to > from) {
      const w = windowFor(from, to, now);
      window = { from: w.from, to: w.to };
      capped = w.capped;
    }
    if (params.officer) userIds = [params.officer];
  }

  let bookings: BodycamBooking[] = [];
  let loadError: string | null = null;
  try {
    bookings = (await searchBodycamBookings(supabase, { from: window.from, to: window.to, userIds }))
      .filter((b) => canWatchBodycam({ role, silo }, b.silo, 'footage'));
  } catch (e) {
    loadError = invitationErrorMessage(e, 'The bodycam bookings could not be loaded.');
  }

  const rows: FootageBooking[] = bookings.map((b) => ({
    id: b.id, bodycamId: b.bodycam_id, serial: b.serial_number, officer: b.user_name, officerId: b.user_id,
    bookedAt: b.booked_at, returnedAt: b.returned_at,
  }));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {incident ? (
            <Link href={`/incidents/${incident.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg">
              <ArrowLeft className="h-4 w-4" /> {incident.number}
            </Link>
          ) : null}
          <h1 className="text-2xl font-bold">{t('Body Cam Footage{value}', { value: incident ? ` · ${incident.number}` : '' })}</h1>
          <p className="max-w-2xl text-muted-foreground">
            {t('Recorded video, found by who had which bodycam and when. Choose a booking to play the part of it inside the window, up to 24 hours. Every playback is recorded with your name and reason.')}</p>
        </div>
        {canAccess('/cameras', role, silo) ? (
          <Link href="/cameras" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
            <Video className="h-4 w-4" /> {' '}{t('Body cams live')}</Link>
        ) : null}
      </header>

      {loadError ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{loadError}</p>
      ) : (
        <FootageBrowser
          bookings={rows}
          window={window}
          capped={capped}
          incident={incident}
          officerId={incident ? null : params.officer ?? null}
        />
      )}
    </div>
  );
}
