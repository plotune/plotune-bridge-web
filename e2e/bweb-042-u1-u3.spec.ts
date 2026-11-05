// Bridge Web real-user findings U1 + U3 — the phone Trace must keep its payload columns and its
// toolbar must not wrap into a broken shape. Real Chromium, real pointer/keyboard helpers, two
// viewports (390x844 and 1440x900), plus an axe WCAG 2.2 AA scan and screenshots for the PR body.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { configureBothChannels, connected, showPanel, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';
import { MockEcu } from '../tests/helpers/mockEcu';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const shot = (name: string) => `docs/screenshots/${name}.png`;

/** A connected, capturing workspace with a Trace full of frames. */
async function traceWorkspace(page: Page): Promise<MockDeviceServer> {
  const device = await new MockDeviceServer({ ecu: new MockEcu() }).ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  device.generate(1, 40);
  await expect(page.locator('[role="row"][data-channel]').first()).toBeVisible({ timeout: 10_000 });
  await showPanel(page, 'Trace');
  await expect(page.locator('.bw-panel-trace .bw-trace')).toBeVisible();
  return device;
}

interface Metrics {
  docOverflow: number;
  traceScroll: number;
  traceScrollbar: string;
  traceBarHeight: number;
  cols: { cls: string; w: number; display: string }[];
  toolTops: number[];
}

async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const trace = document.querySelector('.bw-panel-trace .bw-trace') as HTMLElement;
    const head = document.querySelector('.bw-panel-trace .bw-trace-head') as HTMLElement;
    const cols = [...head.querySelectorAll('[role="columnheader"]')].map((c) => ({
      cls: (c as HTMLElement).className,
      w: Math.round((c as HTMLElement).getBoundingClientRect().width),
      display: getComputedStyle(c).display,
    }));
    const tools = document.querySelector('.bw-panel-trace .bw-panel-tools') as HTMLElement;
    // centre Y, not top: the tools are align-items:center and have different heights, so their
    // tops differ even on one line. All items on one flex line share the same vertical centre.
    const toolTops = [...tools.children].map((c) => {
      const r = (c as HTMLElement).getBoundingClientRect();
      return Math.round(r.top + r.height / 2);
    });
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      traceScroll: trace.scrollWidth - trace.clientWidth,
      traceScrollbar: getComputedStyle(trace).scrollbarWidth,
      traceBarHeight: trace.offsetHeight - trace.clientHeight, // >0 => a classic (visible) horizontal bar
      cols,
      toolTops,
    };
  });
}

async function axeClean(page: Page, label: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  console.log(`axe (${label}, WCAG 2.2 AA): ${axe.violations.length} violations, ${axe.passes.length} passes, ${axe.incomplete.length} incomplete`);
  expect(axe.violations.map((v) => v.id), `${label}: WCAG 2.2 AA violations`).toEqual([]);
}

test.describe('U1 + U3: phone Trace (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps Type + Data readable, scrolls sideways, and lays the tools out on one row', async ({ page }) => {
    const device = await traceWorkspace(page);
    try {
      const m = await measure(page);
      console.log('390 metrics:', JSON.stringify(m));
      const type = m.cols.find((c) => c.cls.includes('bw-c-type'))!;
      const data = m.cols.find((c) => c.cls.includes('bw-c-data'))!;

      // U1: the table scrolls inside its panel (not the page), and the payload is readable again.
      expect(m.docOverflow, 'the page must not overflow').toBeLessThanOrEqual(0);
      expect(m.traceScroll, 'the trace scrolls sideways inside its panel').toBeGreaterThan(0);
      expect(m.traceScrollbar, 'the scrollbar is styled thin').toBe('thin');
      // Overlay scrollbars do not reserve space in headless Chromium, so the definite cue is the hint line.
      await expect(page.getByTestId('trace-scroll-hint'), 'a visible sideways-scroll hint').toBeVisible();
      expect(type, 'a Type column exists').toBeTruthy();
      expect(type.display, 'Type is no longer hidden').not.toBe('none');
      expect(type.w, 'Type column is readable').toBeGreaterThanOrEqual(60);
      expect(data.w, 'Data column is readable instead of "D…"').toBeGreaterThanOrEqual(80);

      // U3: every header tool sits on the same line (no orphaned full-screen icon on a third line).
      expect(new Set(m.toolTops).size, 'all panel tools share one row').toBe(1);

      await page.screenshot({ path: shot('visual-u1-u3-390'), animations: 'disabled' });
      await axeClean(page, 'phone Trace 390x844');
    } finally {
      await device.close();
    }
  });
});

test.describe('U1 + U3: desktop Trace (1440x900) is unchanged', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('no sideways scroll, Type and Data readable, tools on one row', async ({ page }) => {
    const device = await traceWorkspace(page);
    try {
      const m = await measure(page);
      console.log('1440 metrics:', JSON.stringify(m));
      const type = m.cols.find((c) => c.cls.includes('bw-c-type'))!;
      const data = m.cols.find((c) => c.cls.includes('bw-c-data'))!;

      expect(m.docOverflow, 'the page must not overflow').toBeLessThanOrEqual(0);
      expect(m.traceScroll, 'the desktop table fits without scrolling').toBeLessThanOrEqual(0);
      await expect(page.getByTestId('trace-scroll-hint'), 'no scroll hint on a wide screen').toBeHidden();
      expect(type.display).not.toBe('none');
      expect(data.w).toBeGreaterThanOrEqual(80);
      expect(new Set(m.toolTops).size, 'all panel tools share one row').toBe(1);

      await page.screenshot({ path: shot('visual-u1-u3-1440'), animations: 'disabled' });
      await axeClean(page, 'desktop Trace 1440x900');
    } finally {
      await device.close();
    }
  });
});
