import { NextRequest } from 'next/server';
import { access } from '../../../lib/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const allowed =
  /^(snapshot|demo|vitals|patients\/p[1-8]\/documents|alerts\/[a-f0-9-]+\/acknowledge|documents\/[a-f0-9-]+\/original|fixtures\/(attack|clean))$/;
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const denied = access(request.headers);
  if (denied) return denied;
  const path = (await params).path.join('/');
  if (!allowed.test(path)) return Response.json({ detail: 'Not found' }, { status: 404 });
  const origin = request.headers.get('origin');
  let sameOrigin = !origin;
  try {
    if (origin)
      sameOrigin =
        new URL(origin).host === request.headers.get('host') &&
        ['http:', 'https:'].includes(new URL(origin).protocol);
  } catch {
    sameOrigin = false;
  }
  if (request.method !== 'GET' && (request.headers.get('sec-fetch-site') === 'cross-site' || !sameOrigin))
    return Response.json({ detail: 'Cross-origin mutation rejected' }, { status: 403 });
  const limit = 5 * 1024 * 1024 + 16384;
  if (Number(request.headers.get('content-length')) > limit)
    return Response.json({ detail: 'Upload exceeds 5 MB' }, { status: 413 });
  try {
    let body: Uint8Array | undefined;
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
    const headers: Record<string, string> = {};
    if (request.headers.has('content-type')) headers['Content-Type'] = request.headers.get('content-type')!;
    if (process.env.API_TOKEN) headers.Authorization = `Bearer ${process.env.API_TOKEN}`;
    const upstream = await fetch(`${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/api/${path}`, {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-type', 'content-disposition'])
      if (upstream.headers.has(name)) responseHeaders.set(name, upstream.headers.get(name)!);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json(
      { detail: 'Clinical stream unavailable. Check that the backend is running.' },
      { status: 503 },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
