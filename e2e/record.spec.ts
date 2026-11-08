import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { configureBothChannels, connected, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

/** Saves through the loss gate. `expectedLoss` must name every field the dialog should show; empty asserts no dialog. */
async function saveFile(page: Page, outPath: string, expectedLoss: string[] = []): Promise<Download> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Stop and save' }).click();
  const loss = page.getByRole('dialog', { name: 'Export with loss?' });
  if (expectedLoss.length === 0) {
    await page.waitForTimeout(100); // let a wrong prompt render before asserting it is absent
    await expect(loss).toHaveCount(0);
  } else {
    await expect(loss).toBeVisible();
    for (const field of expectedLoss) await expect(loss).toContainText(field);
    await loss.getByRole('button', { name: /Export anyway/ }).click();
  }
  const download = await downloadPromise;
  await download.saveAs(outPath);
  return download;
}

async function saveRecording(page: Page, outPath: string, expectedLoss: string[] = []): Promise<string> {
  await saveFile(page, outPath, expectedLoss);
  return readFile(outPath, 'utf8');
}

test('record to ASC: status while recording, a downloaded file with every frame in order, and a summary', async ({ page }, info) => {
  const device = await new MockDeviceServer().ready();
  device.generate(1, 100, 0x7e8);
  device.generate(2, 100, 0x123);
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const status = page.getByTestId('record-status');
  await expect(status).toContainText(/Recording · [1-9]\d* frames/);
  // The counts tick with every frame, so they must not be a live region that a screen reader announces.
  await expect(status).not.toHaveAttribute('role', 'status');
  // The recording keeps going while the user looks at another page and comes back.
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Capture', exact: true }).first().click();
  await expect(status).toContainText('Recording');
  await page.waitForTimeout(1200);

  const text = await saveRecording(page, info.outputPath('rec.asc'), []);
  const lines = text.split('\n');
  expect(lines[0]).toMatch(/^date \w{3} \w{3} \d+ \d\d:\d\d:\d\d\.\d{3} (am|pm) \d{4}$/);
  expect(lines).toContain('base hex  timestamps absolute');
  const frames = lines.filter((l) => /^\s+\d+\.\d{6} [12]\s+\S+\s+(Rx|Tx)\s+d \d/.test(l));
  expect(frames.length).toBeGreaterThan(200); // two channels at 100 frames/s for a couple of seconds
  expect(frames.some((l) => / 1\s+7E8\s+Rx\s+d 2 [0-9A-F]{2} AA$/.test(l))).toBe(true);
  expect(frames.some((l) => / 2\s+123\s+Rx\s+d 2 [0-9A-F]{2} AA$/.test(l))).toBe(true);
  const times = frames.map((l) => Number(l.trim().split(/\s+/)[0]));
  expect(times[0]).toBe(0);
  // Time never runs backwards within a channel.
  for (const channel of [1, 2]) {
    const own = frames.filter((l) => new RegExp(`^\\s+[\\d.]+ ${channel}\\s`).test(l)).map((l) => Number(l.trim().split(/\s+/)[0]));
    expect(own.every((t, i) => i === 0 || t >= own[i - 1])).toBe(true);
  }
  await expect(status).toContainText(/Saved bridge-\d{8}-\d{6}\.asc · \d+ frames/);
  await expect(status).toHaveAttribute('role', 'status'); // the one-time summary is announced
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
  await device.close();
});

test('candump log and CSV are offered and written', async ({ page }, info) => {
  const device = await new MockDeviceServer().ready();
  device.generate(1, 100, 0x7e8);
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  // The top-bar control shows short codes; select by the stable value, not the visible label (U4).
  const status = page.getByTestId('record-status');
  await page.getByLabel('Recording format').selectOption('candump');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(status).toContainText(/Recording · [1-9]\d* frames/);
  await page.waitForTimeout(600);

  // candump cannot carry Rx/Tx. Default export refuses; Cancel keeps recording.
  await page.getByRole('button', { name: 'Stop and save' }).click();
  const loss = page.getByRole('dialog', { name: 'Export with loss?' });
  await expect(loss).toBeVisible();
  await expect(loss).toContainText('cannot preserve: direction (Rx/Tx)');
  await expect(loss).not.toContainText('RTR requested length (DLC)');
  await loss.getByRole('button', { name: 'Cancel' }).click();
  await expect(loss).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop and save' })).toBeVisible();

  // Consent is for the fields shown. If an RTR frame arrives while the dialog is open, the first
  // Export anyway click must re-present the dialog with the new loss instead of exporting it.
  await page.getByRole('button', { name: 'Stop and save' }).click();
  await expect(loss).toBeVisible();
  await expect(loss).toContainText('direction (Rx/Tx)');
  device.core.injectRx(1, { id: 0x100, rtr: true, dlc: 5 });
  await page.waitForTimeout(100);
  await loss.getByRole('button', { name: /Export anyway/ }).click();
  await expect(loss).toBeVisible();
  await expect(loss).toContainText('RTR requested length (DLC)');

  // The second click accepts the updated, field-specific loss and downloads the file.
  const [candumpDownload] = await Promise.all([
    page.waitForEvent('download'),
    loss.getByRole('button', { name: /Export anyway/ }).click(),
  ]);
  await candumpDownload.saveAs(info.outputPath('rec-candump'));
  const candumpText = await readFile(info.outputPath('rec-candump'), 'utf8');
  expect(/^\(\d+\.\d{6}\) can0 7E8#[0-9A-F]{2}AA$/m.test(candumpText)).toBe(true);
  await expect(status).toContainText(/lossy: direction \(Rx\/Tx\)/);
  await expect(status).toContainText('RTR requested length (DLC)');

  // CSV represents every mandatory field, so it does not prompt.
  await page.getByLabel('Recording format').selectOption('csv');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(status).toContainText(/Recording · [1-9]\d* frames/);
  await page.waitForTimeout(600);
  const csv = await saveRecording(page, info.outputPath('rec-csv'), []);
  expect(csv.startsWith('time_s,channel,id_hex,extended,direction,remote,dlc,data_hex\r\n') && /\r\n\d+\.\d{6},1,7E8,0,rx,0,2,[0-9A-F]{2}AA/.test(csv)).toBe(true);
  await device.close();
});

test('a recording is not limited by the 20,000-row trace buffer', async ({ page }, info) => {
  test.setTimeout(120_000);
  const device = await new MockDeviceServer().ready();
  device.generate(1, 900, 0x7e8);
  device.generate(2, 900, 0x123);
  await connected(page, device.url);
  await configureBothChannels(page);
  // Recording starts before capture does, so it must hold every frame the trace ever sees.
  await page.getByLabel('Recording format').selectOption('candump');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await startCapture(page);
  const header = page.getByTestId('trace-count');
  // Wait until the trace has really dropped older rows, so the test means something.
  await expect(header).toContainText('older rows scrolled out', { timeout: 100_000 });
  // Read what the trace has seen BEFORE stopping: the recording then still holds at least all of it.
  const shown = (await header.innerText()).match(/([\d,]+) frames · ([\d,]+) older rows/)!;
  const text = await saveRecording(page, info.outputPath('big.log'), ['direction (Rx/Tx)']);
  const recorded = text.trim().split('\n').length;
  const inTrace = Number(shown[1].replace(/,/g, ''));
  const evicted = Number(shown[2].replace(/,/g, ''));
  console.log(`RECORDED ${recorded} frames; the trace kept ${inTrace} and dropped ${evicted} older rows`);
  expect(recorded).toBeGreaterThan(20_000); // more than the trace can hold
  // Everything the trace had seen (kept + scrolled out) is in the file; the few rows that are not frames (connection notes) are the margin.
  expect(recorded).toBeGreaterThanOrEqual(inTrace + evicted - 5);
  await device.close();
});

test('on a phone the recording controls wrap inside the page width', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const device = await new MockDeviceServer().ready();
  device.generate(1, 50, 0x7e8);
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByTestId('record-status')).toContainText(/Recording · [1-9]\d* frames/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await saveRecording(page, info.outputPath('phone.asc'), []); // ASC: no loss dialog
  await expect(page.getByTestId('record-status')).toContainText('Saved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await device.close();
});

test('BLF: a downloaded binary file with the Vector header and zlib containers', async ({ page }, info) => {
  const device = await new MockDeviceServer().ready();
  device.generate(1, 100, 0x7e8);
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  await page.getByLabel('Recording format').selectOption('blf');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByTestId('record-status')).toContainText(/Recording · [1-9]\d* frames/);
  await page.waitForTimeout(800);
  const path = info.outputPath('rec.blf');
  const download = await saveFile(page, path, []); // BLF: no loss dialog
  expect(download.suggestedFilename()).toMatch(/^bridge-\d{8}-\d{6}\.blf$/);
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('LOGG');
  expect(bytes.readUInt32LE(4)).toBe(144);
  expect(bytes.subarray(144, 148).toString('latin1')).toBe('LOBJ'); // the first container
  expect(Number(bytes.readBigUInt64LE(16))).toBe(bytes.length); // the header's file size is the real size
  expect(bytes.readUInt32LE(32)).toBeGreaterThan(50); // object count
  await expect(page.getByTestId('record-status')).toContainText(/Saved bridge-\d{8}-\d{6}\.blf/);
  await device.close();
});
