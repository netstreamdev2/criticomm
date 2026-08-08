import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { requireFeaturePage } from '@/lib/features';
import { FootageFinder } from './footage-finder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'CCTV Footage · Criticom' };

export default async function FootagePage() {
  await requireFeaturePage('web.cameras');
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">CCTV footage</h1>
        <p className="text-muted-foreground">
          Pull recorded video for a camera and time window straight from HikCentral.
          Every retrieval is audit-logged for chain of custody.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>How retrieval works</CardTitle>
          <CardDescription>
            Pick a camera and a window (up to 24 hours) — the platform issues a playback URL
            for the central recorder. HLS plays in a browser tab; RTSP paste into VLC or the
            investigation workstation. Longer exports go through the NVR itself.
          </CardDescription>
        </CardHeader>
      </Card>

      <FootageFinder />
    </div>
  );
}
