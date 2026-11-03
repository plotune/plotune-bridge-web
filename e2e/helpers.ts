import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { PROJECTS_KEY } from '../src/workspace/project';
import { seededProject } from '../tests/helpers/project';

/**
 * A first visit is one blank canvas. Most tests want panels to be there, so they start from a workspace with three canvases
 * (Capture, Diagnostics, Analysis). It is written before the page loads, and only when the browser has no workspace yet.
 */
export async function seedWorkspace(page: Page): Promise<void> {
  const storage = { data: {} as Record<string, string>, getItem: (k: string) => storage.data[k] ?? null, setItem: (k: string, v: string) => { storage.data[k] = v; }, removeItem: (k: string) => { delete storage.data[k]; } };
  seededProject(storage);
  const json = storage.data[PROJECTS_KEY]!;
  await page.addInitScript(([key, value]) => { try { if (localStorage.getItem(key!) === null) localStorage.setItem(key!, value!); } catch { /* storage blocked */ } }, [PROJECTS_KEY, json]);
}

/** The explorer on the left. On a phone it is closed until asked for, so this opens it. */
export async function explorer(page: Page) {
  await page.getByRole('navigation', { name: 'Canvases' }).waitFor(); // the page has rendered, so "not visible" means closed
  const side = page.getByRole('complementary', { name: 'Explorer' });
  if (!(await side.isVisible())) await page.getByRole('button', { name: 'Explorer', exact: true }).first().click();
  await expect(side).toBeVisible();
  return side;
}

/** On a phone the explorer floats over the canvas; this puts it away again. Wide screens keep it beside the canvas. */
export async function putExplorerAway(page: Page): Promise<void> {
  const side = page.getByRole('complementary', { name: 'Explorer' });
  if ((await side.isVisible()) && (page.viewportSize()?.width ?? 1440) <= 900) await page.getByRole('button', { name: 'Explorer', exact: true }).first().click();
}

/** The settings dialog of a device (the first one when no name is given). Channels, the device and the diagnostic link are here, not on the canvas. */
export async function openDeviceSettings(page: Page, label?: string) {
  const side = await explorer(page);
  await (label ? side.getByRole('button', { name: `Settings for ${label}`, exact: true }) : side.getByRole('button', { name: /^Settings for / }).first()).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function closeDialog(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** The Advanced link on the account pane. The local-network address form is behind it. */
export const LOCAL_ADVANCED = 'Advanced: connect on the local network instead';

/** Opens the local-network address form from the add-device pane (the account pane is the default). */
export async function openLocalAddressForm(page: Page): Promise<void> {
  await (await explorer(page)).getByRole('button', { name: 'Add a device' }).click();
  await page.getByRole('button', { name: LOCAL_ADVANCED }).click();
}

/** Answers the first-visit explainer and connects. `address` may be a full ws:// or wss:// URL. */
export async function connect(page: Page, address: string): Promise<void> {
  await seedWorkspace(page);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Canvases' })).toBeVisible();
  const remembered = (await explorer(page)).getByTestId('device-chip').filter({ hasText: address.startsWith('ws') ? address : `ws://${address}` });
  if (await remembered.count()) {
    await remembered.getByRole('button', { name: /^Select / }).click();
    await page.locator('main').getByRole('button', { name: 'Reconnect', exact: true }).click();
    return;
  }
  await openLocalAddressForm(page);
  await expect(page.locator('[data-testid=permission-explainer], #device-address')).toBeVisible();
  const explainer = page.getByTestId('permission-explainer');
  if (await explainer.isVisible()) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Device address').fill(address);
  await page.getByRole('button', { name: 'Connect' }).click();
}

export async function connected(page: Page, address: string): Promise<void> {
  await connect(page, address);
  await expect((await explorer(page)).getByTestId('device-chip')).toContainText('Connected');
  await putExplorerAway(page);
}

/** On a phone one panel fills the screen; this shows the named one. On a wide screen every panel is already in view. */
export async function showPanel(page: Page, name: string): Promise<void> {
  const switcher = page.getByRole('navigation', { name: 'Panels on this canvas' });
  if (await switcher.isVisible()) await switcher.getByRole('button', { name, exact: true }).click();
}

/** Gives a panel the whole workspace, so rows and plots have room and nothing is below the fold. A phone shows one panel at a time already. */
export async function maximizePanel(page: Page, name: string): Promise<void> {
  const switcher = page.getByRole('navigation', { name: 'Panels on this canvas' });
  if (await switcher.isVisible()) { await switcher.getByRole('button', { name, exact: true }).click(); return; }
  await page.locator('[data-dock-group]').filter({ has: page.getByRole('region', { name, exact: true }) }).getByRole('button', { name: 'Maximize this group' }).click();
}

/** Sets both channels of a device to the same bit rate, in that device's settings. */
export async function configureBothChannels(page: Page, bitrate = '500000', label?: string): Promise<void> {
  const dialog = await openDeviceSettings(page, label);
  await dialog.getByLabel('CAN1 bit rate').selectOption(bitrate);
  await dialog.getByLabel('CAN2 bit rate').selectOption(bitrate);
  await expect(dialog.getByLabel('CAN2 bit rate')).toHaveValue(bitrate);
  await closeDialog(page);
  await putExplorerAway(page);
}

export async function startCapture(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start capture' }).click();
  await expect(page.getByRole('button', { name: 'Stop capture' })).toBeVisible();
}

/** A throwaway self-signed certificate for 127.0.0.1, used only to prove the wss:// code path. Nothing is committed. */
export function selfSignedCert(): { cert: string; key: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-web-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
  return { cert: readFileSync(join(dir, 'c.pem'), 'utf8'), key: readFileSync(join(dir, 'k.pem'), 'utf8') };
}

/**
 * Simulates the browser's local-network permission, which headless automation cannot show or answer.
 * While `window.__lna.state` is 'denied', a connection attempt fails exactly as a blocked one does (no open, close 1006)
 * and the Permissions API reports 'denied'. This is a SIMULATION of the browser's behavior, not the real prompt.
 */
export async function simulateLocalNetworkPermission(page: Page, initial: 'denied' | 'granted' | 'prompt'): Promise<void> {
  await page.addInitScript((state) => {
    const w = window as unknown as { __lna: { state: string; attempts: number }; WebSocket: typeof WebSocket };
    w.__lna = { state, attempts: 0 };
    const Native = w.WebSocket;
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: {
        query: async ({ name }: { name: string }) => {
          if (['local-network', 'local-network-access', 'loopback-network'].includes(name)) return { state: w.__lna.state };
          throw new TypeError('unknown permission');
        },
      },
    });
    w.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        w.__lna.attempts += 1;
        super(w.__lna.state === 'granted' ? url : 'ws://127.0.0.1:9', protocols); // port 9 refuses: the same outcome the page sees when blocked
      }
    } as typeof WebSocket;
  }, initial);
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.png': 'image/png' };

/**
 * Serves the built site to the test browser as if it were hosted at `origin` (a secure origin such as the real hosted
 * address), by intercepting requests. Nothing leaves the machine. This lets tests see what a visitor on the hosted
 * page sees: a secure context, with the page's real origin shown in the instructions for the device.
 */
export async function serveBuildAt(page: Page, origin: string): Promise<void> {
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = join(process.cwd(), 'dist', path === '/' ? 'index.html' : path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ body: readFileSync(file), contentType: MIME[extname(file)] ?? 'application/octet-stream' });
  });
}
