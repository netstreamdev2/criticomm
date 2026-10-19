import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * The push-to-talk radio's SOS key, for the SOS button (components/panic-button.tsx).
 *
 * Only on the radios we have seen send it: the Estalky E977 (and the E966 the
 * PocStar build names). Any app on a phone could send the same signal, so an
 * ordinary phone ignores it, and on a radio it opens a countdown the officer
 * can cancel rather than sending at once.
 *
 * The listener is a native module in the app build (modules/radio-keys); in
 * Expo Go, on iOS, or in an older build it is simply absent.
 */

export type RadioKeyEvent = { key: 'sos'; pressed: boolean; at: number };

const RADIO_MODELS = ['E977', 'E966'];

type RadioKeysModule = { addListener(event: 'onRadioKey', listener: (e: RadioKeyEvent) => void): { remove(): void } };
const native = Platform.OS === 'android' ? requireOptionalNativeModule<RadioKeysModule>('RadioKeys') : null;

/** True on a radio whose SOS key HikTech hears. */
export function hasRadioSosKey(): boolean {
  if (!native) return false;
  const model = String((Platform.constants as { Model?: string }).Model ?? '').toUpperCase();
  return RADIO_MODELS.some((m) => model.includes(m));
}

/** Hear the SOS key; returns the way to stop. Does nothing where there is no such key. */
export function onRadioSosKey(listener: (e: RadioKeyEvent) => void): () => void {
  if (!native || !hasRadioSosKey()) return () => {};
  const sub = native.addListener('onRadioKey', listener);
  return () => sub.remove();
}

/** Repeated presses inside this window are the same emergency. */
export const RADIO_SOS_REPEAT_MS = 60_000;
/** The officer's chance to cancel a press of the radio's key. */
export const RADIO_SOS_COUNTDOWN_S = 5;
