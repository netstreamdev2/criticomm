import type * as React from 'react';
import { Suspense } from 'react';
import { OFFICE_MODULES, getMyModules, type MyModules } from '@criticom/api';
import { ModuleStrip } from '@/components/office/module-strip';
import { NoticeHost } from '@/components/office/notice';
import { getSession } from '@/lib/session';

/** Every duty office screen shares the strip of screens across the top. */
export default async function ModulesLayout({ children }: { children: React.ReactNode }) {
  const { supabase } = await getSession();
  const mine: MyModules = await getMyModules(supabase).catch(() => ({}));
  const items = OFFICE_MODULES.filter((m) => m.code in mine).map((m) => ({ href: m.href, label: m.label }));
  return (
    <div className="space-y-4">
      <Suspense fallback={null}>
        <ModuleStrip items={items} />
      </Suspense>
      {children}
      <NoticeHost />
    </div>
  );
}
