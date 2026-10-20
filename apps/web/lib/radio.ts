import 'server-only';
import {
  joinRadios, listRadioPresence, listRadioRegister, presenceRadios, radioCounts, type ProviderPicture, type RadioView,
} from '@criticom/api';
import type { CriticomClient } from '@criticom/db';

/**
 * The radio desk's picture: every radio, as the person it belongs to, with
 * how it is right now. The register and the app's reports (0087) are read
 * with the person's own session, so they hold only their department's radios
 * unless they see every department.
 *
 * PocStar is the main platform; the app on the same radio is the backup when
 * PocStar is not answering for it (chooseSource). Which one is in use stays
 * behind the scenes: the people on the desk see radios, not platforms.
 */

/** PocStar (the Constellations console): connected once its API is issued; until then, nothing from it. */
async function askPocStar(): Promise<ProviderPicture> {
  return {
    provider: 'pocstar', configured: false, ok: false, message: 'Not connected yet.', radios: [], checkedAt: new Date().toISOString(),
  };
}

/** The app on the radios: what each one reported in the last day, under the reader's own rules. */
async function askApp(supabase: CriticomClient): Promise<ProviderPicture> {
  const checkedAt = new Date().toISOString();
  try {
    const radios = presenceRadios(await listRadioPresence(supabase));
    return { provider: 'hiktech', configured: true, ok: true, message: 'Connected', radios, checkedAt };
  } catch (e) {
    // Before 0087 is run there is nothing to read: the desk shows the register alone.
    console.warn('[radio] presence not read', (e as Error).message);
    return { provider: 'hiktech', configured: true, ok: false, message: 'Not connected', radios: [], checkedAt };
  }
}

export type RadioDesk = {
  views: RadioView[];
  counts: ReturnType<typeof radioCounts>;
  at: string;
};

export async function loadRadioDesk(supabase: CriticomClient): Promise<RadioDesk> {
  const [register, pictures] = await Promise.all([
    listRadioRegister(supabase).catch(() => []),
    Promise.all([askPocStar(), askApp(supabase)]),
  ]);
  const views = joinRadios(register, pictures.flatMap((p) => p.radios));
  return { views, counts: radioCounts(views), at: new Date().toISOString() };
}
