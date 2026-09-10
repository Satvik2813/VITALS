import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { getMe } from '../../../lib/server-me';
import { safeNext } from '../../../lib/safe-redirect';

const ONBOARDING_PATHS = new Set(['/onboarding/patient', '/onboarding/doctor']);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  if (!code) {
    // Not a valid callback invocation. Never silently "succeed".
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Don't reflect provider/library error details into the redirect URL.
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  // Route by the caller's REAL, server-verified profile state -- never by
  // trusting `next`/`role` hints for anything authorization-sensitive. Those
  // hints only pick which onboarding form to show a brand-new signup; they
  // are re-validated here against the actual database row.
  const me = await getMe();

  if (me?.role && me.onboarding_completed) {
    // POSITIVE role match only -- do NOT collapse "not patient" into doctor,
    // which is how transient/unexpected states leaked users into the wrong
    // portal. Anything unrecognized falls back to the neutral role picker.
    let dashboard: string | null = null;
    if (me.role === 'patient') dashboard = '/app/patient';
    else if (me.role === 'doctor' || me.role === 'admin') dashboard = '/app/doctor';
    if (dashboard) {
      // Honor a same-role deep link (e.g. a protected route that redirected
      // here to sign in) instead of always bouncing to the dashboard root.
      // `next` is treated strictly as a UX hint here; it can only redirect
      // WITHIN the caller's own role tree, never bypass a role guard.
      const target = next.startsWith(dashboard) ? next : dashboard;
      return NextResponse.redirect(`${origin}${target}`);
    }
    return NextResponse.redirect(`${origin}/get-started`);
  }

  // New or incomplete signup: send to the requested onboarding flow if one
  // was specified, otherwise let them choose a role.
  if (ONBOARDING_PATHS.has(next)) {
    return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/get-started`);
}
