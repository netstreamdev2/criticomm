import { PermissionsAndroid, Platform } from 'react-native';

/**
 * HikTech Talk's native half: LiveKit's WebRTC for the app. It is in the app
 * build from 1.3 (the EAS build with @livekit/react-native); in Expo Go or an
 * older build it is missing, and Talk says so instead of crashing.
 */

type LiveKitNative = {
  registerGlobals: () => void;
  AudioSession: {
    configureAudio: (c: unknown) => Promise<void>;
    startAudioSession: () => Promise<void>;
    stopAudioSession: () => Promise<void>;
  };
  AndroidAudioTypePresets: { communication: Record<string, unknown> };
};

let native: LiveKitNative | null | undefined;

/** LiveKit's native module, set up once; null when this build does not have it. */
export function liveKitNative(): LiveKitNative | null {
  if (native !== undefined) return native;
  // Hermes has no DOMException, and LiveKit's client builds a class on it the
  // moment it loads. A plain stand-in, before anything of LiveKit's loads; a
  // failed load in a release build stops the app, so this must come first.
  const g = globalThis as { DOMException?: unknown };
  if (typeof g.DOMException === 'undefined') {
    g.DOMException = class DOMException extends Error {
      readonly code = 0;
      constructor(message = '', name = 'Error') {
        super(message);
        this.name = name;
      }
    };
  }
  try {
    const lk = require('@livekit/react-native') as LiveKitNative;
    lk.registerGlobals();
    native = lk;
  } catch {
    native = null;
  }
  return native;
}

/** Talk plays through the loudspeaker, like a radio, with the phone's echo cancelling. */
export async function startTalkAudio(): Promise<void> {
  const lk = liveKitNative();
  if (!lk) return;
  await lk.AudioSession.configureAudio({
    android: {
      preferredOutputList: ['bluetooth', 'headset', 'speaker'],
      audioTypeOptions: lk.AndroidAudioTypePresets.communication,
    },
    ios: { defaultOutput: 'speaker' },
  });
  await lk.AudioSession.startAudioSession();
}

export async function stopTalkAudio(): Promise<void> {
  await liveKitNative()?.AudioSession.stopAudioSession().catch(() => {});
}

/** The microphone, asked for once; false when refused. */
export async function askMicrophone(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const mic = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (!mic) return true;
  const r = await PermissionsAndroid.request(mic);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}
