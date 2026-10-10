import type { CriticomClient } from '@criticom/db';

type Channel = ReturnType<CriticomClient['channel']>;

/**
 * Join a live channel as the signed-in user, never as an anonymous visitor.
 *
 * A channel that joins before the session's token has reached the live
 * connection joins with the public key alone, and the database judges every
 * change it receives as if nobody had signed in (0069). The token is set
 * first, then the channel joins; a channel removed meanwhile never joins.
 */
export function subscribeSignedIn(
  client: CriticomClient,
  channel: Channel,
  onStatus?: (status: string) => void,
): Channel {
  void Promise.resolve()
    .then(() => client.realtime.setAuth())
    .catch(() => { /* signed out or offline: the channel still joins, and sees only what that allows */ })
    .then(() => {
      if (!client.getChannels().includes(channel)) return;
      if (onStatus) channel.subscribe((status: string) => onStatus(status));
      else channel.subscribe();
    });
  return channel;
}
