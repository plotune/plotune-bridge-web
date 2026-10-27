import { createServer } from 'node:net';
import { expect, test } from '@playwright/test';
import { MockEcu } from '../tests/helpers/mockEcu';
import { configureBothChannels, connect, connected, selfSignedCert, serveBuildAt, simulateLocalNetworkPermission, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

const BASE = 2n ** 63n + 12345n; // far above 2^53: any conversion to a double would corrupt the low digits

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

test.describe('capture workflow', () => {
  test('captures both channels, preserves timestamps and direction, and sends frames', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    await connected(page, device.url);
    await expect(page.getByTestId('channel-1')).toContainText('Bus OK');
    await expect(page.getByLabel('CAN1 bit rate')).toHaveValue(''); // unconfigured until set
    await expect(page.getByRole('switch', { name: 'Termination (120 Ω)' }).first()).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('button', { name: 'Start capture' }).click();
    await expect(page.getByTestId('action-error')).toHaveText('Set a bit rate on CAN1 and CAN2 first.');

    await configureBothChannels(page);
    await startCapture(page);
    device.core.injectRx(1, { id: 0x100, data: Uint8Array.of(1, 2), timestampNs: BASE });
    device.core.injectRx(2, { id: 0x18daf110, extended: true, data: Uint8Array.of(0xde, 0xad, 0xbe, 0xef), timestampNs: BASE + 123_456_789n });
    device.core.injectRx(2, { id: 0x7ff, rtr: true, data: new Uint8Array(), timestampNs: BASE + 2_000_000_001n });
    const rows = page.locator('[role=row][data-channel]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(/0\.000000\s*CAN1\s*100\s*Std Data\s*Rx\s*2\s*01 02/);
    await expect(rows.nth(1)).toContainText(/0\.123456\s*CAN2\s*18DAF110\s*Ext Data\s*Rx\s*4\s*DE AD BE EF/);
    await expect(rows.nth(2)).toContainText(/2\.000000\s*CAN2\s*7FF\s*Std Remote\s*Rx/);

    await page.getByLabel('ID (hex)').fill('123');
    await page.getByLabel('Data (hex bytes)').fill('11 22 33 44');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(rows.nth(3)).toContainText(/CAN1\s*123\s*Std Data\s*Tx\s*4\s*11 22 33 44/);
    await expect(page.getByTestId('tx-log')).toContainText('Sent 11 22 33 44');
    await device.close();
  });

  test('checks a frame before sending and explains what is wrong', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    await connected(page, device.url);
    await configureBothChannels(page);
    await page.getByLabel('ID (hex)').fill('800');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Standard IDs go up to 7FF. Choose extended for larger IDs.')).toBeVisible();
    await page.getByLabel('Data (hex bytes)').fill('00 11 22 33 44 55 66 77 88');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('A CAN frame carries at most 8 bytes.')).toBeVisible();
    expect(device.core.requests.filter((r) => r.op === 'transmit')).toHaveLength(0);
    await device.close();
  });

  test('shows dropped frames per channel: a trace marker, the counters, and a warning state', async ({ page }) => {
    const device = await new MockDeviceServer({ queueCapacity: 32 }).ready();
    await connected(page, device.url);
    await configureBothChannels(page);
    await startCapture(page);
    for (let i = 0; i < 200; i += 1) device.core.injectRx(1, { id: 0x10, data: Uint8Array.of(i) }); // one burst, delivered on the next tick
    device.core.injectRx(2, { id: 0x20, data: Uint8Array.of(1) });
    await expect(page.locator('#panel-trace')).toContainText('168 frames dropped'); // visible without scrolling
    await page.locator('#panel-trace').getByLabel('Follow').uncheck();
    await page.getByTestId('trace-scroll').evaluate((el) => (el.scrollTop = 0));
    const marker = page.locator('[data-marker=drop]');
    await expect(marker).toContainText('CAN1: the device dropped 168 frames (its buffer was full)');
    const stats = page.getByTestId('stats-table');
    await expect(stats.locator('tr[data-channel="1"] td[data-col="rxDropped"]')).toHaveText('168', { timeout: 5000 });
    await expect(stats.locator('tr[data-channel="1"] td[data-col="rxOverflow"]')).toHaveText('168');
    await expect(stats.locator('tr[data-channel="2"] td[data-col="rxDropped"]')).toHaveText('0');
    await expect(page.getByText('Frames missing')).toBeVisible();
    await device.close();
  });

  test('keeps working through a lost link: the device keeps its settings and delivers what it captured meanwhile', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    await connected(page, device.url);
    await configureBothChannels(page);
    await startCapture(page);
    device.drop(1006);
    await expect(page.locator('[data-notice=lost]')).toBeVisible();
    await expect(page.getByTestId('device-chip')).toContainText('Disconnected');
    device.core.injectRx(1, { id: 0x42, data: Uint8Array.of(9), timestampNs: BASE + 5n }); // captured while nobody is attached
    await page.getByRole('button', { name: 'Reconnect' }).click();
    await expect(page.getByTestId('device-chip')).toContainText('Connected');
    await expect(page.locator('[data-marker=session]').last()).toContainText('Reconnected');
    await expect(page.locator('[role=row][data-channel]').filter({ hasText: '42' })).toHaveCount(1);
    await expect(page.getByLabel('CAN1 bit rate')).toHaveValue('500000'); // configuration survived on the device
    await device.close();
  });
});

test.describe('connection problems are explained, never silent', () => {
  test('a device that is not there: causes are listed, the origin to allow is named, and retry works', async ({ page }) => {
    const port = await freePort();
    await connect(page, `127.0.0.1:${port}`);
    const notice = page.locator('[data-notice=unreachable]');
    await expect(notice).toContainText("Couldn't connect to the device");
    await expect(notice).toContainText('http://127.0.0.1:4173'); // what the device must allow
    await expect(notice).toContainText('If you chose Block'); // the permission cause is offered
    const device = await new MockDeviceServer({ port }).ready();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('device-chip')).toContainText('Connected');
    await device.close();
  });

  test('simulated: a blocked local-network permission is named as the cause, and retry works once it is allowed', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    await simulateLocalNetworkPermission(page, 'denied');
    await connect(page, device.url);
    const notice = page.locator('[data-notice=permission-blocked]');
    await expect(notice).toContainText('Your browser is blocking access to your local network');
    await expect(notice).toContainText('Open the site settings');
    await page.evaluate(() => ((window as unknown as { __lna: { state: string } }).__lna.state = 'granted')); // the user allows it
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('device-chip')).toContainText('Connected');
    expect(await page.evaluate(() => (window as unknown as { __lna: { attempts: number } }).__lna.attempts)).toBe(2);
    await device.close();
  });

  test('simulated: a pending permission prompt is reminded about after a moment', async ({ page }) => {
    await page.addInitScript(() => {
      // A connection that never completes, like a browser waiting for the user to answer its prompt.
      window.WebSocket = class {
        static OPEN = 1;
        readyState = 0;
        close() {}
        send() {}
      } as unknown as typeof WebSocket;
    });
    await connect(page, '192.168.1.50:9101');
    await expect(page.getByTestId('connecting')).toContainText('Connecting to ws://192.168.1.50:9101');
    await expect(page.getByTestId('prompt-reminder')).toContainText('choose Allow', { timeout: 5000 });
  });

  test('a replaced session explains the takeover and does not reconnect by itself', async ({ page, browser }) => {
    const device = await new MockDeviceServer().ready();
    await connected(page, device.url);
    const other = await browser.newContext();
    const second = await other.newPage();
    await connected(second, device.url);
    const notice = page.locator('[data-notice=replaced]');
    await expect(notice).toContainText('Another window or tool took over this device');
    await page.waitForTimeout(2500);
    expect(device.connections).toBe(2); // the first page did not fight for the device
    await page.getByRole('button', { name: 'Reconnect' }).click();
    await expect(page.getByTestId('device-chip')).toContainText('Connected');
    await expect(second.locator('[data-notice=replaced]')).toBeVisible(); // and now the other one is the one replaced
    await other.close();
    await device.close();
  });

  test('a device that closes because this page could not keep up (1013) says so in plain words', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    await connected(page, device.url);
    device.drop(1013, 'send queue overflow');
    const notice = page.locator('[data-notice=overflow]');
    await expect(notice).toContainText('could not keep up');
    const plain = await notice.locator('.bw-notice-body > strong, .bw-notice-body > p, .bw-notice-body > ul').allInnerTexts();
    expect(plain.join(' ')).not.toContain('1013'); // the code is only in the technical details
    await expect(notice.locator('details code')).toContainText('close code: 1013');
    await device.close();
  });

  test.describe('other close codes in plain language', () => {
    for (const [code, kind, text] of [
      [1001, 'device-closed', 'ended the connection'],
      [1003, 'rejected-message', 'rejected something'],
      [1009, 'rejected-message', 'too large'],
    ] as const) {
      test(`close code ${code}`, async ({ page }) => {
        const device = await new MockDeviceServer().ready();
        await connected(page, device.url);
        device.drop(code, 'test');
        await expect(page.locator(`[data-notice=${kind}]`)).toContainText(text);
        await device.close();
      });
    }
  });

  test('works over wss:// when the device offers it (self-signed certificate accepted by the test browser only)', async ({ browser }) => {
    const device = await new MockDeviceServer({ tls: selfSignedCert() }).ready();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    expect(device.url.startsWith('wss://')).toBe(true);
    await connected(page, device.url);
    await expect(page.getByTestId('device-chip')).toContainText('mock-bridge-can-0001');
    await context.close();
    await device.close();
  });
});

test.describe('browsers that cannot open a direct connection', () => {
  const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0';
  test('shows an honest notice up front and never attempts the blocked connection', async ({ browser }) => {
    const context = await browser.newContext({ userAgent: FIREFOX });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __constructed: number; WebSocket: typeof WebSocket };
      w.__constructed = 0;
      const Native = w.WebSocket;
      w.WebSocket = class extends Native {
        constructor(url: string | URL, p?: string | string[]) {
          w.__constructed += 1;
          super(url, p);
        }
      } as typeof WebSocket;
    });
    await serveBuildAt(page, 'https://bridge.plotune.net'); // a secure origin, like the hosted page
    await page.goto('https://bridge.plotune.net/');
    const banner = page.getByTestId('unsupported-browser');
    await expect(banner).toContainText('not supported for direct device connection yet');
    await expect(banner).toContainText('Chrome, Edge or Brave');
    await page.screenshot({ path: 'test-results/unsupported-browser.png' });

    await page.getByLabel('Device address').fill('192.168.1.50:9101');
    await page.getByRole('button', { name: 'Connect' }).click();
    const notice = page.locator('[data-notice=blocked-by-browser]');
    await expect(notice).toContainText('This address cannot be opened from this browser');
    await expect(notice).toContainText('Firefox blocks plain ws:// connections from secure pages');
    expect(await page.evaluate(() => (window as unknown as { __constructed: number }).__constructed)).toBe(0);

    // wss:// is not pre-judged: the attempt is made (and here fails only because nothing is listening).
    await page.getByRole('button', { name: 'Change address' }).click();
    await page.getByLabel('Device address').fill('wss://127.0.0.1:9');
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.locator('[data-notice=unreachable]')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __constructed: number }).__constructed)).toBe(1);
    await context.close();
  });
});

test.describe('panels', () => {
  test('a panel can be maximized, restored with Escape, hidden, and stays hidden after a reload', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    await connected(page, device.url);
    const trace = page.locator('#panel-trace');
    const before = await trace.boundingBox();
    await page.getByRole('button', { name: 'Maximize Trace' }).click();
    await expect(trace).toHaveClass(/is-maximized/);
    const maximized = await trace.boundingBox();
    expect(maximized!.height).toBeGreaterThan(before!.height);
    await page.keyboard.press('Escape');
    await expect(trace).not.toHaveClass(/is-maximized/);

    await page.getByText('Panels', { exact: true }).click();
    await page.getByRole('group', { name: 'Show panels' }).getByLabel('Statistics').uncheck();
    await expect(page.locator('#panel-stats')).toHaveCount(0);
    await page.reload();
    await connected(page, device.url);
    await expect(page.locator('#panel-stats')).toHaveCount(0);
    await device.close();
  });

  test('a panel can go full screen', async ({ page }) => {
    const device = await new MockDeviceServer().ready();
    await connected(page, device.url);
    await page.getByRole('button', { name: 'Show Trace full screen' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('panel-trace');
    await page.keyboard.press('Escape');
    await device.close();
  });
});

test.describe('diagnostics against a synthetic ECU', () => {
  test('ISO-TP, UDS and XCP work end to end through the device', async ({ page }) => {
    const ecu = new MockEcu();
    const device = await new MockDeviceServer({ ecu }).ready();
    await connected(page, device.url);
    await configureBothChannels(page);
    await page.getByRole('button', { name: 'Diagnostics' }).click();
    await expect(page.getByTestId('needs-capture').first()).toContainText('Start capture on CAN1');
    await page.getByTestId('needs-capture').first().getByRole('button', { name: 'Start capture' }).click();
    await expect(page.getByTestId('needs-capture')).toHaveCount(0);

    const fill = (name: string, value: string) => page.getByRole('textbox', { name, exact: true }).fill(value);
    await page.getByRole('textbox', { name: /^Request ID \(hex\)/ }).fill('700');
    await page.getByRole('textbox', { name: /^Response ID \(hex\)/ }).fill('708');

    const udsLog = page.getByTestId('log-diagnostic-log');
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(udsLog).toContainText('Session 03 active · P2 50 ms · P2* 5000 ms');
    await fill('Data identifiers', 'F190 F191 F192 F193'); // a 42-byte answer: multi-frame ISO-TP with flow control
    await page.getByRole('button', { name: 'Read data' }).click();
    await expect(udsLog).toContainText('PLOTUNE-SYNTH-001'); // hex plus a text view, since the answer holds several identifiers
    await fill('Raw request', '22 DE AD');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(udsLog).toContainText('Refused: requestOutOfRange (0x31) for ReadDataByIdentifier');
    await page.getByRole('button', { name: 'Request seed' }).click();
    await expect(udsLog).toContainText('Seed: 12 34');
    await fill('Security access key', '0000');
    await page.getByRole('button', { name: 'Send key' }).click();
    await expect(udsLog).toContainText('Refused: invalidKey (0x35) for SecurityAccess');
    await page.getByRole('button', { name: 'Request seed' }).click();
    await fill('Security access key', 'B7 91');
    await page.getByRole('button', { name: 'Send key' }).click();
    await expect(udsLog).toContainText('Key accepted');

    const xcpLog = page.getByTestId('log-calibration-log');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(xcpLog).toContainText('Connected · little-endian · up to 8 bytes per command');
    await fill('Read address', '10');
    await fill('Read length', '20');
    await page.getByRole('button', { name: 'Read memory' }).click();
    await expect(xcpLog).toContainText('00000010: 10 11 12 13 14 15 16 17');
    await fill('Write address', '40');
    await fill('Write data', '01 02 03');
    await page.getByRole('button', { name: 'Write memory' }).click(); // asks to confirm first
    expect(Array.from(ecu.memory.subarray(0x40, 0x43))).toEqual([0x40, 0x41, 0x42]);
    await page.getByRole('button', { name: 'Confirm: write 3 bytes' }).click();
    await expect(xcpLog).toContainText('Wrote 3 bytes');
    expect(Array.from(ecu.memory.subarray(0x40, 0x43))).toEqual([1, 2, 3]);
    await fill('Read address', 'FE');
    await fill('Read length', '7');
    await page.getByRole('button', { name: 'Read memory' }).click();
    await expect(xcpLog).toContainText('ERR_OUT_OF_RANGE');

    // Everything the diagnostics sent and received is in the trace too, with its channel and direction.
    await page.getByRole('button', { name: 'Capture' }).click();
    await expect(page.locator('[role=row][data-direction=tx]').first()).toContainText('CAN1');
    await expect(page.locator('[role=row][data-direction=rx]').filter({ hasText: '708' }).first()).toContainText('Std Data');
    await device.close();
  });
});
