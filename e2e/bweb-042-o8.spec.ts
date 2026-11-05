// BWEB-042 rev 1 / O8 — Postel's law: a bare host (or a ws:// / wss:// address with no port) used to silently
// become ws://host (port 80). Direct targets now require an explicit port. This spec proves, in a real Chromium:
//   1. bare host / ws://host / wss://host are rejected with the port hint, open NO socket (so never hit :80/:443),
//      and the address form recovers via "Change address";
//   2. a valid address with an explicit port is accepted and the socket is opened at that port;
//   3. a legacy saved address without a port does not crash the app (clean, usable shell);
//   4. an explicit axe WCAG 2.2 AA scan of the connect screen (clean and validation-error states).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openLocalAddressForm, seedWorkspace } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MISSING_PORT = 'Add the port, for example 192.168.1.50:9101.';

/** Seeds a workspace (permission explained, signed out) and waits for the app to render. */
async function seed(page: Page, overrides: Record<string, unknown> = {}): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const workspace = {
    version: 1, devices: [], activeId: '', traceView: 'all', page: 'capture',
    hidden: { capture: [], diagnostics: [], device: [] }, diagnostics: {},
    permissionExplained: true, ...overrides,
  };
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('bw.workspace', value);
      sessionStorage.setItem('bw.sso.signedOut', '1'); // no silent sign-in on the local preview origin
    } catch { /* storage blocked */ }
  }, JSON.stringify(workspace));
  await seedWorkspace(page); // project canvases
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Canvases' }).waitFor();
}

/** Records every WebSocket the page tries to open, so a wrong-port connection cannot hide from the test. */
async function recordSockets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __wsUrls: string[]; WebSocket: typeof WebSocket };
    w.__wsUrls = [];
    const Native = w.WebSocket;
    w.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        w.__wsUrls.push(String(url));
        super(url, protocols);
      }
    } as typeof WebSocket;
  });
}
const sockets = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __wsUrls: string[] }).__wsUrls);

/** Reaches the local-network address form (handles the first-visit explainer if it appears). */
async function toConnectForm(page: Page): Promise<void> {
  await openLocalAddressForm(page);
  const explainer = page.getByTestId('permission-explainer');
  if (await explainer.isVisible()) await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Device address')).toBeVisible();
}

/** Explicit axe WCAG 2.2 AA scan; reports violations / passes / incomplete and fails on any violation. */
async function axeConnect(page: Page, label: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations = axe.violations.map((v) => v.id);
  const incomplete = axe.incomplete.map((i) => i.id);
  console.log(`axe (${label}, WCAG 2.2 AA): ${axe.violations.length} violations, ${axe.passes.length} passes, ${axe.incomplete.length} incomplete${incomplete.length ? ` [${incomplete.join(', ')}]` : ''}`);
  expect(violations, `${label}: axe violations`).toEqual([]);
}

test.describe('BWEB-042 rev 1 / O8: direct targets require an explicit port', () => {
  test('bare host / ws://host / wss://host show the port hint, open nothing, and the form recovers', async ({ page }) => {
    await recordSockets(page);
    await seed(page);
    await toConnectForm(page);

    for (const address of ['192.168.1.50', 'ws://192.168.1.50', 'wss://192.168.1.50']) {
      await page.getByLabel('Device address').fill(address);
      await page.getByRole('button', { name: 'Connect' }).click();
      const notice = page.locator('[data-notice=blocked-by-browser]');
      await expect(notice).toContainText(MISSING_PORT);
      await expect(notice).toContainText('Check the device address'); // a validation error, not a browser refusal
      // The whole point of O8: no connection is attempted, so nothing ever reaches port 80 / 443.
      expect(await sockets(page)).toEqual([]);
      // The form recovers: the same address is still in the field, ready to have its port added.
      await page.getByRole('button', { name: 'Change address' }).click();
      await expect(page.getByLabel('Device address')).toHaveValue(address);
    }
  });

  test('a valid address with an explicit port is accepted and the socket targets that port', async ({ page }) => {
    await recordSockets(page);
    await seed(page);
    await toConnectForm(page);

    await page.getByLabel('Device address').fill('127.0.0.1:9'); // loopback, port 9 -> connection fails fast
    await page.getByRole('button', { name: 'Connect' }).click();
    // No port-validation error, and a real socket is opened at the explicit port (never :80).
    await expect(page.locator('[data-notice=blocked-by-browser]')).toHaveCount(0);
    await expect.poll(() => sockets(page).then((u) => u.length)).toBeGreaterThan(0);
    const urls = await sockets(page);
    expect(urls[0]).toContain(':9');
    expect(urls[0]).not.toContain(':80');
  });

  test('a legacy saved address without a port does not crash the app', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await seed(page, {
      devices: [{ id: 'd1', label: 'Bridge 1', target: '192.168.1.50', captureChannels: [1, 2], transmitChannel: 1 }],
      activeId: 'd1',
    });
    // The app renders a clean, usable shell: the port-less device is dropped by the persistence allowlist,
    // not thrown at. No uncaught error.
    await expect(page.getByRole('navigation', { name: 'Canvases' })).toBeVisible();
    await expect(page.getByTestId('device-chip')).toHaveCount(0);
    expect(errors).toEqual([]);
    // Re-entering the saved address shows the validation error (consistent message, form recovers).
    await toConnectForm(page);
    await page.getByLabel('Device address').fill('192.168.1.50');
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.locator('[data-notice=blocked-by-browser]')).toContainText(MISSING_PORT);
  });

  test('explicit axe WCAG 2.2 AA scan of the connect screen (empty and validation-error states)', async ({ page }) => {
    await seed(page);
    await toConnectForm(page);
    await axeConnect(page, 'connect screen, empty form');

    await page.getByLabel('Device address').fill('192.168.1.50');
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.locator('[data-notice=blocked-by-browser]')).toContainText(MISSING_PORT);
    await axeConnect(page, 'connect screen, port validation error');
  });
});
