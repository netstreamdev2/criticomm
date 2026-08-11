import Link from 'next/link';

/**
 * The Criticomm lockup, shared by the landing page's header and footer so the
 * two can never drift.
 *
 * The supplied logo is entirely dark ink — the wordmark's second half is a
 * near-black navy (about rgb(1,15,88)) which, on this page's near-black
 * background, resolves to roughly 1.3:1 contrast and simply disappears. It is
 * a light-background asset, so it is given a light background: a white plate,
 * the same decision the sign-in hero already makes.
 *
 * The alternative — filtering or recolouring the mark — would be altering
 * someone's brand asset to work around a missing variant, which is not a
 * decision a stylesheet should be making. A proper reversed (light-on-dark)
 * export would let this sit directly on the bar and the plate could go.
 */
export function BrandMark({
  size = 'sm', href = '/', tagline = false,
}: {
  size?: 'sm' | 'lg';
  /** Omit to render as plain content rather than a link. */
  href?: string | null;
  /** Show the product descriptor beside the mark (large screens only). */
  tagline?: boolean;
}) {
  const plate = (
    <span
      className={`inline-flex items-center rounded-lg bg-white shadow-lg shadow-black/40 ring-1 ring-white/25 ${
        size === 'lg' ? 'px-4 py-2.5' : 'px-3 py-1.5'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/criticomm-logo.png"
        alt="Criticomm"
        className={size === 'lg' ? 'h-9 w-auto' : 'h-[26px] w-auto'}
      />
    </span>
  );

  const content = (
    <span className="inline-flex items-center gap-3">
      {plate}
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
      aria-label="Criticomm — home"
      className="lp-ease inline-flex rounded-lg transition-opacity duration-300 hover:opacity-90"
    >
      {content}
    </Link>
  );
}
