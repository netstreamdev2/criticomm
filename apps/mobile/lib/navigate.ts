import { Linking, Platform } from 'react-native';
import { getIncident } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';

/**
 * Navigate: hand the scene to the phone's own map app for turn-by-turn
 * directions — coordinates when the call has them, the address otherwise.
 * Used by the incident screens, the new-incident alert and the notification.
 */

type Place = { location_lat?: number | null; location_lng?: number | null; location_address?: string | null };

/** Open directions to a place. False when the incident has no location at all. */
export function openDirections(place: Place): boolean {
  const { location_lat: lat, location_lng: lng, location_address: address } = place;
  const query = lat && lng ? `${lat},${lng}` : address;
  if (!query) return false;
  const url = Platform.select({
    ios: `maps://?daddr=${encodeURIComponent(query)}`,
    default: `geo:0,0?q=${encodeURIComponent(query)}`,
  });
  void Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`));
  return true;
}

/**
 * Directions to an incident known only by its id (an alert, a notification).
 * False when it cannot be read (no signal, no access) or has no location —
 * the caller then opens the incident instead.
 */
export async function navigateToIncident(incidentId: string): Promise<boolean> {
  const incident = await getIncident(getSupabase(), incidentId).catch(() => null);
  return incident ? openDirections(incident) : false;
}
