// BWEB-042 rev 1 / O9 — WCAG 1.3.1 table semantics on the Trace and Statistics tables.
// Before the fix, axe reported two "incomplete" results (which automated release scans do not fail):
//   aria-required-children  -> .bw-trace-scroll (a rowgroup whose only child was an unroled div)
//   th-has-data-cells       -> the header-only Statistics <table> when no device is connected
// This spec makes those two rules explicit in the verification and would fail on the original markup.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace, connected, configureBothChannels, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';
import { MockEcu } from '../tests/helpers/mockEcu';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const RULES = ['aria-required-children', 'th-has-data-cells'];

/** The axe check that catches O9: no violations, no incomplete nodes for these two rules, and both rules must have run. */
async function tableAxe(page: Page, label: string): Promise<void> {
  const full = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  console.log(`axe (${label}, WCAG 2.2 AA): ${full.violations.length} violations, ${full.passes.length} passes, ${full.incomplete.length} incomplete`);
  expect(full.violations.map((v) => v.id), `${label}: WCAG 2.2 AA violations`).toEqual([]);
  const incompleteIds = full.incomplete.map((i) => i.id);
  expect(incompleteIds, `${label}: aria-required-children must not be incomplete`).not.toContain('aria-required-children');
  expect(incompleteIds, `${label}: th-has-data-cells must not be incomplete`).not.toContain('th-has-data-cells');

  const targeted = await new AxeBuilder({ page }).withRules(RULES).analyze();
  const problems = [
    ...targeted.violations.map((v) => `violation:${v.id}`),
    ...targeted.incomplete.map((i) => `incomplete:${i.id}`),
  ];
  console.log(`axe targeted (${label}): problems=${problems.length ? problems.join(',') : 'none'} passes=${targeted.passes.map((p) => p.id).join(',')}`);
  expect(problems, `${label}: targeted table rules`).toEqual([]);
  expect(targeted.passes.map((p) => p.id), `${label}: both rules ran`).toEqual(expect.arrayContaining(RULES));
}

test.describe('BWEB-042 rev 1 / O9: Trace and Statistics table semantics', () => {
  test('empty tables: no header-only table and no rowgroup without a row', async ({ page }) => {
    await seedWorkspace(page); // capture template: Trace + Statistics panels, no device
    await page.goto('/');
    await expect(page.getByTestId('stats-table')).toBeVisible();
    await expect(page.locator('.bw-trace')).toBeVisible();

    // DOM semantics (L3 evidence for the L2 unit guards).
    expect(await page.locator('.bw-trace-canvas').getAttribute('role')).toBe('presentation');
    expect(await page.locator('.bw-trace-scroll [role="row"]').count()).toBeGreaterThanOrEqual(1);
    expect(await page.getByTestId('stats-table').locator('tbody td').count()).toBeGreaterThanOrEqual(1);
    expect(await page.getByTestId('stats-table').locator('tbody td').first().innerText()).toContain('No statistics yet');

    await tableAxe(page, 'empty Trace + Statistics tables');
  });

  test('populated tables with a captured frame keep the same semantics', async ({ page }) => {
    const device = await new MockDeviceServer({ ecu: new MockEcu() }).ready();
    await connected(page, device.url);
    await configureBothChannels(page);
    await startCapture(page);
    device.generate(1, 40);
    await expect(page.locator('[role="row"][data-channel]').first()).toBeVisible();
    await expect(page.getByTestId('stats-table').locator('tr[data-channel="1"]')).toBeVisible({ timeout: 10_000 });
    await tableAxe(page, 'populated Trace + Statistics tables');
    await device.close();
  });

  test('initial workspace axe (WCAG 2.2 AA) stays clean', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Canvases' }).waitFor();
    const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    console.log(`axe (initial workspace, WCAG 2.2 AA): ${axe.violations.length} violations, ${axe.passes.length} passes, ${axe.incomplete.length} incomplete`);
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });
});
