import { Phone } from 'lucide-react';
import { telLink } from '@criticom/db/disaster-plan';
import { cn } from '@/lib/utils';

/**
 * Dial a number from the desk. A phone link: the PC opens it in its calling
 * app (Zoiper, Phone Link or Teams, whichever is set to open phone links in
 * Windows), so the desk calls with one press. Nothing when there is no number.
 */
export function CallButton({ number, label, size = 'md', className }: {
  number: string | null | undefined; label?: string; size?: 'sm' | 'md'; className?: string;
}) {
  const href = telLink(number);
  if (!href) return null;
  return (
    <a href={href} title={number ?? undefined}
      className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md bg-severity-low font-semibold text-severity-low-fg hover:opacity-90',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-3 text-sm', className)}>
      <Phone className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      {label ?? number}
    </a>
  );
}
