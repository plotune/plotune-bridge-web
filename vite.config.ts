import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

// The page's Content-Security-Policy suits the built, static site. The dev server injects inline styles, so it drops the policy.
const devWithoutCsp = (): Plugin => ({
  name: 'dev-without-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>\s*/, ''),
});

// Static build for GitHub Pages at the root of bridge.plotune.net: relative base keeps it host-agnostic.
export default defineConfig({
  base: './',
  plugins: [react(), devWithoutCsp()],
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/node/**'],
    css: false,
  },
});
