import { test, expect } from '@playwright/test';

test.describe('Public landing page', () => {
  test('loads with VITALIS branding and a Get started CTA, no demo links', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page).toHaveTitle(/VITALIS/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/zero-trust/i);
    await expect(page.getByRole('link', { name: 'Get started', exact: true }).first()).toBeVisible();
    // The old "sign in with Google" / "explore the demo" funnel is gone from
    // the normal product journey.
    await expect(page.getByRole('link', { name: /Sign in with Google/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Explore live demo/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Demo', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('primary CTA navigates to /get-started, which offers Patient and Doctor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Get started', exact: true }).first().click();
    await expect(page).toHaveURL(/\/get-started/);
    await expect(page.getByRole('heading', { name: /Patient/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Doctor/i })).toBeVisible();
  });

  test('get-started role choice carries through to /login with a role hint', async ({ page }) => {
    await page.goto('/get-started');
    await page.getByRole('heading', { name: /Patient/i }).click();
    await expect(page).toHaveURL(/\/login\?role=patient/);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('Sign in remains a returning-user entry point to /login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the legacy demo is reachable directly but not linked from the landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /demo/i })).toHaveCount(0);
    await page.goto('/demo');
    await expect(page.getByRole('heading', { name: 'Clinical command center' })).toBeVisible();
  });

  test('theme toggle switches and persists across reload', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: /^Theme:/ });
    await expect(toggle).toBeVisible();
    // Cycle until we land on an explicit (non-"Auto") theme so the assertion
    // below isn't sensitive to whatever the OS default happens to be.
    let attribute = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    for (let i = 0; i < 3 && !attribute; i += 1) {
      await toggle.click();
      attribute = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    }
    expect(attribute).toMatch(/^(light|dark)$/);
    const stored = await page.evaluate(() => localStorage.getItem('vitalis-theme'));
    expect(stored).toBe(attribute);
    await page.reload();
    const afterReload = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(afterReload).toBe(attribute);
  });

  for (const [label, width, height] of [
    ['mobile-360', 360, 800],
    ['mobile-390', 390, 844],
    ['mobile-430', 430, 932],
    ['tablet', 768, 1024],
    ['desktop', 1366, 800],
  ] as const) {
    test(`no horizontal overflow at ${label} (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
