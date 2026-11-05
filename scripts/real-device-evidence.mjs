#!/usr/bin/env node
// BR-WEB-006 rev 2 / BR-WEB-001 rev 2 (local half): real-ESP32 local WebSocket evidence.
//
// Serves the production build on http://127.0.0.1:4173 (a declared permitted device origin),
// launches headless Chromium, grants `localNetworkAccess` through CDP, blocks every optional
// Cloud endpoint after load, then connects to the real Bridge CAN device, discovers its
// capabilities and completes local acquisition/control (set bit rate + start capture).
//
// This is a hardware-gated evidence script, not part of `npm run test:e2e`. It is skipped unless
// BRIDGE_REAL_DEVICE_URL is set (default: ws://192.168.1.10:9100). Run after `npm run build`:
//   PLAYWRIGHT_BROWSERS_PATH=/var/lib/plotune-nexus/tools/playwright \
//   BRIDGE_REAL_DEVICE_URL=ws://192.168.1.10:9100 node scripts/real-device-evidence.mjs
//
// Writes docs/evidence/br-web-006-real-device.{json,md,png} and prints a short summary.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import WebSocket from 'ws';

const ROOT = process.cwd();
const BASE = 'http://127.0.0.1:4173';
const DEVICE = process.env.BRIDGE_REAL_DEVICE_URL ?? 'ws://192.168.1.10:9100';
const OUT = join(ROOT, 'docs', 'evidence');
const CLOUD_HOSTS = ['https://api.plotune.net', 'https://stream.plotune.net', 'https://www.plotune.net', 'https://plotune.net'];

const evidence = {
  requirement_ids: ['BR-WEB-006 rev 2', 'BWEB-002 rev 1', 'BR-WEB-001 rev 2 (local half)'],
  level: 'L3 integration (real device)',
  utc: new Date().toISOString(),
  base_url: BASE,
  device_url: DEVICE,
  cloud_blocked_after_load: CLOUD_HOSTS,
  steps: [],
};
const step = (name, detail) => { evidence.steps.push({ name, detail }); console.log(`  - ${name}: ${detail}`); };

async function httpUp() {
  try {
    const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

async function deviceHello() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DEVICE, { origin: BASE, handshakeTimeout: 8000 });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('hello timed out')); }, 10000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'request', id: 1, op: 'hello', params: { contract_version: '0.1.0', client: 'plotune-bridge-web-evidence' } })));
    ws.on('message', (data) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data.toString())); } catch (e) { reject(e); }
      ws.close();
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function main() {
  if (!process.env.BRIDGE_REAL_DEVICE_URL) {
    console.log('SKIP: set BRIDGE_REAL_DEVICE_URL to run the real-device evidence (hardware-gated).');
    process.exit(0);
  }
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('dist/index.html is missing — run `npm run build` first');
  mkdirSync(OUT, { recursive: true });

  // Capability discovery over a direct local WebSocket, BEFORE the browser connects (the device
  // allows one session at a time and replaces an older connection).
  const hello = await deviceHello();
  evidence.device_hello = hello;
  evidence.device = {
    identity: hello.result?.device_id ?? null,
    firmware: hello.result?.firmware ?? null,
    contract_version: hello.result?.contract_version ?? null,
    can_fd: hello.result?.can_fd ?? null,
    supported_bitrates: hello.result?.supported_bitrates ?? [],
    channels: hello.result?.channels ?? [],
  };
  step('hello over ws://', `device_id=${evidence.device.identity}, contract=${evidence.device.contract_version}, can_fd=${evidence.device.can_fd}, bitrates=${JSON.stringify(evidence.device.supported_bitrates)}`);

  // Serve dist on 4173. Reuse an existing preview if one is already running.
  let server = null;
  if (!(await httpUp())) {
    server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' });
    for (let i = 0; i < 60 && !(await httpUp()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await httpUp())) throw new Error('preview server did not come up on 4173');
  }
  step('serve dist', `${BASE}/ (production build, relative asset base)`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  evidence.browser = browser.version();
  step('headless Chromium', browser.version());

  // Grant the browser's local-network permission (the native prompt cannot be answered by automation).
  const cdp = await browser.newBrowserCDPSession();
  let grant = 'granted';
  try {
    await cdp.send('Browser.grantPermissions', { origin: BASE, permissions: ['localNetworkAccess'] });
  } catch (e) { grant = `unsupported: ${e.message}`; }
  evidence.local_network_access = grant;
  step('CDP Browser.grantPermissions(localNetworkAccess)', grant);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  // A page signed out in this tab: no silent Cloud sign-in round trip.
  await page.addInitScript(() => { try { sessionStorage.setItem('bw.sso.signedOut', '1'); } catch { /* blocked */ } });
  await page.goto(`${BASE}/`);
  await page.getByRole('navigation', { name: 'Canvases' }).waitFor();

  // Cloud is blocked AFTER load: the already loaded local workspace must keep working.
  for (const base of CLOUD_HOSTS) await page.route(`${base}/**`, (route) => route.abort());
  step('Cloud blocked after load', CLOUD_HOSTS.join(', '));

  // Connect to the real device through the local-network address form.
  await page.getByTestId('empty-canvas').getByRole('button', { name: 'Trace', exact: true }).click().catch(() => {});
  const side = page.getByRole('complementary', { name: 'Explorer' });
  if (!(await side.isVisible())) await page.getByRole('button', { name: 'Explorer', exact: true }).first().click();
  await side.getByRole('button', { name: 'Add a device' }).click();
  await page.getByRole('button', { name: 'Advanced: connect on the local network instead' }).click();
  const explainer = page.getByTestId('permission-explainer');
  if (await explainer.isVisible()) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Device address').fill(DEVICE.replace(/^ws:\/\//, ''));
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByTestId('device-chip').filter({ hasText: 'Connected' }).first().waitFor({ timeout: 20000 });
  step('local connect', 'device-chip reports Connected');

  // Local acquisition/control: set a bit rate, then start capture (no Cloud involved).
  await side.getByRole('button', { name: /^Settings for / }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('CAN1 bit rate').selectOption('500000');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Start capture' }).click();
  await page.getByRole('button', { name: 'Stop capture' }).waitFor({ timeout: 15000 });
  step('local acquisition/control', 'CAN1 bit rate = 500000; Start capture -> Stop capture visible');

  // The loaded local workspace is still usable and persisted with Cloud blocked.
  const stored = await page.evaluate(() => ({ workspace: localStorage.getItem('bw.workspace'), projects: localStorage.getItem('bw.projects') }));
  evidence.local_state = { workspace_present: !!stored.workspace, projects_present: !!stored.projects, workspace: stored.workspace };
  step('local workspace persisted with Cloud blocked', `bw.workspace=${!!stored.workspace}, bw.projects=${!!stored.projects}`);

  const shot = join(OUT, 'br-web-006-real-device.png');
  await page.screenshot({ path: shot, fullPage: false });
  evidence.screenshot = 'docs/evidence/br-web-006-real-device.png';
  evidence.console_errors = consoleErrors;
  evidence.verdict = consoleErrors.length === 0 ? 'PASS' : 'PASS with console errors (see console_errors)';
  step('verdict', evidence.verdict);

  writeFileSync(join(OUT, 'br-web-006-real-device.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const lines = [
    '# BR-WEB-006 rev 2 — real-device local WebSocket evidence', '',
    `- **Requirement IDs:** ${evidence.requirement_ids.join(', ')}`,
    `- **Level:** ${evidence.level}`,
    `- **UTC:** ${evidence.utc}`,
    `- **Verdict:** ${evidence.verdict}`,
    `- **Page (declared permitted origin):** ${evidence.base_url}`,
    `- **Real device:** ${evidence.device_url}`,
    `- **Identity:** \`${evidence.device.identity}\` · firmware \`${evidence.device.firmware}\` · contract \`${evidence.device.contract_version}\` · can_fd=\`${evidence.device.can_fd}\``,
    `- **Capabilities:** supported bit rates ${JSON.stringify(evidence.device.supported_bitrates)}; channels ${JSON.stringify(evidence.device.channels.map((c) => ({ channel: c.channel, name: c.name, bitrate: c.bitrate, streaming: c.streaming })))}`,
    `- **Chromium:** ${evidence.browser}`,
    `- **CDP Browser.grantPermissions(localNetworkAccess):** ${evidence.local_network_access}`,
    `- **Cloud blocked after load:** ${evidence.cloud_blocked_after_load.join(', ')}`,
    `- **Screenshot:** ${evidence.screenshot}`, '',
    '## Steps', '', ...evidence.steps.map((s) => `- **${s.name}** — ${s.detail}`), '',
    '## Raw hello', '', '```json', JSON.stringify(evidence.device_hello, null, 2), '```', '',
    '## Limitations', '',
    '- No CAN bus is attached to the device; capture is armed but no bus traffic is generated.',
    '- A plain `ws://` non-loopback endpoint is refused by the hosted HTTPS origin as mixed content, so this evidence uses the declared local preview origin `http://127.0.0.1:4173`.',
    '- Remote WebRTC / Cloud connection (BR-WEB-001 remote half, BWEB-001/003) is not verified here.',
    '- The native local-network permission prompt cannot be shown in automation; `localNetworkAccess` is granted through CDP.',
    '',
  ];
  writeFileSync(join(OUT, 'br-web-006-real-device.md'), lines.join('\n'));
  console.log(`\nEvidence written to ${OUT}`);

  await context.close();
  await browser.close();
  if (server) server.kill('SIGTERM');
}

main().then(() => process.exit(0)).catch((error) => {
  evidence.verdict = 'FAIL';
  evidence.error = String(error);
  try { writeFileSync(join(OUT, 'br-web-006-real-device.json'), `${JSON.stringify(evidence, null, 2)}\n`); } catch { /* ignore */ }
  console.error('FAILED:', error);
  process.exit(1);
});
