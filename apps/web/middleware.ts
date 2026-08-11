import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
// Import from the lean `./roles` subpath (pure logic + types only) so the Edge
// middleware bundle never pulls in @supabase/supabase-js's full client.
import { canAccess } from '@criticom/db/roles';
import type { Silo, UserRole } from '@criticom/db/types';

const PUBLIC_PATHS = ['/login', '/reset-password', '/share-location'];

/**
 * The landing page. Kept out of PUBLIC_PATHS because that list is prefix-based
 * and '/' is a prefix of everything — an exact match is the only safe form.
 */
const LANDING_PATH = '/';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Per-tenant access rules (migration 0035) — the SuperAdmin's deny-only
 * overlay on the route matrix. Cached per tenant for 60s so the edge does one
 * small indexed read a minute, not one per request; a toggle therefore takes
 * effect within a minute, which the Access Control console says out loud.
 *
 * Deliberately inlined rather than imported from @criticom/api: the edge
 * bundle must not pull the full client package, and the logic is six lines.
 */
type AccessRule = { href: string; role: string; allowed: boolean };
const RULES_TTL_MS = 60_000;
const rulesCache = new Map<string, { at: number; rules: AccessRule[] }>();

async function tenantRules(
  supabase: { from: (t: string) => { select: (c: string) => PromiseLike<{ data: AccessRule[] | null }> } },
  tenantKey: string,
): Promise<AccessRule[]> {
  const hit = rulesCache.get(tenantKey);
  if (hit && Date.now() - hit.at < RULES_TTL_MS) return hit.rules;
  try {
    // RLS scopes the query to the caller's tenant — no filter needed here.
    const { data } = await supabase.from('access_rules').select('href, role, allowed');
    const rules = data ?? [];
    rulesCache.set(tenantKey, { at: Date.now(), rules });
    return rules;
  } catch {
    // Fail open to "no denials": the matrix and flags still stand underneath.
    return hit?.rules ?? [];
  }
}

function ruleDenied(rules: AccessRule[], role: string, pathname: string): boolean {
  if (role === 'SuperAdmin') return false; // the rule-writer can never be locked out
  return rules.some(
    (r) => !r.allowed
      && (r.role === '*' || r.role === role)
      && (pathname === r.href || pathname.startsWith(`${r.href}/`)),
  );
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  // If Supabase env isn't configured on this deployment, don't crash the whole
  // site — let the request through (pages/route handlers surface the config error).
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) {
          response.cookies.set({ name, value, ...options });
        }
      },
    },
  });

  const { pathname } = request.nextUrl;
  const isPublic = pathname === LANDING_PATH
    || PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // API callers need a status code they can branch on. Redirecting them to the
  // HTML login page yields a 200 full of markup and the classic
  // "Unexpected token '<'" JSON parse error at the call site.
  const isApi = pathname.startsWith('/api/');

  // A failed auth lookup (network blip, bad token) must never 500 the edge —
  // treat it as "no user" and fall through to the redirect logic below.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null;
  try {
    ({ data: { user } } = await supabase.auth.getUser());
  } catch {
    user = null;
  }

  // Unauthenticated → 401 for APIs, bounce to login for pages.
  if (!user && !isPublic) {
    if (isApi) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Already logged in and on /login → go to dashboard
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Role + silo route enforcement (mirrors V4 [Authorize(Roles=…)] matrix)
  if (user) {
    const userSilo = (user.app_metadata?.silo ?? 'Ethekwini') as Silo;
    const userRole = (user.app_metadata?.role ?? 'Viewer') as UserRole;

    if (!isPublic && !canAccess(pathname, userRole, userSilo)) {
      if (isApi) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = '/403';
      return NextResponse.redirect(url);
    }

    // The SuperAdmin's per-tenant overlay: only checked once the code matrix
    // has allowed the route, because rules can only subtract. Page routes
    // only — APIs are guarded by feature flags and their own role checks.
    if (!isPublic && !isApi && pathname !== '/403' && pathname !== '/dashboard') {
      const tenantKey = (user.app_metadata?.tenant_id as string | undefined) ?? 'founding';
      const rules = await tenantRules(supabase, tenantKey);
      if (ruleDenied(rules, userRole, pathname)) {
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard';
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *   - _next/static, _next/image, api/health
     *   - any static asset by extension (public/ files like the logo — without
     *     this, the login page's own <img> gets redirected to /login and the
     *     browser renders a broken image instead of the brand)
     */
    '/((?!_next/static|_next/image|api/health|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|css|js|map|txt|xml|woff2?)$).*)',
  ],
};
