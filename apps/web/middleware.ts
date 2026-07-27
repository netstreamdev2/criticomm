import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { canAccess, type Silo, type UserRole } from '@criticom/db';

const PUBLIC_PATHS = ['/login', '/reset-password', '/share-location'];

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies) {
            response.cookies.set({ name, value, ...options });
          }
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Unauthenticated → bounce to login (except public routes)
  if (!user && !isPublic) {
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
     * Match all request paths except for:
     *   _next/static, _next/image, favicon.ico, api/health
     */
    '/((?!_next/static|_next/image|favicon.ico|api/health).*)',
  ],
};
