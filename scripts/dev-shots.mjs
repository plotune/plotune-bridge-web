// Development aid: builds nothing, just drives an already running preview/dev server and saves screenshots
// into .dev-shots/<label>/ so a change can be reviewed by eye. Usage: node scripts/dev-shots.mjs <label> [baseUrl] [addr1,addr2,...]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const label = process.argv[2] ?? 'latest';
const base = process.argv[3] ?? 'http://127.0.0.1:4173';
const addresses = (process.argv[4] ?? 'ws://127.0.0.1:9101,ws://127.0.0.1:9121').split(',');
const out = `.dev-shots/${label}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base);
await page.getByRole('button', { name: 'Add a device' }).click();
await page.locator('[data-testid=permission-explainer], #device-address').waitFor();
if (await page.getByTestId('permission-explainer').isVisible()) await page.getByRole('button', { name: 'Continue' }).click();
await page.getByLabel('Device address').fill(addresses[0]);
await page.getByRole('button', { name: 'Connect', exact: true }).click();
await page.getByTestId('device-chip').first().waitFor();
for (let i = 1; i < addresses.length; i += 1) {
  await page.getByRole('button', { name: 'Add a device' }).click();
  await page.getByLabel('Device address').fill(addresses[i]);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.locator('[data-phase="connected"]').nth(i).waitFor();
}
for (let i = 0; i < addresses.length; i += 1) {
  await page.getByRole('button', { name: `Select Bridge ${i + 1}` }).click();
  for (const ch of [1, 2]) {
    const select = page.getByLabel(`CAN${ch} bit rate`);
    if (await select.isEnabled()) await select.selectOption('500000'); // locked when the device is already capturing
  }
}
const start = page.getByRole('button', { name: 'Start capture' });
if (await start.isVisible()) await start.click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/capture.png` });
await page.getByRole('button', { name: 'Diagnostics' }).click();
await page.screenshot({ path: `${out}/diagnostics.png` });
await page.getByRole('button', { name: 'Device', exact: true }).click();
await page.screenshot({ path: `${out}/device.png` });
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Capture', exact: true }).click();
await page.screenshot({ path: `${out}/capture-phone.png`, fullPage: true });
await browser.close();
console.log(`saved to ${out}`);
