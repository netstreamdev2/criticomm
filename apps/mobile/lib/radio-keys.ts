import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { isRadioModel } from '@criticom/api';

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

export type RadioKeyEvent = { key: 'sos' | 'ptt'; pressed: boolean; at: number; source?: 'broadcast' | 'key'; action?: string };
/** Any key press while the app is on screen, for the Buttons screen to learn from. */
export type HardwareKeyEvent = { code: number; scan: number; name: string; pressed: boolean; at: number };

const MODEL = Platform.OS === 'android' ? String((Platform.constants as { Model?: string }).Model ?? '') : '';
const KEYMAP_KEY = 'criticom.radio.keys.v1';
export type KeyMap = { ptt: number[]; sos: number[] };

/** A position read straight from the GPS, on a device without Google services. */
export type PlainFix = { lat: number; lng: number; time: number; accuracy?: number; speed?: number; heading?: number; mocked?: boolean };

type RadioKeysModule = {
  addListener(event: 'onRadioKey', listener: (e: RadioKeyEvent) => void): { remove(): void };
  addListener(event: 'onDutyTick', listener: (e: { at: number }) => void): { remove(): void };
  addListener(event: 'onDutyFix', listener: (e: PlainFix) => void): { remove(): void };
  addListener(event: 'onHardwareKey', listener: (e: HardwareKeyEvent) => void): { remove(): void };
  /** From the build of 23 October 2026: the taught buttons, opening on start-up, battery saving. */
  setKeyMap?: (ptt: number[], sos: number[]) => boolean;
  setOpenOnBoot?: (on: boolean) => boolean;
  ignoresBatterySaving?: () => boolean;
  askToIgnoreBatterySaving?: () => boolean;
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

/** A push-to-talk radio or smart hard hat (E977, E966, H1): its buttons are HikTech's. */
export const isRadioDevice = () => Platform.OS === 'android' && isRadioModel(MODEL);

/** True on a radio or hard hat whose SOS button HikTech hears, or where one was learned. */
export function hasRadioSosKey(): boolean {
  if (!native) return false;
  return isRadioDevice() || keyMap.sos.length > 0;
}

/** True in a build that hears the talk button and learns buttons. */
export const hasButtonLearning = () => Boolean(native?.setKeyMap);

/* ── The learned buttons ──────────────────────────────────────────────── */

let keyMap: KeyMap = { ptt: [], sos: [] };

/** The buttons learned on this device (the Buttons screen), handed to the build on start. */
export async function loadKeyMap(): Promise<KeyMap> {
  try {
    const raw = await AsyncStorage.getItem(KEYMAP_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<KeyMap>) : null;
    keyMap = {
      ptt: Array.isArray(parsed?.ptt) ? parsed.ptt.filter(Number.isInteger) : [],
      sos: Array.isArray(parsed?.sos) ? parsed.sos.filter(Number.isInteger) : [],
    };
  } catch { /* none learned */ }
  try { native?.setKeyMap?.(keyMap.ptt, keyMap.sos); } catch { /* an older build */ }
  return keyMap;
}

export async function saveKeyMap(next: KeyMap): Promise<void> {
  keyMap = { ptt: [...new Set(next.ptt)], sos: [...new Set(next.sos)] };
  await AsyncStorage.setItem(KEYMAP_KEY, JSON.stringify(keyMap)).catch(() => {});
  try { native?.setKeyMap?.(keyMap.ptt, keyMap.sos); } catch { /* an older build */ }
}

export const currentKeyMap = () => keyMap;

/** The talk button: pressed and let go. Does nothing where the build cannot hear it. */
export function onRadioPttKey(listener: (e: RadioKeyEvent) => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onRadioKey', (e) => { if (e.key === 'ptt') listener(e); });
  return () => sub.remove();
}

/** Every key press while the app is on screen, and every radio button heard: for the Buttons screen. */
export function onAnyButton(listener: (e: { kind: 'key'; key: HardwareKeyEvent } | { kind: 'radio'; radio: RadioKeyEvent }) => void): () => void {
  if (!native) return () => {};
  const a = native.addListener('onHardwareKey', (key) => listener({ kind: 'key', key }));
  const b = native.addListener('onRadioKey', (radio) => listener({ kind: 'radio', radio }));
  return () => { a.remove(); b.remove(); };
}

/** Open the app when this device is switched on (radios and hard hats). */
export function setOpenOnBoot(on: boolean): boolean {
  try { return Boolean(native?.setOpenOnBoot?.(on)); } catch { return false; }
}

/** Left out of battery saving; true where the build cannot tell. */
export function ignoresBatterySaving(): boolean {
  try { return native?.ignoresBatterySaving ? Boolean(native.ignoresBatterySaving()) : true; } catch { return true; }
}

/** Ask once to be left out of battery saving (the system's own question). */
export function askToIgnoreBatterySaving(): boolean {
  try { return Boolean(native?.askToIgnoreBatterySaving?.()); } catch { return false; }
}

/** Hear the SOS key; returns the way to stop. Does nothing where there is no such key. */
export function onRadioSosKey(listener: (e: RadioKeyEvent) => void): () => void {
  if (!native || !hasRadioSosKey()) return () => {};
  const sub = native.addListener('onRadioKey', (e) => { if (e.key === 'sos') listener(e); });
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

/* ── On start ─────────────────────────────────────────────────────────── */

const OPEN_ON_BOOT_KEY = 'criticom.radio.openOnBoot.v1';
const BATTERY_ASKED_KEY = 'criticom.battery.asked.v1';
const BATTERY_ASK_EVERY_MS = 7 * 24 * 3_600_000;

/** Whether this radio opens the app when switched on: yes unless turned off on its setup screen. */
export async function openOnBootChoice(): Promise<boolean> {
  const v = await AsyncStorage.getItem(OPEN_ON_BOOT_KEY).catch(() => null);
  return v !== 'off';
}

export async function chooseOpenOnBoot(on: boolean): Promise<void> {
  setOpenOnBoot(on);
  await AsyncStorage.setItem(OPEN_ON_BOOT_KEY, on ? 'on' : 'off').catch(() => {});
}

/** The app started: the taught buttons handed to the build, and a radio set to open when switched on. */
export async function initRadioButtons(): Promise<void> {
  await loadKeyMap();
  if (isRadioDevice()) setOpenOnBoot(await openOnBootChoice());
}

/**
 * Starting a shift: when battery saving may stop the app (and with it the
 * route, the camera and Talk with the screen off), the system's own question
 * is asked. At most once a week, so a "no" is not asked again every shift.
 */
export async function askBatteryAtShiftStart(): Promise<void> {
  if (ignoresBatterySaving()) return;
  const last = Number(await AsyncStorage.getItem(BATTERY_ASKED_KEY).catch(() => null)) || 0;
  if (Date.now() - last < BATTERY_ASK_EVERY_MS) return;
  await AsyncStorage.setItem(BATTERY_ASKED_KEY, String(Date.now())).catch(() => {});
  askToIgnoreBatterySaving();
}
