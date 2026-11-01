import { expect, test } from '@playwright/test';
import { configureBothChannels, connected, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

const lastTime = (page: import('@playwright/test').Page) =>
  page.locator('.bw-trace-row[data-channel] .bw-c-time').last().innerText();

test('Pause freezes the view while capture goes on, counts what arrives, and Resume catches up', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  device.generate(1, 40, 0x7e8);
  const count = page.getByTestId('trace-count');
  // Wait for real frames: pausing before the first one would freeze an empty table.
  await expect(count).toContainText(/Capturing · ([1-9]\d) frames/);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(count).toContainText('Paused');
  const frozenAt = await lastTime(page);
  const frozenRows = await page.locator('.bw-trace-row[data-channel]').count();
  // Capture goes on in the background: the waiting counter grows while the rows on screen do not change.
  await expect.poll(async () => Number(((await count.innerText()).match(/([\d,]+) new rows? waiting/) ?? [])[1]?.replace(/,/g, '') ?? 0), { timeout: 5000 }).toBeGreaterThan(20);
  expect(await lastTime(page)).toBe(frozenAt);
  expect(await page.locator('.bw-trace-row[data-channel]').count()).toBe(frozenRows);
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(count).not.toContainText('Paused');
  await expect(count).not.toContainText('waiting');
  await expect.poll(() => lastTime(page), { timeout: 5000 }).not.toBe(frozenAt);
  await device.close();
});

test('a paused trace stays frozen with a filter on, and Clear ends the pause', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  device.generate(1, 40, 0x7e8);
  device.generate(2, 40, 0x123);
  const count = page.getByTestId('trace-count');
  await expect(count).toContainText(/([1-9]\d) frames/);
  await page.getByLabel('Filter by ID or data').fill('7e8');
  await page.getByRole('button', { name: 'Pause' }).click();
  const shown = async () => Number((await count.innerText()).match(/([\d,]+) shown/)![1].replace(/,/g, ''));
  const atPause = await shown();
  await page.waitForTimeout(800);
  expect(await shown()).toBe(atPause);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await device.close();
});

test('the text a filter looks for is marked in the table', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  device.generate(1, 20, 0x7e8);
  await expect(page.locator('.bw-trace-row[data-channel]').first()).toBeVisible();
  await page.getByLabel('Filter by ID or data').fill('7e8');
  const marks = page.locator('.bw-trace-row[data-channel] mark');
  await expect(marks.first()).toBeVisible();
  expect(await marks.first().innerText()).toBe('7E8');
  await page.getByLabel('Filter by ID or data').fill('aa');
  await expect(page.locator('.bw-c-data mark').first()).toHaveText('AA');
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page.locator('.bw-trace mark')).toHaveCount(0);
  await device.close();
});

test('recent filters are offered as suggestions and remembered across a reload', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  await connected(page, device.url);
  const box = page.getByLabel('Filter by ID or data');
  await box.fill('7e8');
  await box.press('Enter');
  await box.fill('22 f1');
  await page.getByRole('combobox', { name: 'Filter by channel' }).focus(); // leaving the box also remembers it
  await page.getByRole('button', { name: 'Clear filter' }).click();
  const options = () => page.locator('#trace-recent-filters option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(await options()).toEqual(['22 f1', '7e8']);
  await page.reload();
  await connected(page, device.url);
  expect(await options()).toEqual(['22 f1', '7e8']);
  await device.close();
});
