import { defineConfig } from '@playwright/test';
import { HEALTH, ORIGIN } from './tests/e2e/origin.mjs';

// Browser tests load the real built extension (the e2e build) into Chromium
// and drive it on local fixture pages. Run with: npm run test:e2e
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  workers: 1,
  // On CI a test that fails once and then passes is reported as "flaky", not hidden.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: ORIGIN },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    // A path only Blob's fixture server answers, so another server on the port is not mistaken for it.
    url: HEALTH,
    reuseExistingServer: true,
  },
});
