import 'server-only';
import { joinRadios, listRadioRegister, radioCounts, type ProviderPicture, type RadioView } from '@criticom/api';
import type { CriticomClient } from '@criticom/db';
import { isPttConfigured, listRealPttLive } from './realptt';

/**
 * The radio desk's picture: what each push-to-talk platform says right now,
 * joined to the register (whose radio it is). The platforms are asked at
 * most every 10 seconds, whoever is looking; the register is read with the
 * person's own session, so it holds only their department's radios unless
 * they see every department.
 */
const TTL_MS = 10_000;
let realptt: { at: number; picture: Promise<ProviderPicture> } | null = null;

async function askRealPtt(): Promise<ProviderPicture> {
  const checkedAt = new Date().toISOString();
  if (!isPttConfigured()) {
    return { provider: 'realptt', configured: false, ok: false, message: 'No RealPTT login on this server yet.', radios: [], checkedAt };
  }
  try {
    const radios = await listRealPttLive();
    const online = radios.filter((r) => r.online && !r.dispatcher).length;
    return { provider: 'realptt', configured: true, ok: true, message: `Connected · ${online} of ${radios.filter((r) => !r.dispatcher).length} online`, radios, checkedAt };
  } catch (e) {
    return { provider: 'realptt', configured: true, ok: false, message: `RealPTT did not answer: ${(e as Error).message}`, radios: [], checkedAt };
  }
}

/** PocStar (the Constellations console): connected once its API is issued; until then, honestly waiting. */
async function askPocStar(): Promise<ProviderPicture> {
  return {
    provider: 'pocstar',
    configured: false,
    ok: false,
    message: 'Waiting for PocStar’s API from Constellations. Radios in the register still show here.',
    radios: [],
    checkedAt: new Date().toISOString(),
  };
}

function cachedRealPtt() {
  if (!realptt || Date.now() - realptt.at > TTL_MS) realptt = { at: Date.now(), picture: askRealPtt() };
  return realptt.picture;
}

export type RadioDesk = {
  providers: Array<Omit<ProviderPicture, 'radios'> & { count: number }>;
  views: RadioView[];
  counts: ReturnType<typeof radioCounts>;
  at: string;
};

export async function loadRadioDesk(supabase: CriticomClient): Promise<RadioDesk> {
  const [register, pictures] = await Promise.all([
    listRadioRegister(supabase).catch(() => []),
    Promise.all([askPocStar(), cachedRealPtt()]),
  ]);
  const views = joinRadios(register, pictures.flatMap((p) => p.radios));
  return {
    providers: pictures.map(({ radios, ...p }) => ({ ...p, count: radios.length })),
    views,
    counts: radioCounts(views),
    at: new Date().toISOString(),
  };
}
