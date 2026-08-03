import fs from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * `app.json` holds everything static. This file adds the one thing that cannot
 * be static: whether the build is wired for Firebase Cloud Messaging.
 *
 * Android remote push does not work without an FCM registration — the phone has
 * no other way to be woken. Historically this app shipped `expo-notifications`
 * without `google-services.json`, and the result was an app that failed at
 * launch: the worst possible outcome, because a responder with no app is worse
 * off than a responder with no push. The fix is to make it a build-time
 * contract instead of a runtime surprise:
 *
 *   • File present  → FCM wired in, `extra.pushChannel = 'fcm'`, push works.
 *   • File absent    → an Android build stops here with an actionable message,
 *     unless `CRITICOM_ALLOW_NO_PUSH=1` says the operator knowingly wants a
 *     realtime-only build (useful for internal previews).
 *
 * iOS needs no equivalent file: APNs credentials are held by EAS against the
 * bundle identifier, so an iOS build is always push-capable.
 *
 * Supply the file on EAS as a secret file and point `GOOGLE_SERVICES_JSON` at
 * it (EAS sets that to an absolute path at build time):
 *
 *   eas secret:create --scope project --name GOOGLE_SERVICES_JSON \
 *     --type file --value ./google-services.json
 */

const ALLOW_NO_PUSH = process.env.CRITICOM_ALLOW_NO_PUSH === '1';

/** Absolute path to google-services.json, or null when it is not available. */
function resolveGoogleServices(): string | null {
  const candidates = [
    process.env.GOOGLE_SERVICES_JSON,
    './google-services.json',
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    const abs = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(__dirname, candidate);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

/**
 * True when this invocation is actually producing an Android binary, as opposed
 * to any of the many other reasons the config gets evaluated (`expo start`,
 * `eas build` on iOS, prebuild inspection, `expo config` in CI, the Metro
 * bundler resolving `extra`). Blocking those would make the repo unusable
 * without an FCM file, which is not the intent — the gate is on shipping an
 * Android app that silently cannot receive a dispatch.
 */
function isAndroidBinaryBuild(): boolean {
  if (process.env.EAS_BUILD_PLATFORM === 'android') return true;
  const argv = process.argv.join(' ');
  return /\b(run:android|build:android)\b/.test(argv);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServices = resolveGoogleServices();

  if (!googleServices && isAndroidBinaryBuild() && !ALLOW_NO_PUSH) {
    throw new Error(
      [
        'google-services.json is missing, so this Android build could not receive dispatches.',
        '',
        'Fix it one of two ways:',
        '  1. Provide the Firebase config — download google-services.json from the',
        '     Firebase console for package za.co.ethekwini.criticom, then either drop it',
        '     in apps/mobile/ or set GOOGLE_SERVICES_JSON to its path. On EAS:',
        '       eas secret:create --scope project --name GOOGLE_SERVICES_JSON \\',
        '         --type file --value ./google-services.json',
        '  2. Build without push deliberately — set CRITICOM_ALLOW_NO_PUSH=1. Alerts then',
        '     arrive only while the app is open, over the realtime channel. Acceptable for',
        '     an internal preview; not for a crew carrying the phone on shift.',
      ].join('\n'),
    );
  }

  const base = config as Partial<ExpoConfig>;

  return {
    ...(base as ExpoConfig),
    name: base.name ?? 'Criticom Responder',
    slug: base.slug ?? 'criticom-responder',
    android: {
      ...base.android,
      ...(googleServices ? { googleServicesFile: googleServices } : {}),
    },
    plugins: [
      ...(base.plugins ?? []),
      [
        'expo-notifications',
        {
          color: '#dc3545',
          // Channels are created from JS (lib/push.ts) so their importance and
          // DnD-bypass stay next to the code that depends on them.
          enableBackgroundRemoteNotifications: true,
        },
      ],
    ],
    extra: {
      ...base.extra,
      /** Read by lib/push.ts to explain, on the profile screen, why push is off. */
      pushChannel: googleServices ? 'fcm' : 'none',
    },
  };
};
