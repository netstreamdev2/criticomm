import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * V4's Dispatch Resources now lives on the Disaster desk (0111): partners
 * are called out from the call's command board, through the guarded
 * functions, with the timeline and Criti beside them.
 */
export default async function DispatchResourcesPage({ searchParams }: { searchParams: Promise<{ incident?: string }> }) {
  const { incident } = await searchParams;
  redirect(incident ? `/disaster/desk/${encodeURIComponent(incident)}` : '/disaster/desk');
}
