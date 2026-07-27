import type { Metadata } from 'next';
import { getIncidentCategoryTree } from '@criticom/api';
import { getSession } from '@/lib/session';
import { LogCallForm } from './log-call-form';

export const metadata: Metadata = { title: 'Log incoming call · Criticom' };
export const dynamic = 'force-dynamic';

export default async function LogCallPage() {
  const { supabase, silo, fullName } = await getSession();
  const categoryTree = await getIncidentCategoryTree(supabase).catch(() => []);

  return <LogCallForm defaultSilo={silo} callTaker={fullName} categoryTree={categoryTree} />;
}
