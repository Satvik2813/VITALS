import { NextRequest, NextResponse } from 'next/server';
import { access } from './lib/auth';
import { updateSession } from './lib/supabase/middleware';

// Paths that require a signed-in Supabase session (see auth-required check
// below); everything else under isPublic() is reachable without one.
const AUTH_REQUIRED_PREFIXES = ['/app', '/onboarding'];

// Paths that must be reachable without the legacy shared-password gate.
// The public landing (/), the role-selection and login flow, the OAuth
// callback, and the signed-in /app/* and /onboarding/* experiences (which
// use Supabase auth on their own) all live here. The legacy /demo route
// KEEPS the shared-password gate below.
function isPublic(path: string) {
  if (path === '/' || path === '/login' || path === '/get-started') return true;
  if (path.startsWith('/auth/')) return true;
  if (path.startsWith('/app')) return true; // Supabase auth handles /app/*
  if (path.startsWith('/onboarding')) return true; // Supabase auth handles /onboarding/*
  if (path.startsWith('/api/v1')) return true; // Supabase JWT proxy
  // VITALIS Bridge pairing/upload for the Android client. It authenticates
  // with its own device credential (or, for /pair, with the bridge code), so
  // the legacy shared-password gate must not stand in front of it. The route
  // itself allowlists exactly which bridge paths it will forward.
  if (path.startsWith('/api/bridge')) return true;
  if (path === '/favicon.svg' || path === '/vitalis-logo.svg') return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (isPublic(path)) {
    const { response, user } = await updateSession(request);
    const needsAuth = AUTH_REQUIRED_PREFIXES.some((prefix) => path.startsWith(prefix));
    if (needsAuth && !user) {
      const login = request.nextUrl.clone();
      login.pathname = '/login';
      login.searchParams.set('next', path);
      // updateSession() may have refreshed or cleared the Supabase session
      // cookies on `response` (a NextResponse.next()). Redirecting with a
      // fresh NextResponse.redirect() would silently drop those Set-Cookie
      // instructions, leaving a stale/invalid cookie in the browser. Carry
      // them over explicitly so refresh/clear always survives the redirect.
      const redirect = NextResponse.redirect(login);
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return redirect;
    }
    return response;
  }

  // Legacy /demo and legacy /api/* keep the shared-password gate.
  const gate = access(request.headers);
  if (gate) return gate;
  return (await updateSession(request)).response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
