import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { configureBothChannels, connected, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

const canvasNav = (page: Page) => page.getByRole('navigation', { name: 'Canvases' });
const panelBar = (page: Page) => page.getByRole('navigation', { name: 'Panels on this canvas' });

async function createCanvas(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Choose canvas' }).click();
  await page.getByRole('dialog', { name: 'Canvases' }).getByRole('button', { name: 'New canvas' }).click();
  await page.getByLabel('Canvas name').fill(name);
  await page.getByRole('button', { name: 'Blank canvas' }).click();
}

async function openCanvasPicker(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Choose canvas' }).click();
  return page.getByRole('dialog', { name: 'Canvases' });
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(widths.scroll, `document horizontal overflow: ${JSON.stringify(widths)}`).toBeLessThanOrEqual(widths.client);
}

async function assertTouchTargets44(container: Locator): Promise<void> {
  const small = await container.getByRole('button').evaluateAll((buttons) => buttons.flatMap((button) => {
    const r = button.getBoundingClientRect();
    return r.width && r.height && (r.width < 44 || r.height < 44)
      ? [{ label: button.getAttribute('aria-label') ?? button.textContent?.trim(), width: Math.round(r.width), height: Math.round(r.height) }]
      : [];
  }));
  expect(small, 'all visible interactive buttons in this mobile state need 44 px targets').toEqual([]);
}

async function logAxe(page: Page, state: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const incomplete = result.incomplete.map((item) => `${item.id} (${item.nodes.length} nodes: ${item.nodes.map((node) => `${node.target.join(' ')} — ${node.failureSummary?.split('\n')[0] ?? 'manual review'}`).join('; ')})`);
  console.log(`axe ${state}: ${result.violations.length} violations; ${result.passes.length} passes; incomplete: ${incomplete.join(', ') || 'none'}`);
  expect(result.violations.map((item) => `${item.id}: ${item.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
}

test.describe('phone canvas picker and saved layout actions', () => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    test(`creates, selects, renames, reorders and deletes canvases at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(canvasNav(page)).toBeVisible();
      await assertNoHorizontalOverflow(page);

      const longName = 'Calibration station 04 east production line';
      await createCanvas(page, longName);
      await expect(page.getByRole('button', { name: /^Choose canvas:/ })).toContainText(longName);
      await assertNoHorizontalOverflow(page);

      let picker = await openCanvasPicker(page);
      await expect(picker.getByRole('button', { name: `Open canvas ${longName}` })).toHaveAttribute('aria-current', 'page');
      await assertTouchTargets44(picker);
      await picker.getByRole('button', { name: 'Rename canvas' }).click();
      const rename = page.getByRole('dialog', { name: 'Rename canvas' });
      await assertTouchTargets44(rename);
      await page.getByLabel('Canvas name').fill('Calibration north');
      await page.keyboard.press('Enter');
      picker = await openCanvasPicker(page);
      await expect(picker.getByRole('button', { name: 'Open canvas Calibration north' })).toHaveAttribute('aria-current', 'page');

      await picker.getByRole('button', { name: 'Duplicate canvas' }).click();
      await expect(page.getByRole('button', { name: /^Choose canvas:/ })).toContainText('Calibration north copy');
      picker = await openCanvasPicker(page);
      await expect(picker.getByRole('button', { name: 'Open canvas Calibration north copy' })).toHaveAttribute('aria-current', 'page');
      await picker.getByRole('button', { name: 'Delete canvas' }).click();
      await expect(page.getByRole('button', { name: /^Choose canvas:/ })).toContainText('Calibration north');

      await picker.getByRole('button', { name: 'New canvas' }).click();
      const create = page.getByRole('dialog', { name: 'New canvas' });
      await assertTouchTargets44(create);
      await page.getByLabel('Canvas name').fill('Thermal soak verification');
      await page.getByRole('button', { name: 'Blank canvas' }).click();
      picker = await openCanvasPicker(page);
      await picker.getByRole('button', { name: 'Open canvas Calibration north' }).click();
      await expect(page.getByRole('button', { name: /^Choose canvas:/ })).toContainText('Calibration north');
      await page.reload();
      await expect(page.getByRole('button', { name: /^Choose canvas:/ })).toContainText('Calibration north');

      picker = await openCanvasPicker(page);
      await picker.getByRole('button', { name: 'Move canvas right' }).click();
      await expect(picker.getByRole('button', { name: 'Move canvas left' })).toBeEnabled();
      await picker.getByRole('button', { name: 'Delete canvas' }).click();
      await expect(page.getByRole('button', { name: /^Choose canvas:/ })).toContainText('Thermal soak verification');
      await page.reload();
      await expect(page.getByRole('button', { name: /^Choose canvas:/ })).toContainText('Thermal soak verification');
      await assertNoHorizontalOverflow(page);
    });
  }
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`phone panel actions edit a saved split layout at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByTestId('empty-canvas').getByRole('button', { name: 'Trace', exact: true }).click();
    await panelBar(page).getByRole('button', { name: 'Add panel' }).click();
    await page.getByRole('dialog', { name: 'Add a panel' }).getByRole('button', { name: /^Statistics Received,/ }).click();
    await expect(panelBar(page).getByRole('button', { name: 'Statistics' })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await panelBar(page).getByRole('button', { name: 'Edit panel layout' }).click();
    let editor = page.getByRole('dialog', { name: 'Edit panel layout' });
    await assertTouchTargets44(editor);
    await editor.getByLabel('Panel name').fill('Bus counters');
    await editor.getByRole('button', { name: 'Save panel name' }).click();
    await expect(editor.getByRole('status')).toHaveText('Panel renamed.');
    await editor.getByLabel('Move beside panel').selectOption({ label: 'Trace (1)' });
    await editor.getByLabel('Position').selectOption('right');
    await editor.getByRole('button', { name: 'Move panel' }).click();
    await expect(editor.getByRole('status')).toHaveText('Panel moved.');
    const grow = editor.getByRole('button', { name: 'Grow 5% at divider 1' });
    await grow.click();
    await expect(editor.locator('fieldset')).toContainText('55%');
    await page.keyboard.press('Escape');
    await expect(panelBar(page).getByRole('button', { name: 'Bus counters' })).toBeVisible();

    // Verify the tab action by moving the panel back into Trace's tab group, then reload its saved structure.
    await panelBar(page).getByRole('button', { name: 'Edit panel layout' }).click();
    editor = page.getByRole('dialog', { name: 'Edit panel layout' });
    await logAxe(page, 'phone panel layout editor');
    await editor.getByLabel('Move beside panel').selectOption({ label: 'Trace (1)' });
    await editor.getByLabel('Position').selectOption('center');
    await editor.getByRole('button', { name: 'Move panel' }).click();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(panelBar(page).getByRole('button', { name: 'Bus counters' })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { label: el.getAttribute('aria-label'), outlineStyle: getComputedStyle(el).outlineStyle, outlineWidth: getComputedStyle(el).outlineWidth } : null;
    });
    expect(focus?.outlineStyle).not.toBe('none');
    expect(parseFloat(focus?.outlineWidth ?? '0')).toBeGreaterThan(0);

    await openCanvasPicker(page);
    await logAxe(page, 'phone canvas picker');
    await page.keyboard.press('Escape');

    // Leaving the phone presentation must discard transient picker and editor state.
    await openCanvasPicker(page);
    await page.setViewportSize({ width: 701, height: viewport.height });
    await expect(page.getByRole('dialog', { name: 'Canvases' })).toHaveCount(0);
    await page.setViewportSize(viewport);
    await expect(page.getByRole('dialog', { name: 'Canvases' })).toHaveCount(0);
    await panelBar(page).getByRole('button', { name: 'Edit panel layout' }).click();
    await page.setViewportSize({ width: 701, height: 844 });
    await expect(page.getByRole('dialog', { name: 'Edit panel layout' })).toHaveCount(0);
    await page.setViewportSize(viewport);
    await expect(page.getByRole('dialog', { name: 'Edit panel layout' })).toHaveCount(0);

    await panelBar(page).getByRole('button', { name: 'Bus counters' }).click();
    await panelBar(page).getByRole('button', { name: 'Edit panel layout' }).click();
    await page.getByRole('dialog', { name: 'Edit panel layout' }).getByRole('button', { name: 'Close panel' }).click();
    await expect(panelBar(page).getByRole('button', { name: 'Bus counters' })).toHaveCount(0);
    await page.reload();
    await expect(panelBar(page).getByRole('button', { name: 'Trace' })).toBeVisible();
    await panelBar(page).getByRole('button', { name: 'Trace' }).click();
    await panelBar(page).getByRole('button', { name: 'Edit panel layout' }).click();
    await page.getByRole('dialog', { name: 'Edit panel layout' }).getByRole('button', { name: 'Close panel' }).click();
    const starter = page.getByTestId('empty-canvas').getByRole('button', { name: 'Trace', exact: true });
    await expect(starter).toBeVisible();
    await expect(panelBar(page)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Edit panel layout' })).toHaveCount(0);
    // Removing the final panel leaves a useful focus destination on the empty canvas.
    await expect.poll(() => starter.evaluate((button) => document.activeElement === button)).toBe(true);
  });
}

test('tablet keeps two panels side by side; desktop retains canvas tabs and dock controls', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.getByTestId('empty-canvas').getByRole('button', { name: 'Trace', exact: true }).click();
  await page.getByRole('button', { name: 'Add panel' }).click();
  await page.getByRole('dialog', { name: 'Add a panel' }).getByRole('button', { name: /^Statistics Received,/ }).click();
  const trace = page.getByRole('region', { name: 'Trace', exact: true });
  const stats = page.getByRole('region', { name: 'Statistics', exact: true });
  await expect(trace).toBeVisible();
  await expect(stats).toBeVisible();
  expect((await stats.boundingBox())!.x).toBeGreaterThan((await trace.boundingBox())!.x);
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(canvasNav(page).getByRole('button', { name: 'Canvas 1' })).toBeVisible();
  await expect(trace).toBeVisible();
  await expect(stats).toBeVisible();
  await page.getByRole('button', { name: 'Choose canvas' }).count().then((count) => expect(count).toBe(0));
  await assertNoHorizontalOverflow(page);
  await logAxe(page, 'desktop two-panel canvas');
});

test('phone canvas edits leave a mocked CAN capture running and its trace available', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await connected(page, device.url);
    await configureBothChannels(page);
    await startCapture(page);
    device.core.injectRx(1, { id: 0x123, data: Uint8Array.of(0xaa) });
    const rows = page.locator('[role=row][data-channel]');
    await expect(rows).toContainText('123');

    await createCanvas(page, 'Live capture notes');
    await page.getByRole('button', { name: /^Choose canvas:/ }).click();
    await page.getByRole('dialog', { name: 'Canvases' }).getByRole('button', { name: 'Open canvas Capture' }).click();
    await expect(page.getByRole('button', { name: 'Stop capture' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Trace' })).toBeVisible();
    await expect(rows.filter({ hasText: '123' })).toHaveCount(1);
    device.core.injectRx(1, { id: 0x124, data: Uint8Array.of(0xbb) });
    await expect(rows.filter({ hasText: '124' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Choose canvas:/ })).toContainText('Capture');
  } finally {
    await device.close();
  }
});
