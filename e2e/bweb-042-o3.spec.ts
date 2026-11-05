// BWEB-042 rev 1 / O3 (WCAG 3.3.1 / 4.1.3). Before the fix a failed open/connect left focus on
// body (or the pane title) while the failure was only announced as an alert. These checks prove the
// keyboard user now lands ON the failure and can act on it, with axe (WCAG 2.2 AA) explicit.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { explorer, seedWorkspace, simulateLocalNetworkPermission } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const ADVANCED = 'Advanced: connect on the local network instead';

async function openLocalForm(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Canvases' }).waitFor();
  const side = await explorer(page);
  await side.getByRole('button', { name: 'Add a device' }).click();
  await page.getByRole('button', { name: ADVANCED }).click();
  const explainer = page.getByTestId('permission-explainer');
  if (await explainer.isVisible()) await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Device address')).toBeVisible();
}

async function axeInitial(page: Page, label: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  console.log(`axe (${label}, WCAG 2.2 AA): ${axe.violations.length} violations, ${axe.passes.length} passes, ${axe.incomplete.length} incomplete`);
  expect(axe.violations.map((v) => v.id), `${label}: axe violations`).toEqual([]);
}

test.describe('BWEB-042 rev 1 / O3: focus lands on the failure notice', () => {
  test('after a connect failure focus is on the alert, Tab stays inside it, and Enter recovers by keyboard', async ({ page }) => {
    await seedWorkspace(page);
    await page.goto('/');
    await openLocalForm(page);
    await page.getByLabel('Device address').fill('127.0.0.1:9'); // nothing listening
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    const notice = page.locator('[data-notice=unreachable]');
    await expect(notice).toBeVisible();
    await expect(notice, 'keyboard focus is on the failure, not body or the pane title').toBeFocused();
    expect(await notice.getAttribute('role')).toBe('alert');
    expect(await notice.getAttribute('tabindex')).toBe('-1');
    const active = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      role: document.activeElement?.getAttribute('role'),
      inNotice: document.querySelector('[data-notice=unreachable]')?.contains(document.activeElement) ?? false,
    }));
    expect(active.role).toBe('alert');
    expect(active.tag).not.toBe('BODY');
    expect(active.inNotice).toBe(true);

    // Tab continues inside the failure (technical details / recovery actions), not off into the page.
    await page.keyboard.press('Tab');
    const stillInside = await page.evaluate(() => document.querySelector('[data-notice=unreachable]')?.contains(document.activeElement) ?? false);
    expect(stillInside, 'Tab keeps the keyboard on the failure').toBe(true);

    // Keyboard-only recovery: activate "Change address" with Enter.
    const change = notice.getByRole('button', { name: 'Change address' });
    await change.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Device address'), 'the address form is back').toBeVisible();

    await axeInitial(page, 'after keyboard recovery');
  });

  test('a simulated denied-permission failure also takes focus on its own alert', async ({ page }) => {
    await simulateLocalNetworkPermission(page, 'denied'); // a SIMULATION of the browser prompt
    await seedWorkspace(page);
    await page.goto('/');
    await openLocalForm(page);
    await page.getByLabel('Device address').fill('127.0.0.1:9');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    const notice = page.locator('[data-notice=permission-blocked]');
    await expect(notice).toBeVisible();
    await expect(notice).toBeFocused();
    expect(await notice.getAttribute('role')).toBe('alert');
  });

  test('initial workspace axe (WCAG 2.2 AA) stays clean', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Canvases' }).waitFor();
    await axeInitial(page, 'initial workspace');
  });
});
