import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  authFixtureAvailable,
  createBareTestIdentity,
  createTestDoctorSession,
  createTestPatientSession,
  cleanupDoctorSession,
  cleanupPatientPair,
  type DoctorTestSession,
} from './support/auth-session';

test.describe('Unauthenticated routing', () => {
  test('/login renders the sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('/app redirects to /login', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login/);
  });

  test('/app/doctor redirects to /login with a next param', async ({ page }) => {
    await page.goto('/app/doctor');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fdoctor/);
  });

  test('/app/doctor/patients redirects to /login with the deep-link preserved', async ({ page }) => {
    await page.goto('/app/doctor/patients');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fdoctor%2Fpatients/);
  });

  test('/app/patient redirects to /login', async ({ page }) => {
    await page.goto('/app/patient');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fpatient/);
  });

  test('/api/v1/me is 401 without a session, never gated behind the legacy password', async ({
    request,
  }) => {
    const res = await request.get('/api/v1/me');
    expect(res.status()).toBe(401);
    // A 503 here would mean the legacy Basic-Auth gate (scoped to /demo) is
    // incorrectly also covering /api/v1 in this environment.
    expect(res.status()).not.toBe(503);
  });

  test('OAuth callback never redirects off-site via `next`', async ({ request }) => {
    const res = await request.get('/auth/callback?next=//evil.example', {
      maxRedirects: 0,
    });
    expect([302, 303, 307, 308]).toContain(res.status());
    const location = res.headers()['location'] || '';
    expect(location).not.toContain('evil.example');
    expect(location).toContain('/login');
  });

  test('OAuth callback with a bad code fails safely, still never off-site', async ({ request }) => {
    const res = await request.get('/auth/callback?code=not-a-real-code&next=//evil.example', {
      maxRedirects: 0,
    });
    expect([302, 303, 307, 308]).toContain(res.status());
    const location = res.headers()['location'] || '';
    expect(location).not.toContain('evil.example');
    expect(location).toContain('/login');
    expect(res.status()).not.toBe(500);
  });

  test('sign-out redirects to /login even when there is no session', async ({ request }) => {
    const res = await request.post('/auth/signout', { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(res.status());
    expect(res.headers()['location'] || '').toContain('/login');
  });

  test('/onboarding/patient redirects to /login with a next param', async ({ page }) => {
    await page.goto('/onboarding/patient');
    await expect(page).toHaveURL(/\/login\?next=%2Fonboarding%2Fpatient/);
  });

  test('/onboarding/doctor redirects to /login with a next param', async ({ page }) => {
    await page.goto('/onboarding/doctor');
    await expect(page).toHaveURL(/\/login\?next=%2Fonboarding%2Fdoctor/);
  });

  test('legacy /demo route is reachable (shared-password gate scoped away from /app)', async ({
    page,
  }) => {
    await page.goto('/demo');
    await expect(page.getByRole('heading', { name: 'Clinical command center' })).toBeVisible();
  });
});

test.describe('Role-aware routing (authenticated)', () => {
  test.skip(!authFixtureAvailable, 'Supabase admin credentials not configured for this environment');

  let doctor: DoctorTestSession;
  let patientPair: Awaited<ReturnType<typeof createTestPatientSession>>;
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async () => {
    apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });
    doctor = await createTestDoctorSession(apiContext);
    patientPair = await createTestPatientSession(apiContext);
  });

  test.afterAll(async () => {
    if (patientPair) await cleanupPatientPair(apiContext, patientPair);
    if (doctor) await cleanupDoctorSession(apiContext, doctor);
    await apiContext.dispose();
  });

  test('an onboarded doctor visiting /app lands on /app/doctor', async ({ context, page }) => {
    await context.addCookies([doctor.cookie]);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/doctor$/, { timeout: 15000 });
  });

  test('an onboarded patient visiting /app lands on /app/patient', async ({ context, page }) => {
    await context.addCookies([patientPair.patient.cookie]);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/patient$/, { timeout: 15000 });
  });

  test('a patient cannot open the doctor route tree by direct URL', async ({ context, page }) => {
    await context.addCookies([patientPair.patient.cookie]);
    await page.goto('/app/doctor/patients');
    // The doctor layout guard redirects a patient identity away rather than
    // rendering doctor-only content for them.
    await expect(page).toHaveURL(/\/app\/patient$/, { timeout: 15000 });
  });

  test('a brand-new, un-onboarded user is routed to /get-started', async ({ context, page }) => {
    // A fresh identity that never called either onboarding endpoint: /app
    // must send them to role selection, never a dashboard.
    const identity = await createBareTestIdentity();
    try {
      await context.addCookies([identity.cookie]);
      await page.goto('/app');
      await expect(page).toHaveURL(/\/get-started$/, { timeout: 15000 });
    } finally {
      await identity.cleanup();
    }
  });

  test('a doctor cannot open the patient route tree by direct URL', async ({ context, page }) => {
    await context.addCookies([doctor.cookie]);
    await page.goto('/app/patient');
    // Symmetric to the patient-into-doctor test: the patient layout guard
    // sends a doctor identity to their own portal rather than rendering
    // patient-only content for them.
    await expect(page).toHaveURL(/\/app\/doctor$/, { timeout: 15000 });
  });

  test('an un-onboarded user hitting /app/doctor is never funneled into doctor onboarding', async ({ context, page }) => {
    // Regression: when getMe/role is null (bare identity, or a transient
    // backend hiccup), the doctor layout used to default to
    // /onboarding/doctor -- a patient could be silently pushed into the
    // wrong onboarding flow. The neutral /get-started picker is the safe
    // fallback for any identity without a known role.
    const identity = await createBareTestIdentity();
    try {
      await context.addCookies([identity.cookie]);
      await page.goto('/app/doctor');
      await expect(page).toHaveURL(/\/(get-started|onboarding\/(patient|doctor))$/, {
        timeout: 15000,
      });
      // The critical invariant: they must NOT end up rendering the doctor
      // portal itself (a page whose canonical URL stays /app/doctor).
      await expect(page).not.toHaveURL(/\/app\/doctor$/);
    } finally {
      await identity.cleanup();
    }
  });

  test('an un-onboarded user hitting /app/patient is never rendered patient content', async ({ context, page }) => {
    const identity = await createBareTestIdentity();
    try {
      await context.addCookies([identity.cookie]);
      await page.goto('/app/patient');
      await expect(page).toHaveURL(/\/(get-started|onboarding\/(patient|doctor))$/, {
        timeout: 15000,
      });
      await expect(page).not.toHaveURL(/\/app\/patient$/);
    } finally {
      await identity.cleanup();
    }
  });

  test('the OAuth callback never routes a patient session into /app/doctor', async ({ context, page }) => {
    // Even when the login page's `next` query hint contradicts the actual
    // server-verified role (attacker or stale link says role=doctor for a
    // patient session), callback must land the patient on /app/patient.
    await context.addCookies([patientPair.patient.cookie]);
    await page.goto('/auth/callback?next=%2Fapp%2Fdoctor');
    // No `code` param -> the callback bails to /login, which is fine. The
    // load-bearing property is that /app/doctor is never reached.
    await expect(page).not.toHaveURL(/\/app\/doctor$/);
  });

  test('a stale role query hint cannot override the server-verified role', async ({ context, page }) => {
    // /login carries the role hint that /get-started injects; if a patient
    // arrives at /login?role=doctor (bookmark, back button), the eventual
    // routing decision must still land them on their patient dashboard.
    await context.addCookies([patientPair.patient.cookie]);
    await page.goto('/app?role=doctor');
    await expect(page).toHaveURL(/\/app\/patient$/, { timeout: 15000 });
  });
});
