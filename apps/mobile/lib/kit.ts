import { bookKit, noKitRegister, type BookedKit } from '@criticom/api';
import { getSupabase } from './supabase';
import { radioId } from './presence';

/**
 * The radio or smart hard hat this app runs on books itself to whoever is on
 * duty on it (0101): no typing. A phone that is not in the register books
 * nothing. Once per person per day on this device, unless asked again.
 */
let done: string | null = null;

export async function bookThisDevice(userId: string, opts: { force?: boolean } = {}): Promise<BookedKit | null> {
  const key = `${userId}:${new Date().toDateString()}`;
  if (done === key && !opts.force) return null;
  try {
    const booked = await bookKit(getSupabase(), { deviceId: await radioId() });
    done = key;
    return booked.booked ? booked : null;
  } catch (e) {
    // Before 0101 is run there is nothing to book; anything else is tried again next time.
    if (noKitRegister(e)) done = key;
    else throw e;
    return null;
  }
}
