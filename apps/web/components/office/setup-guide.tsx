'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Check, ChevronRight, Map as MapIcon } from 'lucide-react';
import type { ModuleCode } from '@criticom/db';
import type { MyModules, OfficeSetup } from '@criticom/api';
import { getSetupAction } from '@/app/(app)/modules/guide-actions';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';

const HIDE_KEY = 'criticom.office-guide.hidden';

type Step = { href: string; code: ModuleCode; label: string; done: (s: OfficeSetup) => boolean; count?: (s: OfficeSetup) => number };

/**
 * The setup path, one slim line under the screens: Sections → Call signs →
 * Staff ready → Allocate duty → Print sheet. Each step ticks itself from the
 * data, the next one is marked, and every step is a link. It can be hidden.
 */
export function SetupGuide() {
  const { t } = useT();
  const path = usePathname();
  const params = useSearchParams();
  const dept = params.get('dept');
  const [data, setData] = useState<{ setup: OfficeSetup; modules: MyModules } | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try { setHidden(localStorage.getItem(HIDE_KEY) === '1'); } catch { /* private window: show it */ }
  }, []);
  // A save refreshes the page (and often moves to the next screen): read the ticks again.
  useEffect(() => {
    let live = true;
    getSetupAction(dept).then((d) => { if (live) setData(d); }).catch(() => {});
    return () => { live = false; };
  }, [dept, path, params.toString()]);

  if (!data) return null;
  const all: Step[] = [
    { href: '/modules/sections', code: 'SECM', label: t('Sections'), done: (s) => s.sections > 0 },
    { href: '/modules/call-signs', code: 'CSNM', label: t('Call signs'), done: (s) => s.callSigns > 0 },
    { href: '/modules/staff', code: 'STFM', label: t('Staff ready'), done: (s) => s.ready > 0, count: (s) => s.ready },
    { href: '/modules/duty-allocation', code: 'DUTA', label: t('Allocate duty'), done: (s) => s.booked > 0 },
    { href: '/modules/duty-operations', code: 'DUTR', label: t('Print sheet'), done: () => false },
  ];
  const steps = all.filter((s) => s.code in data.modules);
  if (steps.length < 2) return null;
  const next = steps.find((s) => !s.done(data.setup));
  const q = dept ? `?dept=${dept}` : '';
  const toggle = (h: boolean) => { setHidden(h); try { localStorage.setItem(HIDE_KEY, h ? '1' : '0'); } catch { /* fine */ } };

  if (hidden) {
    return (
      <div className="no-print flex justify-end">
        <button type="button" onClick={() => toggle(false)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-fg">
          <MapIcon className="h-3.5 w-3.5" aria-hidden /> {t('Show setup guide')}
        </button>
      </div>
    );
  }
  return (
    <nav aria-label={t('Setup guide')}
      className="no-print flex flex-wrap items-center gap-1 rounded-md border border-primary/25 bg-gradient-to-b from-primary/10 to-bg-card/55 px-2 py-1.5 text-xs backdrop-blur-md">
      <MapIcon className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {steps.map((s, i) => {
        const done = s.done(data.setup);
        const here = path === s.href;
        const isNext = s === next;
        return (
          <span key={s.href} className="inline-flex items-center gap-1">
            {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> : null}
            <Link href={`${s.href}${q}`} aria-current={here ? 'step' : undefined}
              className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold transition-colors',
                done ? 'text-severity-low-ink hover:bg-severity-low/10'
                  : isNext ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                    : 'text-muted-foreground hover:bg-muted hover:text-fg',
                here && !isNext && 'ring-1 ring-primary/60')}>
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span aria-hidden className="tabular-nums">{i + 1}</span>}
              {s.label}{s.count && s.count(data.setup) > 0 ? ` (${s.count(data.setup)})` : ''}
              {isNext ? <span className="ml-0.5 rounded-full bg-white/25 px-1.5 text-[10px] uppercase tracking-wide">{t('Next')}</span> : null}
              <span className="sr-only">{done ? t('done') : isNext ? t('next step') : ''}</span>
            </Link>
          </span>
        );
      })}
      <button type="button" onClick={() => toggle(true)} className="ml-auto text-muted-foreground hover:text-fg">{t('Hide guide')}</button>
    </nav>
  );
}
