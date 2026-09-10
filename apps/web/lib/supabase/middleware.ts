import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { supabaseConfigured, supabaseEnv } from './env';

// Refreshes the Supabase auth session cookies and returns a { response, user } pair.
// Follows the pattern in @supabase/ssr docs for Next middleware.
export async function updateSession(request: NextRequest) {
  if (!supabaseConfigured()) {
    return { response: NextResponse.next({ request }), user: null };
  }
  const { url, anon } = supabaseEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list: { name: string; value: string; options: CookieOptions }[]) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { response, user };
}
