import * as Location from 'expo-location';

export type Here = { lat: number; lng: number; accuracy: number | null };

/**
 * Where the phone is now, kept with a record filed on site (an inspection, an
 * assessment): a fresh fix if it comes within a few seconds, else the last
 * known one from the past ten minutes. Null without permission, with no fix,
 * or when a location-faking app gave it (those count for nothing, 0100).
 * Never throws: the record files without a position rather than not at all.
 */
export async function hereNow(timeoutMs = 8000): Promise<Here | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) {
      const asked = await Location.requestForegroundPermissionsAsync();
      if (!asked.granted) return null;
    }
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    const pos = fresh ?? (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null));
    if (!pos || pos.mocked) return null;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
  } catch {
    return null;
  }
}
