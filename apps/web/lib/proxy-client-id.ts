/**
 * Client identity forwarded to the FastAPI backend for rate limiting.
 *
 * Every browser and Android request reaches the backend through these Next
 * route handlers, so without this the backend sees exactly one peer address
 * and its "per-peer" limits collapse into a single global bucket for the whole
 * platform (see apps/api/app/security.py).
 *
 * The backend accepts a declared identity ONLY alongside a valid
 * `VITALIS_PROXY_SECRET`, so these headers are worthless to anyone who cannot
 * present that secret. When the secret is not configured the backend falls
 * back to the peer address and we send nothing.
 *
 * The address itself comes from the hosting platform's own headers, which the
 * platform overwrites on ingress (Vercel replaces client-supplied
 * `x-forwarded-for`). `x-real-ip` is preferred; otherwise the LEFT-most
 * `x-forwarded-for` entry, which on such a platform is the real client.
 * Only set `VITALIS_PROXY_SECRET` when the web tier sits behind a trusted edge
 * — documented in docs/DEPLOYMENT.md.
 */
const MAX_CLIENT_ID = 64;
const CLIENT_ID_RE = /^[0-9a-fA-F.:_-]+$/;

function sanitize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CLIENT_ID) return null;
  return CLIENT_ID_RE.test(trimmed) ? trimmed : null;
}

/** Headers to merge into the upstream request; empty when not configured. */
export function proxyIdentityHeaders(request: Request): Record<string, string> {
  const secret = process.env.VITALIS_PROXY_SECRET;
  if (!secret) return {};
  const headers: Record<string, string> = { 'X-Vitalis-Proxy-Secret': secret };
  const client =
    sanitize(request.headers.get('x-real-ip')) ??
    sanitize(request.headers.get('x-forwarded-for')?.split(',')[0]);
  if (client) headers['X-Vitalis-Client'] = client;
  return headers;
}
