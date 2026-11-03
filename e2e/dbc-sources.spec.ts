import { expect, test } from '@playwright/test';
import { closeDialog, configureBothChannels, connected, openDeviceSettings, openLocalAddressForm, seedWorkspace, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

// The mock device sends id 0x7E8 on CAN1 with data [counter, 0xAA].
const DBC = 'BO_ 2024 Resp: 2 X\n SG_ Counter : 0|8@1+ (1,0) [0|255] "rpm" Y\n SG_ Marker : 8|8@1+ (1,0) [0|255] "" Y\n';
const ASC = ['date Mon Nov 3 10:00:00.000 am 2026', 'base hex  timestamps absolute', 'internal events logged', ...Array.from({ length: 40 }, (_, i) => `   ${(i * 0.05).toFixed(6)} 1  7E8             Rx   d 2 ${(i % 256).toString(16).padStart(2, '0').toUpperCase()} AA`)].join('\n');

test('a database belongs to one device: two identical Bridges keep their CAN1 apart', async ({ page }) => {
  const first = await new MockDeviceServer().ready();
  const second = await new MockDeviceServer({ deviceId: 'mock-bridge-can-0002' }).ready();
  await connected(page, first.url);
  await openLocalAddressForm(page);
  await page.getByLabel('Device address').fill(second.url);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByTestId('device-chip')).toHaveCount(2);
  await configureBothChannels(page, '500000', 'Bridge 1');
  await configureBothChannels(page, '500000', 'Bridge 2');

  // Only Bridge 2's CAN1 gets the database. Its dialog says whose channel it is.
  const dialog = await openDeviceSettings(page, 'Bridge 2');
  await expect(dialog.getByRole('group', { name: 'Databases of Bridge 2' })).toBeVisible();
  await dialog.getByTestId('dbc-input-1').setInputFiles({ name: 'car.dbc', mimeType: 'text/plain', buffer: Buffer.from(DBC) });
  await expect(dialog.getByTestId('db-row-1')).toContainText('1 message');
  await closeDialog(page);
  const again = await openDeviceSettings(page, 'Bridge 1');
  await expect(again.getByTestId('db-row-1')).toContainText('No database');
  await closeDialog(page);

  first.generate(1, 20, 0x7e8);
  second.generate(1, 20, 0x7e8);
  await startCapture(page);
  const rows = page.locator('[role=row][data-channel]');
  await expect(rows.filter({ hasText: 'Bridge 2' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'Bridge 1' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'Bridge 2' }).getByRole('button', { name: /Show the signals of Resp/ }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'Bridge 1' }).getByRole('button', { name: /Show the signals of/ })).toHaveCount(0);
  await first.close();
  await second.close();
});

test('a log of CAN frames opens like a source: link a database to its channel, then choose signals', async ({ page }) => {
  await seedWorkspace(page);
  await page.goto('/');
  await page.getByTestId('open-file').setInputFiles({ name: 'drive.asc', mimeType: 'text/plain', buffer: Buffer.from(ASC) });
  const dialog = page.getByRole('dialog', { name: /Open drive/ });
  await expect(dialog).toContainText('40 frames');
  await expect(dialog.getByTestId('db-row-1')).toContainText('40 frames');
  await dialog.getByTestId('dbc-input-1').setInputFiles({ name: 'car.dbc', mimeType: 'text/plain', buffer: Buffer.from(DBC) });
  await expect(dialog.getByTestId('db-row-1')).toContainText('2 signals');
  await dialog.getByRole('button', { name: 'Open in Analyzer' }).click();
  const analyzer = page.getByRole('region', { name: 'Analyzer' });
  await expect(analyzer).toBeVisible();
  await analyzer.getByRole('button', { name: 'Signal', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add signals' });
  await add.getByRole('searchbox', { name: 'Search signals' }).fill('counter');
  await add.getByRole('checkbox').check();
  await add.getByRole('button', { name: /^Add 1 signal/ }).click();
  await expect(analyzer.getByRole('rowheader', { name: 'Counter' })).toBeVisible();
  await analyzer.getByRole('button', { name: 'Statistics' }).click();
  await expect(analyzer.getByRole('rowheader', { name: 'Counter' }).locator('xpath=..')).toContainText('19.50'); // the average of 0..39
});

test('a canvas is closed with the mark on its tab, and a closed one can be brought back', async ({ page }) => {
  await seedWorkspace(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Canvases' });
  await nav.getByRole('button', { name: 'Diagnostics' }).hover();
  await nav.getByRole('button', { name: 'Diagnostics' }).locator('.bw-seg-close').click();
  await expect(nav.getByRole('button', { name: 'Diagnostics' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(nav.getByRole('button', { name: 'Diagnostics' })).toBeVisible();
});
