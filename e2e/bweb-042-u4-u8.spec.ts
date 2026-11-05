// Bridge Web real-user findings U4 + U8 — the recording-format select and the recorded-file chip.
// Real Chromium at 1440x900 (desktop, where the chip shows) and 390x844 (phone, where U4 said the
// chooser was invisible), axe WCAG 2.2 AA at both, and top-bar screenshots for the PR body.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { configureBothChannels, connected, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const shot = (name: string) => `docs/screenshots/${name}.png`;

async function axeClean(page: import('@playwright/test').Page, label: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  console.log(`axe (${label}, WCAG 2.2 AA): ${axe.violations.length} violations, ${axe.passes.length} passes, ${axe.incomplete.length} incomplete`);
  expect(axe.violations.map((v) => v.id), `${label}: WCAG 2.2 AA violations`).toEqual([]);
}

async function shortOptions(page: import('@playwright/test').Page): Promise<void> {
  const options = await page.getByLabel('Recording format').locator('option').evaluateAll((els) =>
    els.map((e) => ({ text: e.textContent ?? '', title: e.getAttribute('title') })),
  );
  console.log('format options:', JSON.stringify(options));
  expect(options.length).toBeGreaterThanOrEqual(3);
  for (const o of options) {
    expect(o.title, 'the full descriptive name stays on title').toBeTruthy();
    expect(o.text, 'the closed 76px control shows a complete short code').not.toContain('(');
  }
}

test.describe('U4 + U8: desktop (1440x900)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the format value is fully readable and the saved chip exposes its full text on hover', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    device.generate(1, 100, 0x7e8);
    try {
      await connected(page, device.url);
      await configureBothChannels(page);
      await startCapture(page);

      // U4: the closed select shows a complete short value; the full name is on title.
      const select = page.getByLabel('Recording format');
      await expect(select).toBeVisible();
      const box = await select.boundingBox();
      expect(box!.width, 'the select is not 0px').toBeGreaterThan(40);
      expect(await select.locator('option:checked').textContent()).toBe('ASC');
      await expect(select).toHaveAttribute('title', /Recording format: ASC \(Vector text\)/);
      await shortOptions(page);
      await select.selectOption('csv');
      await expect(select).toHaveAttribute('title', /CSV \(spreadsheet\)/);
      await select.selectOption('asc');
      await page.locator('.bw-topbar').screenshot({ path: shot('visual-u4-u8-1440'), animations: 'disabled' });

      // U8: a real recording ends with an ellipsised chip whose title holds the whole string.
      await page.getByRole('button', { name: 'Record', exact: true }).click();
      await expect(page.getByTestId('record-status')).toContainText(/Recording/);
      await page.waitForTimeout(600);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Stop and save' }).click(),
      ]);
      await download.saveAs('/tmp/opencode/u4-u8-recording.asc');
      const status = page.getByTestId('record-status');
      await expect(status).toContainText(/Saved bridge-\d{8}-\d{6}\.asc/);
      const title = await status.getAttribute('title');
      const text = await status.textContent();
      console.log('saved chip:', JSON.stringify({ title, text }));
      expect(title, 'the full text is available on hover').toBe(text);
      expect(title!).toMatch(/Saved bridge-\d{8}-\d{6}\.asc · \d+ frames · \d/);
      expect(title!, 'the file size is present').toMatch(/\d+(\.\d+)? (B|KB|MB)/);
      const truncated = await status.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(truncated, 'the visible chip really is ellipsised, which is why the title matters').toBe(true);
      await page.locator('.bw-topbar').screenshot({ path: shot('visual-u4-u8-1440-saved'), animations: 'disabled' });

      await axeClean(page, 'desktop 1440x900');
    } finally {
      await device.close();
    }
  });
});

test.describe('U4: phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the format chooser is reachable with a 44px target and no top-bar overflow', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    device.generate(1, 20, 0x123);
    try {
      await connected(page, device.url);
      const select = page.getByLabel('Recording format');
      await expect(select, 'the chooser is visible on a phone (was 0px)').toBeVisible();
      const box = await select.boundingBox();
      console.log('phone select box:', JSON.stringify(box));
      expect(box!.width).toBeGreaterThan(40);
      expect(box!.height, '44px touch target').toBeGreaterThanOrEqual(44);
      expect(await select.locator('option:checked').textContent()).toBe('ASC');
      await shortOptions(page);
      const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log('phone docOverflow:', docOverflow);
      expect(docOverflow, 'the extra control must not overflow the phone page').toBeLessThanOrEqual(0);

      await page.locator('.bw-topbar').screenshot({ path: shot('visual-u4-u8-390'), animations: 'disabled' });
      await axeClean(page, 'phone 390x844');
    } finally {
      await device.close();
    }
  });
});
