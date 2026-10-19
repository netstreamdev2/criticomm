import type * as React from 'react';
import { DEPARTMENT_NAMES, type Silo } from '@criticom/db';
import { InfoTip } from '@/components/ui/info-tip';
import { OFFICE_SILOS } from '@/lib/office';
import { requestT } from '@/lib/i18n';

/**
 * A duty office page title: the screen in capitals as the old system shows
 * it, the department, an (i), and for the systems controller a department
 * picker. View-only access says so once, beside the title.
 */
export async function OfficeHeader({
  title, info, target, global, canEdit, path, children,
}: {
  title: string;
  info: string;
  target: Silo;
  global: boolean;
  canEdit: boolean;
  /** This page, for the department picker. */
  path: string;
  children?: React.ReactNode;
}) {
  const { t } = await requestT();
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold uppercase tracking-wide">
          {t(title)} <InfoTip text={t(info)} />
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(DEPARTMENT_NAMES[target] ?? target)}
          {canEdit ? null : <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase">{t('View only')}</span>}
        </p>
      </div>
      <div className="no-print flex flex-wrap items-center gap-2">
        {children}
        {global ? (
          <form method="get" action={path} className="flex items-center gap-2">
            <select name="dept" defaultValue={target} aria-label={t('Department')}
              className="h-9 rounded-md border border-border bg-bg-soft px-2 text-sm">
              {OFFICE_SILOS.map((s) => <option key={s} value={s}>{t(DEPARTMENT_NAMES[s] ?? s)}</option>)}
            </select>
            <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">{t('Show')}</button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
