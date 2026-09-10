import { NextRequest } from 'next/server';
import { proxyIdentityHeaders } from '../../../../lib/proxy-client-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public passthrough for the VITALIS Bridge Android client.
 *
 * This exists so the handset has ONE public base URL (the web origin) instead
 * of needing the FastAPI host exposed separately. It is deliberately not the
 * `/api/v1/[...path]` proxy:
 *
 *   * It never reads the Supabase session and never injects a JWT. The only
 *     credential it moves is the client's own `vtb_` device token, forwarded
 *     verbatim for the backend to validate.
 *   * Because it injects no ambient credential, there is nothing for a
 *     cross-origin browser request to abuse — so, unlike the v1 proxy, it does
 *     not (and must not) reject requests without a same-origin `Origin`
 *     header: a native Android client sends none.
 *   * The path allowlist below is exhaustive on purpose. Patient-authenticated
 *     bridge routes (`/bridge/code`, `/bridge/code/regenerate`,
 *     `/bridge/devices/*`) are NOT reachable here; they stay behind the
 *     session-authenticated v1 proxy where they belong.
 *
 * See docs/BRIDGE.md for the contract this serves.
 */
const ALLOWED: Record<string, readonly string[]> = {
  pair: ['POST'],
  session: ['GET'],
  vitals: ['POST'],
  unpair: ['POST'],
};

// Bridge bodies are small JSON documents; nothing here uploads a file.
const MAX_BODY = 64 * 1024;

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const segments = (await params).path;
  const allowedMethods = segments.length === 1 ? ALLOWED[segments[0]] : undefined;
  if (!allowedMethods) return Response.json({ detail: 'Not found' }, { status: 404 });
  if (!allowedMethods.includes(request.method))
    return Response.json({ detail: 'Method not allowed' }, { status: 405 });

  if (Number(request.headers.get('content-length')) > MAX_BODY)
    return Response.json({ detail: 'Request body exceeds size limit' }, { status: 413 });

  try {
    let body: BodyInit | undefined;
    if (request.method !== 'GET' && request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BODY) {
          await reader.cancel();
          return Response.json({ detail: 'Request body exceeds size limit' }, { status: 413 });
        }
        chunks.push(value);
      }
      body = Buffer.concat(chunks);
    }

    // Preserve per-handset rate limiting across this proxy hop: without it
    // the backend sees one peer for every device on earth, which would make
    // the pairing brute-force bound a platform-wide denial of service.
    const headers: Record<string, string> = { ...proxyIdentityHeaders(request) };
    // Forwarded as-is; this route never mints, reads or logs a credential.
    const auth = request.headers.get('authorization');
    if (auth) headers['Authorization'] = auth;
    headers['Content-Type'] = 'application/json';

    const upstream = await fetch(
      `${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/api/v1/bridge/${segments[0]}`,
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
    for (const name of ['content-type', 'retry-after', 'www-authenticate']) {
      if (upstream.headers.has(name)) responseHeaders.set(name, upstream.headers.get(name)!);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ detail: 'API unavailable. Check that the backend is running.' }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
