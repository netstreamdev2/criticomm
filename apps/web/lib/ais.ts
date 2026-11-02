import 'server-only';
import { takeAisMessage, type AisShip } from './ais-message';

/**
 * Ships around Durban from aisstream.io (AISSTREAM_API_KEY): a live stream of
 * the ships' own AIS reports, not an answer to a question. The console keeps
 * one connection open while someone has the Ships layer on, remembers each
 * ship's latest report, and closes it ten minutes after the last look.
 *
 * aisstream allows one connection per key: the live console and a developer's
 * machine each need their own key.
 *
 * On Vercel a function is frozen between asks, so a connection cannot stay
 * open: each ask listens for a few seconds and closes again, and the ships
 * heard are kept while the function stays warm.
 */

/** Durban port, the anchorage and the coast either side. [[south, west], [north, east]]. */
const DURBAN_BOX = [[-30.15, 30.75], [-29.55, 31.4]];
const STALE_MS = 30 * 60_000;
const IDLE_MS = 10 * 60_000;
const SERVERLESS = !!process.env.VERCEL;
const LISTEN_MS = 6_000;

type State = { ws: WebSocket | null; ships: Map<string, AisShip>; lastAsked: number; retryAt: number; error: string | null; idle: ReturnType<typeof setInterval> | null };
// Kept on globalThis: the dev server reloads this file without closing the old connection.
const g = globalThis as typeof globalThis & { __criticomAis?: State };
const state: State = g.__criticomAis ??= { ws: null, ships: new Map(), lastAsked: 0, retryAt: 0, error: null, idle: null };

function connect(key: string) {
  if (state.ws || Date.now() < state.retryAt) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
  } catch (e) {
    state.error = (e as Error).message;
    state.retryAt = Date.now() + 60_000;
    return;
  }
  state.ws = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: [DURBAN_BOX], FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ShipStaticData'] }));
  };
  ws.onmessage = async (e) => {
    try {
      const raw = typeof e.data === 'string' ? e.data : await new Blob([e.data as ArrayBuffer]).text();
      const m = JSON.parse(raw) as Record<string, unknown>;
      if (typeof m.error === 'string') { state.error = m.error; ws.close(); return; }
      state.error = null;
      takeAisMessage(m, state.ships);
    } catch { /* one bad message is skipped */ }
  };
  ws.onclose = () => {
    if (state.ws === ws) state.ws = null;
    // Asked for lately: come back in half a minute; otherwise wait to be asked.
    state.retryAt = Date.now() + 30_000;
  };
  ws.onerror = () => { state.error = state.error ?? 'The ship feed could not be reached.'; };
  if (SERVERLESS) return;
  state.idle ??= setInterval(() => {
    if (Date.now() - state.lastAsked > IDLE_MS && state.ws) { state.ws.close(); state.ws = null; }
  }, 60_000);
}

/**
 * The ships seen in the last half hour. Opens the stream on the first ask
 * (ships then fill in over the next minutes: a ship at anchor reports every
 * three minutes).
 */
export async function aisShips(key: string): Promise<{ ships: AisShip[]; error: string | null; warming: boolean }> {
  state.lastAsked = Date.now();
  const fresh = !state.ws;
  if (SERVERLESS) {
    // Listen, then close before the function is frozen. Ships at anchor fill in over several asks.
    const empty = state.ships.size === 0;
    state.retryAt = 0;
    connect(key);
    const ws = state.ws as WebSocket | null;
    if (ws) {
      await new Promise((r) => setTimeout(r, LISTEN_MS));
      ws.close();
      if (state.ws === ws) state.ws = null;
    }
    const cutoff = Date.now() - STALE_MS;
    for (const [k, s] of state.ships) if (s.seen < cutoff) state.ships.delete(k);
    return { ships: [...state.ships.values()], error: state.error, warming: empty };
  }
  connect(key);
  if (fresh && state.ships.size === 0) await new Promise((r) => setTimeout(r, 4000));
  const cutoff = Date.now() - STALE_MS;
  for (const [k, s] of state.ships) if (s.seen < cutoff) state.ships.delete(k);
  return { ships: [...state.ships.values()], error: state.error, warming: fresh };
}
