import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import {
  deniedHrefs, featureEnabled, getFeatureMap, getMyModules, getMyTenant, type MyModules, getOperationalSettings, insightsApply, listAccessRules, listOpsLinks,
} from '@criticom/api';
import { hiddenHrefs as hiddenFor } from '@/lib/features';
import type { Silo, UserRole } from '@criticom/db';
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
import { ShiftBanner } from '@/components/schedule/shift-banner';
import { ZoneNotifier } from '@/components/zone-notifier';
import { I18nProvider } from '@/components/i18n';
import { currentLang, dictionaryFor } from '@/lib/i18n';
import { hasSidebar, isDisasterDesk, isDoctor, isEmsAdmin, isFireCommand, isPoliceAdmin } from '@/lib/nav';

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
  const [settings, opsLinks, branding, features, accessRules, tenant] = await Promise.all([
    getOperationalSettings(supabase),
    listOpsLinks(supabase),
    getBrandingMap(),
    getFeatureMap(supabase),
    listAccessRules(supabase),
    role === 'SystemAdmin' || role === 'Supervisor' || role === 'Captain' || role === 'SystemController' || role === 'ControlRoom' || isEmsAdmin(role, silo) || isDoctor(role) || isFireCommand(role, silo) || isDisasterDesk(role, silo) || isPoliceAdmin(role, silo)
      ? getMyTenant(supabase).catch(() => null) : Promise.resolve(null),
  ]);
  // Two subtractive overlays on the nav: features the tenant has switched off,
  // and modules the SuperAdmin has hidden for this tenant or this role.
  // Middleware refuses the routes themselves; this keeps the links honest.
  const hidden = [...hiddenFor(features), ...deniedHrefs(accessRules, role)];
  // System Modules shows only for people the systems controller gave access to.
  const modules: MyModules = await getMyModules(supabase).catch(() => ({}));
  if (Object.keys(modules).length === 0) hidden.push('/modules');
  if (!('STFM' in modules)) hidden.push('/modules/staff');
  const dept = branding[silo as Silo];

  // The person's language (0078) and its approved translations; English until chosen.
  const lang = await currentLang(supabase, user.id);
  const [dict, translator] = await Promise.all([
    dictionaryFor(supabase, lang),
    supabase.from('profiles').select('translator_langs').eq('id', user.id).maybeSingle()
      .then(({ data }) => ((data as { translator_langs?: string[] } | null)?.translator_langs ?? []).length > 0, () => false),
  ]);
  const canTranslate = translator || role === 'SuperAdmin' || role === 'SystemAdmin';

  // Admin tiers, supervisory roles, the two control-room desks (Dispatcher and
  // IncidentLogger), the case manager and Metro Police officers have curated
  // sidebars. The remaining operational roles use compact top navigation to
  // preserve workspace width.
  const usesSidebar = hasSidebar(role, silo);
  // The desks, the case manager and the EMS administrator work from their
  // menu alone; the external links strip would repeat it.
  const showsCommandBar = !['Supervisor', 'Dispatcher', 'IncidentLogger', 'CaseManager'].includes(role) && !isEmsAdmin(role, silo) && !isDoctor(role)
    && !isFireCommand(role, silo) && !isDisasterDesk(role, silo);

  return (
    <I18nProvider lang={lang} dict={dict}>
    <ToastProvider>
      <div className={usesSidebar ? 'min-h-screen lg:grid lg:grid-cols-[var(--sidebar-w,264px)_1fr] lg:transition-[grid-template-columns] lg:duration-200' : 'min-h-screen'}>
        {usesSidebar ? <Sidebar silo={silo} role={role} dept={dept} org={branding.Ethekwini} tenantName={tenant?.name} hiddenHrefs={hidden} /> : null}
        <div className="flex min-h-screen min-w-0 flex-col">
          <Topbar fullName={fullName} role={role} silo={silo} hasSidebar={usesSidebar} canTranslate={canTranslate} />
          {/* Role navigation and the external ops links share one bar — two
              stacked bands cost a whole row of vertical space and read as two
              unrelated toolbars. */}
          {/* External ops links sit above role navigation: the links are a
              reference strip you dip into, the navigation is the thing you
              come back to, so it reads better closest to the page it acts on. */}
          {showsCommandBar && (
            <div className="no-print flex flex-col gap-1 border-b border-border bg-bg-soft/95 px-3 py-1.5 backdrop-blur sm:px-4">
              <OpsCommandBar role={role} silo={silo} links={opsLinks} hiddenHrefs={hidden} />
              {usesSidebar ? null : (
                <div className="flex flex-wrap items-center justify-center gap-1">
                  <TopNav role={role} silo={silo} hiddenHrefs={hidden} />
                </div>
              )}
            </div>
          )}
          {/* Every console sits on the earth-at-night backdrop (globals.css,
              .console-backdrop), the same image as the shift screens. */}
          <main className="console-backdrop flex-1 bg-bg p-3 sm:p-4">
            {/* An officer calling for help outranks whatever screen you are
                on, so this sits above the page rather than inside one. It
                renders nothing when there is no live panic. Suspended so its
                query never delays the page a dispatcher is actually waiting
                for — the blocking pop-up already fired at the moment it
                mattered; this is the standing reminder afterwards. */}
            <Suspense fallback={null}>
              <PanicBanner userId={user.id} role={role as UserRole} />
            </Suspense>
            {/* Desk staff whose shift is starting: Start shift here checks them in. */}
            <Suspense fallback={null}>
              <ShiftBanner userId={user.id} role={role as UserRole} silo={silo as Silo} />
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
        {/* Perimeters shared with this console (consoles only — not the officer app). */}
        <ZoneNotifier
          userId={user.id}
          role={role as UserRole}
          soundEnabled={settings['alerts.sound_enabled']}
          toastSeconds={settings['alerts.toast_seconds']}
        />
        {featureEnabled(features, 'web.assistant') ? (
          <AssistantDock fullName={fullName} role={role} silo={silo} tiles={featureEnabled(features, 'web.criti_tiles') && insightsApply(role as UserRole)} />
        ) : null}
      </div>
    </ToastProvider>
    </I18nProvider>
  );
}
