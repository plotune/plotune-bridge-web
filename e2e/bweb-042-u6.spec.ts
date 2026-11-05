// U6 (real-user finding): capture can be running while the canvas shows nothing, so the page says "Capturing" but
// offers no frames. The empty canvas now states it and points at the Trace. This spec proves the conditions:
// no hint before capture, hint while capturing on an empty canvas, and no hint once a panel exists.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { MockDeviceServer } from './mockServer';
import { MockEcu } from '../tests/helpers/mockEcu';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** A blank first visit (no seeded project) connected to the mock device, so the canvas stays empty. */
async function connectOnBlankCanvas(page: import('@playwright/test').Page, url: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a device' }).click();
  await page.getByRole('button', { name: 'Advanced: connect on the local network instead' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Device address').fill(url);
  await page.getByRole('button', { name: 'Connect', exact: true }).last().click();
  const side = page.getByRole('complementary', { name: 'Explorer' });
  if (!(await side.isVisible())) await page.getByRole('button', { name: 'Explorer', exact: true }).first().click();
  await expect(side.getByTestId('device-chip')).toContainText('Connected', { timeout: 10_000 });
}

test.describe('U6: the empty canvas says capture is running', () => {
  test('hint appears only while capturing on an empty canvas, and axe stays clean', async ({ page }) => {
    const device = await new MockDeviceServer({ ecu: new MockEcu() }).ready();
    await connectOnBlankCanvas(page, device.url);

    const hint = page.getByTestId('capture-hint');
    await expect(page.getByTestId('empty-canvas')).toBeVisible();
    await expect(hint).toHaveCount(0); // connected but not capturing yet

    // Give channel 1 a bit rate so the start is accepted.
    await page.getByRole('button', { name: /^Settings for / }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('CAN1 bit rate').selectOption('500000');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    await page.getByRole('button', { name: 'Start capture' }).click();
    await expect(hint).toBeVisible({ timeout: 5000 });
    await expect(hint).toContainText('Capturing. Add a Trace to watch the frames.');

    const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    console.log(`axe (empty canvas while capturing, WCAG 2.2 AA): ${axe.violations.length} violations, ${axe.passes.length} passes, ${axe.incomplete.length} incomplete`);
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    // Adding the Trace the hint points at replaces the empty canvas, so the hint goes with it.
    await page.getByRole('button', { name: 'Trace', exact: true }).first().click();
    await expect(hint).toHaveCount(0);

    await page.getByRole('button', { name: 'Stop capture' }).click();
    await device.close();
  });

  test('hint is absent on a first visit with no device at all', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('empty-canvas')).toBeVisible();
    await expect(page.getByTestId('capture-hint')).toHaveCount(0);
  });
});
