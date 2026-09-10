import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  authFixtureAvailable,
  createTestDoctorSession,
  cleanupDoctorSession,
  type DoctorTestSession,
} from './support/auth-session';

test.describe('Doctor experience (authenticated)', () => {
  test.skip(!authFixtureAvailable, 'Supabase admin credentials not configured for this environment');

  let session: DoctorTestSession;
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async () => {
    apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });
    session = await createTestDoctorSession(apiContext);
  });

  test.afterAll(async () => {
    if (session) await cleanupDoctorSession(apiContext, session);
    await apiContext.dispose();
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([session.cookie]);
  });

  test('overview loads with real authenticated data', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/app/doctor');
    await expect(page).toHaveURL(/\/app\/doctor$/);
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByText('E2E Synthetic Patient')).toBeVisible({ timeout: 15000 });
    expect(errors).toEqual([]);
  });

  test('sidebar navigation renders every primary section and no patient-view switcher', async ({ page }) => {
    await page.goto('/app/doctor');
    // aria-label lives on the <aside> (complementary landmark), not the
    // <nav> it wraps -- scope by that landmark rather than a "navigation"
    // role lookup, which would see an unnamed <nav>.
    const sidebar = page.getByRole('complementary', { name: 'Primary navigation' });
    for (const label of [
      'Overview',
      'Patients',
      'Live monitoring',
      'Alerts',
      'Documents',
      'Security center',
      'Notifications',
      'Settings',
    ]) {
      await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    // Patient and doctor are separate authenticated roles now, not a UI
    // preview toggle -- this control must not exist anywhere in the shell.
    await expect(page.getByText('Patient view')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Open patient view/i })).toHaveCount(0);
  });

  test('patients page loads, lists the seeded patient, and search filters it', async ({ page }) => {
    await page.goto('/app/doctor/patients');
    await expect(page.getByRole('heading', { name: 'Patients', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'E2E Synthetic Patient' })).toBeVisible({
      timeout: 15000,
    });

    const search = page.getByLabel('Search patients');
    await search.fill('E2E Synthetic');
    await expect(page.getByRole('link', { name: 'E2E Synthetic Patient' })).toBeVisible();

    await search.fill('no-such-patient-xyz');
    await expect(page.getByText(/No matches|No patients yet/)).toBeVisible();
  });

  test('patient detail route shows vitals, trend, and alerts panels', async ({ page }) => {
    await page.goto('/app/doctor/patients');
    await page.getByRole('link', { name: 'E2E Synthetic Patient' }).click({ timeout: 15000 });
    await expect(page).toHaveURL(/\/app\/doctor\/patients\/[a-f0-9-]+$/, { timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'E2E Synthetic Patient' })).toBeVisible();
    // The abnormal seeded reading (HR 178) should be the latest value shown.
    await expect(page.getByText('178', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Vitals trend (recent)')).toBeVisible();
    // Alerts panel renders either real alerts or its own empty state -- the
    // exact risk state a trained model assigns isn't something this test
    // should assume, only that the panel never crashes either way.
    await expect(page.getByText(/Open alerts/)).toBeVisible();
  });

  test('direct URL access to another doctor\'s patient is denied', async ({ page }) => {
    const otherApiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });
    const otherDoctor = await createTestDoctorSession(otherApiContext);
    try {
      // otherDoctor's own seeded patient is NOT assigned to `session`'s
      // doctor -- guessing its URL must never expose their record.
      await page.goto(`/app/doctor/patients/${otherDoctor.patientId}`);
      // Scoped past role alone: Next's route announcer (#__next-route-announcer__)
      // also carries role="alert", so an unscoped getByRole('alert') is ambiguous.
      await expect(page.getByText('Patient not found')).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('heading', { name: 'E2E Synthetic Patient' })).toHaveCount(0);
    } finally {
      await cleanupDoctorSession(otherApiContext, otherDoctor);
      await otherApiContext.dispose();
    }
  });

  test('alerts queue loads and never crashes on an empty or populated result', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/app/doctor/alerts');
    await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
    await expect(page.getByText(/No active alerts|E2E Synthetic Patient/)).toBeVisible({
      timeout: 15000,
    });
    expect(errors).toEqual([]);
  });

  test('security center loads with real posture signals from scanned documents', async ({ page }) => {
    await page.goto('/app/doctor/security');
    await expect(page.getByRole('heading', { name: 'Security center' })).toBeVisible();
    await expect(page.getByText('Gateway', { exact: true })).toBeVisible();
    // Real, authenticated document scanning now lives on /app/doctor/documents itself
    // (no more hand-off to the legacy /demo gateway); the security center links there.
    await expect(page.getByRole('link', { name: /documents/i }).first()).toHaveAttribute(
      'href',
      '/app/doctor/documents',
    );
  });

  test('documents page shows an honest empty state and can upload a real document to scan', async ({ page }) => {
    await page.goto('/app/doctor/documents');
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    await expect(page.getByText('No scans yet')).toBeVisible();

    await page.setInputFiles('input[type="file"]', {
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Routine follow-up note. Vitals stable overnight.'),
    });
    await page.getByRole('button', { name: /Upload & scan/i }).click();
    await expect(page.getByText('note.txt')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('TRUSTED')).toBeVisible();
  });

  test('notifications page reflects real alert state, not a static placeholder', async ({ page }) => {
    await page.goto('/app/doctor/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    // The fixture doctor has one clearly-abnormal reading, so an alert is the
    // expected case -- but the exact model output isn't something a UI test
    // should pin down, so accept either honest outcome.
    await expect(page.getByText(/Nothing new|E2E Synthetic Patient/)).toBeVisible({ timeout: 15000 });
  });

  test('settings loads real /api/v1/me data, has no experience switcher, and exposes sign-out', async ({ page }) => {
    await page.goto('/app/doctor/settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    const profilePanel = page.locator('section', { has: page.getByRole('heading', { name: 'Profile' }) });
    await expect(profilePanel.getByText('E2E Test Doctor')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Experience switcher' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Open patient view/i })).toHaveCount(0);
    const sessionPanel = page.locator('section', { has: page.getByRole('heading', { name: 'Session' }) });
    await expect(sessionPanel.getByRole('button', { name: /Sign out/i })).toBeVisible();
  });

  test('a doctor cannot use /app/patient as an experience switcher', async ({ page }) => {
    await page.goto('/app/patient');
    // The patient layout guard redirects a doctor identity straight back to
    // their own dashboard rather than rendering the patient shell for them.
    await expect(page).toHaveURL(/\/app\/doctor$/, { timeout: 15000 });
  });

  test('desktop layout: sidebar, stat cards, and patients table render without overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto('/app/doctor/patients');
    await expect(page.getByRole('link', { name: 'E2E Synthetic Patient' })).toBeVisible({
      timeout: 15000,
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('add-patient dialog opens, is keyboard reachable, and can be cancelled', async ({ page }) => {
    await page.goto('/app/doctor/patients');
    await page.getByRole('button', { name: 'Add patient' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add patient' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Full name')).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
  });
});
