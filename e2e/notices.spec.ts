import { expect, test, type Page } from '@playwright/test';
import { configureBothChannels, connected, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

const SELECTORS = ['nav[aria-label=Workspace]', '#panel-trace', '#panel-channels', '#panel-stats'];

async function geometry(page: Page): Promise<Record<string, { y: number; height: number; width: number }>> {
  const out: Record<string, { y: number; height: number; width: number }> = {};
  for (const selector of SELECTORS) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, selector).not.toBeNull();
    out[selector] = { y: Math.round(box!.y), height: Math.round(box!.height), width: Math.round(box!.width) };
  }
  return out;
}

test.describe('notices float over the workspace', () => {
  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    test(`a lost connection does not move or resize any panel (${name})`, async ({ page }) => {
      await page.setViewportSize(size);
      const device = await new MockDeviceServer().ready();
      await connected(page, device.url);
      await configureBothChannels(page);
      await startCapture(page);
      device.generate(1, 20, 0x7e8);
      await page.waitForTimeout(800);
      const before = await geometry(page);

      device.drop(1006);
      const dock = page.getByTestId('notice-dock');
      await expect(dock).toBeVisible();
      await expect(dock.getByRole('button', { name: 'Reconnect' })).toBeVisible();
      const after = await geometry(page);
      for (const selector of SELECTORS) {
        // Never squeezed, never pushed down. (On a phone the device card above the workspace drops its channel lines when the
        // device disconnects, so the panels may slide up; that is the device's state, not the notice.)
        expect(after[selector].height, selector).toBe(before[selector].height);
        expect(after[selector].width, selector).toBe(before[selector].width);
        expect(after[selector].y, selector).toBeLessThanOrEqual(before[selector].y);
      }
      if (name === 'desktop') expect(after).toEqual(before);

      // The card floats: it is fixed to the viewport corner, not part of the page flow.
      const position = await dock.evaluate((el) => getComputedStyle(el).position);
      expect(position).toBe('fixed');
      await device.close();
    });
  }

  test('the notice can be hidden to a chip and shown again, with the mouse or Esc, without moving anything', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const device = await new MockDeviceServer().ready();
    await connected(page, device.url);
    await configureBothChannels(page);
    await startCapture(page);
    device.drop(1006);
    const dock = page.getByTestId('notice-dock');
    await expect(dock.getByRole('button', { name: 'Reconnect' })).toBeVisible();
    const open = await geometry(page);

    await dock.getByRole('button', { name: /^Hide this message/ }).click();
    await expect(dock.getByRole('button', { name: 'Reconnect' })).toBeHidden();
    const chip = dock.getByRole('button', { name: /^Show the message/ });
    await expect(chip).toBeVisible();
    expect(await geometry(page)).toEqual(open);

    await chip.click();
    await expect(dock.getByRole('button', { name: 'Reconnect' })).toBeVisible();
    // Esc inside the card hides it again.
    await dock.getByRole('button', { name: 'Reconnect' }).focus();
    await page.keyboard.press('Escape');
    await expect(chip).toBeVisible();
    expect(await geometry(page)).toEqual(open);
    await device.close();
  });
});
