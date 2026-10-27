import { cn } from '@/lib/utils';

/** SAWS's warning colours, readable on screen and in print. */
export const WARNING_TONE: Record<string, { chip: string; bar: string; map: string }> = {
  Yellow: { chip: 'bg-[#facc15] text-slate-950', bar: 'border-l-[#facc15]', map: '#facc15' },
  Orange: { chip: 'bg-[#f97316] text-slate-950', bar: 'border-l-[#f97316]', map: '#f97316' },
  Red: { chip: 'bg-[#dc2626] text-white', bar: 'border-l-[#dc2626]', map: '#dc2626' },
};

/** "Yellow · Level 4", in the warning's colour. */
export function WarningBadge({ colour, level, className }: { colour: string; level: number; className?: string }) {
  const tone = WARNING_TONE[colour] ?? WARNING_TONE.Yellow!;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide', tone.chip, className)}>
      {colour} · Level {level}
    </span>
  );
}
