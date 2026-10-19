import { canAccess } from '@criticom/db';
import { requireFeaturePage } from '@/lib/features';
import { loadRadioDesk } from '@/lib/radio';
import { talkChannelsFor } from '@/lib/talk';
import { getSession } from '@/lib/session';
import { RadioDesk } from './radio-desk';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Radio Desk · HikTech' };

/**
 * The radio desk: every push-to-talk radio and smart hard hat, as the
 * person it belongs to, with what its platform says right now. Messages and
 * recordings for a radio are one click away.
 */
export default async function RadioDeskPage() {
  await requireFeaturePage('web.ptt');
  const { supabase, role, silo } = await getSession();
  const [desk, talk] = await Promise.all([loadRadioDesk(supabase), talkChannelsFor(supabase, { role, silo })]);
  return <RadioDesk initial={desk} talk={talk} canManage={canAccess('/admin/radios', role, silo)} />;
}
