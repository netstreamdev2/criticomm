import { useSyncExternalStore } from 'react';
import { PermissionsAndroid, Platform, Vibration } from 'react-native';
import type { Room as LiveKitRoom } from 'livekit-client';
import { isRadioModel, myRadioCamera, radioCameraPass } from '@criticom/api';
import { getSupabase } from './supabase';
import { radioId } from './presence';
import { liveKitNative } from './talk-native';
import { tNow } from './translator';
import { hasCameraStandby, hasGoogleServices, startCameraStandby, stopCameraStandby } from './radio-keys';

/**
 * The radio's camera for the control room (0091).
 *
 * While on duty the radio asks every few seconds whether the control room has
 * opened its camera: from the open app, and with the screen off from the
 * route recorder's fixes (lib/tracker.ts). When it has, the officer is told
 * first, every time: a long buzz, one notification sound and a notification
 * that stays while the camera is live, and the red pill on screen. Then the
 * back camera and the microphone go live to the control room over the voice
 * server, as Talk does. Nothing is recorded. When the view is closed (or after
 * ten minutes) the camera stops, with one short buzz.
 *
 * Only on the push-to-talk radios and the smart hard hats (the E977, E966
 * and H1): an ordinary phone is never opened this way.
 */

const POLL_MS = 8_000;
const CHANNEL = 'radio-camera';
/** Three long pulses: hard to miss in a pocket or a holster. */
const BUZZ = [0, 900, 350, 900, 350, 900];

const MODEL = Platform.OS === 'android' ? String((Platform.constants as { Model?: string }).Model ?? '') : '';
/** This device is a radio the control room may open the camera of. */
export const isCameraRadio = () => Platform.OS === 'android' && isRadioModel(MODEL);

/* ── Live state, for the pill on screen ───────────────────────────────── */

let live = false;
const listeners = new Set<() => void>();
function setLive(next: boolean) {
  if (live === next) return;
  live = next;
  for (const l of listeners) l();
}
export function useRadioCameraLive(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => live);
}

/* ── Permissions and the standby ──────────────────────────────────────── */

/** Camera and microphone, asked once; true when both are allowed. */
export async function askCameraPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const want = [PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    const got = await PermissionsAndroid.requestMultiple(want);
    return want.every((p) => got[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

/**
 * On duty with the app on screen: start the camera's standby, so the camera
 * may open later with the screen off. Off duty: stop it, and any live view.
 */
export async function cameraStandby(onDuty: boolean): Promise<void> {
  if (!isCameraRadio() || !hasCameraStandby()) return;
  if (!onDuty) {
    stopCameraStandby();
    await stopCamera();
    return;
  }
  if (!(await askCameraPermissions())) return;
  // Without Google services (the H1 hard hat) the standby also reads the GPS and keeps the device awake.
  startCameraStandby(tNow('On duty'), tNow('Camera ready for the control room'), tNow('Camera standby'), !hasGoogleServices());
}

/* ── The officer is told ──────────────────────────────────────────────── */

type Notifications = typeof import('expo-notifications');
let notifications: Notifications | null | undefined;
function N(): Notifications | null {
  if (notifications !== undefined) return notifications;
  try {
    notifications = require('expo-notifications') as Notifications;
  } catch {
    notifications = null;
  }
  return notifications;
}

const told = new Set<string>();

async function tellOfficer(viewId: string) {
  if (told.has(viewId)) return;
  told.add(viewId);
  Vibration.vibrate(BUZZ);
  const n = N();
  if (!n) return;
  try {
    await n.setNotificationChannelAsync(CHANNEL, {
      name: tNow('Camera opened by the control room'),
      importance: n.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: BUZZ,
      enableVibrate: true,
      lockscreenVisibility: n.AndroidNotificationVisibility.PUBLIC,
    });
    await n.scheduleNotificationAsync({
      identifier: `camera-${viewId}`,
      content: {
        title: tNow('Control room is viewing your camera'),
        body: tNow('Your camera and microphone are live.'),
        sound: 'default',
        sticky: true,
        priority: n.AndroidNotificationPriority.MAX,
      },
      trigger: { channelId: CHANNEL },
    });
  } catch { /* the buzz and the pill still tell them */ }
}

async function untellOfficer(viewId: string) {
  Vibration.vibrate(250);
  try { await N()?.dismissNotificationAsync(`camera-${viewId}`); } catch { /* already gone */ }
}

/* ── Live ─────────────────────────────────────────────────────────────── */

let current: { viewId: string; room: LiveKitRoom | null } | null = null;

async function startCamera(viewId: string) {
  await stopCamera();
  current = { viewId, room: null };
  setLive(true);
  await tellOfficer(viewId);
  try {
    if (!liveKitNative()) throw new Error('This build cannot send video');
    // After liveKitNative(): its stand-ins must be in place before LiveKit loads.
    const { Room, RoomEvent } = require('livekit-client') as typeof import('livekit-client');
    const pass = await radioCameraPass(getSupabase(), viewId);
    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      videoCaptureDefaults: { facingMode: 'environment', resolution: { width: 1280, height: 720, frameRate: 24 } },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (current?.viewId !== viewId) return;
    current.room = room;
    room.on(RoomEvent.Disconnected, () => {
      // Dropped: the next check opens it again while the view is still open (told only once).
      if (current?.room === room) current = null;
    });
    await room.connect(pass.url, pass.token, { autoSubscribe: false });
    if (current?.viewId !== viewId) { await room.disconnect(); return; }
    // The back camera; a hard hat with only one camera uses that one.
    await room.localParticipant.setCameraEnabled(true, { facingMode: 'environment' })
      .catch(() => room.localParticipant.setCameraEnabled(true));
    await room.localParticipant.setMicrophoneEnabled(true).catch((e: Error) => console.warn('[criticom] camera: no microphone', e.message));
    console.log('[criticom] camera live for the control room');
  } catch (e) {
    console.warn('[criticom] camera did not start', (e as Error).message);
    const room = current?.room;
    current = null;
    await room?.disconnect().catch(() => {});
  }
}

async function stopCamera() {
  const was = current;
  current = null;
  if (!was) return;
  setLive(false);
  await was.room?.disconnect().catch(() => {});
  await untellOfficer(was.viewId);
}

/* ── Asking ───────────────────────────────────────────────────────────── */

let lastAsked = 0;
let asking = false;

/**
 * Has the control room opened this radio's camera? Safe to call often: once
 * every few seconds at most. With no signal it says nothing and asks again.
 */
export async function checkCamera(): Promise<void> {
  if (!isCameraRadio() || asking || Date.now() - lastAsked < POLL_MS) return;
  asking = true;
  lastAsked = Date.now();
  try {
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    if (!data.session) { await stopCamera(); return; }
    const view = await myRadioCamera(sb, await radioId());
    if (view && view.id !== current?.viewId) await startCamera(view.id);
    else if (!view && current) await stopCamera();
  } catch {
    // No signal, or 0091 not run: ask again next time.
  } finally {
    asking = false;
  }
}

/** Signing out: the camera stops and its standby with it. */
export async function stopCameraForSignOut(): Promise<void> {
  stopCameraStandby();
  await stopCamera();
}
