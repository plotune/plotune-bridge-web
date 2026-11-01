import { expect, test } from '@playwright/test';
import { configureBothChannels, connected, startCapture } from './helpers';
import { MockDeviceServer } from './mockServer';

test('a filter keeps following live traffic, and only matching frames are shown', async ({ page }) => {
  const device = await new MockDeviceServer().ready();
  await connected(page, device.url);
  await configureBothChannels(page);
  await startCapture(page);
  device.generate(1, 40, 0x7e8);
  device.generate(2, 40, 0x123);
  const count = page.getByTestId('trace-count');
  await page.getByLabel('Filter by ID or data').fill('7e8');
  const shown = () => page.locator('.bw-trace-row[data-channel]').evaluateAll((els) => els.map((e) => e.querySelector('.bw-c-id')?.textContent));
  await expect(count).toContainText('shown');
  const first = Number((await count.innerText()).match(/(\d+) shown/)![1]);
  await expect.poll(async () => Number((await count.innerText()).match(/(\d+) shown/)![1]), { timeout: 5000 }).toBeGreaterThan(first + 10);
  // Every visible row is a 7E8 frame; none of the other id leaks in, and the total keeps growing faster than the shown count.
  const ids = await shown();
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids)).toEqual(new Set(['7E8']));
  const text = await count.innerText();
  const [, total, matched] = text.match(/([\d,]+) frames · ([\d,]+) shown/)!;
  expect(Number(total.replace(/,/g, ''))).toBeGreaterThan(Number(matched.replace(/,/g, '')));
  await device.close();
});
