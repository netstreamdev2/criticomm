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

export type PersonnelChange = {
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  id: string | null;
  isOnDuty: boolean | null;
};

/**
 * Personnel changes as they happen — an officer going on or off duty, changing
 * vehicle, or sending a GPS heartbeat. Pass `userId` to watch one officer.
 * Wrap the handler in `onDutyFlip` to ignore the heartbeats.
 */
export function subscribePersonnel(
  client: CriticomClient,
  onChange: (change: PersonnelChange) => void,
  opts: { userId?: string } = {},
) {
  const filter = opts.userId ? `user_id=eq.${opts.userId}` : undefined;
  const channel = client
    .channel(uniqueTopic(`personnel:${opts.userId ?? 'all'}`))
    .on(
      'postgres_changes' as never,
      { event: '*', schema: 'public', table: 'personnel', filter },
      (payload: {
        eventType: PersonnelChange['event'];
        new: { id?: string; is_on_duty?: boolean } | null;
        old: { id?: string } | null;
      }) => onChange({
        event: payload.eventType,
        id: payload.new?.id ?? payload.old?.id ?? null,
        isOnDuty: payload.new?.is_on_duty ?? null,
      }),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

/**
 * Only pass on changes to who is on duty. Every on-duty phone sends a GPS
 * heartbeat a minute; refreshing a dashboard for each would thrash it. The
 * first update seen from an officer passes (their state is not known yet),
 * then only real on/off flips do.
 */
export function onDutyFlip(handler: () => void) {
  const known = new Map<string, boolean | null>();
  return (change: PersonnelChange) => {
    if (change.event !== 'UPDATE' || !change.id) { handler(); return; }
    const before = known.get(change.id);
    known.set(change.id, change.isOnDuty);
    if (before !== change.isOnDuty) handler();
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
