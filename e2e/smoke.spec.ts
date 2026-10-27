import { expect, test } from '@playwright/test';
import { MockDeviceServer } from './mockServer';

test('loads the explainer then connects to a mock device', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  await page.goto('/');
  await expect(page.getByTestId('permission-explainer')).toBeVisible();
  await page.screenshot({ path: 'test-results/explainer.png' });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Device address').fill(device.url.replace('ws://', ''));
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByTestId('device-chip')).toContainText('Connected');
  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
  await device.close();
});
