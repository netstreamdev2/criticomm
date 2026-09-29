import Link from 'next/link';

/** Shared HIKTECH wordmark for the landing page header and footer. */
export function BrandMark({
  size = 'sm', href = '/', tagline = false,
}: {
  size?: 'sm' | 'lg';
  /** Omit to render as plain content rather than a link. */
  href?: string | null;
  /** Show the product descriptor beside the mark (large screens only). */
  tagline?: boolean;
}) {
  const mark = (
    <span
      className={`inline-flex items-center rounded-lg bg-[#0b1019] shadow-lg shadow-black/30 ring-1 ring-white/10 ${
        size === 'lg' ? 'px-3 py-1.5' : 'px-1 py-1'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/hiktech-logo.svg"
        alt="HIKTECH"
        className={size === 'lg' ? 'h-14 w-auto' : 'h-6 w-auto sm:h-8'}
      />
    </span>
  );

  const content = (
    <span className="inline-flex items-center gap-3">
      {mark}
      {tagline && (
        <span className="hidden border-l border-white/15 pl-3 text-[11px] font-semibold uppercase leading-tight tracking-[0.14em] text-white/45 xl:block">
          Emergency
          <br />
          Command Platform
        </span>
      )}
    </span>
  );

  if (!href) return content;
  return (
    <Link
      href={href}
      aria-label="HikTech — home"
      className="lp-ease inline-flex rounded-lg transition-opacity duration-300 hover:opacity-90"
    >
      {content}
    </Link>
  );
}
