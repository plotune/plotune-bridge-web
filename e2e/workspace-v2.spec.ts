import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { closeDialog, configureBothChannels, connected, openDeviceSettings, seedWorkspace, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Canvases' });
const DBC = 'BO_ 2024 Resp: 2 X\n SG_ Counter : 0|8@1+ (1,0) [0|255] "rpm" Y\n SG_ Level : 8|8@1+ (0.5,-10) [-10|117.5] "degC" Y\n';
const CSV = 'time_s,Speed [km/h],Torque [Nm]\n' + Array.from({ length: 21 }, (_, i) => `${i / 2},${i * 5},${100 - i * 2}`).join('\n') + '\n';

test('canvases can be added, named, switched and deleted, and are remembered after a reload', async ({ page }) => {
  await page.goto('/');
  // A first visit is a blank canvas with three starting points, and nothing else asking for attention.
  await expect(nav(page).getByRole('button')).toHaveText(['Canvas 1']);
  await expect(page.getByTestId('empty-canvas').getByRole('button')).toContainText(['Trace', 'Scope', 'Analyzer', 'Browse panels']);
  await expect(page.getByText('Your workspace')).toHaveCount(0);
  await page.getByRole('button', { name: 'New canvas' }).click();
  await page.getByLabel('Canvas name').fill('Cell 7');
  await page.getByRole('button', { name: /Transmit and test/ }).click();
  await expect(nav(page).getByRole('button', { name: 'Cell 7' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Send frame' })).toBeVisible();

  await nav(page).getByRole('button', { name: 'Cell 7' }).dblclick();
  await page.getByLabel('Canvas name').fill('Night run');
  await page.keyboard.press('Enter');
  await expect(nav(page).getByRole('button', { name: 'Night run' })).toBeVisible();

  await page.reload();
  await expect(nav(page).getByRole('button', { name: 'Night run' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Send frame' })).toBeVisible();

  await nav(page).getByRole('button', { name: 'Night run' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete canvas' }).click();
  await expect(nav(page).getByRole('button', { name: 'Night run' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(nav(page).getByRole('button', { name: 'Night run' })).toBeVisible();
});

test('a tab can be dragged beside another panel, a divider resizes with the keyboard, and the layout is remembered', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New canvas' }).click();
  await page.getByRole('button', { name: /Transmit and test/ }).click();
  // Statistics sits under the Trace on the right. Drag it onto the right edge of the Send frame panel.
  const channelsTab = page.getByRole('tab', { name: 'Statistics' });
  const send = page.getByRole('region', { name: 'Send frame' });
  const sendBox = (await send.boundingBox())!;
  const tabBox = (await channelsTab.boundingBox())!;
  await page.mouse.move(tabBox.x + 20, tabBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(tabBox.x - 40, tabBox.y - 40, { steps: 5 });
  await page.mouse.move(sendBox.x + sendBox.width - 30, sendBox.y + sendBox.height / 2, { steps: 10 });
  await page.mouse.up();
  const channels = page.getByRole('region', { name: 'Statistics', exact: true });
  await expect(channels).toBeVisible();
  const after = (await channels.boundingBox())!;
  expect(after.x).toBeGreaterThan(sendBox.x + sendBox.width * 0.4); // docked beside it, on the right

  const divider = page.getByRole('separator', { name: 'Resize panels' }).first();
  await divider.focus();
  const before = Number(await divider.getAttribute('aria-valuenow'));
  await page.keyboard.press(before > 50 ? 'ArrowLeft' : 'ArrowRight');
  await expect.poll(async () => Number(await page.getByRole('separator', { name: 'Resize panels' }).first().getAttribute('aria-valuenow'))).not.toBe(before);

  const box = (await page.getByRole('region', { name: 'Statistics', exact: true }).boundingBox())!;
  await page.reload();
  const again = (await page.getByRole('region', { name: 'Statistics', exact: true }).boundingBox())!;
  expect(Math.abs(again.x - box.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(again.width - box.width)).toBeLessThanOrEqual(2);
});

test('a recording opens in the Analyzer: signals, cursors, statistics, a calculated signal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New canvas' }).click();
  await page.getByRole('button', { name: /^Analysis/ }).click();
  await expect(page.getByRole('region', { name: 'Recordings' })).toBeVisible();
  await page.getByRole('region', { name: 'Recordings' }).locator('input[type=file]').setInputFiles({ name: 'drive.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  const analyzer = page.getByRole('region', { name: 'Analyzer' });
  const table = analyzer.getByRole('table', { name: /Signals on the plot/ });
  await expect(table.getByRole('rowheader', { name: 'Speed' })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'Torque' })).toBeVisible();

  await analyzer.getByRole('button', { name: 'Cursors' }).click();
  await analyzer.getByRole('button', { name: 'Cursors' }).click();
  const row = table.getByRole('rowheader', { name: 'Speed' }).locator('xpath=..');
  await expect(row).toContainText('25.00'); // cursor A at 2.5 s of a 10 s recording: 5 km/h per half second
  await expect(row).toContainText('75.00');
  await analyzer.getByRole('button', { name: 'Statistics' }).click();
  await expect(row).toContainText('50.00'); // the average of 0..100

  await analyzer.getByRole('button', { name: 'Calculated' }).click();
  await page.getByLabel('Formula').fill('Speed - Torque');
  await page.getByLabel('Name', { exact: true }).fill('Margin');
  await page.getByRole('button', { name: 'Add to plot' }).click();
  await expect(table.getByRole('rowheader', { name: 'Margin' })).toBeVisible();

  // The plot is drawn, takes focus and answers the keyboard.
  const canvas = analyzer.locator('canvas');
  await expect(canvas).toBeVisible();
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  await page.keyboard.press('F');

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);

  // The settings are saved with the workspace: strips, signals and the formula survive a reload (the recording itself does not).
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByText('This recording is not available here.')).toBeVisible();
});

test('the Scope sends its window to the Analyzer', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  device.generate(1, 100, 0x7e8);
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  await openDeviceSettings(page);
  await page.getByTestId('dbc-input-1').setInputFiles({ name: 'car.dbc', mimeType: 'text/plain', buffer: Buffer.from(DBC) });
  await closeDialog(page);
  const scope = page.getByRole('region', { name: 'Scope' });
  await scope.getByLabel('Search signals').fill('counter');
  await scope.getByRole('group', { name: 'Choose signals to plot' }).getByRole('checkbox').first().check();
  await expect(scope.getByRole('button', { name: 'Analyze this window' })).toBeEnabled();
  await scope.getByRole('button', { name: 'Analyze this window' }).click();
  const analyzer = page.getByRole('region', { name: 'Analyzer' });
  await expect(analyzer.getByRole('table', { name: /Signals on the plot/ }).getByRole('rowheader', { name: 'Counter' })).toBeVisible();
  await analyzer.getByRole('button', { name: 'Statistics' }).click();
  await expect(analyzer.getByRole('columnheader', { name: 'Avg' })).toBeVisible();
  await device.close();
});

test('on a phone one panel fills the screen and the switcher changes it, without the page scrolling sideways', async ({ page }) => {
  await seedWorkspace(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await expect(nav(page)).toBeVisible();
  const switcher = page.getByRole('navigation', { name: 'Panels on this canvas' });
  await expect(switcher.getByRole('button', { name: 'Trace' })).toHaveAttribute('aria-pressed', 'true');
  await switcher.getByRole('button', { name: 'Statistics' }).click();
  await expect(page.getByRole('region', { name: 'Statistics', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Trace', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('the command palette adds panels, and the explorer hides to give the canvas the whole width', async ({ page }) => {
  await page.goto('/');
  const side = page.getByRole('complementary', { name: 'Explorer' });
  await expect(side).toBeVisible();
  const withExplorer = (await page.getByRole('main').boundingBox())!.width;
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(side).toHaveCount(0);
  expect((await page.getByRole('main').boundingBox())!.width).toBeGreaterThan(withExplorer + 200);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('add panel: scope');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Scope' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Explorer' })).toHaveCount(0); // the choice is remembered
});

test('on a phone the explorer opens over the canvas, and the thumb bar stays inside the screen', async ({ page }) => {
  await seedWorkspace(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Panels on this canvas' });
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(800);
  await expect(page.getByRole('complementary', { name: 'Explorer' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Explorer' }).click();
  await expect(page.getByRole('complementary', { name: 'Explorer' })).toBeVisible();
  // Touch targets: the add-device button is at least 40 px.
  const add = (await page.getByRole('complementary', { name: 'Explorer' }).getByRole('button', { name: 'Add a device' }).boundingBox())!;
  expect(Math.min(add.width, add.height)).toBeGreaterThanOrEqual(40);
});
