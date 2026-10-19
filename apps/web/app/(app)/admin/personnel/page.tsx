import { redirect } from 'next/navigation';

/**
 * Personnel moved into Staff Maintenance (its Logins tab): the staff file,
 * HR's staff list, roles, invitations and leavers in one place. Old links
 * and bookmarks land there, filter kept.
 */
export default async function PersonnelMovedPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status, q } = await searchParams;
  const sp = new URLSearchParams({ view: 'logins' });
  if (status) sp.set('status', status);
  if (q) sp.set('q', q);
  redirect(`/modules/staff?${sp}`);
}
