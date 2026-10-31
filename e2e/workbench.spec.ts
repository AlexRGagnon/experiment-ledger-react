import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
const sample = (name: string, accuracy = 0.7) => ({
  name,
  model: 'test-model',
  dataset: 'synthetic-browser-test',
  seed: 17,
  metrics: { accuracy, latency_ms: 140 },
});
async function importRun(page: Page, input: ReturnType<typeof sample>) {
  await page.getByLabel('Experiment JSON').fill(JSON.stringify(input));
  await page.getByRole('button', { name: 'Import experiment', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Inspect ' + input.name, exact: true }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Experiment Ledger', exact: true })).toBeVisible();
});
test('keyboard operation imports a record and duplicate imports remain singular', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Load baseline', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Experiment JSON')).not.toHaveValue('');
  await page.getByLabel('Experiment JSON').fill(JSON.stringify(sample('keyboard-run')));
  await page.getByRole('button', { name: 'Import experiment', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Inspect keyboard-run', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Import experiment', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Already stored');
  await expect(page.getByRole('button', { name: 'Inspect keyboard-run', exact: true })).toHaveCount(
    1,
  );
});
test('malformed JSON and invalid schemas show actionable errors', async ({ page }) => {
  await page.getByLabel('Experiment JSON').fill('{broken');
  await page.getByRole('button', { name: 'Import experiment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid JSON');
  await page.getByLabel('Experiment JSON').fill(JSON.stringify({ ...sample('bad'), seed: -1 }));
  await page.getByRole('button', { name: 'Import experiment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Seed must');
});
test('two persisted experiments compare and export without network services', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:8797') && !r.url().startsWith('blob:'))
      external.push(r.url());
  });
  await importRun(page, sample('comparison-baseline', 0.7));
  await importRun(page, sample('comparison-candidate', 0.8));
  await page.getByRole('checkbox', { name: 'Select comparison-baseline', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select comparison-candidate', exact: true }).check();
  const table = page.getByRole('table', { name: 'Metric comparison', exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row', { name: /accuracy/ })).toContainText('+0.1');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export input JSON', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(JSON.parse(readFileSync(path!, 'utf8')).name).toBe('comparison-candidate');
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/workbench.png', fullPage: true });
  expect(external).toEqual([]);
});
test('notes survive page reload and can be reopened', async ({ page }) => {
  await importRun(page, sample('notes-persistence'));
  await page
    .getByRole('textbox', { name: 'Research notes', exact: true })
    .fill('Verified against an independent reference.');
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Notes saved');
  await page.reload();
  await page.getByRole('button', { name: 'Inspect notes-persistence', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Research notes', exact: true })).toHaveValue(
    'Verified against an independent reference.',
  );
});
test('stale note writes preserve the draft and offer explicit reload', async ({
  page,
  request,
}) => {
  const input = sample('conflict-review');
  await importRun(page, input);
  const headers = { 'Content-Type': 'application/json', 'X-Ledger-Client': '1' };
  const imported = await request.post('/api/runs', { data: input, headers });
  const { run } = await imported.json();
  await page.getByRole('textbox', { name: 'Research notes', exact: true }).fill('My unsaved draft');
  const changed = await request.patch('/api/runs/' + run.id, {
    headers,
    data: { notes: 'Other session note', version: run.version },
  });
  expect(changed.status()).toBe(200);
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('another session');
  await expect(page.getByRole('textbox', { name: 'Research notes', exact: true })).toHaveValue(
    'My unsaved draft',
  );
  await page.getByRole('button', { name: 'Reload saved notes', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Research notes', exact: true })).toHaveValue(
    'Other session note',
  );
});
test('untrusted HTML-looking input is rendered as text', async ({ page }) => {
  const name = '<img src=x onerror=alert(1)>';
  let dialogs = 0;
  page.on('dialog', async (d) => {
    dialogs++;
    await d.dismiss();
  });
  await importRun(page, sample(name));
  await expect(page.getByRole('button', { name: 'Inspect ' + name, exact: true })).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
  expect(dialogs).toBe(0);
});
test('filter uses the real backend and removes nonmatching rows', async ({ page }) => {
  await importRun(page, sample('unique-filter-case'));
  await page.getByLabel('Filter runs', { exact: true }).fill('unique-filter-case');
  await expect(
    page.getByRole('table', { name: 'Saved experiments', exact: true }).locator('tbody tr'),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Inspect unique-filter-case', exact: true }),
  ).toBeVisible();
});
test('mobile layout has no page-level horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await importRun(page, sample('mobile-review'));
  await expect(page.getByRole('textbox', { name: 'Research notes', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
test('list failure is visible and refresh recovers', async ({ page }) => {
  await page.route('**/api/runs?*', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Injected storage failure.' }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Injected storage failure');
  await page.unroute('**/api/runs?*');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Saved experiments', exact: true }).locator('tbody tr').first(),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
