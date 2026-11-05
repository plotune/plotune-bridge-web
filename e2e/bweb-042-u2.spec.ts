// Bridge Web real-user finding U2 — the phone Statistics table is cut mid-word with no cue that
// more columns are scrollable. Real Chromium at 390x844 and 1440x900, axe WCAG 2.2 AA, screenshots.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { configureBothChannels, connected, showPanel, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';
import { MockEcu } from '../tests/helpers/mockEcu';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const shot = (name: string) => `docs/screenshots/${name}.png`;

async function statsWorkspace(page: Page): Promise<MockDeviceServer> {
  const device = await new MockDeviceServer({ ecu: new MockEcu() }).ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  device.generate(1, 40);
  await showPanel(page, 'Statistics');
  await expect(page.getByTestId('stats-table')).toBeVisible();
  return device;
}

interface Metrics {
  docOverflow: number;
  tableWidth: number;
  wrapWidth: number;
  hiddenX: number;
  dataMore: string | null;
  mask: string;
  scrollbar: string;
}

async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const wrap = document.querySelector('.bw-table-wrap') as HTMLElement;
    const table = document.querySelector('[data-testid="stats-table"]') as HTMLElement;
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tableWidth: table.scrollWidth,
      wrapWidth: wrap.clientWidth,
      hiddenX: wrap.scrollWidth - wrap.clientWidth,
      dataMore: wrap.getAttribute('data-more'),
      mask: getComputedStyle(wrap).maskImage,
      scrollbar: getComputedStyle(wrap).scrollbarWidth,
    };
  });
}

async function axeClean(page: Page, label: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  console.log(`axe (${label}, WCAG 2.2 AA): ${axe.violations.length} violations, ${axe.passes.length} passes, ${axe.incomplete.length} incomplete`);
  expect(axe.violations.map((v) => v.id), `${label}: WCAG 2.2 AA violations`).toEqual([]);
}

test.describe('U2: phone Statistics (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('hidden columns get a truthful hint, edge fade and scrollbar', async ({ page }) => {
    const device = await statsWorkspace(page);
    try {
      await expect(page.locator('.bw-table-wrap')).toHaveAttribute('data-more', 'true');
      const m = await measure(page);
      console.log('390 metrics:', JSON.stringify(m));

      expect(m.docOverflow, 'the page must not overflow').toBeLessThanOrEqual(0);
      expect(m.hiddenX, '~313 px of the table is hidden (report3.json)').toBeGreaterThan(100);
      expect(m.tableWidth, 'the table is ~653 px wide').toBeGreaterThan(600);
      expect(m.dataMore, 'the flag says columns are hidden').toBe('true');
      expect(m.mask, 'a real edge fade is applied').toContain('gradient');
      expect(m.scrollbar, 'a thin scrollbar is styled').toBe('thin');
      await expect(page.getByTestId('stats-scroll-hint'), 'the cue names the hidden columns').toBeVisible();

      // The cue must be truthful: at the scroll end there are no hidden columns to the right.
      await page.locator('.bw-table-wrap').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await expect(page.locator('.bw-table-wrap')).not.toHaveAttribute('data-more', 'true');
      await expect(page.getByTestId('stats-scroll-hint')).toBeHidden();
      // Back to the start for the screenshot that shows the cut + hint + fade.
      await page.locator('.bw-table-wrap').evaluate((el) => { el.scrollLeft = 0; });
      await expect(page.locator('.bw-table-wrap')).toHaveAttribute('data-more', 'true');

      await page.screenshot({ path: shot('visual-u2-390'), animations: 'disabled' });
      await axeClean(page, 'phone Statistics 390x844');
    } finally {
      await device.close();
    }
  });
});

test.describe('U2: narrow Statistics panel on desktop (1440x900)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the cue appears exactly when columns are hidden', async ({ page }) => {
    const device = await statsWorkspace(page);
    try {
      const m = await measure(page);
      console.log('1440 metrics:', JSON.stringify(m));
      expect(m.docOverflow, 'the page must not overflow').toBeLessThanOrEqual(0);
      // Truthfulness at any width: the flag (and therefore the hint) matches real overflow.
      expect(m.dataMore === 'true', 'data-more matches real overflow').toBe(m.hiddenX > 8);
      if (m.hiddenX > 8) await expect(page.getByTestId('stats-scroll-hint')).toBeVisible();
      else await expect(page.getByTestId('stats-scroll-hint')).toBeHidden();

      await page.screenshot({ path: shot('visual-u2-1440'), animations: 'disabled' });
      await axeClean(page, 'desktop Statistics 1440x900');
    } finally {
      await device.close();
    }
  });
});
