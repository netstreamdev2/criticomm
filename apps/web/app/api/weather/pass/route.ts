import { NextResponse } from 'next/server';
import { getRequestSupabase } from '@/lib/supabase';
import { issueWeatherPass, weatherPassKey } from '@/lib/weather-pass';

/**
 * A two-hour pass for weather map tiles, for the officer app's Live Map,
 * whose tiles load as plain images and cannot carry a sign-in. The caller
 * must be signed in (the middleware checks the bearer; this checks again).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const supabase = await getRequestSupabase(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.OPENWEATHER_API_KEY) {
    return NextResponse.json({ configured: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    return NextResponse.json(
      { configured: true, ...issueWeatherPass(weatherPassKey()) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'Weather passes are not set up on this server.' }, { status: 500 });
  }
}
