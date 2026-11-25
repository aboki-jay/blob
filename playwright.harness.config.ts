import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The same browser tests, but run against the overlay loaded into an ordinary
// page with a stand-in for Chrome's extension APIs (tests/e2e/harness.ts).
// Use this where a real extension cannot be loaded. It does not exercise
// Chrome's injection, permissions or chrome.storage. Run with:
//   npm run test:e2e:harness
process.env.BLOB_E2E = 'harness';

export default defineConfig({
  ...base,
  globalSetup: './tests/e2e/build-harness.ts',
});
