import { NextRequest } from 'next/server';
import { getAccessToken } from '../../../../lib/supabase/server';
import { proxyIdentityHeaders } from '../../../../lib/proxy-client-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// This route is Supabase-JWT authenticated (see getAccessToken() below) and
// must NOT also require the legacy shared-password gate from lib/auth.ts —
// that gate is scoped to the /demo synthetic dashboard only. Requiring both
// would lock real, authenticated doctors/patients out of /app in production.
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join('/');
  const search = request.nextUrl.search;

  const origin = request.headers.get('origin');
  let sameOrigin = !origin;
  try {
    if (origin) {
      const u = new URL(origin);
      sameOrigin = u.host === request.headers.get('host') && ['http:', 'https:'].includes(u.protocol);
    }
  } catch {
    sameOrigin = false;
  }
  if (request.method !== 'GET' && (request.headers.get('sec-fetch-site') === 'cross-site' || !sameOrigin))
    return Response.json({ detail: 'Cross-origin mutation rejected' }, { status: 403 });

  const limit = 5 * 1024 * 1024 + 16384;
  if (Number(request.headers.get('content-length')) > limit)
    return Response.json({ detail: 'Upload exceeds 5 MB' }, { status: 413 });

  const token = await getAccessToken();
  if (!token) return Response.json({ detail: 'Not authenticated' }, { status: 401 });

  try {
    let body: BodyInit | undefined;
    if (request.method !== 'GET' && request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          return Response.json({ detail: 'Upload exceeds 5 MB' }, { status: 413 });
        }
        chunks.push(value);
      }
      body = Buffer.concat(chunks);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      // Preserve per-client rate limiting across this proxy hop.
      ...proxyIdentityHeaders(request),
    };
    const ct = request.headers.get('content-type');
    if (ct) headers['Content-Type'] = ct;
    const upstream = await fetch(
      `${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/api/v1/${path}${search}`,
      {
        method: request.method,
        headers,
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      },
    );
    const responseHeaders = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of ['content-type', 'content-disposition', 'retry-after']) {
      if (upstream.headers.has(name)) responseHeaders.set(name, upstream.headers.get(name)!);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ detail: 'API unavailable. Check that the backend is running.' }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
