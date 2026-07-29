import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { LogoutButton } from '@/components/logout-button';
import { Sidebar } from '@/components/sidebar';
import { RealtimeToaster } from '@/components/realtime-toaster';

/** Shown instead of a cryptic 500 when the deployment has no Supabase env. */
function NotConfigured() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="max-w-lg rounded-xl border border-severity-medium/40 bg-severity-medium/10 p-6">
        <h1 className="text-xl font-bold text-severity-medium">Deployment not configured</h1>
        <p className="mt-3 text-sm">
          This deployment is missing its Supabase environment variables, so it can&apos;t reach the database.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">Set these in your hosting provider, then <strong>redeploy</strong>:</p>
        <ul className="mt-2 list-inside list-disc font-mono text-xs text-muted-foreground">
          <li>NEXT_PUBLIC_SUPABASE_URL</li>
          <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
          <li>SUPABASE_SERVICE_ROLE_KEY</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          The <span className="font-mono">NEXT_PUBLIC_</span> prefix is required — without it the value never
          reaches the app. Values are baked in at build time, so a redeploy is needed after adding them.
          Visit <span className="font-mono">/api/health/config</span> to check what this deployment can see.
        </p>
      </div>
    </main>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return <NotConfigured />;
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
