'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { CalendarDays, ChevronDown, LayoutGrid, Users } from 'lucide-react';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';

export type MenuItem = { href: string; label: string; info: string };

const pill = 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors';
const idle = 'border-primary/25 bg-gradient-to-b from-primary/15 to-bg-card/55 backdrop-blur-md text-muted-foreground hover:from-primary/25 hover:text-fg';
const on = 'border-primary bg-primary/25 text-fg backdrop-blur-md';

/**
 * The duty office menu: two menus instead of a row of screens, as the old
 * system groups them. Staff ▾ (staff, call signs, sections, endorsements)
 * and Duty ▾ (the roster, allocating, the duty sheet, leave). Each item
 * says in a line what it is for; the menu shows which screen is open.
 */
export function OfficeMenu({ staff, duty }: { staff: MenuItem[]; duty: MenuItem[] }) {
  const { t } = useT();
  const path = usePathname();
  const params = useSearchParams();
  const dept = params.get('dept');
  const q = dept ? `?dept=${dept}` : '';
  const [open, setOpen] = useState<'staff' | 'duty' | null>(null);
  const box = useRef<HTMLElement>(null);

  // A click elsewhere, Escape, or moving to another screen closes it.
  useEffect(() => { setOpen(null); }, [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const here = (href: string) => path === href || path.startsWith(`${href}/`);
  const menu = (key: 'staff' | 'duty', title: string, Icon: typeof Users, items: MenuItem[]) => {
    if (items.length === 0) return null;
    const current = items.find((i) => here(i.href));
    return (
      <div className="relative">
        <button
          type="button" onClick={() => setOpen(open === key ? null : key)}
          aria-expanded={open === key} aria-haspopup="menu"
          className={cn(pill, current ? on : idle)}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {t(title)}
          {current ? <span className="font-normal text-muted-foreground">· {t(current.label)}</span> : null}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open === key && 'rotate-180')} aria-hidden />
        </button>
        {open === key ? (
          <div role="menu" className="frost absolute left-0 top-11 z-40 w-[min(92vw,22rem)] rounded-xl border border-border p-1.5 shadow-2xl">
            {items.map((i) => (
              <Link
                key={i.href} href={`${i.href}${q}`} role="menuitem"
                aria-current={here(i.href) ? 'page' : undefined}
                className={cn('block rounded-lg px-3 py-2 hover:bg-muted', here(i.href) && 'bg-primary/15')}
              >
                <span className="block text-sm font-semibold">{t(i.label)}</span>
                <span className="block text-xs text-muted-foreground">{t(i.info)}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <nav ref={box} className="no-print flex flex-wrap items-center gap-2" aria-label={t('Duty office')}>
      <Link href={`/modules${q}`} aria-label={t('System Modules')} title={t('System Modules')} className={cn(pill, path === '/modules' ? on : idle)}>
        <LayoutGrid className="h-4 w-4" aria-hidden />
      </Link>
      {menu('staff', 'Staff', Users, staff)}
      {menu('duty', 'Duty', CalendarDays, duty)}
    </nav>
  );
}
