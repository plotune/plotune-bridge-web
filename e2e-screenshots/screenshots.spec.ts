import { expect, test } from '@playwright/test';
import { GeneratorControl } from '../e2e-virtual/generatorControl';
import { connect, connected, serveBuildAt, simulateLocalNetworkPermission } from '../e2e/helpers';
import { MockDeviceServer } from '../e2e/mockServer';

const HOSTED = 'https://bridge.plotune.net'; // the build is served to the test browser under this origin; nothing leaves the machine
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0';
const out = (name: string) => `docs/screenshots/${name}.png`;

test('permission explanation (first visit)', async ({ page }) => {
  await serveBuildAt(page, HOSTED);
  await page.goto(`${HOSTED}/`);
  await page.getByRole('button', { name: 'Add a device' }).click();
  await expect(page.getByTestId('permission-explainer')).toBeVisible();
  await page.screenshot({ path: out('permission-explanation') });
});

test('address step with the origin the device must allow', async ({ page }) => {
  await serveBuildAt(page, HOSTED);
  await page.goto(`${HOSTED}/`);
  await page.getByRole('button', { name: 'Add a device' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Device address').fill('192.168.1.50:9101');
  await expect(page.getByText('The device must allow this page.')).toBeVisible();
  await page.screenshot({ path: out('address-and-origin') });
});

test('unsupported browser notice (Firefox user agent)', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: FIREFOX, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await serveBuildAt(page, HOSTED);
  await page.goto(`${HOSTED}/`);
  await page.getByRole('button', { name: 'Add a device' }).click();
  await expect(page.getByTestId('unsupported-browser')).toBeVisible();
  await page.getByLabel('Device address').fill('192.168.1.50:9101');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.locator('[data-notice=blocked-by-browser]')).toBeVisible();
  await page.screenshot({ path: out('unsupported-browser') });
  await context.close();
});

test('blocked local-network permission (simulated) with retry', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  await simulateLocalNetworkPermission(page, 'denied');
  await serveBuildAt(page, HOSTED);
  await page.goto(`${HOSTED}/`);
  await page.getByRole('button', { name: 'Add a device' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Device address').fill(device.url.replace('ws://', ''));
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.locator('[data-notice=permission-blocked]')).toBeVisible();
  await page.screenshot({ path: out('permission-blocked-simulated') });
  await device.close();
});

test('capture dashboard on the real virtual device', async ({ page }) => {
  test.skip(!process.env.BRIDGE_VIRTUAL_URL, 'BRIDGE_VIRTUAL_URL is not set');
  await page.setViewportSize({ width: 1440, height: 900 });
  await connected(page, process.env.BRIDGE_VIRTUAL_URL!);
  const stop = page.getByRole('button', { name: 'Stop capture' });
  if (await stop.isVisible()) await stop.click();
  await page.getByLabel('CAN1 bit rate').selectOption('500000');
  await page.getByLabel('CAN2 bit rate').selectOption('500000');
  await page.getByRole('switch', { name: 'Termination (120 Ω)' }).nth(1).click();
  await page.getByRole('button', { name: 'Reset counters' }).click(); // counters describe this capture, not the device's whole life
  await page.getByRole('button', { name: 'Start capture' }).click();
  await page.locator('#panel-transmit').getByRole('combobox').first().selectOption('2');
  await page.getByLabel('ID (hex)').fill('5A5');
  await page.getByLabel('Data (hex bytes)').fill('DE AD BE EF');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.locator('[role=row][data-channel]').count(), { timeout: 15_000 }).toBeGreaterThan(12);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: out('capture-dashboard'), fullPage: false });
  const stopAgain = page.getByRole('button', { name: 'Stop capture' });
  if (await stopAgain.isVisible()) await stopAgain.click();
});

test('two devices in one workspace', async ({ page }) => {
  test.skip(!process.env.BRIDGE_VIRTUAL_URL || !process.env.BRIDGE_VIRTUAL2_URL, 'two virtual device URLs are not set');
  await page.setViewportSize({ width: 1440, height: 900 });
  await connected(page, process.env.BRIDGE_VIRTUAL_URL!);
  await page.getByRole('button', { name: 'Add a device' }).click();
  await page.getByLabel('Device address').fill(process.env.BRIDGE_VIRTUAL2_URL!);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByTestId('device-chip')).toHaveCount(2);
  for (const n of [1, 2]) {
    await page.getByRole('button', { name: `Select Bridge ${n}` }).click();
    const stop = page.getByRole('button', { name: 'Stop capture' });
    if (await stop.isVisible()) await stop.click();
    await expect(page.getByLabel('CAN1 bit rate')).toBeEnabled();
    await page.getByLabel('CAN1 bit rate').selectOption('500000');
    await page.getByLabel('CAN2 bit rate').selectOption('500000');
    await page.getByRole('button', { name: 'Reset counters' }).click();
  }
  await page.getByRole('button', { name: 'Start capture' }).click();
  await expect(page.locator('.bw-setup-tag')).toHaveCount(4);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out('two-devices') });
  await page.getByRole('button', { name: 'Stop capture' }).click();
});

test('drops reported by a device with a tiny buffer', async ({ page }) => {
  test.skip(!process.env.BRIDGE_OVERFLOW_URL, 'BRIDGE_OVERFLOW_URL is not set');
  await page.setViewportSize({ width: 1440, height: 900 });
  await connected(page, process.env.BRIDGE_OVERFLOW_URL!);
  const stop = page.getByRole('button', { name: 'Stop capture' });
  if (await stop.isVisible()) await stop.click();
  await page.getByLabel('CAN1 bit rate').selectOption('1000000');
  await page.getByLabel('CAN2 bit rate').selectOption('1000000');
  await page.getByRole('button', { name: 'Reset counters' }).click();
  await page.getByRole('button', { name: 'Start capture' }).click();
  await expect(page.locator('#panel-trace')).toContainText(/frames dropped/, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: out('drops-reported'), fullPage: false });
  await page.getByRole('button', { name: 'Stop capture' }).click();
});

test('diagnostics against the real bench ECU', async ({ page }) => {
  test.skip(!process.env.BRIDGE_BENCH_URL || !process.env.BRIDGE_BENCH_CONTROL_URL, 'bench endpoints are not set');
  const control = await GeneratorControl.open(process.env.BRIDGE_BENCH_CONTROL_URL!);
  await control.enableEcu();
  await connected(page, process.env.BRIDGE_BENCH_URL!);
  await page.getByRole('button', { name: 'Diagnostics' }).click();
  await page.getByRole('textbox', { name: /^Request ID \(hex\)/ }).fill('700');
  await page.getByRole('textbox', { name: /^Response ID \(hex\)/ }).fill('708');
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.getByRole('textbox', { name: 'Data identifiers', exact: true }).fill('F190 F191 F192 F193');
  await page.getByRole('button', { name: 'Read data' }).click();
  await page.getByRole('button', { name: 'Request seed' }).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByTestId('log-calibration-log')).toContainText('Connected');
  await page.getByRole('button', { name: 'Read memory' }).click();
  await expect(page.getByTestId('log-calibration-log')).toContainText('Read 16 bytes');
  await page.screenshot({ path: out('diagnostics-bench'), fullPage: false });
  await control.call('enable_ecu', { enabled: false });
  control.close();
  void connect;
});
