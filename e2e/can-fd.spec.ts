import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { closeDialog, configureBothChannels, connected, openDeviceSettings, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

const FD_DATA = Uint8Array.from({ length: 64 }, (_, i) => i);
const FD_HEX = Array.from(FD_DATA, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const FD_HEX_COMPACT = FD_HEX.replaceAll(' ', '');
const FD_CAPABILITY = 'CAN FD';

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`);
  expect(summary, `${label}: accessibility violations`).toEqual([]);
}

async function saveRecording(page: Page, outPath: string): Promise<void> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Stop and save' }).click()]);
  await download.saveAs(outPath);
}

test('an FD-capable device exposes CAN FD, BRS and ESI controls and says so in Device settings', async ({ page }) => {
  const device = await new MockDeviceServer({ advertiseCanFd: true }).ready();
  await connected(page, device.url);

  const fd = page.getByLabel(FD_CAPABILITY, { exact: true });
  await expect(fd).toBeVisible();
  const brs = page.getByLabel('Bit rate switch (BRS)', { exact: true });
  const esi = page.getByLabel('Error state indicator (ESI)', { exact: true });
  await expect(brs).toBeDisabled();
  await expect(esi).toBeDisabled();

  await fd.check();
  await expect(brs).toBeEnabled();
  await expect(esi).toBeEnabled();
  await expectNoAxeViolations(page, 'FD send controls');

  const dialog = await openDeviceSettings(page);
  await expect(dialog.getByTestId('device-facts')).toContainText(FD_CAPABILITY);
  await closeDialog(page);
  await device.close();
});

test('a Classical-only device exposes no FD controls, says classic CAN, and keeps the 8-byte limit', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  await connected(page, device.url);

  await expect(page.getByLabel(FD_CAPABILITY, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Bit rate switch (BRS)', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Error state indicator (ESI)', { exact: true })).toHaveCount(0);

  const dialog = await openDeviceSettings(page);
  await expect(dialog.getByTestId('device-facts')).toContainText('classic CAN');
  await closeDialog(page);
  await configureBothChannels(page);

  await page.getByLabel('Data (hex bytes)').fill('00 11 22 33 44 55 66 77 88');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('A CAN frame carries at most 8 bytes.')).toBeVisible();
  expect(device.core.requests.filter((r) => r.op === 'transmit')).toHaveLength(0);
  await device.close();
});

test('sends a 64-byte FD frame with BRS; the mock receives it and the trace shows FD/BRS and all bytes', async ({ page }) => {
  const device = await new MockDeviceServer({ advertiseCanFd: true }).ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);

  await page.getByLabel(FD_CAPABILITY, { exact: true }).check();
  await page.getByLabel('Bit rate switch (BRS)', { exact: true }).check();
  await page.getByLabel('ID (hex)').fill('123');
  await page.getByLabel('Data (hex bytes)').fill(FD_HEX);
  await expect(page.locator('#panel-transmit')).toContainText('64 bytes');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const sent = device.core.requests.filter((r) => r.op === 'transmit').at(-1) as { params: { frame: Record<string, unknown> } } | undefined;
  expect(sent).toBeDefined();
  expect(sent!.params.frame).toMatchObject({ channel: 1, id: 0x123, fd: true, brs: true, esi: false, dlc: 15 });
  expect(sent!.params.frame.data).toBe(FD_HEX_COMPACT.toLowerCase());
  expect(String(sent!.params.frame.data).length / 2).toBe(64);

  await expect(page.getByTestId('tx-log')).toContainText('FD CAN1');
  const row = page.locator('[role=row][data-channel="1"][data-fd="1"]').last();
  await expect(row).toHaveAttribute('data-brs', '1');
  await expect(row).toContainText('Std FD');
  await expect(row).toContainText('BRS');
  await expect(row).toContainText('15');
  await expect(row).toContainText(FD_HEX);
  await expect(row).toContainText('Tx');
  await device.close();
});

test('an invalid FD length shows an accessible error and sends nothing', async ({ page }) => {
  const device = await new MockDeviceServer({ advertiseCanFd: true }).ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await page.getByLabel(FD_CAPABILITY, { exact: true }).check();

  await page.getByLabel('Data (hex bytes)').fill('00 01 02 03 04 05 06 07 08');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const message = 'A CAN FD frame carries 0-8, 12, 16, 20, 24, 32, 48 or 64 bytes.';
  await expect(page.getByText(message)).toBeVisible();
  const data = page.getByLabel('Data (hex bytes)');
  await expect(data).toHaveAttribute('aria-invalid', 'true');
  await expect(data).toHaveAttribute('aria-describedby', 'tx-data-error');
  await expect(page.locator('#tx-data-error')).toHaveText(message);
  await expectNoAxeViolations(page, 'FD validation error');
  expect(device.core.requests.filter((r) => r.op === 'transmit')).toHaveLength(0);
  await device.close();
});

test('injected FD receive frames appear with FD/BRS/ESI and the full 64-byte payload', async ({ page }) => {
  const device = await new MockDeviceServer({ advertiseCanFd: true }).ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);

  device.injectFd(1, { id: 0x321, brs: true, esi: true, data: FD_DATA });
  const row = page.locator('[role=row][data-channel="1"][data-fd="1"]').last();
  await expect(row).toHaveAttribute('data-brs', '1');
  await expect(row).toHaveAttribute('data-esi', '1');
  await expect(row).toContainText('Std FD');
  await expect(row).toContainText('BRS');
  await expect(row).toContainText('ESI');
  await expect(row).toContainText('15');
  await expect(row).toContainText(FD_HEX);
  await expect(row).toContainText('Rx');
  await device.close();
});

test('recordings on an FD device carry CAN FD flags and the full 64-byte payload', async ({ page }, info) => {
  test.setTimeout(90_000);
  const device = await new MockDeviceServer({ advertiseCanFd: true }).ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);

  const textFormats = [
    ['asc', (text: string) => text.includes('CANFD 1 Rx') && text.includes('1 0 F 64') && text.includes(FD_HEX)],
    ['candump', (text: string) => text.includes(`can0 123##1${FD_HEX_COMPACT}`)],
    ['csv', (text: string) => text.startsWith('time_s,channel,id_hex,extended,direction,remote,dlc,data_hex,fd,brs,esi\r\n') && text.includes(`1,123,0,rx,0,15,${FD_HEX_COMPACT},1,1,0`)],
  ] as const;

  for (const [format, check] of textFormats) {
    await page.getByLabel('Recording format').selectOption(format);
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    device.injectFd(1, { id: 0x123, brs: true, esi: false, data: FD_DATA });
    await expect(page.getByTestId('record-status')).toContainText(/Recording · [1-9]\d* frames/);
    const path = info.outputPath(`fd.${format}`);
    await saveRecording(page, path);
    const text = await readFile(path, 'utf8');
    expect(check(text), format).toBe(true);
  }

  await page.getByLabel('Recording format').selectOption('blf');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  device.injectFd(1, { id: 0x123, brs: true, esi: false, data: FD_DATA });
  await expect(page.getByTestId('record-status')).toContainText(/Recording · [1-9]\d* frames/);
  const blfPath = info.outputPath('fd.blf');
  await saveRecording(page, blfPath);
  const bytes = await readFile(blfPath);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('LOGG');
  const containerSize = bytes.readUInt32LE(144 + 8);
  const raw = inflateSync(bytes.subarray(144 + 32, 144 + containerSize));
  expect(raw.subarray(0, 4).toString('latin1')).toBe('LOBJ');
  expect(raw.readUInt32LE(8)).toBe(136); // CAN_FD_MESSAGE_64 object
  expect(raw.readUInt32LE(12)).toBe(101); // object type
  expect(raw[34]).toBe(64); // valid payload bytes
  expect([...raw.subarray(72, 72 + 64)]).toEqual([...FD_DATA]);
  expect(raw.readUInt32LE(44)).toBe(0x3000); // FD + BRS flags
  await device.close();
});
