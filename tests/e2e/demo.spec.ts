import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('deterioration → real PDF upload → quarantine → critical preserved → audit', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await request.post('/api/demo', { data: { action: 'reset' } });
  // The legacy synthetic dashboard moved from `/` to `/demo` when the new
  // VITALIS landing page / auth shell was built; the legacy shared-password
  // gate and every /api/* contract this test exercises are unchanged.
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Clinical command center' })).toBeVisible();
  await expect(page.locator('.patient-row')).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const firstSnapshot = await (await request.get('/api/snapshot')).json();
  const firstReading = firstSnapshot.patients.find((p: { id: string }) => p.id === 'p1').vitals;
  await expect
    .poll(async () => {
      const current = await (await request.get('/api/snapshot')).json();
      return current.patients.find((p: { id: string }) => p.id === 'p1').vitals.timestamp;
    })
    .not.toBe(firstReading.timestamp);
  // Real browser mutation exercises Origin/Host and the full proxy boundary.
  await page.getByRole('button', { name: 'Start deterioration', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deterioration running' })).toBeDisabled();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await request.post('/api/demo', { data: { action: 'advance', steps: 24 } });
  await expect(page.locator('.patient-row').first()).toContainText('Arjun Mehta');
  await expect(page.locator('.patient-detail .detail-header')).toContainText('Critical');
  await expect(page.locator('.news-total')).toContainText('NEWS2');
  await expect(page.locator('.component-grid')).toBeVisible();
  await expect(page.getByText('Personal baseline · last 30 min', { exact: true })).toBeVisible();
  await expect(page.locator('.reasoning')).toContainText('baseline');
  const before = await (await request.get('/api/snapshot')).json();
  const criticalPatient = before.patients.find((p: { id: string }) => p.id === 'p1');
  expect(criticalPatient.vitals.spo2).toBeLessThan(firstReading.spo2);
  expect(criticalPatient.vitals.heart_rate).toBeGreaterThan(firstReading.heart_rate);
  expect(criticalPatient.vitals.respiratory_rate).toBeGreaterThan(firstReading.respiratory_rate);
  expect(before.metrics.episodes_detected).toBe(1);
  expect(before.metrics.raw_threshold_alerts).toBeGreaterThan(before.metrics.actionable_alerts);
  expect(before.metrics.reduction_pct).toBeGreaterThan(0);
  expect(before.metrics.false_positive_events).toBe(0);
  expect(before.metrics.processing_p95_ms).toBeLessThan(100);
  await page.screenshot({ path: 'data/qa/critical-desktop.png', fullPage: true });
  await page.getByRole('tab', { name: 'Documents (0)', exact: true }).click();
  await page
    .getByLabel('Upload clinical document')
    .setInputFiles(path.resolve('output/pdf/attack-report.pdf'));
  await expect(page.getByText('SECURITY QUARANTINE', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Trust conflict detected', { exact: true })).toBeVisible();
  await expect(page.getByText('Critical alert preserved', { exact: true })).toBeVisible();
  await expect(page.getByText('MALICIOUS', { exact: true })).toBeVisible();
  const after = await (await request.get('/api/snapshot')).json();
  const p = after.patients.find((p: { id: string }) => p.id === 'p1');
  expect(p.risk).toEqual(before.patients.find((p: { id: string }) => p.id === 'p1').risk);
  expect(p.trust_conflict).toBe(true);
  expect(p.context.screened_historical_facts).toEqual([]);
  expect(p.documents[0].scan.quarantined).toBe(true);
  expect(
    p.documents[0].facts.every((fact: { trust_status: string }) => fact.trust_status === 'QUARANTINED'),
  ).toBe(true);
  expect(p.documents[0].scan.signals.some((s: { code: string }) => s.code === 'hidden_text')).toBe(true);
  const auditTypes = new Set(after.audit.map((event: { event_type: string }) => event.event_type));
  for (const expectedType of [
    'DOCUMENT_UPLOADED',
    'SCAN_COMPLETED',
    'SECURITY_SIGNAL',
    'DOCUMENT_QUARANTINED',
    'TRUST_CONFLICT',
    'CLINICAL_ALERT_PRESERVED',
    'CONTEXT_PROTECTED',
  ]) {
    expect(auditTypes.has(expectedType)).toBe(true);
  }
  const original = await request.get(`/api/documents/${p.documents[0].id}/original`);
  expect(original.ok()).toBe(true);
  const originalBytes = Buffer.from(await original.body());
  const fixtureBytes = await readFile(path.resolve('output/pdf/attack-report.pdf'));
  expect(createHash('sha256').update(originalBytes).digest('hex')).toBe(
    createHash('sha256').update(fixtureBytes).digest('hex'),
  );
  await page.screenshot({ path: 'data/qa/quarantine-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Audit trail', exact: true }).click();
  await expect(page.locator('.full-audit')).toContainText('clinical alert preserved');
  await page.getByRole('button', { name: 'Alert analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'lower demonstrated alert burden' })).toBeVisible();
  await page.getByRole('button', { name: /^Document trust/ }).click();
  await page
    .getByLabel('Upload clinical document')
    .setInputFiles(path.resolve('output/pdf/clean-report.pdf'));
  await expect(page.getByText('TRUSTED', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.context-panel')).toContainText('13.2');

  // Reset and repeat the complete critical path to prove deterministic replay.
  await page.getByRole('button', { name: 'Command center', exact: true }).click();
  await page.getByRole('button', { name: 'Reset synthetic run' }).click();
  await expect(page.getByRole('button', { name: 'Start deterioration', exact: true })).toBeEnabled();
  await expect(page.locator('.patient-detail .detail-header')).toContainText('Normal');
  await page.getByRole('button', { name: 'Start deterioration', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await request.post('/api/demo', { data: { action: 'advance', steps: 24 } });
  await expect(page.locator('.patient-row').first()).toContainText('Arjun Mehta');
  await expect(page.locator('.patient-detail .detail-header')).toContainText('Critical');
  await page.getByRole('tab', { name: 'Documents (0)', exact: true }).click();
  await page.getByRole('button', { name: /Run attack demo/ }).click();
  await expect(page.getByText('SECURITY QUARANTINE', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Critical alert preserved', { exact: true })).toBeVisible();
  const replay = await (await request.get('/api/snapshot')).json();
  expect(replay.patients[0].id).toBe('p1');
  expect(replay.patients[0].risk.state).toBe('CRITICAL');
  expect(replay.patients[0].context.screened_historical_facts).toEqual([]);
  expect(replay.audit.some((event: { event_type: string }) => event.event_type === 'TRUST_CONFLICT')).toBe(
    true,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Command center', exact: true }).click();
  await expect(page.locator('.patient-queue')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'data/qa/dashboard-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('proxy rejects cross-site writes and unknown paths', async ({ request }) => {
  expect(
    (
      await request.post('/api/demo', {
        headers: { origin: 'https://evil.example' },
        data: { action: 'reset' },
      })
    ).status(),
  ).toBe(403);
  expect((await request.get('/api/anything-else')).status()).toBe(404);
});
