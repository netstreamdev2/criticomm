import 'server-only';
import { getTalkServerStatus, listTalkChannels, talkChannelsToOffer, incidentChannel, type TalkChannel } from '@criticom/api';
import { GLOBAL_ROLES, type CriticomClient, type Silo, type UserRole } from '@criticom/db';

/**
 * The talk groups a console page offers this person: the database answers
 * for each (talk_access, 0083). Empty when Talk is not installed or no
 * voice server is set, with the reason for the page to show.
 */
export async function talkChannelsFor(
  supabase: CriticomClient,
  me: { role: UserRole; silo: Silo },
  extra: { incidentId?: string } = {},
): Promise<{ channels: TalkChannel[]; setUp: boolean; installed: boolean }> {
  const status = await getTalkServerStatus(supabase);
  if (!status) return { channels: [], setUp: false, installed: false };
  if (!status.configured) return { channels: [], setUp: false, installed: true };
  const wanted = extra.incidentId
    ? [incidentChannel(extra.incidentId)]
    : talkChannelsToOffer({ silo: me.silo, seesAll: GLOBAL_ROLES.includes(me.role) });
  return { channels: await listTalkChannels(supabase, wanted), setUp: true, installed: true };
}
