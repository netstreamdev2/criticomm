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

/** A position read straight from the GPS, on a device without Google services. */
export type PlainFix = { lat: number; lng: number; time: number; accuracy?: number; speed?: number; heading?: number };

type RadioKeysModule = {
  addListener(event: 'onRadioKey', listener: (e: RadioKeyEvent) => void): { remove(): void };
  addListener(event: 'onDutyTick', listener: (e: { at: number }) => void): { remove(): void };
  addListener(event: 'onDutyFix', listener: (e: PlainFix) => void): { remove(): void };
  /** From the build after 1.3.0; older builds do not have it. */
  battery?: () => { level: number; charging: boolean } | null;
  /** The camera's standby while on duty (0091); from the build after that. */
  startDutyMedia?: (title: string, text: string, channel: string) => boolean;
  stopDutyMedia?: () => boolean;
  /** From the build after that: with plain GPS and a wake-up, for devices without Google services. */
  startDutyStandby?: (title: string, text: string, channel: string, plainGps: boolean) => boolean;
  hasGoogleServices?: () => boolean;
};
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

/**
 * The battery, from the system's last report: level 0-100 and whether it is
 * charging. Null in a build without it (1.3.0 and older), on iOS, or in Expo Go.
 */
export function readBattery(): { level: number | null; charging: boolean | null } | null {
  try {
    const b = native?.battery?.();
    if (!b) return null;
    return { level: b.level >= 0 && b.level <= 100 ? b.level : null, charging: typeof b.charging === 'boolean' ? b.charging : null };
  } catch {
    return null;
  }
}

/**
 * The camera's standby while on duty (0091): lets the control room open the
 * radio's camera with the screen off. Start it only with the app on screen.
 * False in a build without it, on iOS, or when Android refused.
 */
export function startCameraStandby(title: string, text: string, channel: string, plainGps = false): boolean {
  try {
    if (native?.startDutyStandby) return Boolean(native.startDutyStandby(title, text, channel, plainGps));
    return Boolean(native?.startDutyMedia?.(title, text, channel));
  } catch {
    return false;
  }
}

/** Google services on this device (the usual location works). True when the build cannot tell. */
export function hasGoogleServices(): boolean {
  try {
    return native?.hasGoogleServices ? Boolean(native.hasGoogleServices()) : true;
  } catch {
    return true;
  }
}

/** The standby's wake-up, every few seconds while on duty, screen off included. */
export function onDutyTick(listener: () => void): () => void {
  if (!native?.startDutyStandby) return () => {};
  const sub = native.addListener('onDutyTick', () => listener());
  return () => sub.remove();
}

/** Positions from the GPS itself, on a device without Google services. */
export function onDutyFix(listener: (fix: PlainFix) => void): () => void {
  if (!native?.startDutyStandby) return () => {};
  const sub = native.addListener('onDutyFix', listener);
  return () => sub.remove();
}

export function stopCameraStandby(): void {
  try {
    native?.stopDutyMedia?.();
  } catch { /* not running */ }
}

/** True in a build that has the camera standby. */
export const hasCameraStandby = () => Boolean(native?.startDutyMedia);
