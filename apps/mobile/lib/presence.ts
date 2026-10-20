import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { RADIO_ID_PATTERN, newRadioId, reportRadioPresence, type PresenceReport } from '@criticom/api';
import { getSupabase } from './supabase';
import { readBattery } from './radio-keys';

/**
 * The radio's presence, for the Radio Desk (0087): the HikTech app standing
 * in for PocStar. Signed in or not, battery, network, the talk group it is
 * in and whether it is on the air, positions still waiting for signal, and
 * — on duty only — where it is.
 *
 * Every 30 seconds while the app is open; in the background on duty, with
 * the route recorder's fixes, at most once a minute; at once when talking
 * starts or stops. A report is "now": with no signal it is skipped, not
 * queued (the route itself is queued, lib/tracker.ts).
 *
 * The Radio ID is made once per install and kept on the phone. An
 * administrator adds it to the register to name the radio.
 *
 * No React context here: the background route task loads this too. The
 * heartbeat itself is RadioPresence (lib/route-tracker.tsx).
 */

const ID_KEY = 'criticom.radio.id.v1';
export const HEARTBEAT_MS = 30_000;
/** In the background, the route recorder wakes this at most this often. */
export const BACKGROUND_EVERY_MS = 60_000;
/** A fix worse than this says nothing useful about where the radio is. */
const ROUGHEST_M = 500;

const MODEL = Platform.OS === 'android'
  ? String((Platform.constants as { Model?: string }).Model ?? '').slice(0, 60) || null
  : Platform.OS === 'ios' ? 'iPhone' : null;
const APP_VERSION = Constants.expoConfig?.version ?? null;

/* ── The Radio ID ─────────────────────────────────────────────────────── */

let idMem: string | null = null;

export async function radioId(): Promise<string> {
  if (idMem) return idMem;
  const saved = await AsyncStorage.getItem(ID_KEY).catch(() => null);
  if (saved && RADIO_ID_PATTERN.test(saved)) {
    idMem = saved;
    return saved;
  }
  const fresh = newRadioId();
  await AsyncStorage.setItem(ID_KEY, fresh).catch(() => {});
  idMem = fresh;
  return fresh;
}

/** The Radio ID, for the screen; null for the moment it takes to read. */
export function useRadioId(): string | null {
  const [id, setId] = useState<string | null>(idMem);
  useEffect(() => {
    if (!id) void radioId().then(setId);
  }, [id]);
  return id;
}

/* ── What the rest of the app tells it ────────────────────────────────── */

let talk: { channel: string | null; talking: boolean } = { channel: null, talking: false };
let fix: { lat: number; lng: number; acc: number | null; fixAt: string } | null = null;
let queued = 0;
let signedOut = false;
/** This account is not on the staff register: it has no radio to report, until it signs in again. */
let notStaff = false;

/** The talk group the Talk screen is in, and whether it is on the air. Reported at once when it changes. */
export function setTalkPresence(next: { channel: string | null; talking: boolean }) {
  if (next.channel === talk.channel && next.talking === talk.talking) return;
  talk = next;
  void reportPresence();
}

/** The newest position from the route recorder (on duty only). */
export function notePresenceFix(p: { t: string; lat: number; lng: number; acc: number | null }) {
  if (p.acc !== null && p.acc > ROUGHEST_M) return;
  if (fix && Date.parse(fix.fixAt) >= Date.parse(p.t)) return;
  fix = { lat: p.lat, lng: p.lng, acc: p.acc, fixAt: p.t };
}

/** How many positions are on the phone waiting for signal. */
export function notePresenceQueued(n: number) {
  queued = Math.max(0, Math.round(n));
}

/* ── Reporting ────────────────────────────────────────────────────────── */

async function readNetwork(): Promise<PresenceReport['network']> {
  try {
    const n = await NetInfo.fetch();
    if (n.isConnected === false) return 'none';
    if (n.type === 'wifi') return 'wifi';
    if (n.type === 'cellular') return 'cellular';
    return n.type === 'none' ? 'none' : 'other';
  } catch {
    return null;
  }
}

let inflight: Promise<void> | null = null;
let dirty = false;
let lastSent = 0;

async function send(): Promise<void> {
  if (notStaff) return;
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  if (!data.session) return;
  const [device, network] = await Promise.all([radioId(), readNetwork()]);
  // No signal: nothing would arrive. The next report says it all.
  if (network === 'none') return;
  const battery = readBattery();
  const report: PresenceReport = {
    device,
    model: MODEL,
    app: APP_VERSION,
    battery: battery?.level ?? null,
    charging: battery?.charging ?? null,
    network,
    channel: talk.channel,
    talking: talk.talking,
    queued,
    signedIn: !signedOut,
    ...(fix ? { lat: fix.lat, lng: fix.lng, acc: fix.acc, fixAt: fix.fixAt } : {}),
  };
  try {
    await reportRadioPresence(sb, report);
  } catch (e) {
    if ((e as { code?: string }).code === 'P0001') notStaff = true;
    throw e;
  }
  lastSent = Date.now();
}

/**
 * Report now. One at a time: a change while one is on its way is sent right
 * after it. `minGapMs` skips the report when one went out that recently.
 * Never throws: a report that does not arrive is replaced by the next.
 */
export function reportPresence(opts: { minGapMs?: number } = {}): Promise<void> {
  if (opts.minGapMs && Date.now() - lastSent < opts.minGapMs) return Promise.resolve();
  if (inflight) {
    dirty = true;
    return inflight;
  }
  dirty = false;
  inflight = send()
    .catch(() => {})
    .finally(() => {
      inflight = null;
      if (dirty) void reportPresence();
    });
  return inflight;
}

/** Signing out: the radio shows as signed out at once, not after two quiet minutes. */
export async function reportSignedOut(): Promise<void> {
  signedOut = true;
  talk = { channel: null, talking: false };
  fix = null;
  if (inflight) await inflight;
  await reportPresence();
}

/** Signed in again: reports say so. */
export function presenceSignedIn() {
  signedOut = false;
  notStaff = false;
}
