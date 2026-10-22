import type * as React from 'react';
import { NoticeHost } from '@/components/office/notice';
import { OfficeMenuBar } from '@/components/office/office-menu-bar';

/** Every duty office screen shares the two menus across the top: Staff ▾ and Duty ▾. */
export default async function ModulesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <OfficeMenuBar />
      {children}
      <NoticeHost />
    </div>
  );
}
