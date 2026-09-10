import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { supabaseEnv } from './env';

export async function createClient() {
  const { url, anon } = supabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list: { name: string; value: string; options: CookieOptions }[]) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Route Handlers may not allow set; ignore -- proxy handles refresh.
        }
      },
    },
  });
}

export async function getUser() {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  return data.user;
}

export async function getAccessToken() {
  const client = await createClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}
