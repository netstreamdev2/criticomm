import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The (i) beside a title or a field: hover or focus it to read one line about
 * what it is. Pure CSS, so it works on server pages and in print it hides.
 */
export function InfoTip({ text, className, side = 'bottom' }: { text: string; className?: string; side?: 'bottom' | 'right' }) {
  return (
    <span className={cn('group relative inline-flex align-middle print:hidden', className)}>
      <button
        type="button"
        aria-label={text}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-muted-foreground outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 hidden w-64 rounded-md border border-border bg-bg-card px-3 py-2 text-xs font-normal normal-case leading-snug tracking-normal text-fg shadow-lg group-focus-within:block group-hover:block',
          side === 'bottom' ? 'left-1/2 top-full mt-1.5 -translate-x-1/2' : 'left-full top-1/2 ml-2 -translate-y-1/2',
        )}
      >
        {text}
      </span>
    </span>
  );
}
