import Link from 'next/link';
import {
  BadgeCheck, CalendarCheck, CalendarDays, ClipboardList, FileText, Gavel, Grid3x3, IdCard, Mail, Plane, Radio, Receipt,
  Scale, ScrollText, Siren, UserRound, Wrench, XCircle, type LucideIcon,
} from 'lucide-react';
import { OFFICE_MODULES, getMyModules, type MyModules } from '@criticom/api';
import { canAccess, type ModuleCode } from '@criticom/db';
import { InfoTip } from '@/components/ui/info-tip';
import { SetupGuide } from '@/components/office/setup-guide';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'System Modules · HikTech' };

const ICON: Record<ModuleCode, LucideIcon> = {
  STFM: UserRound, CSNM: IdCard, SECM: Grid3x3, ENTM: BadgeCheck,
  DUTA: CalendarDays, DUTM: Wrench, DUTR: ClipboardList, ABSM: XCircle, LEAM: Plane,
};

/** The old system's other modules, which already live elsewhere in the console. */
const ENFORCEMENT: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/police/fines', label: 'Fines', icon: Receipt },
  { href: '/police/charges', label: 'Charges', icon: Scale },
  { href: '/police/transactions', label: 'Charge Transactions', icon: FileText },
  { href: '/police/warrants', label: 'Warrants', icon: Gavel },
  { href: '/police/summons', label: 'Summons', icon: ScrollText },
];
const OPERATIONS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/dispatch', label: 'Dispatch', icon: Siren },
  { href: '/mail', label: 'Mail', icon: Mail },
  { href: '/roster', label: 'Duty Roster', icon: CalendarCheck },
  { href: '/attendance', label: 'Time & Attendance', icon: Radio },
];

/** System Modules: the old system's module menu, showing what this person may open. */
export default async function ModulesPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const { dept } = await searchParams;
  const mine: MyModules = await getMyModules(supabase).catch(() => ({}));
  const q = dept ? `?dept=${dept}` : '';
  const open = (href: string) => canAccess(href, role, silo);

  const column = (key: string, title: string, items: Array<{ href: string; label: string; icon: LucideIcon; info?: string; level?: string }>) =>
    items.length === 0 ? null : (
      <section key={key} className="space-y-1">
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">{t(title)}</h2>
        {items.map((m) => (
          <div key={m.href} className="flex items-center gap-2">
            <Link href={`${m.href}${q}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted"><m.icon className="h-4 w-4" aria-hidden /></span>
              <span className="truncate font-medium">{t(m.label)}</span>
              {m.level === 'View' ? <span className="ml-auto text-[10px] font-semibold uppercase text-muted-foreground">{t('View only')}</span> : null}
            </Link>
            {m.info ? <InfoTip text={t(m.info)} side="right" /> : null}
          </div>
        ))}
      </section>
    );

  const office = (group: 'staff' | 'duty') => OFFICE_MODULES
    .filter((m) => m.group === group && m.code in mine)
    .map((m) => ({ href: m.href, label: m.label, icon: ICON[m.code], info: m.info, level: mine[m.code] }));

  const staff = office('staff');
  const duty = office('duty');
  const enforcement = ENFORCEMENT.filter((m) => open(m.href));
  const operations = OPERATIONS.filter((m) => open(m.href));

  return (
    <div className="space-y-4">
      <header className="border-b border-border pb-3">
        <h1 className="flex items-center gap-2 text-xl font-bold uppercase tracking-wide">
          {t('System Modules')} <InfoTip text={t('The duty office screens. The systems controller decides who may open each one, and whether they may change it.')} />
        </h1>
      </header>
      <SetupGuide />
      {staff.length + duty.length === 0 ? (
        <p className="rounded-lg border border-border bg-bg-card p-6 text-sm text-muted-foreground">
          {t('You have no duty office screens yet. Ask the systems controller for access.')}
        </p>
      ) : null}
      <div className="grid gap-6 rounded-lg border border-border bg-bg-card p-5 md:grid-cols-3">
        {column('staff', 'Staff & Personnel', staff)}
        {column('duty', 'Duty Management', duty)}
        <div className="space-y-6">
          {column('enforcement', 'Enforcement', enforcement)}
          {column('operations', 'Operations', operations)}
        </div>
      </div>
    </div>
  );
}
