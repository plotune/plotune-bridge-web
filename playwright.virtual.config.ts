import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Integration against the real plotune-nexus virtual device and Step 3a bench generator, over WebSocket.
// Those live in a private repository, so CI cannot run them; they are skipped unless the endpoints are given:
//   BRIDGE_VIRTUAL_URL      virtual device, 2 channels, generator + loopback   (e.g. ws://127.0.0.1:9101)
//   BRIDGE_OVERFLOW_URL     virtual device with a tiny queue and a fast generator (ws://127.0.0.1:9111)
//   BRIDGE_BENCH_URL        bench generator's paired Bridge endpoint           (ws://127.0.0.1:9202)
//   BRIDGE_BENCH_CONTROL_URL bench generator control endpoint                  (ws://127.0.0.1:9201)
//   BRIDGE_BENCH_ORIGIN_URL a bench Bridge endpoint started with --ws-origin https://bridge.plotune.net (ws://127.0.0.1:9302)
export default defineConfig({ ...base, testDir: 'e2e-virtual', timeout: 90_000 });
