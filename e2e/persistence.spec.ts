import { expect, test } from '@playwright/test';
import { connected, configureBothChannels, LOCAL_ADVANCED, openLocalAddressForm } from './helpers';
import { MockDeviceServer } from './mockServer';

// This spies on browser APIs; it does not simulate a permission grant.
async function observeDeviceAccess(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const counts = { sockets: 0, permissions: 0 };
    Object.assign(window, { __deviceAccess: counts });
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        counts.sockets++;
        super(url, protocols);
      }
    };
    const nativeQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (descriptor) => { counts.permissions++; return nativeQuery(descriptor); };
  });
}

test('zero-device first load renders the workspace and offline settings without device access', async ({ page }) => {
  await observeDeviceAccess(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  await expect(page.locator('#panel-trace')).toBeVisible();
  await expect(page.getByTestId('permission-explainer')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/offline-workspace.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'docs/screenshots/offline-workspace-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await page.getByRole('button', { name: 'Edit settings' }).click();
  await page.getByRole('textbox', { name: /^Request ID/ }).fill('701');
  await expect(page.getByRole('button', { name: 'Start session' })).toBeDisabled();
  await page.reload();
  await expect(page.locator('main')).toHaveAttribute('data-page', 'diagnostics');
  // The remembered value shows in the one-line summary, and in the form once it is opened.
  await expect(page.getByTestId('link-summary')).toContainText('requests 701');
  await page.getByRole('button', { name: 'Edit settings' }).click();
  await expect(page.getByRole('textbox', { name: /^Request ID/ })).toHaveValue('701');
  expect(await page.evaluate(() => (window as unknown as { __deviceAccess: unknown }).__deviceAccess)).toEqual({ sockets: 0, permissions: 0 });
  await openLocalAddressForm(page);
  await expect(page.getByTestId('permission-explainer')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-page', 'diagnostics');
  await expect(page.getByTestId('device-chip')).toHaveCount(0);
});

test('reload keeps the view, both devices and UI choices; reconnect reads live state without setup replay', async ({ page }) => {
  const a = await new MockDeviceServer().ready();
  const b = await new MockDeviceServer().ready();
  try {
    await connected(page, a.url);
    await configureBothChannels(page);
    await page.getByTestId('channel-2').getByRole('checkbox').uncheck();
    await page.getByLabel('Send channel').selectOption('2');
    await page.getByRole('button', { name: 'Start capture', exact: true }).click();
    await openLocalAddressForm(page);
    await page.getByLabel('Device address').fill(b.url);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('device-chip')).toHaveCount(2);
    await page.getByRole('button', { name: 'Select Bridge 1' }).click();
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    const connections = a.connections;
    await observeDeviceAccess(page);
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-page', 'diagnostics');
    await expect(page.getByTestId('device-chip')).toHaveCount(2);
    await expect(page.getByTestId('device-chip').first()).toContainText(a.url);
    expect(await page.evaluate(() => (window as unknown as { __deviceAccess: unknown }).__deviceAccess)).toEqual({ sockets: 0, permissions: 0 });
    expect(a.connections).toBe(connections);
    await page.screenshot({ path: 'docs/screenshots/remembered-devices.png' });
    await page.locator('main').getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(page.getByTestId('device-chip').first()).toHaveAttribute('data-phase', 'connected');
    await page.getByRole('button', { name: 'Capture', exact: true }).click();
    await expect(page.getByLabel('CAN1 bit rate')).toHaveValue('500000');
    await expect(page.getByRole('button', { name: 'Stop capture' })).toBeVisible();
    await expect(page.getByTestId('channel-2').getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByLabel('Send channel')).toHaveValue('2');
    await page.getByRole('button', { name: 'Stop capture' }).click();
    await page.getByRole('button', { name: 'Remove Bridge 1' }).click();
    await page.getByRole('button', { name: 'Remove Bridge 2' }).click();
    await expect(page.getByText('Your workspace', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('device-chip')).toHaveCount(0);
  } finally { await a.close(); await b.close(); }
});

test('unavailable browser storage does not prevent navigation or adding a device', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('blocked', 'SecurityError'); } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Device', exact: true }).click();
  await expect(page.getByText('Not connected to a device.')).toBeVisible();
  await openLocalAddressForm(page);
  await expect(page.getByTestId('permission-explainer')).toBeVisible();
});

test('failed and canceled address edits preserve the last working device across reload', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  try {
    await connected(page, device.url);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.locator('main').getByRole('button', { name: 'Change address' }).click();
    await page.getByLabel('Device address').fill('ws://127.0.0.1:9/private-path');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('[data-notice=unreachable]')).toBeVisible();
    // A reload during a failed edit must also retain the working endpoint.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bw.workspace')!).devices[0].target)).toBe(device.url);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('device-chip')).toContainText(device.url);
    await page.reload();
    await expect(page.getByTestId('device-chip')).toContainText(device.url);
    await page.locator('main').getByRole('button', { name: 'Change address' }).click();
    await page.getByLabel('Device address').fill(device.url);
    await page.evaluate(() => {
      // SIMULATION: a pending browser connection, as in the existing permission test.
      window.WebSocket = class {
        static OPEN = 1;
        readyState = 0;
        close() {}
        send() {}
      } as unknown as typeof WebSocket;
    });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('connecting')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('device-chip')).toContainText(device.url);
    await expect(page.getByLabel('Device address')).toHaveCount(0);
  } finally { await device.close(); }
});

test('each unfinished device stays connectable when another draft is added or removed', async ({ page }) => {
  await page.goto('/');
  await openLocalAddressForm(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('.bw-setup').getByRole('button', { name: 'Add a device' }).click();
  await page.getByRole('button', { name: 'Select Bridge 1' }).click();
  await page.getByRole('button', { name: LOCAL_ADVANCED }).click();
  await expect(page.getByLabel('Device address')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Bridge 1' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select Bridge 2' })).toBeVisible();
  await page.getByRole('button', { name: LOCAL_ADVANCED }).click();
  await expect(page.getByLabel('Device address')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Your workspace', { exact: true })).toBeVisible();
});
