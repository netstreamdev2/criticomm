/**
 * The administrators' handbook: design documents shared by the build team
 * and eThekwini's administrators. Each page is one standalone HTML file in
 * `apps/web/handbook/`, the single source for both the in-app page
 * (`/admin/handbook/[slug]`, administrators only) and the shared copy.
 *
 * Pure functions only, so they can be tested without Next.
 */

export type HandbookPage = {
  slug: string;
  title: string;
  summary: string;
  /** File name inside `apps/web/handbook/`. */
  file: string;
  /** ISO date of the last substantive change. */
  updated: string;
  audience: string;
};

export const HANDBOOK: HandbookPage[] = [
  {
    slug: 'staff-onboarding',
    title: 'How staff get their accounts',
    summary: 'Invitations, the accepting screens, officers without email, bringing existing staff across, and the safety rules behind all of it.',
    file: 'staff-onboarding.html',
    updated: '2026-10-04',
    audience: 'Administrators and the build team',
  },
  {
    slug: 'staff-list-request',
    title: 'The staff list we need',
    summary: 'For eThekwini HR, sent with the template: who to include, what each column holds, what to leave out, and what happens next.',
    file: 'staff-list-request.html',
    updated: '2026-10-04',
    audience: 'eThekwini HR and administrators',
  },
];

/** Only registered pages are served, so a slug can never reach another file. */
export function findHandbookPage(slug: string): HandbookPage | null {
  return HANDBOOK.find((p) => p.slug === slug) ?? null;
}

/** Marks the Google Fonts links in a handbook file (used by the shared copy). */
const FONT_BLOCK = /<!-- handbook:fonts[\s\S]*?<!-- \/handbook:fonts -->/;

/**
 * The same three faces, served by the app itself: its CSP admits no
 * third-party fonts, and an administrator's page should call nobody else.
 * Files in `public/handbook/fonts/` (SIL Open Font Licence).
 */
export const SELF_HOSTED_FONTS = `<style>
@font-face { font-family: 'Rubik'; font-style: normal; font-weight: 400 700; font-display: swap; src: url('/handbook/fonts/rubik-latin.woff2') format('woff2'); }
@font-face { font-family: 'Public Sans'; font-style: normal; font-weight: 400 700; font-display: swap; src: url('/handbook/fonts/public-sans-latin.woff2') format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 500 600; font-display: swap; src: url('/handbook/fonts/jetbrains-mono-latin.woff2') format('woff2'); }
</style>`;

const BAR_CSS = `
.hb-bar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1rem;
  padding: .6rem 16px; background: var(--surface); border-bottom: 1px solid var(--line);
  font-family: var(--font-display); font-size: .85rem; }
.hb-bar a { color: var(--ink); text-decoration: none; font-weight: 600; }
.hb-bar a:hover, .hb-bar a:focus-visible { color: var(--accent); }
.hb-bar span { color: var(--muted); }
`;

/**
 * Wrap a handbook file as a full page for the app: self-hosted fonts, the
 * reader's console theme (light or dark), and a bar back to the handbook.
 */
export function renderHandbookPage(
  fragment: string,
  opts: { themeKey: string; defaultTheme: string; lightThemes: string[] },
): string {
  const body = fragment.replace(FONT_BLOCK, SELF_HOSTED_FONTS);
  // Follow the theme the person chose in the console (same origin, same
  // storage): its light themes read light, everything else dark.
  const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(opts.themeKey)})||${JSON.stringify(opts.defaultTheme)};`
    + `document.documentElement.setAttribute('data-theme',${JSON.stringify(opts.lightThemes)}.indexOf(t)>=0?'light':'dark');}catch(e){}})();`;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="robots" content="noindex, nofollow">',
    `<script>${themeScript}</script>`,
    `<style>${BAR_CSS}</style>`,
    '</head>',
    '<body>',
    '<nav class="hb-bar" aria-label="Handbook"><a href="/admin/handbook">← Handbook</a><span>HikTech administrators</span><a href="/admin">Admin</a></nav>',
    body,
    '</body>',
    '</html>',
  ].join('\n');
}
