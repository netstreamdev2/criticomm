'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';

/**
 * The strip of screens across the top of every duty office page, as on the
 * old system: back to System Modules, then each screen you may open.
 */
export function ModuleStrip({ items }: { items: Array<{ href: string; label: string }> }) {
  const { t } = useT();
  const path = usePathname();
  const params = useSearchParams();
  const dept = params.get('dept');
  const q = dept ? `?dept=${dept}` : '';
  return (
    <nav className="no-print -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label={t('System Modules')}>
      <Link href={`/modules${q}`}
        className={cn('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors',
          path === '/modules' ? 'border-primary bg-primary/15 text-fg' : 'border-border text-muted-foreground hover:bg-muted hover:text-fg')}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('System Modules')}
      </Link>
      {items.map((m) => {
        const active = path === m.href || path.startsWith(`${m.href}/`);
        return (
          <Link key={m.href} href={`${m.href}${q}`} aria-current={active ? 'page' : undefined}
            className={cn('inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-sm font-semibold transition-colors',
              active ? 'border-primary bg-primary/15 text-fg' : 'border-border text-muted-foreground hover:bg-muted hover:text-fg')}>
            {t(m.label)}
          </Link>
        );
      })}
    </nav>
  );
}
