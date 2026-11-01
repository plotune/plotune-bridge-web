import { expect, test } from '@playwright/test';
import { configureBothChannels, connected, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

// The mock device sends id 0x7E8 on CAN1 with data [counter, 0xAA].
const DBC = 'BO_ 2024 Resp: 2 X\n SG_ Counter : 0|8@1+ (1,0) [0|255] "" Y\n SG_ Marker : 8|8@1+ (1,0) [0|255] "" Y\nVAL_ 2024 Marker 170 "Alive" ;\n';

test('a database names messages and signals in the trace, is remembered, and can be removed', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  device.generate(1, 20, 0x7e8);
  const trace = page.getByRole('table', { name: 'Captured frames' });
  await expect(trace.locator('.bw-trace-row[data-channel]').first()).toBeVisible();
  await expect(trace.getByRole('columnheader', { name: 'Name' })).toHaveCount(0);

  // A file that is not a database is refused in plain words and nothing changes.
  await page.locator('summary', { hasText: 'Databases' }).click();
  await page.getByTestId('dbc-input-1').setInputFiles({ name: 'bad.dbc', mimeType: 'text/plain', buffer: Buffer.from('this is not a database') });
  await expect(page.getByRole('alert').filter({ hasText: 'No messages found' })).toBeVisible();
  await expect(trace.getByRole('columnheader', { name: 'Name' })).toHaveCount(0);

  await page.getByTestId('dbc-input-1').setInputFiles({ name: 'car.dbc', mimeType: 'text/plain', buffer: Buffer.from(DBC) });
  await expect(page.getByTestId('db-row-1').getByText('car.dbc')).toBeVisible();
  await expect(trace.getByRole('columnheader', { name: 'Name' })).toBeVisible();
  const expander = trace.getByRole('button', { name: 'Show the signals of Resp' }).first();
  await expect(expander).toBeVisible();

  // Expanding shows the decoded signals with their labels, right under the frame.
  await expander.click();
  await expect(trace.getByRole('row').filter({ has: page.locator('[data-signal=Counter]') }).or(trace.locator('[data-signal=Counter]')).first()).toBeVisible();
  const marker = trace.locator('[data-signal=Marker]').first();
  await expect(marker).toContainText('170 (Alive)');
  await page.screenshot({ path: 'test-results/dbc-expanded.png' });

  // The filter finds frames by message or signal name.
  await page.getByLabel('Filter by ID, data or name').fill('counter');
  await expect(trace.locator('.bw-trace-row[data-channel]').first()).toBeVisible();
  await page.getByLabel('Filter by ID, data or name').fill('nosuchname');
  await expect(page.getByText('No frames match this filter.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filter' }).click();

  // Remembered across a reload, without uploading anything.
  await page.reload();
  await connected(page, device.url);
  await page.locator('summary', { hasText: 'Databases' }).click();
  await expect(page.getByTestId('db-row-1').getByText('car.dbc')).toBeVisible();
  device.generate(1, 20, 0x7e8);
  await expect(trace.getByRole('columnheader', { name: 'Name' })).toBeVisible();

  // Removing the database keeps every frame and goes back to raw rows.
  await page.getByRole('button', { name: 'Remove the database from CAN1' }).click();
  await expect(trace.getByRole('columnheader', { name: 'Name' })).toHaveCount(0);
  await expect(page.getByTestId('dbc-input-1')).toBeAttached();
  await device.close();
});
