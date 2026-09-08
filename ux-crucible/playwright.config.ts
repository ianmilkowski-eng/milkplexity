import { defineConfig, devices } from '@playwright/test';

// STAGING_URL lets the same suite run against the live GitHub Pages site.
const BASE = process.env.STAGING_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: {
    // Layout-lock tolerance: 0.2% of pixels may differ (anti-aliasing), no per-pixel threshold slack.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, threshold: 0.1, animations: 'disabled' },
  },
  use: { baseURL: BASE, trace: 'retain-on-failure', deviceScaleFactor: 1 },
  webServer: process.env.STAGING_URL ? undefined : {
    command: 'npx http-server .. -p 4173 -s -c-1',
    url: BASE + '/index.html',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'mobile-320-dark',  use: { viewport: { width: 320,  height: 568 }, colorScheme: 'dark' } },
    { name: 'mobile-390-light', use: { ...devices['iPhone 13'], deviceScaleFactor: 1, colorScheme: 'light' } },
    { name: 'tablet-768-dark',  use: { viewport: { width: 768,  height: 1024 }, colorScheme: 'dark' } },
    { name: 'desktop-1280-dark', use: { viewport: { width: 1280, height: 800 }, colorScheme: 'dark' } },
    { name: 'desktop-1440-light', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
  ],
});
