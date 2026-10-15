import type { Ionicons } from '@expo/vector-icons';
import { tx } from '@criticom/db/i18n';
import type { Silo } from '@criticom/db/types';

/**
 * The module registry — the responder app's shape, as data.
 *
 * Every screen the app offers beyond its core (incidents + shift + profile)
 * is a module: a destination, an icon, a description for the Home grid, and
 * the feature flag that governs it. The Home screen renders this list, and
 * the tab bar consults it, so adding a module is one entry here plus its
 * screen file — no layout surgery, and the flag wiring cannot be forgotten
 * because it is part of the entry's type.
 */

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type AppModule = {
  key: string;
  title: string;
  /** One line under the title on the Home card — what the crew does with it. */
  blurb: string;
  icon?: IconName;
  href: string;
  /** Feature flag that must be on; undefined = always available. */
  feature?: string;
  /** Department the module belongs to; undefined = every silo sees it. */
  silo?: Silo;
  /** Accent for the card rail; defaults to the theme accent. */
  tone?: 'accent' | 'primary' | 'low' | 'medium';
};

export const MODULES: AppModule[] = [
  {
    key: 'incidents',
    title: tx('My Incidents'),
    blurb: tx('Your incidents, live. Respond and advance status as things happen.'),
    icon: 'radio-outline',
    href: '/(tabs)/incidents',
  },
  {
    key: 'alerts',
    title: tx('Alerts'),
    blurb: tx('Everything that came in while you were busy, with what still needs your acknowledgement.'),
    icon: 'notifications-outline',
    href: '/alerts',
    feature: 'mobile.alerts_inbox',
  },
  {
    key: 'schedule',
    title: tx('My Schedule'),
    blurb: tx('Current duty, next duty, allocations, balances and endorsements.'),
    icon: 'calendar-outline',
    href: '/(tabs)/schedule',
  },
  {
    key: 'shift',
    title: tx('Start of Shift'),
    blurb: tx('Mental readiness, vehicle selection and inspection — the gate to responding to incidents.'),
    icon: 'clipboard-outline',
    href: '/(tabs)/shift',
  },
  {
    key: 'leave',
    title: tx('Leave'),
    blurb: tx('Apply from the field; balances shown before the form.'),
    icon: 'airplane-outline',
    href: '/leave',
    feature: 'mobile.leave',
    tone: 'low',
  },
  {
    key: 'firearm',
    title: tx('Firearm Check'),
    blurb: tx('The armoury checklist — issue, return or inspect, safety items first.'),
    icon: 'shield-checkmark-outline',
    href: '/firearm-check',
    feature: 'mobile.firearm_check',
    silo: 'MetroPolice',
    tone: 'medium',
  },
  {
    key: 'fines',
    title: tx('Fines'),
    blurb: tx('Issue an AARTO 01 or by-law notice at the roadside and print the slip — works with no signal.'),
    icon: 'receipt-outline',
    href: '/fines',
    feature: 'mobile.fines',
    silo: 'MetroPolice',
    tone: 'primary',
  },
  {
    key: 'assistant',
    title: 'Criti',
    blurb: tx('Ask about your incidents, your crew, your shift — scoped to what you can already see.'),
    href: '/assistant',
    feature: 'mobile.assistant',
    tone: 'accent',
  },
];

/** Home shows what the tab bar cannot fit; the rest is one tap deeper. */
export function homeModules(enabled: (key: string) => boolean, silo?: Silo): AppModule[] {
  return MODULES.filter(
    (m) =>
      (m.feature ? enabled(m.feature) : true)
      // Ethekwini is the global silo — its members see every department's modules.
      && (m.silo && silo ? m.silo === silo || silo === 'Ethekwini' : true),
  );
}
