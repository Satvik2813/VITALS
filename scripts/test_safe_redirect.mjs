// Regression test for the OAuth callback's open-redirect guard.
// A real Google authorization `code` cannot be obtained non-interactively,
// so this exercises the extracted pure function directly instead of the
// full /auth/callback route.
// node scripts/test_safe_redirect.mjs
import assert from 'node:assert/strict';
import { safeNext } from '../apps/web/lib/safe-redirect.ts';

let checks = 0;
const ok = (value, expected) => {
  assert.equal(safeNext(value), expected, `safeNext(${JSON.stringify(value)})`);
  checks++;
};

// Safe: same-origin absolute application paths pass through unchanged.
ok('/app', '/app');
ok('/app/doctor', '/app/doctor');
ok('/app/patient/vitals?x=1', '/app/patient/vitals?x=1');
ok('/', '/');

// Unsafe: must all fall back to /app, never reach the attacker's target.
ok(null, '/app');
ok(undefined, '/app');
ok('', '/app');
ok('evil.example', '/app'); // no leading slash
ok('//evil.example', '/app'); // protocol-relative
ok('///evil.example', '/app');
ok('/\\evil.example', '/app'); // backslash normalizes to // in some browsers
ok('\\\\evil.example', '/app');
// Percent-encoded slashes are never decoded before use, so this resolves to
// a same-origin path segment, not a host change -- safe to pass through.
ok('/%2F%2Fevil.example', '/%2F%2Fevil.example');
ok('javascript:alert(1)', '/app'); // no leading slash
ok('/javascript:alert(1)', '/app'); // embedded scheme after a leading slash
ok('https://evil.example', '/app');
ok('/https://evil.example', '/app'); // still rejected: scheme-looking segment after slash
ok('http:evil.example', '/app');

console.log(`${checks} safe-redirect checks passed.`);
