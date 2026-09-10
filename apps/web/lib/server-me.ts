import { getAccessToken } from './supabase/server';
import type { Me } from './api-v1';

/**
 * Server-side-only fetch of the caller's platform profile, hitting the
 * FastAPI backend directly (not the /api/v1 Next proxy, which expects to run
 * inside a browser request/response cycle for cookie forwarding). Used by
 * route handlers and layouts that need to make a routing decision -- doctor
 * vs patient vs onboarding -- before rendering anything.
 *
 * Returns null if there is no session or the backend call fails; callers
 * should treat that the same as "not onboarded" for routing purposes rather
 * than crash the page.
 */
export async function getMe(): Promise<Me | null> {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/api/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}
