import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSupabase } from '@/lib/supabase';
import { LogoutButton } from '@/components/logout-button';
import { Sidebar } from '@/components/sidebar';
import { RealtimeToaster } from '@/components/realtime-toaster';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const silo = (user.app_metadata?.silo as string | undefined) ?? 'Ethekwini';
  const role = (user.app_metadata?.role as string | undefined) ?? 'Viewer';
  const fullName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'User';

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <Sidebar silo={silo} role={role} />
      <div className="flex min-h-screen flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-bg-soft pl-14 pr-4 sm:pr-6 lg:pl-6">
          <div className="min-w-0 truncate text-sm text-muted-foreground">
            <span className="font-semibold text-white">{fullName}</span>
            <span className="mx-2 hidden sm:inline">·</span>
            <span className="hidden uppercase tracking-wide sm:inline">{role}</span>
            <span className="mx-2 hidden md:inline">·</span>
            <span className="hidden md:inline">{silo}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link href="/profile" className="text-sm text-muted-foreground hover:text-white">
              Profile
            </Link>
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-bg p-4 sm:p-6">{children}</main>
      </div>
      <RealtimeToaster silo={silo} role={role} />
    </div>
  );
}
