import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { featureEnabled, getFeatureMap, getOperationalSettings, listOpsLinks } from '@criticom/api';
import { hiddenHrefs as hiddenFor } from '@/lib/features';
import type { Silo } from '@criticom/db';
import { OpsCommandBar } from '@/components/ops-command-bar';
import { getBrandingMap } from '@/lib/branding';
import { getServerSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { TopNav } from '@/components/top-nav';
import { CommandPalette } from '@/components/command-palette';
import { ToastProvider } from '@/components/toast';
import { AlertCenter } from '@/components/alert-center';
import { AssistantDock } from '@/components/assistant-dock';
import { PanicBanner } from '@/components/panic-banner';

// Every page in this group is per-user (cookies + RLS), so none of them should
// ever be statically prerendered at build time.
export const dynamic = 'force-dynamic';

/** Shown instead of a cryptic 500 when the deployment has no Supabase env. */
function NotConfigured() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="max-w-lg rounded-xl border border-severity-medium/40 bg-severity-medium/10 p-6">
        <h1 className="text-xl font-bold text-severity-medium-ink">Deployment not configured</h1>
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

  // Admin-tuned alert behaviour, command-bar links and department identity;
  // all three fail safe.
  const [settings, opsLinks, branding, features] = await Promise.all([
    getOperationalSettings(supabase),
    listOpsLinks(supabase),
    getBrandingMap(),
    getFeatureMap(supabase),
  ]);
  const hidden = hiddenFor(features);
  const dept = branding[silo as Silo];

  // Only the admin tier keeps the sidebar. They genuinely work across every
  // module at once; a dispatcher or a responder lives on two or three screens,
  // and a permanent 264px column of links they cannot use costs them map and
  // queue width on the view that actually matters. Everyone else gets the same
  // destinations as a collapsed bar under the header.
  const usesSidebar = role === 'SystemAdmin' || role === 'SuperAdmin';

  return (
    <ToastProvider>
      <div className={usesSidebar ? 'min-h-screen lg:grid lg:grid-cols-[264px_1fr]' : 'min-h-screen'}>
        {usesSidebar ? <Sidebar silo={silo} role={role} dept={dept} hiddenHrefs={hidden} /> : null}
        <div className="flex min-h-screen min-w-0 flex-col">
          <Topbar fullName={fullName} role={role} silo={silo} hasSidebar={usesSidebar} />
          {/* Role navigation and the external ops links share one bar — two
              stacked bands cost a whole row of vertical space and read as two
              unrelated toolbars. */}
          {/* External ops links sit above role navigation: the links are a
              reference strip you dip into, the navigation is the thing you
              come back to, so it reads better closest to the page it acts on. */}
          <div className="flex flex-col gap-1 border-b border-border bg-bg-soft/95 px-3 py-1.5 backdrop-blur sm:px-4">
            <OpsCommandBar role={role} silo={silo} links={opsLinks} />
            {usesSidebar ? null : (
              <div className="flex flex-wrap items-center justify-center gap-1">
                <TopNav role={role} silo={silo} hiddenHrefs={hidden} />
              </div>
            )}
          </div>
          <main className="flex-1 bg-bg p-3 sm:p-4">
            {/* An officer calling for help outranks whatever screen you are
                on, so this sits above the page rather than inside one. It
                renders nothing when there is no live panic. Suspended so its
                query never delays the page a dispatcher is actually waiting
                for — the blocking pop-up already fired at the moment it
                mattered; this is the standing reminder afterwards. */}
            <Suspense fallback={null}>
              <PanicBanner />
            </Suspense>
            {children}
          </main>
        </div>
        <CommandPalette silo={silo} role={role} hiddenHrefs={hidden} searchEnabled={featureEnabled(features, 'web.search')} />
        <AlertCenter
          silo={silo}
          role={role}
          userId={user.id}
          tuning={{
            modalMinSeverity: settings['alerts.modal_min_severity'],
            soundEnabled: settings['alerts.sound_enabled'],
            toastSeconds: settings['alerts.toast_seconds'],
          }}
        />
        {featureEnabled(features, 'web.assistant') ? <AssistantDock fullName={fullName} role={role} silo={silo} /> : null}
      </div>
    </ToastProvider>
  );
}
