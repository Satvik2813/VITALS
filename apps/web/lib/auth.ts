import { timingSafeEqual } from 'node:crypto';
export function access(headers: Headers): Response | null {
  const password = process.env.VITALIS_ACCESS_PASSWORD;
  if (!password)
    return process.env.VERCEL || process.env.NODE_ENV === 'production'
      ? new Response('Configure VITALIS_ACCESS_PASSWORD before hosting.', { status: 503 })
      : null;
  const expected = Buffer.from(
    'Basic ' + Buffer.from(`${process.env.VITALIS_ACCESS_USER || 'doctor'}:${password}`).toString('base64'),
  );
  const actual = Buffer.from(headers.get('authorization') || '');
  if (actual.length === expected.length && timingSafeEqual(actual, expected)) return null;
  return new Response('Sign in to VITALIS', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="VITALIS", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}
