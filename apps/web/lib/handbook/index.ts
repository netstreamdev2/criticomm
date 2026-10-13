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
  /**
   * A guide for anyone reviewing HikTech: example data only, served without
   * signing in at /guide/<slug> as well as in the administrators' handbook.
   */
  public?: boolean;
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
  {
    slug: 'incident-police',
    title: 'A police call, from first ring to closed case',
    summary: 'The call logger, the Metro Police desk, the officer’s phone from start of shift to the report, and the case manager closing the case.',
    file: 'incident-police.html',
    updated: '2026-10-13',
    audience: 'Anyone reviewing HikTech',
    public: true,
  },
  {
    slug: 'incident-fire',
    title: 'A fire call, from first ring to closed case',
    summary: 'Signing onto an appliance, the Fire desk, the firefighter’s phone, the fire report, and a call shared with EMS.',
    file: 'incident-fire.html',
    updated: '2026-10-13',
    audience: 'Anyone reviewing HikTech',
    public: true,
  },
  {
    slug: 'incident-ems',
    title: 'A medical call, from first ring to closed case',
    summary: 'Signing onto an ambulance, the EMS desk, treating and transporting, the patient care report and the hospital handover.',
    file: 'incident-ems.html',
    updated: '2026-10-13',
    audience: 'Anyone reviewing HikTech',
    public: true,
  },
  {
    slug: 'incident-disaster',
    title: 'A disaster call, from first ring to closed case',
    summary: 'The Disaster desk, resources deployed, the officer at the scene, and the After-Action Report.',
    file: 'incident-disaster.html',
    updated: '2026-10-13',
    audience: 'Anyone reviewing HikTech',
    public: true,
  },
];

/** The guides anyone may read, without signing in (/guide). */
export const PUBLIC_GUIDES = HANDBOOK.filter((p) => p.public);

/** A public guide by its slug; never an administrators' page. */
export function findPublicGuide(slug: string): HandbookPage | null {
  return PUBLIC_GUIDES.find((p) => p.slug === slug) ?? null;
}

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
  opts: {
    themeKey: string; defaultTheme: string; lightThemes: string[];
    /** The public guides (/guide) link back to their list, not to Admin. */
    audience?: 'admin' | 'public';
  },
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
    opts.audience === 'public'
      ? '<nav class="hb-bar" aria-label="Guides"><a href="/guide">← All guides</a><span>HikTech · eThekwini Municipality</span><a href="/login">Sign in</a></nav>'
      : '<nav class="hb-bar" aria-label="Handbook"><a href="/admin/handbook">← Handbook</a><span>HikTech administrators</span><a href="/admin">Admin</a></nav>',
    body,
    '</body>',
    '</html>',
  ].join('\n');
}

/** Escapes text for the guides list (titles and summaries are ours, but stay safe). */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * The list of public guides (/guide), in the guides' own look: `styleSource`
 * is any built guide, whose fonts and styles are reused.
 */
export function guideIndexFragment(styleSource: string, guides: HandbookPage[]): string {
  const end = styleSource.indexOf('</style>');
  const head = (end < 0 ? '' : styleSource.slice(0, end + '</style>'.length)).replace(/<title>[^<]*<\/title>/, '');
  const cards = guides.map((g) => `      <a class="guide-card" href="/guide/${esc(g.slug)}">
        <h3>${esc(g.title)}</h3>
        <p class="muted">${esc(g.summary)}</p>
        <span class="who">Updated ${esc(new Date(g.updated).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }))}</span>
      </a>`).join('\n');
  return `<title>HikTech · Guides</title>
${head}
<style>
.guide-list { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); margin-top: 2rem; }
.guide-card { display: grid; gap: .45rem; align-content: start; text-decoration: none; color: var(--ink); background: var(--surface);
  border: 1px solid var(--line); border-top: 3px solid var(--brand); border-radius: 0 0 10px 10px; padding: 1.1rem 1.2rem; }
.guide-card:hover, .guide-card:focus-visible { border-color: var(--accent); outline: none; }
.guide-card .who { font-size: .8rem; color: var(--muted); }
</style>
<div class="page">
  <header class="masthead col">
    <p class="eyebrow">eThekwini Municipality · HikTech · Guides</p>
    <h1>How a call travels through HikTech</h1>
    <p class="lede">One guide per department, each following a single call from the moment the phone rings to the closed case: the console screens, the phone app screens, and what every button does.</p>
    <div class="meta"><span><b>For:</b> anyone reviewing HikTech</span><span><b>Data:</b> examples only, no real people</span></div>
  </header>
  <section class="band">
    <div class="guide-list">
${cards}
    </div>
  </section>
  <footer class="col">HikTech · eThekwini Municipality.</footer>
</div>`;
}
