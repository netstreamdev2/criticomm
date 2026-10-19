import { redirect } from 'next/navigation';
import { listResponderBoard } from '@criticom/api';
import { RESPONDER_MONITOR_ACT_ROLES, RESPONDER_MONITOR_ROLES } from '@criticom/db';
import { IncidentLive } from '@/components/incident-live';
import { getSession } from '@/lib/session';
import { ResponderBoard } from './responder-board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Active Responders · HikTech' };

/**
 * The Active Responders terminal (V4 Responder → Monitor): every call with
 * crews still out, live. Read with the person's own session, so the
 * database decides which calls are on it; the Viewer watches, everyone else
 * may also talk to the crew and export the log.
 */
export default async function ResponderMonitorPage() {
  const { supabase, role } = await getSession();
  // The middleware already refuses anyone else; the page checks again.
  if (!RESPONDER_MONITOR_ROLES.includes(role)) redirect('/403');
  const entries = await listResponderBoard(supabase).catch(() => []);
  return (
    <>
      <IncidentLive />
      <ResponderBoard entries={entries} canAct={RESPONDER_MONITOR_ACT_ROLES.includes(role)} renderedAt={Date.now()} />
    </>
  );
}
