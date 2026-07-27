import Link from 'next/link';
import {
  PhoneCall, ListChecks, Map, BarChart3, MapPinned, Filter, RadioTower, FolderClosed,
  Radio, ClipboardCheck, Gauge, Target, ShieldAlert, FlameKindling, Stethoscope, Mountain,
  CalendarClock, IdCard, Briefcase, GraduationCap, Users, SlidersHorizontal, Bell, Camera,
  Bot, FileText, Activity, Network, type LucideIcon,
} from 'lucide-react';
import { canAccess, type Silo, type UserRole } from '@criticom/db';

export type QuickLink = { href: string; label: string; desc: string; icon: LucideIcon; tone?: string };

const ICONS: Record<string, LucideIcon> = {
  PhoneCall, ListChecks, Map, BarChart3, MapPinned, Filter, RadioTower, FolderClosed,
  Radio, ClipboardCheck, Gauge, Target, ShieldAlert, FlameKindling, Stethoscope, Mountain,
  CalendarClock, IdCard, Briefcase, GraduationCap, Users, SlidersHorizontal, Bell, Camera,
  Bot, FileText, Activity, Network,
};

/** Big tappable shortcut cards, filtered to what the role/silo may access. */
export function QuickLinks({
  links, role, silo,
}: {
  links: Array<Omit<QuickLink, 'icon'> & { icon: keyof typeof ICONS }>;
  role: UserRole; silo: Silo;
}) {
  const visible = links.filter((l) => canAccess(l.href, role, silo));
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {visible.map((l) => {
        const Icon = ICONS[l.icon] ?? Activity;
        return (
          <Link
            key={l.href}
            href={l.href}
            className="group flex items-start gap-3 rounded-xl border border-border bg-gradient-to-b from-bg-card to-bg-soft p-4 transition-all hover:-translate-y-0.5 hover:border-accent/50"
          >
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${l.tone ?? 'bg-accent/15 text-accent'}`}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white group-hover:text-white">{l.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{l.desc}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
