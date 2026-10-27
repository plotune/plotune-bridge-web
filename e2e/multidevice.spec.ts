import { expect, test } from '@playwright/test';
import { connected } from './helpers';
import { MockDeviceServer } from './mockServer';

const BASE = 1_000_000_000n;

test.describe('several devices at once', () => {
  test('two devices share one trace window, each frame names its device, and the panels follow the selected device', async ({ page }) => {
    const first = await new MockDeviceServer().ready();
    const second = await new MockDeviceServer({ deviceId: 'mock-bridge-can-0002' }).ready();
    await connected(page, first.url);

    await page.getByRole('button', { name: 'Add a device' }).click();
    await expect(page.getByLabel('Device address')).toBeVisible();
    await page.getByLabel('Device address').fill(second.url);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('device-chip')).toHaveCount(2);
    await expect(page.getByText('2 of 2 devices connected').first()).toBeVisible();
    await expect(page.getByTestId('active-device')).toContainText('Bridge 2 · mock-bridge-can-0002');

    // Settings belong to the selected device only.
    await page.getByLabel('CAN1 bit rate').selectOption('250000');
    await page.getByLabel('CAN2 bit rate').selectOption('250000');
    await page.getByRole('button', { name: 'Select Bridge 1' }).click();
    await expect(page.getByLabel('CAN1 bit rate')).toHaveValue('');
    await page.getByLabel('CAN1 bit rate').selectOption('500000');
    await page.getByLabel('CAN2 bit rate').selectOption('500000');

    // One Start for every connected device.
    await page.getByRole('button', { name: 'Start capture' }).click();
    await expect(page.getByRole('button', { name: 'Stop capture' })).toBeVisible();
    await expect(page.locator('.bw-setup-tag')).toHaveCount(4); // both devices, both channels, are capturing
    const rows = page.locator('[role=row][data-channel]');
    first.core.injectRx(1, { id: 0x100, data: Uint8Array.of(1), timestampNs: BASE });
    await expect(rows).toHaveCount(1);
    second.core.injectRx(2, { id: 0x200, data: Uint8Array.of(2), timestampNs: BASE * 9n });
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(/0\.000000\s*Bridge 1\s*CAN1\s*100/);
    await expect(rows.nth(1)).toContainText(/0\.000000\s*Bridge 2\s*CAN2\s*200/); // each device's time is relative to its own first frame

    await expect(page.getByTestId('merge-note')).toContainText('device clocks are not synchronised');

    // The trace can show one device.
    await page.getByLabel('Trace source').selectOption({ label: 'Bridge 2' });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('200');
    await expect(page.getByRole('columnheader', { name: 'Device' })).toHaveCount(0);
    await expect(page.getByTestId('merge-note')).toHaveCount(0);

    // Removing a device disconnects it and leaves the other running.
    await page.getByRole('button', { name: 'Remove Bridge 2' }).click();
    await expect(page.getByTestId('device-chip')).toHaveCount(1);
    await expect(page.getByLabel('Trace source')).toHaveCount(0);
    await first.close();
    await second.close();
  });

  test('a device that cannot be reached does not disturb the connected one', async ({ page }) => {
    const first = await new MockDeviceServer().ready();
    await connected(page, first.url);
    await page.getByRole('button', { name: 'Add a device' }).click();
    await page.getByLabel('Device address').fill('ws://127.0.0.1:9');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('[data-notice]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('device-chip')).toContainText('Connected');
    await first.close();
  });
});
