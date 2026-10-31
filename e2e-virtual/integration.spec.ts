import { expect, test, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { connected, openLocalAddressForm } from '../e2e/helpers';
import { GeneratorControl } from './generatorControl';

const env = {
  virtual: process.env.BRIDGE_VIRTUAL_URL,
  single: process.env.BRIDGE_SINGLE_CHANNEL_URL,
  overflow: process.env.BRIDGE_OVERFLOW_URL,
  bench: process.env.BRIDGE_BENCH_URL,
  benchControl: process.env.BRIDGE_BENCH_CONTROL_URL,
  benchOrigin: process.env.BRIDGE_BENCH_ORIGIN_URL,
  virtual2: process.env.BRIDGE_VIRTUAL2_URL,
};

async function stopIfCapturing(page: Page): Promise<void> {
  const stop = page.getByRole('button', { name: 'Stop capture' });
  if (await stop.isVisible()) await stop.click();
  await expect(page.getByRole('button', { name: 'Start capture' })).toBeVisible();
}

test.describe('nexus virtual device over WebSocket (2 channels, seeded generator, loopback)', () => {
  test.skip(!env.virtual, 'BRIDGE_VIRTUAL_URL is not set');

  test('captures both channels with monotonic device timestamps, and a sent frame is echoed as Tx and looped back as Rx', async ({ page }) => {
    await connected(page, env.virtual!);
    await stopIfCapturing(page);
    await expect(page.getByTestId('device-chip')).toContainText('virtual-bridge-can-0001');
    await page.getByLabel('CAN1 bit rate').selectOption('500000');
    await page.getByLabel('CAN2 bit rate').selectOption('500000');
    await page.getByRole('button', { name: 'Start capture' }).click();

    const rows = page.locator('[role=row][data-channel]');
    await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(20);
    const sample = await rows.evaluateAll((els) => els.map((e) => ({ channel: Number((e as HTMLElement).dataset.channel), time: Number(e.querySelector('.bw-c-time')!.textContent) })));
    expect(new Set(sample.map((r) => r.channel))).toEqual(new Set([1, 2])); // both channels, labelled as the device labelled them
    for (const channel of [1, 2]) {
      const times = sample.filter((r) => r.channel === channel).map((r) => r.time);
      expect(times.length).toBeGreaterThan(3);
      expect(times).toEqual([...times].sort((a, b) => a - b)); // non-decreasing per channel
    }

    await page.getByLabel('ID (hex)').fill('5A5');
    await page.getByLabel('Data (hex bytes)').fill('DE AD BE EF');
    await page.locator('#panel-transmit').getByRole('combobox').first().selectOption('2');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const mine = page.locator('[role=row][data-channel="2"]').filter({ hasText: '5A5' });
    await expect(mine.filter({ hasText: 'Tx' })).toHaveCount(1);
    await expect(mine.filter({ hasText: 'Rx' })).toHaveCount(1); // the device's loopback mode returns it as received
    await expect(page.getByTestId('stats-table').locator('tr[data-channel="2"] td[data-col="txSent"]')).toHaveText(/^[1-9]/, { timeout: 5000 });
    await stopIfCapturing(page);
  });

  test('a second window takes the device over (real replace-on-connect, close 4001) and the first does not fight back', async ({ page, browser }) => {
    await connected(page, env.virtual!);
    const other = await browser.newContext();
    const second = await other.newPage();
    await connected(second, env.virtual!);
    await expect(page.locator('[data-notice=replaced]')).toContainText('Another window or tool took over this device');
    await page.waitForTimeout(2000);
    await expect(second.getByTestId('device-chip')).toContainText('Connected'); // still the owner
    await page.getByRole('button', { name: 'Reconnect' }).click();
    await expect(page.getByTestId('device-chip')).toContainText('Connected');
    await expect(second.locator('[data-notice=replaced]')).toBeVisible();
    await other.close();
  });
});

test.describe('two real virtual devices in one workspace', () => {
  test.skip(!env.virtual || !env.virtual2, 'BRIDGE_VIRTUAL_URL and BRIDGE_VIRTUAL2_URL are not both set');

  test('both stream into one trace, every row names its device, and a frame sent to one device is echoed only by that device', async ({ page }) => {
    await connected(page, env.virtual!);
    await openLocalAddressForm(page);
    await page.getByLabel('Device address').fill(env.virtual2!);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('device-chip')).toHaveCount(2);
    for (const n of [1, 2]) {
      await page.getByRole('button', { name: `Select Bridge ${n}` }).click();
      await stopIfCapturing(page);
      await page.getByLabel('CAN1 bit rate').selectOption('500000');
      await page.getByLabel('CAN2 bit rate').selectOption('500000');
    }
    await page.getByRole('button', { name: 'Start capture' }).click();
    const rows = page.locator('[role=row][data-channel]');
    await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(10);
    const devices = await rows.evaluateAll((els) => els.map((e) => e.querySelector('.bw-c-dev')?.textContent ?? ''));
    expect(new Set(devices)).toEqual(new Set(['Bridge 1', 'Bridge 2']));

    // The send panel acts on the selected device (Bridge 2 is selected): only its loopback answers.
    await page.getByLabel('ID (hex)').fill('5A5');
    await page.getByLabel('Data (hex bytes)').fill('DE AD BE EF');
    await page.locator('#panel-transmit').getByRole('combobox').first().selectOption('1');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const mine = page.locator('[role=row][data-channel="1"]').filter({ hasText: '5A5' });
    await expect(mine.filter({ hasText: 'Tx' })).toHaveCount(1);
    await expect(mine.filter({ hasText: 'Bridge 2' })).toHaveCount(2);
    await expect(mine.filter({ hasText: 'Bridge 1' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Stop capture' }).click();
  });
});

test.describe('device with a tiny buffer and a fast generator', () => {
  test.skip(!env.overflow, 'BRIDGE_OVERFLOW_URL is not set');

  test('reports the frames the device had to drop, per channel, in the trace header, the markers and the counters', async ({ page }) => {
    await connected(page, env.overflow!);
    await stopIfCapturing(page);
    await page.getByLabel('CAN1 bit rate').selectOption('1000000');
    await page.getByLabel('CAN2 bit rate').selectOption('1000000');
    await page.getByRole('button', { name: 'Start capture' }).click();
    await expect(page.locator('#panel-trace')).toContainText(/[1-9][\d,]* frames dropped/, { timeout: 15_000 });
    const stats = page.getByTestId('stats-table');
    await expect(stats.locator('tr[data-channel="1"] td[data-col="rxDropped"]')).not.toHaveText('0', { timeout: 10_000 });
    await expect(stats.locator('tr[data-channel="2"] td[data-col="rxDropped"]')).not.toHaveText('0');
    await expect(page.getByText('Frames missing')).toBeVisible();
    // Everything received is accounted for: received = delivered + dropped on each channel.
    await stopIfCapturing(page);
    for (const channel of [1, 2]) {
      const cell = (col: string) => stats.locator(`tr[data-channel="${channel}"] td[data-col="${col}"]`).innerText().then((t) => Number(t.replace(/,/g, '')));
      expect(await cell('rxReceived')).toBe((await cell('rxForwarded')) + (await cell('rxDropped')));
    }
  });
});

test.describe('Step 3a bench: synthetic ECU behind the paired Bridge endpoint', () => {
  test.skip(!env.bench || !env.benchControl, 'BRIDGE_BENCH_URL / BRIDGE_BENCH_CONTROL_URL are not set');

  test('periodic traffic, multi-frame ISO-TP, UDS security access and XCP all work against the real responder', async ({ page }) => {
    const control = await GeneratorControl.open(env.benchControl!);
    await control.enableEcu();
    await connected(page, env.bench!);
    await expect(page.getByLabel('CAN1 bit rate')).toHaveValue('1000000');
    await expect(page.getByRole('button', { name: 'Stop capture' })).toBeVisible(); // the bench leaves capture armed; the page shows it

    const periodic = page.locator('[role=row][data-channel="1"]').filter({ hasText: /CAN1\s*180/ });
    await expect.poll(() => periodic.count(), { timeout: 10_000 }).toBeGreaterThan(5);
    const times = await periodic.evaluateAll((els) => els.slice(0, 6).map((e) => Number(e.querySelector('.bw-c-time')!.textContent)));
    expect(times).toEqual([...times].sort((a, b) => a - b));

    await page.getByRole('button', { name: 'Diagnostics' }).click();
    const fill = (name: string, value: string) => page.getByRole('textbox', { name, exact: true }).fill(value);
    await page.getByRole('textbox', { name: /^Request ID \(hex\)/ }).fill('700');
    await page.getByRole('textbox', { name: /^Response ID \(hex\)/ }).fill('708');
    const udsLog = page.getByTestId('log-diagnostic-log');
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(udsLog).toContainText('Session 03 active · P2 50 ms · P2* 5000 ms');
    await page.getByRole('button', { name: 'Tester present' }).click();
    await expect(udsLog).toContainText('Tester present acknowledged');
    await fill('Data identifiers', 'F190 F191 F192 F193'); // a 43-byte answer: first frame, flow control, consecutive frames
    await page.getByRole('button', { name: 'Read data' }).click();
    await expect(udsLog).toContainText('PLOTUNE-SYNTH-001');
    await expect(udsLog).toContainText('BENCH');
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
    await fill('Write data', 'CA FE 01');
    await page.getByRole('button', { name: 'Write memory' }).click();
    await page.getByRole('button', { name: 'Confirm: write 3 bytes' }).click();
    await expect(xcpLog).toContainText('Wrote 3 bytes');
    await fill('Read address', '40');
    await fill('Read length', '3');
    await page.getByRole('button', { name: 'Read memory' }).click();
    await expect(xcpLog).toContainText('00000040: CA FE 01');
    await fill('Read address', 'FE');
    await fill('Read length', '7');
    await page.getByRole('button', { name: 'Read memory' }).click();
    await expect(xcpLog).toContainText('ERR_OUT_OF_RANGE');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).first().click();
    await control.call('enable_ecu', { enabled: false });
    control.close();
  });
});

test.describe('a hosted page must be allowed by the device (real servers)', () => {
  test.skip(!env.bench || !env.benchOrigin, 'BRIDGE_BENCH_URL / BRIDGE_BENCH_ORIGIN_URL are not set');

  const handshake = (url: string, origin: string): Promise<string> =>
    new Promise((resolve) => {
      const ws = new WebSocket(url, { origin });
      ws.once('open', () => (ws.close(), resolve('open')));
      ws.once('unexpected-response', (_req, res) => resolve(`HTTP ${res.statusCode}`));
      ws.once('error', () => undefined);
    });

  test('by default a device refuses the hosted origin with 403; once it lists the origin the handshake succeeds', async () => {
    expect(await handshake(env.bench!, 'https://bridge.plotune.net')).toBe('HTTP 403'); // default allow-list: localhost origins only
    expect(await handshake(env.benchOrigin!, 'https://bridge.plotune.net')).toBe('open'); // started with --ws-origin https://bridge.plotune.net
    expect(await handshake(env.benchOrigin!, 'https://evil.example')).toBe('HTTP 403');
    expect(await handshake(env.bench!, 'http://127.0.0.1:4173')).toBe('open'); // localhost pages are allowed by default
  });
});


test.describe('independent channel and reload against a fresh virtual Bridge', () => {
  test.skip(!env.single, 'BRIDGE_SINGLE_CHANNEL_URL is not set (fresh unconfigured two-channel virtual device)');

  test('CAN1 captures/sends with CAN2 unset; reload reads the still-armed device without reconfiguration', async ({ page }) => {
    await connected(page, env.single!);
    await expect(page.getByLabel('CAN2 bit rate')).toHaveValue('');
    await page.getByLabel('CAN1 bit rate').selectOption('500000');
    await page.getByRole('button', { name: 'Start capture', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop capture' })).toBeVisible();
    await expect(page.getByTestId('channel-2')).toContainText('Idle');
    await expect(page.getByTestId('action-error')).toHaveCount(0);
    await expect.poll(() => page.locator('[role=row][data-channel="1"]').count()).toBeGreaterThan(5);
    await expect(page.locator('[role=row][data-channel="2"]')).toHaveCount(0);
    await page.getByLabel('ID (hex)').fill('5A6');
    await page.getByLabel('Data (hex bytes)').fill('DE AD');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('tx-log')).toContainText('Sent DE AD');
    await page.getByLabel('Send channel').selectOption('2');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await page.getByLabel('Send channel').selectOption('1');
    await page.screenshot({ path: 'docs/screenshots/independent-can1.png' });
    await page.getByRole('button', { name: 'Maximize Channels' }).click();
    await page.screenshot({ path: 'docs/screenshots/independent-channels.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Device', exact: true }).click();
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-page', 'device');
    await expect(page.getByTestId('device-chip')).toContainText('Disconnected');
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(page.getByTestId('device-chip')).toContainText('Connected');
    await page.getByRole('button', { name: 'Capture', exact: true }).click();
    await expect(page.getByLabel('CAN1 bit rate')).toHaveValue('500000');
    await expect(page.getByLabel('CAN2 bit rate')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Stop capture' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop capture' }).click();
  });
});
