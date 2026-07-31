import type { DepartmentBranding } from '@criticom/api';
import { cn } from '@/lib/utils';

/**
 * A department's crest.
 *
 * Renders the uploaded logo when Admin → Departments has one; otherwise a
 * monogram shield in the department's own colours. That fallback is
 * deliberate: official municipal and service insignia belong to the
 * municipality, so the app never ships fabricated versions — it just looks
 * right until the real crest is uploaded.
 */
export function DeptBadge({
  branding, logoUrl, size = 'md', className,
}: {
  branding: Pick<DepartmentBranding, 'monogram' | 'primary_color' | 'accent_color' | 'short_name'>;
  logoUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dims = {
    xs: 'h-6 w-6 text-[9px]',
    sm: 'h-8 w-8 text-[10px]',
    md: 'h-11 w-11 text-xs',
    lg: 'h-16 w-16 text-base',
  }[size];

  if (logoUrl) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/95 p-0.5 ring-1 ring-black/10',
          dims,
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={`${branding.short_name} crest`}
          className="h-full w-full object-contain"
        />
      </span>
    );
  }

  return (
    <span
      aria-label={`${branding.short_name} badge`}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-bold uppercase tracking-wider text-white shadow-inner',
        dims,
        className,
      )}
      style={{
        background: `linear-gradient(140deg, ${branding.primary_color}, ${branding.accent_color})`,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.18), 0 1px 6px ${branding.primary_color}55`,
      }}
    >
      {branding.monogram}
    </span>
  );
}

/** Inline department label with its crest — for tables, rows and headers. */
export function DeptChip({
  branding, logoUrl, className, showMotto = false,
}: {
  branding: Pick<DepartmentBranding,
    'monogram' | 'primary_color' | 'accent_color' | 'short_name' | 'official_name' | 'motto'>;
  logoUrl?: string | null;
  className?: string;
  showMotto?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <DeptBadge branding={branding} logoUrl={logoUrl} size="sm" />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-bold">{branding.short_name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {showMotto && branding.motto ? branding.motto : branding.official_name}
        </span>
      </span>
    </span>
  );
}

/** A thin colour rail — used to tint cards and rows by owning department. */
export function DeptRail({
  branding, className,
}: {
  branding: Pick<DepartmentBranding, 'primary_color'>;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('absolute inset-y-0 left-0 w-1 rounded-l', className)}
      style={{ background: branding.primary_color }}
    />
  );
}
