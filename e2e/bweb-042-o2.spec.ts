// BWEB-042 open item O2 — WCAG 2.4.6 / 2.4.9 (link and button purpose), 2.5.3 (label in name).
// The add-device / device-list pane used to show several controls with the SAME accessible name: "Connect" once per
// device row, "Try again" in a failure notice and in a row, "Cancel" for pairing and for the pane, "Add a device" for
// the sidebar icon and the pane button, and "Sign out" in the account menu and in the pane. Each now keeps its visible
// label inside a longer, unique accessible name.
//
// This spec drives the real Chromium build through a mocked Plotune sign-in (the same PKCE callback + stubbed cloud
// endpoints the audit harness used), proves the accessible names are unique and label-in-name holds in the browser,
// and runs an EXPLICIT axe WCAG 2.2 AA scan of the two screens involved: the device list / account pane and the
// failure notice. Reporting violations / passes / incomplete for each.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { explorer, seedWorkspace, serveBuildAt } from './helpers';

const HOSTED = 'https://bridge.plotune.net'; // sign-in only completes on the hosted origin
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const CODE = 'c'.repeat(43); // matches /^code=[A-Za-z0-9_-]{43}$/
const STATE = 's'.repeat(22); // matches /^state=[A-Za-z0-9_-]{22}$/
const VERIFIER = 'v'.repeat(43);
const PAIRED = new Date(Date.now() - 3_600_000).toISOString();

/** Stubs every cloud endpoint the page calls. Everything is local; nothing reaches plotune.net. */
async function stubCloud(page: Page): Promise<void> {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'content-type': 'application/json',
  };
  await page.route(/https:\/\/(api|stream|www)\.plotune\.net\/.*/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = route.request().url();
    let body: unknown = {};
    if (url.includes('/auth/bridge-token')) body = { access_token: 'account-token', expires_in: 28800, username: 'kantr' };
    else if (url.endsWith('/v1/projects')) body = { items: [{ id: 'proj-1', name: 'Lab', role: 'Owner' }] };
    else if (url.endsWith('/devices/pairing-token')) body = { token: 'plt_pair_first', expires_at: Math.floor(Date.now() / 1000) + 120, expires_in: 120 };
    else if (url.includes('/remote-ticket')) body = { ticket: 'ticket', expires_at: 0 };
    else if (url.includes('/ice-servers')) body = { iceServers: [], expires_at: 0 };
    else if (url.endsWith('/devices')) body = { devices: [
      { device_uuid: 'dev-1', device_id: 'Bridge-A', device_type: 'bridge', paired_at: PAIRED },
      { device_uuid: 'dev-2', device_id: 'Bridge-B', device_type: 'bridge', paired_at: PAIRED },
    ] };
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(body) });
  });
  // A remote connect whose relay closes at once fails with a retry-kind notice ("cloud unreachable"), which marks the
  // row not reachable -> the "Try again" (notice + row) duplicate screen. Deterministic, no network.
  await page.routeWebSocket(/wss:\/\/stream\.plotune\.net\/.*/, (ws) => { void ws.close({ code: 1000 }); });
}

/** Boots a signed-in page with the two-device project already loaded. */
async function signedIn(page: Page): Promise<void> {
  await page.addInitScript((pending) => {
    try { sessionStorage.setItem('bw.sso.pending', pending); } catch { /* storage blocked */ }
  }, JSON.stringify({ verifier: VERIFIER, state: STATE }));
  await seedWorkspace(page);
  await serveBuildAt(page, HOSTED);
  await stubCloud(page);
  // The fragment is what plotune.net would return the browser with, after the authorize redirect.
  await page.goto(`${HOSTED}/#code=${CODE}&state=${STATE}`);
  await expect(page.getByRole('button', { name: 'kantr' })).toBeVisible({ timeout: 15_000 });
}

/** Opens the add-device pane and waits for the cloud device list. */
async function deviceList(page: Page): Promise<void> {
  const side = await explorer(page);
  await side.getByRole('button', { name: 'Add a device' }).click();
  await expect(page.getByRole('heading', { name: 'Connect a Bridge device' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Bridge-A', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Bridge-B', exact: true })).toBeVisible();
}

/** Explicit axe WCAG 2.2 AA scan; reports violations / passes / incomplete and fails on any violation. */
async function axeScan(page: Page, label: string): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations = axe.violations.map((v) => v.id);
  const incomplete = axe.incomplete.map((i) => i.id);
  console.log(`axe (${label}, WCAG 2.2 AA): ${axe.violations.length} violations, ${axe.passes.length} passes, ${axe.incomplete.length} incomplete${incomplete.length ? ` [${incomplete.join(', ')}]` : ''}`);
  expect(violations, `${label}: axe violations`).toEqual([]);
}

interface Named { name: string; text: string }

/**
 * Browser-level equivalent of the focused unit test: for controls that show `label` (or are named exactly `label`,
 * e.g. the icon-only sidebar "Add a device"), assert they co-exist, that their accessible names are unique, and that
 * label-in-name holds (the accessible name contains the visible text). The effective name of these buttons is their
 * aria-label, or their text content when there is none. FAILS against the old markup, where each group shared one name.
 */
async function assertUniqueNames(page: Page, label: string): Promise<void> {
  const group: Named[] = await page.evaluate((visible) => {
    const norm = (v: string | null) => (v ?? '').replace(/\s+/g, ' ').trim();
    const out: { name: string; text: string }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, [role="menuitem"]'))) {
      if (el.closest('[hidden]') || el.getAttribute('aria-hidden') === 'true') continue;
      const text = norm(el.textContent);
      const name = norm(el.getAttribute('aria-label') ?? el.textContent);
      if (text === visible || name === visible) out.push({ name, text });
    }
    return out;
  }, label);
  expect(group.length, `expected two or more "${label}" controls to co-exist on this screen`).toBeGreaterThanOrEqual(2);
  const names = group.map((g) => g.name);
  expect(new Set(names).size, `controls showing "${label}" must have unique accessible names (got ${JSON.stringify(names)})`).toBe(names.length);
  for (const g of group) {
    if (g.text) expect(g.name, `label-in-name must hold for "${label}"`).toContain(g.text);
  }
}

test.describe('BWEB-042 open item O2: unique accessible names (WCAG 2.4.6 / 2.4.9 / 2.5.3)', () => {
  test('device list / account pane: rows name their device, Add a device is distinct; axe WCAG 2.2 AA scan', async ({ page }) => {
    await signedIn(page);
    await deviceList(page);

    // Every device row has its own name; no bare "Connect" is left on this screen.
    await expect(page.getByRole('button', { name: 'Connect Bridge-A', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Bridge-B', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
    // The sidebar "+" keeps the short name; the pane action is distinguished.
    await expect(page.getByRole('button', { name: 'Add a device', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Add a device with a pairing code', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Sign out of your Plotune account', exact: true })).toBeVisible();

    await assertUniqueNames(page, 'Connect');
    await assertUniqueNames(page, 'Add a device');

    await axeScan(page, 'device list / account pane');
  });

  test('account menu and pairing code: Sign out and Cancel are distinguishable', async ({ page }) => {
    await signedIn(page);
    await deviceList(page);

    // Account menu "Sign out" vs the pane "Sign out".
    await page.getByRole('button', { name: 'kantr' }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out of your Plotune account', exact: true })).toBeVisible();
    await assertUniqueNames(page, 'Sign out');
    await page.keyboard.press('Escape'); // close the menu, return focus to its trigger

    // Pairing "Cancel" vs the pane "Cancel".
    await page.getByRole('button', { name: 'Add a device with a pairing code', exact: true }).click();
    const pairing = page.getByRole('group', { name: 'Pairing code' });
    await expect(pairing.getByRole('button', { name: 'Cancel pairing', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible(); // the pane cancel stays short
    await assertUniqueNames(page, 'Cancel');
    await pairing.getByRole('button', { name: 'Cancel pairing', exact: true }).click(); // tidy up
  });

  test('failure notice: notice Try again and row Try again are distinct; axe WCAG 2.2 AA scan', async ({ page }) => {
    await signedIn(page);
    await deviceList(page);
    await page.getByRole('button', { name: 'Connect Bridge-A', exact: true }).click();

    // The relay closes at once -> a retry-kind failure notice above the list, and the row becomes "Try again".
    await expect(page.locator('[data-notice]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible(); // notice action stays short
    await expect(page.getByRole('button', { name: 'Try again: reconnect Bridge-A', exact: true })).toBeVisible(); // row names the device
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(1); // no bare duplicate

    await assertUniqueNames(page, 'Try again');

    await axeScan(page, 'device list / account pane with the failure notice');
  });
});
