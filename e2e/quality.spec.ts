import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { MockEcu } from '../tests/helpers/mockEcu';
import { configureBothChannels, connect, connected, LOCAL_ADVANCED, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} :: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(" | ")}`);
  expect(summary, `${label}: accessibility violations`).toEqual([]);
}

test.describe('accessibility (axe, WCAG 2.1 A and AA)', () => {
  test('the permission explanation and the address screen', async ({ page }) => {
    await page.goto('/');
    await expectNoAxeViolations(page, 'offline workspace');
    await page.getByRole('button', { name: 'Add a device' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to connect your Bridge' })).toBeVisible();
    await expectNoAxeViolations(page, 'account sign-in');
    await page.getByRole('button', { name: LOCAL_ADVANCED }).click();
    await expect(page.getByTestId('permission-explainer')).toBeVisible();
    await expectNoAxeViolations(page, 'permission explainer');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Device address')).toBeVisible();
    await expectNoAxeViolations(page, 'address screen');
  });

  test('failure notices and the connecting state', async ({ page }) => {
    await connect(page, '127.0.0.1:9');
    await expect(page.locator('[data-notice=unreachable]')).toBeVisible();
    await expectNoAxeViolations(page, 'unreachable notice');
  });

  test('every workspace page, with live data and an open panel menu', async ({ page }) => {
    const device = await new MockDeviceServer({ ecu: new MockEcu() }).ready();
    await connected(page, device.url);
    await configureBothChannels(page);
    await startCapture(page);
    device.generate(1, 40);
    device.generate(2, 25, 0x200);
    await expect(page.locator('[role=row][data-channel]').first()).toBeVisible();
    await expectNoAxeViolations(page, 'capture page');
    await page.getByText('Panels', { exact: true }).click();
    await expectNoAxeViolations(page, 'capture page with the panels menu open');
    await page.getByRole('button', { name: 'Diagnostics' }).click();
    await expectNoAxeViolations(page, 'diagnostics page');
    await page.getByRole('button', { name: 'Device', exact: true }).click();
    await expectNoAxeViolations(page, 'device page');
    await page.getByRole('button', { name: 'Capture', exact: true }).click();
    device.drop(4001, 'replaced');
    await expect(page.locator('[data-notice=replaced]')).toBeVisible();
    await expectNoAxeViolations(page, 'takeover notice over the workspace');
    await device.close();
  });

  test('a maximized panel', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    await connected(page, device.url);
    await page.getByRole('button', { name: 'Maximize Trace' }).click();
    await expectNoAxeViolations(page, 'maximized trace');
    await device.close();
  });
});

test('a full session raises no console errors, page errors or Content-Security-Policy violations', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`console ${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
  const device = await new MockDeviceServer({ ecu: new MockEcu() }).ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  device.generate(1, 100);
  await expect(page.locator('[role=row][data-channel]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Diagnostics' }).click();
  await page.getByRole('button', { name: 'Device', exact: true }).click();
  await page.getByRole('button', { name: 'Maximize Device' }).click();
  await page.keyboard.press('Escape');
  device.drop(1013, 'overflow');
  await expect(page.locator('[data-notice=overflow]')).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'))).toContain("default-src 'self'");
  expect(problems).toEqual([]);
  await device.close();
});
