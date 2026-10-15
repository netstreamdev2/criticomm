import { cn } from '@/lib/utils';
import Image from 'next/image';

/** Criti's head at icon sizes; the full character for larger welcome art. */
export function CritiMascot({ className, variant = 'head' }: { className?: string; variant?: 'head' | 'full' }) {
  return (
    <Image
      src={variant === 'head' ? '/criti-head.png' : '/criti-mascot.png'}
      alt=""
      aria-hidden="true"
      width={128}
      height={128}
      className={cn('shrink-0 object-contain', className)}
    />
  );
}
