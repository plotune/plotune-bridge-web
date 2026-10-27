import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Regenerates docs/screenshots. The dashboard and diagnostics shots need the real virtual device and bench (see README).
export default defineConfig({ ...base, testDir: 'e2e-screenshots', timeout: 90_000, use: { ...base.use, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } });
