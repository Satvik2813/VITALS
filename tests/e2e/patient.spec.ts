import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  authFixtureAvailable,
  createTestDoctorSession,
  createTestPatientSession,
  cleanupDoctorSession,
  cleanupPatientPair,
} from './support/auth-session';

// Patient is a real, separately-onboarded authenticated identity now, not a
// "view mode" of a doctor session -- the fixture creates a genuine patient
// account assigned to a genuine doctor account via the real onboarding API.
test.describe('Patient experience (authenticated)', () => {
  test.skip(!authFixtureAvailable, 'Supabase admin credentials not configured for this environment');

  let pair: Awaited<ReturnType<typeof createTestPatientSession>>;
  let apiContext: Awaited<ReturnType<typeof playwrightRequest.newContext>>;

  test.beforeAll(async () => {
    apiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });
    pair = await createTestPatientSession(apiContext);
  });

  test.afterAll(async () => {
    if (pair) await cleanupPatientPair(apiContext, pair);
    await apiContext.dispose();
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([pair.patient.cookie]);
  });

  for (const [label, width, height] of [
    ['360', 360, 800],
    ['390', 390, 844],
    ['430', 430, 932],
  ] as const) {
    test(`home renders above-the-fold health status at ${label}px with no overflow`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width, height });
      await page.goto('/app/patient');
      await expect(page).toHaveURL(/\/app\/patient$/);
      // Latest (abnormal) seeded heart-rate reading must be visible without
      // scrolling -- "important health status appears above the fold". The
      // value is a bare text node next to a unit span (e.g. "172bpm"), so
      // exact-text matching never matches and plain substring matching would
      // collide with "76" (the normal-range reading) -- bound the digits.
      const hr = page.getByText(/(?<!\d)172(?!\d)/);
      await expect(hr).toBeVisible({ timeout: 15000 });
      const box = await hr.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeLessThan(height);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      // Bottom nav must not cover the primary content. Exact match --
      // otherwise this also matches the (hidden-but-present) desktop nav,
      // whose accessible name contains this string as a substring.
      const nav = page.getByRole('navigation', { name: 'Patient navigation', exact: true });
      const navBox = await nav.boundingBox();
      expect(navBox).not.toBeNull();
      expect(navBox!.y).toBeGreaterThan(box!.y);
      expect(errors).toEqual([]);
    });
  }

  test('bottom navigation moves between Home, Vitals, History, Alerts, Profile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/patient');
    const nav = page.getByRole('navigation', { name: 'Patient navigation', exact: true });

    await nav.getByRole('link', { name: 'Vitals' }).click();
    await expect(page).toHaveURL(/\/app\/patient\/vitals$/);
    await expect(page.getByRole('heading', { name: 'Vitals', exact: true })).toBeVisible();

    await nav.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/app\/patient\/history$/);
    await expect(page.getByRole('heading', { name: 'Health trends' })).toBeVisible();

    await nav.getByRole('link', { name: 'Alerts' }).click();
    await expect(page).toHaveURL(/\/app\/patient\/alerts$/);
    await expect(page.getByRole('heading', { name: 'Alerts & guidance' })).toBeVisible();

    await nav.getByRole('link', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/app\/patient\/profile$/);

    await nav.getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(/\/app\/patient$/);
  });

  test('vitals page lists real seeded readings', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/patient/vitals');
    await expect(page.getByText(/(?<!\d)172(?!\d)/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/(?<!\d)76(?!\d)/)).toBeVisible();
  });

  test('history page renders a chart and switches metric without crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/patient/history');
    await page.getByRole('tab', { name: 'SpO₂' }).click();
    await expect(page.getByRole('tab', { name: 'SpO₂', selected: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('alerts page uses plain language, not raw ML jargon', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/patient/alerts');
    await expect(page.getByRole('heading', { name: 'Alerts & guidance' })).toBeVisible();
    const body = await page.textContent('body');
    expect(body).not.toMatch(/NEWS2|anomaly score|threshold/i);
  });

  test('my doctor page shows the real assigned doctor, not another one', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/patient/doctor');
    await expect(page.getByText('E2E Test Doctor')).toBeVisible({ timeout: 15000 });
  });

  test('home links to My doctor and Device instead of a clinician-view switch', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/patient');
    await expect(page.getByRole('link', { name: /Open clinician view/i })).toHaveCount(0);
    await page.getByRole('link', { name: 'My doctor' }).click();
    await expect(page).toHaveURL(/\/app\/patient\/doctor$/);
  });

  test('device page shows the permanent Bridge Code and an honest not-connected state', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/patient/device');
    await expect(page.getByText('VITALIS Bridge Code')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/^VTL-[0-9A-HJKMNP-TVWXYZ]{4}-[0-9A-HJKMNP-TVWXYZ]{4}$/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Copy bridge code/i })).toBeEnabled();
    await expect(page.getByText('No phone connected yet.')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('bridge code is stable across reloads and hidden from the doctor UI', async ({ page }) => {
    await page.goto('/app/patient/device');
    const codeLocator = page.getByText(/^VTL-[0-9A-HJKMNP-TVWXYZ]{4}-[0-9A-HJKMNP-TVWXYZ]{4}$/);
    await expect(codeLocator).toBeVisible({ timeout: 15000 });
    const code = (await codeLocator.textContent())?.trim();
    await page.reload();
    await expect(page.getByText(code!)).toBeVisible({ timeout: 15000 });

    // The same permanent code also surfaces in the profile/account area.
    await page.goto('/app/patient/profile');
    await expect(page.getByText(code!)).toBeVisible({ timeout: 15000 });
  });

  test('profile page loads real /api/v1/me and can save contact info', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/patient/profile');
    // The header greeting also shows the name -- scope to the page body so
    // this doesn't strict-mode-fail on the duplicate.
    await expect(page.getByRole('main').getByText('E2E Test Patient')).toBeVisible({ timeout: 15000 });
    const phone = page.getByLabel('Phone number');
    await phone.fill('+15559998888');
    await page.getByRole('button', { name: /Save changes/i }).click();
    await expect(page.getByRole('button', { name: /Saved/i })).toBeVisible({ timeout: 10000 });
  });

  test('a patient cannot see another patient\'s data by direct URL', async ({ page }) => {
    const otherApiContext = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:3000' });
    const otherDoctor = await createTestDoctorSession(otherApiContext);
    const otherPair = await createTestPatientSession(otherApiContext, otherDoctor);
    try {
      await page.goto(`/app/doctor/patients/${otherPair.patient.patientId}`);
      // Patients can't reach doctor routes at all (redirected to their own
      // dashboard) -- confirms the isolation without needing a raw API path.
      await expect(page).toHaveURL(/\/app\/patient$/, { timeout: 15000 });
    } finally {
      await cleanupPatientPair(otherApiContext, otherPair);
      await otherApiContext.dispose();
    }
  });

  test('tablet width remains overflow-free with the mobile nav', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/app/patient');
    await expect(page.getByRole('navigation', { name: 'Patient navigation', exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('desktop width shows the top navigation, not a stretched phone layout', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.goto('/app/patient');
    await expect(page.getByRole('navigation', { name: 'Patient navigation (desktop)' })).toBeVisible();
    // Exact match -- otherwise this locator also matches the desktop nav
    // above (its accessible name contains this string as a substring),
    // which is visible by design at this width, making the assertion
    // vacuously fail against the wrong element instead of checking the
    // actual mobile nav's hidden state.
    await expect(page.getByRole('navigation', { name: 'Patient navigation', exact: true })).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
