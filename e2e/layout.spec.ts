import { expect, test, type Page } from '@playwright/test';
import { configureBothChannels, connected, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

const height = async (page: Page, selector: string) => Math.round((await page.locator(selector).first().boundingBox())!.height);

test('the Trace splitter: untouched layout is the default, keys resize, Enter resets, and it is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const device = await new MockDeviceServer().ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  const splitter = page.getByTestId('trace-splitter');
  await expect(splitter).toHaveAttribute('role', 'separator');
  await expect(splitter).toHaveAttribute('aria-valuenow', '60');
  // Nothing saved yet: the grid has no override at all, so the layout is exactly the original one.
  expect(await page.locator('.bw-grid').evaluate((el) => (el as HTMLElement).style.cssText)).toBe('');
  const original = await height(page, '#panel-trace');
  const lowerOriginal = await height(page, '#panel-channels');

  await splitter.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(splitter).toHaveAttribute('aria-valuenow', '70');
  const bigger = await height(page, '#panel-trace');
  expect(bigger).toBeGreaterThan(original + 40);
  expect(await height(page, '#panel-channels')).toBeLessThan(lowerOriginal); // the row below gives the space

  await page.keyboard.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '25');
  expect(await height(page, '#panel-trace')).toBeLessThan(original);
  await page.keyboard.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', '80');

  await page.keyboard.press('ArrowUp');
  await expect(splitter).toHaveAttribute('aria-valuenow', '75');
  const saved = await height(page, '#panel-trace');
  await page.reload();
  await connected(page, device.url);
  await expect(page.getByTestId('trace-splitter')).toHaveAttribute('aria-valuenow', '75');
  expect(Math.abs((await height(page, '#panel-trace')) - saved)).toBeLessThanOrEqual(2);

  await page.getByTestId('trace-splitter').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('trace-splitter')).toHaveAttribute('aria-valuenow', '60');
  expect(await height(page, '#panel-trace')).toBe(original); // exactly the original layout, not an approximation
  expect(await page.locator('.bw-grid').evaluate((el) => (el as HTMLElement).style.cssText)).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('bw.layout.capture.split'))).toBeNull();
  await device.close();
});

test('dragging the splitter resizes the Trace, and a damaged remembered value is ignored', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('bw.layout.capture.split', 'garbage'));
  const device = await new MockDeviceServer().ready();
  await connected(page, device.url);
  const splitter = page.getByTestId('trace-splitter');
  await expect(splitter).toHaveAttribute('aria-valuenow', '60'); // the damaged value did not change anything
  const before = await height(page, '#panel-trace');
  const box = (await splitter.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 80, { steps: 6 });
  await page.mouse.up();
  expect(await height(page, '#panel-trace')).toBeGreaterThan(before + 30);
  expect(Number(await splitter.getAttribute('aria-valuenow'))).toBeGreaterThan(60);
  await device.close();
});

test('no splitter on a phone, and the page does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const device = await new MockDeviceServer().ready();
  await connected(page, device.url);
  await expect(page.getByTestId('trace-splitter')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await device.close();
});
