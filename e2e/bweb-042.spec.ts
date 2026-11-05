// BWEB-042 rev 1 / O10 — WCAG 2.5.8 (Target Size (Minimum), 24 x 24 CSS px).
// The deployed WCAG 2.2 AA axe scan is clean because axe's `target-size` rule accepts this control
// through the spacing exception. The control's OWN box was 22.8 px high on desktop, which only a
// manual measurement can catch. This spec measures the real box, exercises the enlarged control with
// a keyboard and with a pointer hit at its centre, and runs axe explicitly with WCAG 2.2 AA tags.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { explorer, seedWorkspace } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Two remembered devices so the sidebar has two "Select Bridge N" controls. */
const WORKSPACE = JSON.stringify({
  version: 1,
  devices: [
    { id: 'd1', label: 'Bridge 1', target: 'ws://127.0.0.1:9101', captureChannels: [1, 2], transmitChannel: 1 },
    { id: 'd2', label: 'Bridge 2', target: 'ws://127.0.0.1:9102', captureChannels: [1, 2], transmitChannel: 1 },
  ],
  activeId: 'd1',
  traceView: 'all',
  page: 'capture',
  hidden: { capture: [], diagnostics: [], device: [] },
  diagnostics: {},
  permissionExplained: true,
});

async function boot(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('bw.workspace', value);
      sessionStorage.setItem('bw.sso.signedOut', '1');
    } catch { /* storage blocked */ }
  }, WORKSPACE);
  await seedWorkspace(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Canvases' }).waitFor();
  await explorer(page); // on a phone this opens the floating explorer
}

async function boxes(page: Page): Promise<{ label: string | null; w: number; h: number }[]> {
  return page.locator('.bw-device-select').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { label: el.getAttribute('aria-label'), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  }));
}

async function axeReport(page: Page, label: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const ids = axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  const targetSize = axe.passes.find((p) => p.id === 'target-size');
  console.log(`axe (${label}, WCAG 2.2 AA): ${axe.violations.length} violations, ${axe.passes.length} passes, ${axe.incomplete.length} incomplete; target-size passed nodes=${targetSize?.nodes.length ?? 0}`);
  expect(ids, `${label}: axe violations`).toEqual([]);
  expect(targetSize, `${label}: axe target-size rule ran`).toBeTruthy();
}

test.describe('BWEB-042 rev 1 / O10: sidebar device control target size', () => {
  test('desktop 1280: the control is >= 24 x 24, measured manually (axe passes it via the spacing exception)', async ({ page }) => {
    await boot(page, 1280);
    const measured = await boxes(page);
    expect(measured).toHaveLength(2);
    console.log(`manual box measurement (desktop 1280): ${measured.map((b) => `${b.label} ${b.w}x${b.h}px`).join(', ')}`);
    for (const b of measured) {
      expect(b.h, `${b.label}: height >= 24 CSS px (WCAG 2.5.8 AA)`).toBeGreaterThanOrEqual(24);
      expect(b.w, `${b.label}: width >= 24 CSS px (WCAG 2.5.8 AA)`).toBeGreaterThanOrEqual(24);
    }
    await axeReport(page, 'desktop with two devices');
  });

  test('the enlarged control is operable by keyboard and by a pointer hit at its centre', async ({ page }) => {
    await boot(page, 1280);
    const chips = page.getByTestId('device-chip');
    await expect(chips).toHaveCount(2);

    // Keyboard-only: focus the control and activate it with Enter.
    const second = page.getByRole('button', { name: 'Select Bridge 2' });
    await second.focus();
    await expect(second).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(chips.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(chips.first()).not.toHaveAttribute('aria-current', 'true');

    // Pointer: click the exact centre of the control's box, not its text.
    const first = page.getByRole('button', { name: 'Select Bridge 1' });
    const box = await first.boundingBox();
    expect(box, 'the control has a hit box').not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(chips.first()).toHaveAttribute('aria-current', 'true');
    await expect(chips.nth(1)).not.toHaveAttribute('aria-current', 'true');
  });

  test('phone 390: the same 24 px minimum holds with the explorer open', async ({ page }) => {
    await boot(page, 390);
    const measured = await boxes(page);
    expect(measured).toHaveLength(2);
    for (const b of measured) {
      expect(b.h, `${b.label}: height >= 24 CSS px (WCAG 2.5.8 AA)`).toBeGreaterThanOrEqual(24);
      expect(b.w, `${b.label}: width >= 24 CSS px (WCAG 2.5.8 AA)`).toBeGreaterThanOrEqual(24);
    }
  });

  test('initial workspace axe (WCAG 2.2 AA) stays clean; the manual measurement is the added value', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Canvases' }).waitFor();
    await axeReport(page, 'initial workspace');
  });
});
