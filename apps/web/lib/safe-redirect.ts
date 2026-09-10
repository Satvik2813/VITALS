/**
 * Only a same-origin, absolute application path is a safe post-login
 * destination. Rejects anything that could change the URL's authority when
 * concatenated onto an origin: a protocol-relative "//host", backslashes
 * that some browsers normalize to slashes, an embedded scheme, or a bare
 * path that doesn't start with "/". Falls back to `fallback` (default
 * "/app") on anything unrecognized.
 */
export function safeNext(value: string | null | undefined, fallback = '/app'): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  if (value.includes('\\')) return fallback;
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return fallback;
  return value;
}
