import 'server-only';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * RTSP → HLS relay for bodycam live view.
 *
 * The Hikvision platform serves live video over RTSP (H.264), but its own HLS
 * output is not available on this deployment, and browsers cannot play RTSP.
 * So the web server runs ffmpeg to repackage the platform's RTSP stream into
 * HLS, which hls.js plays. Because the HLS is served from our own origin, it
 * also sidesteps the mixed-content block an http:// platform stream would hit
 * on an HTTPS console.
 *
 * The video is copied, not transcoded (the stream is already H.264), so this
 * is cheap. One ffmpeg per view session; an idle session is reaped so a closed
 * tab does not keep the bodycam's mobile data flowing.
 *
 * Note: this needs a long-lived Node server and ffmpeg on the host — it does
 * not run on serverless/edge. Point BODYCAM_FFMPEG_PATH at the binary if it is
 * not on PATH.
 */

/**
 * Find the ffmpeg binary. Prefer BODYCAM_FFMPEG_PATH; otherwise try PATH, then
 * a few known install locations (a freshly winget-installed ffmpeg is not on a
 * long-running process's PATH until it restarts). Resolved once, lazily.
 */
let ffmpegPath: string | null = null;
function resolveFfmpeg(): string {
  if (ffmpegPath) return ffmpegPath;
  const env = process.env.BODYCAM_FFMPEG_PATH?.trim();
  if (env && existsSync(env)) return (ffmpegPath = env);

  const local = process.env.LOCALAPPDATA ?? '';
  const candidates: string[] = [];
  if (local) {
    candidates.push(join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
    const pkgs = join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of readdirSync(pkgs)) {
        if (!/^Gyan\.FFmpeg/i.test(d)) continue;
        const base = join(pkgs, d);
        for (const build of readdirSync(base)) {
          const bin = join(base, build, 'bin', 'ffmpeg.exe');
          if (existsSync(bin)) candidates.push(bin);
        }
      }
    } catch { /* no winget packages dir */ }
  }
  candidates.push('C:\\ffmpeg\\bin\\ffmpeg.exe', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg');

  for (const c of candidates) {
    if (existsSync(c)) return (ffmpegPath = c);
  }
  return (ffmpegPath = env || 'ffmpeg'); // last resort: let spawn try PATH
}

const IDLE_MS = 45_000; // stop ffmpeg this long after the last segment request
const READY_TIMEOUT_MS = 30_000; // the platform's RTSP session can take ~10s to open
const MAX_SESSIONS = 8; // a safety ceiling on concurrent ffmpeg processes
const FPS = 25; // force a constant frame rate; the bodycam's is variable

/**
 * The video encoder. The bodycam's RTSP stream has broken timestamps (the
 * first frame carries none), which freezes a browser at 0:00 if the stream is
 * only copied — so we re-encode, which regenerates clean timestamps. Hardware
 * encoding (Intel QuickSync here) does 1080p in realtime without loading the
 * CPU; set BODYCAM_HLS_VCODEC to 'libx264' (software) or 'h264_nvenc' etc. for
 * hosts without QuickSync.
 */
const VCODEC = process.env.BODYCAM_HLS_VCODEC?.trim() || 'h264_qsv';

/** The ffmpeg filter + encoder arguments for the configured codec. */
function videoArgs(): string[] {
  if (VCODEC === 'copy') return ['-c:v', 'copy'];
  // Constant frame rate (clean timestamps) and the encoder's pixel format.
  const fmt = VCODEC === 'h264_qsv' ? 'nv12' : 'yuv420p';
  const base = ['-vf', `fps=${FPS},format=${fmt}`, '-g', String(FPS * 2)];
  if (VCODEC === 'libx264') return [...base, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency'];
  return [...base, '-c:v', VCODEC]; // h264_qsv / h264_nvenc / h264_amf
}

type Relay = {
  sessionId: string;
  cameraCode: string;
  dir: string;
  proc: ChildProcess;
  startedAt: number;
  stderrTail: string[];
};

/**
 * A single base directory keyed by session id, so the serving route can find a
 * stream's files purely from the filesystem. In the dev server the "start" and
 * "serve" routes can run in separate module instances that do not share this
 * module's in-memory Map — the filesystem is the shared state that does work
 * across them. The Map is still kept, by whichever instance spawned ffmpeg, to
 * own the process and reap it.
 */
const BASE = join(tmpdir(), 'criticom-bodycam-hls');
try { mkdirSync(BASE, { recursive: true }); } catch { /* exists */ }

const relays = new Map<string, Relay>();

const PLAYLIST = 'index.m3u8';
const ALIVE = '.alive'; // a viewer-activity heartbeat the serving route touches
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isSafeFile = (f: string) => f === PLAYLIST || /^seg_\d{1,6}\.ts$/.test(f);

/** Last time a viewer fetched from this session, from the on-disk heartbeat. */
function lastSeen(dir: string, startedAt: number): number {
  try { return Math.max(startedAt, statSync(join(dir, ALIVE)).mtimeMs); } catch { return startedAt; }
}

// Reap this instance's own streams once a viewer has gone quiet. Runs across
// instances via the shared heartbeat file; unref'd so it never holds the process open.
function reap() {
  const now = Date.now();
  for (const [id, r] of relays) {
    if (now - lastSeen(r.dir, r.startedAt) > IDLE_MS) stopRelay(id);
  }
}
const reaper = setInterval(reap, 15_000);
reaper.unref?.();

function stopRelay(sessionId: string) {
  const r = relays.get(sessionId);
  if (!r) return;
  relays.delete(sessionId);
  try { r.proc.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(r.dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/**
 * Start an ffmpeg relay and return the same-origin HLS path the browser plays.
 *
 * 'live' pulls the bodycam's RTSP into a short rolling HLS window. 'footage'
 * pulls the platform's recorded playback HLS into a growing, seekable VOD —
 * needed because the platform only serves playback over a sustained ffmpeg
 * session, not the one-off segment fetches a stateless proxy or the browser
 * make. Rejects if ffmpeg cannot start or the first playlist never appears.
 */
export async function startRelay(
  cameraCode: string,
  inputUrl: string,
  opts: { kind?: 'live' | 'footage' } = {},
): Promise<{ sessionId: string; playlistUrl: string }> {
  reap();
  if (relays.size >= MAX_SESSIONS) {
    throw new Error('Too many bodycam views are open on this server. Close one and try again.');
  }

  const sessionId = randomUUID();
  const dir = join(BASE, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ALIVE), ''); // start the heartbeat so the reaper waits
  const playlist = join(dir, PLAYLIST);

  // Both re-encode (clean timestamps, guaranteed browser-playable H.264); the
  // bodycam has no audio, so -an. Live keeps a short rolling window; footage
  // keeps every segment so the recording can be scrubbed.
  const args = opts.kind === 'footage'
    ? [
        '-nostdin', '-loglevel', 'error',
        '-i', inputUrl,
        '-an',
        ...videoArgs(),
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_list_size', '0',
        '-hls_flags', 'append_list',
        '-hls_playlist_type', 'event',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', join(dir, 'seg_%05d.ts'),
        playlist,
      ]
    : [
        '-nostdin', '-loglevel', 'error',
        '-rtsp_transport', 'tcp',
        '-i', inputUrl,
        '-an',
        ...videoArgs(),
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '6',
        '-hls_flags', 'delete_segments+append_list+omit_endlist',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', join(dir, 'seg_%05d.ts'),
        playlist,
      ];

  let proc: ChildProcess;
  try {
    proc = spawn(resolveFfmpeg(), args, { windowsHide: true });
  } catch (e) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    throw new Error(`Could not start ffmpeg (${(e as Error).message}). Install ffmpeg or set BODYCAM_FFMPEG_PATH.`);
  }

  const relay: Relay = { sessionId, cameraCode, dir, proc, startedAt: Date.now(), stderrTail: [] };
  relays.set(sessionId, relay);

  proc.stderr?.on('data', (b: Buffer) => {
    relay.stderrTail.push(b.toString());
    if (relay.stderrTail.length > 20) relay.stderrTail.shift();
  });
  let exited = false;
  proc.on('error', (e) => { relay.stderrTail.push(String(e)); });
  proc.on('exit', () => { exited = true; });

  // Wait for ffmpeg to write the first playlist.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    try {
      const s = await stat(playlist);
      if (s.size > 0) break;
    } catch { /* not yet */ }
    if (exited) {
      const why = relay.stderrTail.join('').trim().split('\n').pop() || 'ffmpeg stopped before producing video.';
      stopRelay(sessionId);
      throw new Error(`The live stream could not be started: ${why}`);
    }
    if (Date.now() > deadline) {
      stopRelay(sessionId);
      throw new Error('The live stream did not start in time. The bodycam may be offline or not recording.');
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  return { sessionId, playlistUrl: `/api/bodycams/hls/${sessionId}/${PLAYLIST}` };
}

/**
 * Resolve a session's file for the serving route, or null if unknown/unsafe.
 * Filesystem-based: it does not depend on this module instance holding the
 * session in memory, so it works even when Next serves this route from a
 * different instance than the one that started the stream.
 */
export function relayFile(sessionId: string, file: string): { path: string; contentType: string } | null {
  if (!UUID_RE.test(sessionId) || !isSafeFile(file)) return null;
  const dir = join(BASE, sessionId);
  if (!existsSync(dir)) return null; // unknown or already-reaped session
  // Path-traversal guard (isSafeFile already constrains the name to no slashes).
  const path = resolve(dir, file);
  if (!path.startsWith(resolve(dir) + sep)) return null;
  try { writeFileSync(join(dir, ALIVE), ''); } catch { /* heartbeat is best-effort */ }
  return {
    path,
    contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
  };
}
