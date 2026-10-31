import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';

/** The Advanced link on the account pane. The local-network address form is behind it. */
export const LOCAL_ADVANCED = 'Advanced: connect on the local network instead';

/** Opens the local-network address form from the add-device pane (the account pane is the default). */
export async function openLocalAddressForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add a device' }).click();
  await page.getByRole('button', { name: LOCAL_ADVANCED }).click();
}

/** Answers the first-visit explainer and connects. `address` may be a full ws:// or wss:// URL. */
export async function connect(page: Page, address: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  const remembered = page.getByTestId('device-chip').filter({ hasText: address.startsWith('ws') ? address : `ws://${address}` });
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
  await expect(page.getByTestId('device-chip')).toContainText('Connected');
}

export async function configureBothChannels(page: Page, bitrate = '500000'): Promise<void> {
  await page.getByLabel('CAN1 bit rate').selectOption(bitrate);
  await page.getByLabel('CAN2 bit rate').selectOption(bitrate);
  await expect(page.getByLabel('CAN2 bit rate')).toHaveValue(bitrate);
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
