import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
// Import from the lean `./roles` subpath (pure logic + types only) so the Edge
// middleware bundle never pulls in @supabase/supabase-js's full client.
import { canAccess } from '@criticom/db/roles';
import type { Silo, UserRole } from '@criticom/db/types';

const PUBLIC_PATHS = ['/login', '/reset-password', '/share-location'];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
