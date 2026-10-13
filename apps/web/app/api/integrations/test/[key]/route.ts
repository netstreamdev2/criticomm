import { NextResponse } from 'next/server';
import { getIntegration, recordIntegrationTest } from '@criticom/api';
import { ADMIN_ROLES } from '@criticom/db/roles';
import type { UserRole } from '@criticom/db/types';
import { hikConfig, hikCredentials, hikListCameras } from '@/lib/hikvision';
import { verifyPttLogin } from '@/lib/realptt';
import { getServerSupabase } from '@/lib/supabase';

/**
 * Live connection test for a single integration.
 *
 * Each probe is the cheapest call that proves the credential works end to end —
 * a models list, a balance check, a one-tile fetch. Nothing here mutates
 * anything on the far side. The outcome is written back to
 * `integration_settings` so the panel can show when it was last verified.
 */
export const dynamic = 'force-dynamic';

type Probe = () => Promise<{ ok: boolean; message: string }>;

const missing = (envName: string) => ({
  ok: false,
  message: `${envName} is not set on this deployment.`,
});

/** Fetch with a hard timeout so a hung endpoint can't hold the request open. */
async function ping(url: string, init?: RequestInit, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

const PROBES: Record<string, Probe> = {
  async supabase() {
    const supabase = await getServerSupabase();
    const { error } = await supabase.from('integration_settings').select('key').limit(1);
    return error
      ? { ok: false, message: error.message }
      : { ok: true, message: 'Database reachable and RLS accepted the session.' };
  },

  async grok() {
    const key = process.env.XAI_API_KEY;
    if (!key) return missing('XAI_API_KEY');
    const model = process.env.XAI_MODEL ?? 'grok-4.7';
    const res = await ping('https://api.x.ai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Key rejected by xAI — rotate it and update the env.' };
    if (!res.ok) return { ok: false, message: `xAI responded ${res.status}.` };
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const hasModel = data.data?.some((m) => m.id === model);
    return {
      ok: true,
      message: hasModel
        ? `Authenticated — model ${model} available.`
        : `Authenticated, but model "${model}" was not in the list; check XAI_MODEL.`,
    };
  },

  async groq() {
    const key = process.env.GROQ_API_KEY;
    if (!key) return missing('GROQ_API_KEY');
    const model = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';
    const res = await ping('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401) return { ok: false, message: 'Key rejected by Groq (401) — rotate it and update the env.' };
    if (!res.ok) return { ok: false, message: `Groq responded ${res.status}.` };
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const hasModel = data.data?.some((m) => m.id === model);
    return {
      ok: true,
      message: hasModel
        ? `Authenticated — model ${model} available.`
        : `Authenticated, but model "${model}" was not in the list; check GROQ_MODEL.`,
    };
  },

  async gemini() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return missing('GEMINI_API_KEY');
    const model = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
    const res = await ping(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${key}`,
    );
    if (res.ok) return { ok: true, message: `Model ${model} reachable.` };
    if (res.status === 403 || res.status === 400) {
      return { ok: false, message: 'Key rejected by Google (403/400) — check the key and its API restrictions.' };
    }
    if (res.status === 404) return { ok: false, message: `Model "${model}" not found for this key.` };
    return { ok: false, message: `Gemini responded ${res.status}.` };
  },

  async expo_push() {
    // Expo's push service needs no credential; confirm the endpoint answers.
    const res = await ping('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    });
    return res.ok
      ? { ok: true, message: 'Expo push service reachable. Devices register their own tokens on sign-in.' }
      : { ok: false, message: `Expo push responded ${res.status}.` };
  },

  async bulksms() {
    const user = process.env.BULKSMS_USERNAME;
    const pass = process.env.BULKSMS_PASSWORD;
    if (!user || !pass) return missing('BULKSMS_USERNAME / BULKSMS_PASSWORD');
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    const res = await ping('https://api.bulksms.com/v1/profile', {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return { ok: false, message: `BulkSMS responded ${res.status} — check the credentials.` };
    const profile = (await res.json()) as { credits?: { balance?: number } };
    const balance = profile.credits?.balance;
    return {
      ok: true,
      message: balance === undefined
        ? 'Authenticated with BulkSMS.'
        : `Authenticated. Credit balance: ${balance}.`,
    };
  },

  async realptt() {
    // The real V4 auth dance (random → HMAC-SHA1 → login), not a mere ping.
    return verifyPttLogin();
  },

  async zoiper() {
    // A URI-scheme handoff to the operator's own machine — nothing to reach.
    return {
      ok: true,
      message: 'Dial-out uses the tel: URI scheme. Zoiper (or any softphone registered for tel:) handles it on the operator workstation.',
    };
  },

  async tomtom() {
    const key = process.env.TOMTOM_API_KEY;
    if (!key) return missing('TOMTOM_API_KEY');
    const res = await ping(
      'https://api.tomtom.com/traffic/services/5/incidentDetails' +
      `?key=${key}&bbox=30.8,-30.1,31.2,-29.7&fields=%7Bincidents%7Btype%7D%7D&language=en-GB`,
    );
    return res.ok
      ? { ok: true, message: 'Traffic incident feed authenticated.' }
      : { ok: false, message: `TomTom responded ${res.status} — check the key.` };
  },

  async flightradar24() {
    const key = process.env.FR24_API_KEY;
    if (!key) return missing('FR24_API_KEY');
    const res = await ping('https://fr24api.flightradar24.com/api/live/flight-positions/light?bounds=-29.6,-30.1,30.8,31.2', {
      headers: { Authorization: `Bearer ${key}`, 'Accept-Version': 'v1' },
    });
    return res.ok
      ? { ok: true, message: 'Aircraft position feed authenticated.' }
      : { ok: false, message: `FlightRadar24 responded ${res.status}.` };
  },

  async ais() {
    const key = process.env.AISSTREAM_API_KEY;
    if (!key) return missing('AISSTREAM_API_KEY');
    return {
      ok: true,
      message: 'API key present. AIS streams over WebSocket; the vessel layer connects on demand.',
    };
  },

  async itraffic() {
    // The exact V4 FetchExternalCamerasAsync call. V4 shipped a literal
    // YOUR_KEY placeholder, so the real key must be issued by i-traffic/SANRAL.
    const key = process.env.ITRAFFIC_API_KEY;
    if (!key) return missing('ITRAFFIC_API_KEY');
    const res = await ping(`https://www.i-traffic.co.za/api/GetCameras?key=${key}&format=xml`);
    if (!res.ok) return { ok: false, message: `i-traffic responded ${res.status} — check the key.` };
    const xml = await res.text();
    const count = (xml.match(/<Camera>/g) ?? []).length;
    return count > 0
      ? { ok: true, message: `Feed authenticated — ${count} cameras available. Import them from SANRAL Cameras.` }
      : { ok: false, message: 'Feed answered but returned no cameras — the key may be invalid.' };
  },

  async openweather() {
    const key = process.env.OPENWEATHER_API_KEY;
    if (!key) return missing('OPENWEATHER_API_KEY');
    const res = await ping(
      `https://api.openweathermap.org/data/2.5/weather?lat=-29.8587&lon=31.0218&appid=${key}`,
    );
    return res.ok
      ? { ok: true, message: 'Weather feed authenticated for Durban.' }
      : { ok: false, message: `OpenWeather responded ${res.status}.` };
  },

  async sanral() {
    const supabase = await getServerSupabase();
    const row = await getIntegration(supabase, 'sanral').catch(() => null);
    const url = String((row?.config as Record<string, unknown> | null)?.matrix_url ?? 'https://www.i-traffic.co.za/map');
    const res = await ping(url).catch(() => null);
    return res?.ok
      ? { ok: true, message: `Matrix at ${url} reachable. Camera registry imports via /api/cameras/import.` }
      : { ok: false, message: `${url} did not respond — check the matrix_url parameter.` };
  },

  async hikvision() {
    const creds = hikCredentials();
    if (!creds) return missing('HIKVISION_APP_KEY / HIKVISION_APP_SECRET');
    const supabase = await getServerSupabase();
    const cfg = await hikConfig(supabase);
    if (!cfg.baseUrl) {
      return { ok: false, message: 'base_url is empty — set it in this integration\'s parameters (e.g. https://hcm.durban.gov.za:1443).' };
    }
    try {
      const page = await hikListCameras({ ...cfg, pageSize: 10 }, 1);
      return {
        ok: true,
        message: `Authenticated with the Hikvision platform — ${page.total} camera${page.total === 1 ? '' : 's'} (bodycams included).${cfg.streamSource === 'test' ? ' The test video is still switched on.' : ''}`,
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  async leaflet_esri() {
    const res = await ping(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/1234/1180',
    );
    return res.ok
      ? { ok: true, message: 'Esri World Imagery tiles reachable.' }
      : { ok: false, message: `Tile server responded ${res.status}.` };
  },
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = (user.app_metadata?.role ?? 'Viewer') as UserRole;
  if (!ADMIN_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { key } = await params;
  const probe = PROBES[key];
  if (!probe) return NextResponse.json({ error: `No test defined for "${key}".` }, { status: 404 });

  let result: { ok: boolean; message: string };
  try {
    result = await probe();
  } catch (e) {
    const err = e as Error;
    result = {
      ok: false,
      message: err.name === 'AbortError' ? 'Timed out after 8 seconds.' : err.message,
    };
  }

  await recordIntegrationTest(supabase, key, result).catch(() => {});
  return NextResponse.json(result);
}
