import { useSyncExternalStore } from 'react';
import { Vibration } from 'react-native';
import { hardHatButton } from '@criticom/api';
import { getSupabase } from './supabase';
import { radioId } from './presence';
import { isHardHatDevice, onRadioCameraKey, onRadioPttKey, say } from './radio-keys';
import { tNow } from './translator';

/**
 * The hard hat's side of pairing (0105). Any press of its buttons tells the
 * server; when an officer's radio is waiting ("Press any button on your hard
 * hat"), the hard hat is booked to them, buzzes, says so out loud and shows
 * it on its small screen. Otherwise a press is just a press.
 */

let shown: { text: string; at: number } | null = null;
const listeners = new Set<() => void>();
function show(text: string) {
  shown = { text, at: Date.now() };
  for (const l of listeners) l();
  setTimeout(() => {
    if (shown && Date.now() - shown.at >= 9_000) { shown = null; for (const l of listeners) l(); }
  }, 10_000);
}

/** What the hard hat's screen says after a pairing, for a few seconds. */
export function useHatPairedNote(): string | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => shown?.text ?? null);
}

let lastAsked = 0;
async function pressed() {
  // One question for a burst of presses.
  if (Date.now() - lastAsked < 2_500) return;
  lastAsked = Date.now();
  try {
    const r = await hardHatButton(getSupabase(), await radioId());
    if (r.paired) {
      Vibration.vibrate([0, 150, 120, 150, 120, 600]);
      const text = tNow('Paired to {name}', { name: r.name ?? '' });
      show(`${text} · ${r.asset_no ?? ''}`);
      say(text);
    } else if (r.clash) {
      Vibration.vibrate([0, 400, 200, 400]);
      show(tNow('Two officers at once. Press again, one at a time.'));
      say(tNow('Two officers at once. Press again, one at a time.'));
    }
  } catch { /* no signal or before 0105: a press is just a press */ }
}

/** On a hard hat, signed in: its talk and camera buttons can pair it. Returns the way to stop. */
export function startHatPairing(): () => void {
  if (!isHardHatDevice()) return () => {};
  const a = onRadioPttKey((e) => { if (e.pressed) void pressed(); });
  const b = onRadioCameraKey(() => { void pressed(); });
  return () => { a(); b(); };
}
