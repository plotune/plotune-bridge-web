// BR-WEB-006 rev 2 (browser/hosting/device-origin requirements) and BWEB-002 rev 1 (local independence).
// L3 integration against the production build, served as the hosted HTTPS origin. A mock device stands in for the
// real Bridge (the real-device WebSocket evidence is gathered separately by scripts/real-device-evidence.mjs).
import { expect, test, type Page } from '@playwright/test';
import { configureBothChannels, explorer, openLocalAddressForm, seedWorkspace, serveBuildAt, simulateLocalNetworkPermission, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

const HOSTED = 'https://bridge.plotune.net';

/** A page signed out in this tab: the hosted origin must not start a silent Cloud sign-in round trip. */
async function bootHosted(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { sessionStorage.setItem('bw.sso.signedOut', '1'); } catch { /* storage blocked */ }
  });
  await seedWorkspace(page);
  await serveBuildAt(page, HOSTED); // the built dist, served as the deployed HTTPS origin
  await page.goto(`${HOSTED}/`);
  await expect(page.getByRole('navigation', { name: 'Canvases' })).toBeVisible();
}

/** Opens the local-network address form (answering the first-visit permission explainer). */
async function localForm(page: Page): Promise<void> {
  await openLocalAddressForm(page);
  const explainer = page.getByTestId('permission-explainer');
  if (await explainer.isVisible()) await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Device address')).toBeVisible();
}

/** Cloud becomes unavailable after load: every optional Cloud endpoint is blocked. */
async function blockCloud(page: Page): Promise<void> {
  for (const base of ['https://api.plotune.net', 'https://stream.plotune.net', 'https://www.plotune.net', 'https://plotune.net']) {
    await page.route(`${base}/**`, (route) => route.abort());
  }
}

test.describe('BR-WEB-006 rev 2: browser, hosting and device-origin requirements', () => {
  test('an unsupported mixed-content/origin combination is explained as a browser rule, never blamed on the device', async ({ page }) => {
    await bootHosted(page);
    await localForm(page);
    // 192.0.2.1 is TEST-NET-1 (RFC 5737): a plain ws:// LAN-style address on the hosted HTTPS page.
    await page.getByLabel('Device address').fill('192.0.2.1:9');
    await page.getByRole('button', { name: 'Connect' }).click();

    const notice = page.locator('[data-notice=mixed-content]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('This secure page cannot open a plain ws:// address');
    await expect(notice).toContainText('not a problem with your device');
    await expect(notice).toContainText('wss://');
    await expect(notice).toContainText('http://127.0.0.1:4173');
    // No false cause and no pointless retry of a combination the browser refuses.
    await expect(notice).not.toContainText("Couldn't connect to the device");
    await expect(notice).not.toContainText('device is powered');
    await expect(notice.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(notice.getByRole('button', { name: 'Change address' })).toBeVisible();
  });

  test('a denied local-network permission gets plain, actionable guidance and does not accuse the device', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    await simulateLocalNetworkPermission(page, 'denied'); // a SIMULATION of the browser prompt
    await bootHosted(page);
    await localForm(page);
    await page.getByLabel('Device address').fill(device.url.replace(/^ws:\/\//, ''));
    await page.getByRole('button', { name: 'Connect' }).click();

    const notice = page.locator('[data-notice=permission-blocked]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Your browser is blocking access to your local network');
    await expect(notice).toContainText('site settings');
    await expect(notice).toContainText('Allow');
    await expect(notice).not.toContainText("Couldn't connect to the device");
    await device.close();
  });

  test('BWEB-002 r1: a loaded local workspace stays usable with Cloud blocked after load, and is not erased', async ({ page }) => {
    await bootHosted(page);
    await blockCloud(page);
    await localForm(page);

    // The declared device-origin requirement is surfaced on the hosted page.
    await expect(page.getByText('The device must allow this page.')).toBeVisible();
    await expect(page.locator('.bw-origin code')).toHaveText(HOSTED);
    await expect(page.getByRole('button', { name: "Copy this page's address" })).toBeVisible();

    // A permitted local device (loopback, with the hosted origin allow-listed) connects without Cloud.
    const device = await new MockDeviceServer({ origins: [HOSTED] }).ready();
    await page.getByLabel('Device address').fill(device.url.replace(/^ws:\/\//, ''));
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect((await explorer(page)).getByTestId('device-chip')).toContainText('Connected');
    expect(device.seenOrigins).toContain(HOSTED); // the Origin header really was the hosted origin

    // Local acquisition/control still completes with Cloud blocked after load.
    await configureBothChannels(page);
    await startCapture(page);
    await expect(page.getByRole('button', { name: 'Stop capture' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop capture' }).click();
    await expect(page.getByRole('button', { name: 'Start capture' })).toBeVisible();

    // Reload with Cloud still blocked: the local workspace (device + canvases) was not erased.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Canvases' })).toBeVisible();
    const stored = await page.evaluate(() => ({ workspace: localStorage.getItem('bw.workspace'), projects: localStorage.getItem('bw.projects') }));
    expect(stored.workspace).toContain('ws://127.0.0.1');
    expect(stored.projects).toBeTruthy();
    await expect((await explorer(page)).getByTestId('device-chip')).toContainText('Bridge 1');
    await device.close();
  });
});
