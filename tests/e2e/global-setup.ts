/**
 * Next.js dev mode (Turbopack) compiles each route on first request, which
 * can take 10-30s+ on a cold server -- long enough that a test's click can
 * race ahead of hydration and silently no-op. Touching every route once
 * before the suite runs moves that cost here (with a generous budget)
 * instead of flaking individual tests.
 */
const ROUTES = [
  '/',
  '/login',
  '/get-started',
  '/onboarding/patient',
  '/onboarding/doctor',
  '/demo',
  '/app/doctor',
  '/app/doctor/patients',
  '/app/doctor/alerts',
  '/app/doctor/security',
  '/app/doctor/documents',
  '/app/doctor/notifications',
  '/app/doctor/settings',
  '/app/patient',
  '/app/patient/vitals',
  '/app/patient/history',
  '/app/patient/alerts',
  '/app/patient/doctor',
  '/app/patient/device',
  '/app/patient/profile',
  '/auth/callback',
];

export default async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
  for (const route of ROUTES) {
    try {
      await fetch(`${baseURL}${route}`, { signal: AbortSignal.timeout(45000) });
    } catch {
      // A route failing to warm isn't fatal -- the real test will surface
      // whatever's actually wrong with a normal failure, just possibly slower.
    }
  }
}
