/**
 * Security headers for a critical-services deployment.
 *
 * Applied to every response. Notes on the deliberate loosenings:
 *  - `unsafe-inline` for styles: Tailwind's runtime theme variables and the
 *    inline `style` props used for department colours require it.
 *  - `unsafe-inline`/`unsafe-eval` for scripts: Next's inline bootstrap and
 *    React refresh in development. Tightening this needs per-request nonces,
 *    which is a separate piece of work.
 *  - connect-src covers Supabase (REST + realtime websockets) and the
 *    key-free upstreams the dispatch console proxies through.
 *  - Bodycam video (0054) is fetched by the browser straight from the
 *    streaming host: the public sample stream, plus whatever hosts the
 *    Hikvision platform streams from, listed in BODYCAM_STREAM_ORIGINS
 *    (space- or comma-separated, e.g. "https://hcm.durban.gov.za:1443").
 *    hls.js plays through blob: media and a blob: worker.
 *  - frame-src allows only SANRAL's i-traffic map (the SANRAL CCTV matrix,
 *    ported from V4); it runs sandboxed in its own origin.
 */
const STREAM_ORIGINS = [
  'https://test-streams.mux.dev',
  ...(process.env.BODYCAM_STREAM_ORIGINS ?? '').split(/[\s,]+/).filter(Boolean),
].join(' ');

/**
 * HikTech Talk (0083): the browser talks straight to the voice server.
 * LiveKit Cloud while testing; a self-hosted server is added in
 * TALK_ORIGINS (e.g. "wss://talk.hiktech.co.za https://talk.hiktech.co.za").
 */
const TALK_ORIGINS = [
  'wss://*.livekit.cloud', 'https://*.livekit.cloud',
  ...(process.env.TALK_ORIGINS ?? '').split(/[\s,]+/).filter(Boolean),
].join(' ');

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // Map tiles (Esri/OSM), department crests and avatars from Supabase storage.
  "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in https://server.arcgisonline.com https://*.tile.openstreetmap.org https://*.arcgisonline.com",
  "font-src 'self' data:",
  `media-src 'self' blob: ${STREAM_ORIGINS}`,
  "worker-src 'self' blob:",
  "frame-src 'self' https://www.i-traffic.co.za",
  `connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co wss://*.supabase.in https://photon.komoot.io https://nominatim.openstreetmap.org https://router.project-osrm.org ${STREAM_ORIGINS} ${TALK_ORIGINS}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: CSP },
  // Defence in depth alongside frame-ancestors, for older browsers.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The console legitimately uses geolocation (dispatch "my position") and
  // the camera (scene evidence); everything else is denied.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Incident data must never sit in a shared cache.
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

/** @type {import('next').NextConfig} */
// Production project: netstream-integrated-solutions/criticomm-new-web.
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@criticom/api', '@criticom/db', '@criticom/ui'],
  // Moved out of `experimental` in Next 15.5
  typedRoutes: false,
  // Version/stack disclosure serves an attacker, not an operator.
  poweredByHeader: false,
  // Scanned certificates (Training) are uploaded through a form action: up to 10 MB each.
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  // The handbook pages are read from disk at request time; make sure they ship
  // with the route that serves them.
  outputFileTracingIncludes: {
    '/admin/handbook/\\[slug\\]': ['./handbook/**/*.html'],
    // The public guides (/guide) read the same files.
    '/guide': ['./handbook/**/*.html'],
    '/guide/\\[slug\\]': ['./handbook/**/*.html'],
    // The police badge on police PDFs (lib/pdf-brand.ts).
    '/api/pdf/**': ['./public/images/dmps-badge.png'],
    '/police/report-centre/export/pdf': ['./public/images/dmps-badge.png'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
    ],
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Authenticated API responses carry operational data — never cache them.
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
        ],
      },
    ];
  },
};
export default nextConfig;
