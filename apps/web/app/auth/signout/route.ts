import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '../../../lib/supabase/server';

export async function POST(request: NextRequest) {
  // request.nextUrl.origin is derived from the trusted host Next.js resolved
  // this request against, never from user-controlled input, so it's safe to
  // build the redirect target from unconditionally.
  const destination = new URL('/login', request.nextUrl.origin);
  let ok = true;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) ok = false;
  } catch {
    ok = false;
  }
  if (!ok) {
    // Never leave the user stranded on a signout failure, and never leak
    // error internals in the URL.
    destination.searchParams.set('error', 'signout_failed');
  }
  const response = NextResponse.redirect(destination, { status: 303 });
  // Belt-and-braces: even if the Supabase SSR client's cookie writes were
  // silently dropped, explicitly clear every sb-* auth cookie so the next
  // navigation cannot re-adopt the previous account's role. This prevents
  // the "signed out as doctor, signed in as patient, still see doctor
  // portal" cross-role leak on transient cookie-write failures.
  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name.startsWith('sb-')) {
      response.cookies.set(c.name, '', { path: '/', maxAge: 0 });
    }
  }
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith('sb-')) {
      response.cookies.set(c.name, '', { path: '/', maxAge: 0 });
    }
  }
  return response;
}
