'use client';
import { createBrowserClient } from '@supabase/ssr';
import { supabaseEnv } from './env';

export function createClient() {
  const { url, anon } = supabaseEnv();
  return createBrowserClient(url, anon);
}
