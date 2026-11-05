import { defineConfig } from '@playwright/test';

// Parallel-delivery agents each run their own preview: set E2E_PORT to avoid colliding with another agent's server.
// The default (4173) is unchanged for a normal single-checkout run.
const port = Number(process.env.E2E_PORT) || 4173;
const baseURL = `http://127.0.0.1:${port}`;

// The production build is what gets tested, served exactly as GitHub Pages serves it: static files, no server logic.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: { command: `npm run build && npx vite preview --host 127.0.0.1 --port ${port} --strictPort`, url: baseURL, reuseExistingServer: true, timeout: 120_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
