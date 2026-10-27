import Link from 'next/link';
import { ClipboardList, Film } from 'lucide-react';
import { listBookedOutBodycams, type LiveBodycam } from '@criticom/api';
import { canAccess, canWatchBodycam } from '@criticom/db/roles';
import { requireFeaturePage } from '@/lib/features';
import { hikConfig, hikCredentials } from '@/lib/hikvision';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';
import { BodycamWall, type WallBodycam } from './bodycam-wall';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Body Cams · HikTech' };

/**
 * Body Cams (migration 0054): every bodycam out with an officer that this
 * person may watch, and up to four live feeds side by side. Each feed asks
 * why it is being opened and goes on the record.
 */
export default async function BodyCamsPage() {
  const { t } = await requestT();
  await requireFeaturePage('web.cameras');
  const { supabase, role, silo } = await getSession();

  let cams: LiveBodycam[] = [];
  let loadError: string | null = null;
  try {
    cams = (await listBookedOutBodycams(supabase)).filter((c) => canWatchBodycam({ role, silo }, c.bodycam.silo, 'live'));
  } catch (e) {
    loadError = invitationErrorMessage(e, 'The bodycams could not be loaded.');
  }

  const cfg = await hikConfig(supabase);
  const connected = cfg.enabled && Boolean(hikCredentials()) && Boolean(cfg.baseUrl);
  const wall: WallBodycam[] = cams.map(({ bodycam: b, holder }) => ({
    bodycamId: b.id, serial: b.serial_number, model: b.model, station: b.station, bookedAt: b.booked_at,
    hasCode: Boolean(b.hik_camera_code),
    officer: holder ? { name: holder.name, badge: holder.badge, station: holder.station, onDuty: holder.onDuty } : null,
  }));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Body Cams')}</h1>
          <p className="max-w-2xl text-muted-foreground">
            {t('Bodycams out with officers right now. Watch up to four at once; each one asks why, and the officer’s phone shows that the control room is viewing their camera.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/* Footage needs the ffmpeg box, which serverless can't run, so it's
              hidden on Vercel — live view is the serverless-ready feature. */}
          {!process.env.VERCEL && canAccess('/cameras/footage', role, silo) ? (
            <Link href="/cameras/footage" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 font-semibold hover:bg-muted">
              <Film className="h-4 w-4" /> {' '}{t('Body cam footage')}</Link>
          ) : null}
          {canAccess('/police/bodycams', role, silo) ? (
            <Link href="/police/bodycams" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 font-semibold hover:bg-muted">
              <ClipboardList className="h-4 w-4" /> {' '}{t('Bodycam register')}</Link>
          ) : null}
        </div>
      </header>

      {cfg.streamSource === 'test' ? (
        <p className="rounded-lg border border-severity-medium/50 bg-severity-medium/10 px-4 py-3 text-sm">
          <b>{t('Test video is on.')}</b> {' '}{t('Every feed shows a sample video, not the bodycam. Switch it off under Admin → Integrations → Hikvision once the platform is connected.')}</p>
      ) : !connected ? (
        <p className="rounded-lg border border-severity-medium/50 bg-severity-medium/10 px-4 py-3 text-sm">
          <b>{t('The Hikvision platform is not connected yet')}</b>{t(', so feeds cannot play. An administrator can switch on the test video under Admin → Integrations → Hikvision to demonstrate.')}</p>
      ) : null}

      {loadError ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{loadError}</p>
      ) : (
        <BodycamWall cams={wall} testVideo={cfg.streamSource === 'test'} />
      )}
    </div>
  );
}
