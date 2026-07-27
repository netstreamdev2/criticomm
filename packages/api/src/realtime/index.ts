import type { CriticomClient, Silo, Database } from '@criticom/db';

type Incident = Database['public']['Tables']['incidents']['Row'];
type IncidentUpdate = Database['public']['Tables']['incident_updates']['Row'];

/**
 * Supabase reuses a channel when two subscribers request the same topic, and
 * adding a `postgres_changes` listener to an already-subscribed channel throws
 * ("cannot add postgres_changes callbacks … after subscribe()"). Several
 * components legitimately watch the same stream (e.g. the global toaster and the
 * dispatch queue both watch `incidents:all`), so every subscription gets a unique
 * topic suffix to guarantee its own channel instance.
 */
let channelSeq = 0;
const uniqueTopic = (base: string) => `${base}:${++channelSeq}:${Math.random().toString(36).slice(2, 8)}`;

/** Subscribe to all new incidents in a silo (replaces SignalR ReceiveNewIncident). */
export function subscribeNewIncidents(
  client: CriticomClient,
  silo: Silo | 'all',
  onInsert: (incident: Incident) => void,
) {
  const filter = silo === 'all' ? undefined : `silo=eq.${silo}`;
  const channel = client
    .channel(uniqueTopic(`incidents:${silo}:inserts`))
    .on(
      'postgres_changes' as never,
      { event: 'INSERT', schema: 'public', table: 'incidents', filter },
      (payload: { new: Incident }) => onInsert(payload.new),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

/** Subscribe to status updates (replaces SignalR ReceiveIncidentUpdate). */
export function subscribeIncidentUpdates(
  client: CriticomClient,
  silo: Silo | 'all',
  onUpdate: (incident: Incident) => void,
) {
  const filter = silo === 'all' ? undefined : `silo=eq.${silo}`;
  const channel = client
    .channel(uniqueTopic(`incidents:${silo}:updates`))
    .on(
      'postgres_changes' as never,
      { event: 'UPDATE', schema: 'public', table: 'incidents', filter },
      (payload: { new: Incident }) => onUpdate(payload.new),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

/** Subscribe to a single incident's update log (for IncidentLifecycle view). */
export function subscribeIncidentTimeline(
  client: CriticomClient,
  incidentId: string,
  onAppend: (update: IncidentUpdate) => void,
) {
  const channel = client
    .channel(uniqueTopic(`incident:${incidentId}:timeline`))
    .on(
      'postgres_changes' as never,
      {
        event: 'INSERT',
        schema: 'public',
        table: 'incident_updates',
        filter: `incident_id=eq.${incidentId}`,
      },
      (payload: { new: IncidentUpdate }) => onAppend(payload.new),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

/** Dispatcher → responder ad-hoc notification (replaces SignalR ReceiveNotification). */
export async function sendNotificationToUser(
  client: CriticomClient,
  args: { userId: string; title: string; message: string; type?: 'info' | 'alert' | 'critical' },
) {
  await client.channel(`notifications:${args.userId}`).send({
    type: 'broadcast',
    event: 'notification',
    payload: { title: args.title, message: args.message, kind: args.type ?? 'info', at: Date.now() },
  });
}

export function subscribeMyNotifications(
  client: CriticomClient,
  userId: string,
  onReceive: (payload: { title: string; message: string; kind: string; at: number }) => void,
) {
  const channel = client
    .channel(`notifications:${userId}`)
    .on('broadcast' as never, { event: 'notification' }, ({ payload }: { payload: never }) =>
      onReceive(payload),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
