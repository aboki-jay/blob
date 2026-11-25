import { defineConfig } from '@playwright/test';

// Browser tests load the real built extension (the e2e build) into Chromium
// and drive it on local fixture pages. Run with: npm run test:e2e
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  workers: 1,
  // On CI a test that fails once and then passes is reported as "flaky", not hidden.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
  },
});
