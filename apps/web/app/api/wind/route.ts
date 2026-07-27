import { NextResponse } from 'next/server';

/**
 * WindController.GetLatest — OpenWeatherMap proxy.
 * The API key stays server-side (OPENWEATHER_API_KEY); the client only sees data.
 * Durban coordinates by default.
 */
export const dynamic = 'force-dynamic';

const DURBAN = { lat: -29.8587, lon: 31.0218 };

export async function GET() {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) {
    return NextResponse.json(
      { configured: false, message: 'Set OPENWEATHER_API_KEY to enable live wind data.' },
      { status: 200 },
    );
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${DURBAN.lat}&lon=${DURBAN.lon}&units=metric&appid=${key}`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`OpenWeatherMap ${res.status}`);
    const data = (await res.json()) as {
      wind?: { speed?: number; deg?: number; gust?: number };
      main?: { temp?: number; humidity?: number };
      weather?: Array<{ description?: string }>;
    };
    return NextResponse.json({
      configured: true,
      windSpeedMs: data.wind?.speed ?? null,
      windDeg: data.wind?.deg ?? null,
      windGustMs: data.wind?.gust ?? null,
      tempC: data.main?.temp ?? null,
      humidity: data.main?.humidity ?? null,
      description: data.weather?.[0]?.description ?? null,
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ configured: true, error: (e as Error).message }, { status: 502 });
  }
}
