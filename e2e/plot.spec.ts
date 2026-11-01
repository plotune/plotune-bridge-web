import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { configureBothChannels, connected, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

// The mock device sends id 0x7E8 on CAN1 with data [counter, 0xAA] and 0x123 on CAN2.
const DBC = 'BO_ 2024 Resp: 2 X\n SG_ Counter : 0|8@1+ (1,0) [0|255] "rpm" Y\n SG_ Level : 8|8@1+ (0.5,-10) [-10|117.5] "degC" Y\nBO_ 291 Other: 2 X\n SG_ Seq : 0|8@1+ (1,0) [0|255] "" Y\n';

async function openPlot(page: Page, device: MockDeviceServer) {
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  await expect(page.getByRole('region', { name: 'Plot' })).toHaveCount(0); // no database yet: no Plot panel
  await page.locator('summary', { hasText: 'Databases' }).click();
  await page.getByTestId('dbc-input-1').setInputFiles({ name: 'car.dbc', mimeType: 'text/plain', buffer: Buffer.from(DBC) });
  await page.getByTestId('dbc-input-2').setInputFiles({ name: 'car.dbc', mimeType: 'text/plain', buffer: Buffer.from(DBC) });
  await page.locator('summary', { hasText: 'Databases' }).click();
  await expect(page.getByRole('region', { name: 'Plot' })).toBeVisible();
}

const choose = async (page: Page, text: string) => {
  await page.getByLabel('Search signals').fill(text);
  await page.getByRole('group', { name: 'Choose signals to plot' }).getByRole('checkbox').first().check();
};

test('plot a decoded signal: lanes, units, cursor, pause, CSV, remembered, accessible', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  device.generate(1, 100, 0x7e8);
  await openPlot(page, device);
  await choose(page, 'counter');
  await page.getByLabel('Search signals').fill('level');
  await page.getByRole('group', { name: 'Choose signals to plot' }).getByRole('checkbox').first().check();
  const canvas = page.getByTestId('plot-canvas');
  await expect(canvas).toBeVisible();
  const table = page.getByTestId('plot-table');
  await expect(table.locator('tr[data-signal=Counter] td').first()).toContainText('rpm');
  await expect(table.locator('tr[data-signal=Level] td').first()).toContainText('degC');
  // Level = 0xAA * 0.5 - 10 = 75: the scaling comes from the database.
  await expect(table.locator('tr[data-signal=Level] td').first()).toContainText('75 degC');
  await expect(page.getByText('device’s own clock')).toBeVisible();
  await page.screenshot({ path: 'test-results/plot-live.png' });

  // Values change while following; a paused plot keeps them.
  const counterCell = table.locator('tr[data-signal=Counter] td').first();
  const before = await counterCell.innerText();
  await expect.poll(() => counterCell.innerText(), { timeout: 5000 }).not.toBe(before);
  const plot = page.getByRole('region', { name: 'Plot' });
  await plot.getByRole('button', { name: 'Pause' }).click();
  const frozen = await counterCell.innerText();
  await page.waitForTimeout(600);
  expect(await counterCell.innerText()).toBe(frozen);
  await expect(plot.getByRole('button', { name: 'Resume' })).toHaveAttribute('aria-pressed', 'true');

  // A cursor over the plot shows the exact values at that time in the table.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + 40);
  await expect(table.locator('caption')).toContainText(/Value of each plotted signal at [\d.]+ s/);
  await page.mouse.move(box.x - 20, box.y - 20);
  await expect(table.locator('caption')).toContainText('Latest value');
  // The keyboard moves the cursor too.
  await canvas.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(table.locator('caption')).toContainText('at');
  await page.keyboard.press('Escape');
  await plot.getByRole('button', { name: 'Resume' }).click();

  // The visible data can be saved.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  expect(download.suggestedFilename()).toBe('signals.csv');
  const text = (await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8')).split('\r\n');
  expect(text[0]).toBe('time_s,channel,message,signal,value,unit');
  expect(text.length).toBeGreaterThan(20);
  expect(text.some((line) => /,CAN1,Resp,Level,75,degC$/.test(line))).toBe(true);

  // Accessible: no violations with the plot, its table and the picker.
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

  // Remembered in this browser and validated against the database after a reload.
  await page.reload();
  await connected(page, device.url);
  await expect(page.getByTestId('plot-table').locator('tr[data-signal=Counter]')).toBeVisible();
  await expect(page.getByTestId('plot-table').locator('tr[data-signal=Level]')).toBeVisible();
  await device.close();
});

test('at about 1,800 frames per second the plot draws well inside a display frame and misses nothing', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  device.generate(1, 900, 0x7e8);
  device.generate(2, 900, 0x123);
  await openPlot(page, device);
  await choose(page, 'counter');
  await page.getByLabel('Search signals').fill('seq');
  await page.getByRole('group', { name: 'Choose signals to plot' }).getByRole('checkbox').first().check();
  const canvas = page.getByTestId('plot-canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(6000);
  const ms: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    ms.push(Number(await canvas.getAttribute('data-draw-ms')));
    await page.waitForTimeout(50);
  }
  ms.sort((a, b) => a - b);
  console.log(`PLOT DRAW at ~1800 frames/s, 2 lanes, 30 s window: median ${ms[20]} ms, worst ${ms[39]} ms, points drawn ${await canvas.getAttribute('data-drawn-points')}`);
  // Target (stated on the PR): the plot's own drawing stays under 8 ms, half of a 60 Hz frame.
  expect(ms[20]).toBeLessThan(8);
  await expect(page.getByText(/rows left the trace before they were read/)).toHaveCount(0);
  await device.close();
});

test('on a phone the plot and its table stay inside the page width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const device = await new MockDeviceServer().ready();
  device.generate(1, 50, 0x7e8);
  await openPlot(page, device);
  await choose(page, 'counter');
  await expect(page.getByTestId('plot-canvas')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const canvas = (await page.getByTestId('plot-canvas').boundingBox())!;
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(390);
  await device.close();
});

test('zoom: drag a range, buttons and keys, the CSV follows, and Reset follows live data again', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  device.generate(1, 100, 0x7e8);
  await openPlot(page, device);
  await choose(page, 'counter');
  const plot = page.getByRole('region', { name: 'Plot' });
  const canvas = page.getByTestId('plot-canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(3500); // a few seconds of data
  await plot.getByLabel('Time window').selectOption('10');
  const rows = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), plot.getByRole('button', { name: 'Download CSV' }).click()]);
    const text = await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8');
    return text.trim().split('\r\n').length - 1;
  };
  const all = await rows();
  expect(all).toBeGreaterThan(150);
  await expect(plot.getByRole('button', { name: 'Reset zoom' })).toHaveCount(0);

  // Drag across a part of the plot to zoom into it.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(plot.getByText(/zoomed to [\d.]+ s/)).toBeVisible();
  await expect(plot.getByRole('button', { name: 'Reset zoom' })).toBeVisible();
  const zoomed = await rows();
  // The drag covered about 15% of a 10 s window at 100 frames/s (about 150 rows): the export is the zoomed range, not everything.
  expect(zoomed).toBeGreaterThan(60);
  expect(zoomed).toBeLessThan(all * 0.6);

  // Buttons and keys change the range further; the status says how far.
  const status = plot.locator('.bw-panel-status');
  const span = async () => Number(((await status.innerText()).match(/zoomed to ([\d.]+) s/) ?? [])[1]);
  const first = await span();
  await plot.getByRole('button', { name: 'Zoom in' }).click();
  expect(await span()).toBeLessThan(first);
  await plot.getByRole('button', { name: 'Zoom out' }).click();
  await plot.getByRole('button', { name: 'Zoom out' }).click();
  expect(await span()).toBeGreaterThan(first);
  await canvas.focus();
  const before = await span();
  await page.keyboard.press('+');
  expect(await span()).toBeLessThan(before);

  // Reset (button, or 0 / Esc on the plot) follows the newest data again.
  await page.keyboard.press('0');
  await expect(plot.getByRole('button', { name: 'Reset zoom' })).toHaveCount(0);
  await expect(status).toContainText('last 10 s');
  await device.close();
});
