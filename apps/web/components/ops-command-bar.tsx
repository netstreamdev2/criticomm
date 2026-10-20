'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Cctv, ChevronDown, ExternalLink, Film, FolderClosed, LayoutDashboard, Link2,
  ListChecks, Map as MapIcon, MoreHorizontal, Network, PhoneCall, Radio, RadioTower,
  Siren, Truck, Video,
} from 'lucide-react';
import { canAccess, type Silo, type UserRole } from '@criticom/db';
import type { OpsLink } from '@criticom/api';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';

/**
 * One row of shortcuts per role, all in the same plain style: the things that
 * person opens every shift, and nothing else. Each is filtered by the same
 * access matrix as the sidebar, and by what the tenant has switched off.
 *
 * The admin tier gets its main pages up front, the rest under "More", and the
 * outside systems (from the OpsLink settings, so the control room can repoint
 * them without a deploy) under "Links". Placeholders with no address yet, and
 * links that repeat a shortcut, are left out.
 */
type Shortcut = { href: string; label: string; icon: typeof Siren };

const ADMIN_SHORTCUTS: Shortcut[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dispatch/log-call', label: 'New Call', icon: Siren },
  { href: '/dispatch/pending', label: 'Incoming', icon: PhoneCall },
  { href: '/incidents/map', label: 'Live Map', icon: MapIcon },
  { href: '/dispatch/ptt', label: 'Radio', icon: RadioTower },
  { href: '/cameras', label: 'Body Cams', icon: Video },
  { href: '/responder', label: 'Responder', icon: Truck },
  { href: '/dispatch/kpi', label: 'KPIs', icon: BarChart3 },
];

/** Less often: one tap further, under "More". */
const ADMIN_MORE: Shortcut[] = [
  { href: '/incidents', label: 'All Incidents', icon: ListChecks },
  { href: '/case-manager', label: 'Case Manager', icon: FolderClosed },
  { href: '/cameras/footage', label: 'Body Cam Footage', icon: Film },
  { href: '/sanral', label: 'Freeway Cameras', icon: Cctv },
  { href: '/hierarchy', label: 'Dept Hierarchy', icon: Network },
  { href: '/report-hub', label: 'Report Hub', icon: BarChart3 },
];

const CONTROLLER_SHORTCUTS = [
  { href: '/command', label: 'Command', icon: Radio },
  { href: '/dispatch/pending', label: 'Dispatch', icon: ListChecks },
  { href: '/incidents/map', label: 'Live Map', icon: MapIcon },
  { href: '/cameras', label: 'Body Cams', icon: Video },
  { href: '/cameras/footage', label: 'Body Cam Footage', icon: Film },
  { href: '/sanral', label: 'SANRAL Cameras', icon: Cctv },
  { href: '/dispatch/ptt', label: 'Radio', icon: RadioTower },
  { href: '/dispatch/kpi', label: 'KPIs', icon: BarChart3 },
];

const CAPTAIN_SHORTCUTS = [
  { href: '/dashboard', label: 'Overview', icon: Radio },
  { href: '/roster/allocation', label: 'Duty Board', icon: ListChecks },
  { href: '/incidents/map', label: 'Live Map', icon: MapIcon },
  { href: '/cameras', label: 'Body Cams', icon: Video },
  { href: '/police', label: 'Police Ops', icon: Siren },
  { href: '/responder', label: 'My Incidents', icon: Truck },
  { href: '/shift/mental-check', label: 'Start Shift', icon: RadioTower },
];

const POLICE_OFFICER_SHORTCUTS = [
  { href: '/dashboard', label: 'Overview', icon: Radio },
  { href: '/responder', label: 'My Incidents', icon: Truck },
  { href: '/roster/mine', label: 'My Schedule', icon: ListChecks },
  { href: '/shift/mental-check', label: 'Start Shift', icon: Siren },
  { href: '/incidents/map', label: 'Live Map', icon: MapIcon },
  { href: '/police', label: 'Police Ops', icon: RadioTower },
];

const ITEM = 'group relative inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-fg/65 transition-colors hover:bg-accent/5 hover:text-fg';

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ShortcutLink({ item, pathname }: { item: Shortcut; pathname: string }) {
  const { t } = useT();
  const Icon = item.icon;
  const active = isActive(pathname, item.href);
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} className={cn(ITEM, active && 'bg-accent/5 text-fg')}>
      <Icon className={cn('h-4 w-4 text-accent/75 transition-colors group-hover:text-accent', active && 'text-accent')} aria-hidden />
      {t(item.label)}
      {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-px bg-accent shadow-[0_0_9px_var(--accent)]" />}
    </Link>
  );
}

/** A small menu off the row ("More", "Links"); closes on an outside click or a page change. */
function Menu({ label, icon: Icon, active, children }: {
  label: string; icon: typeof Siren; active?: boolean; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => { setOpen(false); }, [pathname]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className={cn(ITEM, (open || active) && 'bg-accent/5 text-fg')}
      >
        <Icon className="h-4 w-4 text-accent/75 group-hover:text-accent" aria-hidden />
        {label}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-bg-card py-1 shadow-2xl">
          {children}
        </div>
      )}
    </div>
  );
}

const MENU_ITEM = 'flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors hover:bg-muted';

export function OpsCommandBar({
  role, silo, links, hiddenHrefs = [],
}: {
  role: string; silo: string; links: OpsLink[]; hiddenHrefs?: string[];
}) {
  const { t } = useT();
  const pathname = usePathname();
  const r = role as UserRole;
  const s = silo as Silo;
  const allowed = (item: Shortcut) => canAccess(item.href, r, s) && !hiddenHrefs.includes(item.href);

  if (role === 'SystemController' || role === 'Captain' || role === 'Police') {
    const shortcutItems = role === 'Captain' ? CAPTAIN_SHORTCUTS
      : role === 'SystemController' ? CONTROLLER_SHORTCUTS : POLICE_OFFICER_SHORTCUTS;
    return (
      <nav aria-label={t('Shortcuts')} className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
        {shortcutItems.filter(allowed).map((item) => <ShortcutLink key={item.href} item={item} pathname={pathname} />)}
      </nav>
    );
  }

  const main = ADMIN_SHORTCUTS.filter(allowed);
  const more = ADMIN_MORE.filter(allowed);
  const mainHrefs = new Set([...main, ...more].map((m) => m.href));
  // Outside systems with an address, and not a repeat of a shortcut above.
  const outside = links.filter((l) => l.href && !(!l.external && mainHrefs.has(l.href)));

  // Nothing this role can use → no bar at all (e.g. a citizen account).
  if (main.length === 0 && more.length === 0 && outside.length === 0) return null;

  return (
    <nav aria-label={t('Shortcuts')} className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
      {main.map((item) => <ShortcutLink key={item.href} item={item} pathname={pathname} />)}
      {more.length > 0 && (
        <Menu label={t('More')} icon={MoreHorizontal} active={more.some((m) => isActive(pathname, m.href))}>
          {more.map((o) => {
            const Icon = o.icon;
            return (
              <Link key={o.href} role="menuitem" href={o.href} className={MENU_ITEM}>
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />{t(o.label)}
              </Link>
            );
          })}
        </Menu>
      )}
      {outside.length > 0 && (
        <Menu label={t('Links')} icon={Link2}>
          {outside.map((l) => l.external ? (
            <a key={l.id} role="menuitem" href={l.href!} target="_blank" rel="noreferrer noopener" className={cn(MENU_ITEM, 'justify-between')}>
              <span>{l.label}</span>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </a>
          ) : (
            <Link key={l.id} role="menuitem" href={l.href!} className={MENU_ITEM}>{l.label}</Link>
          ))}
        </Menu>
      )}
    </nav>
  );
}
