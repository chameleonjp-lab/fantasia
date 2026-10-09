import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-ui-only', testMatch: 'ui-only.spec.ts',
  timeout: 12000, globalTimeout: 90000, expect: { timeout: 1500 }, workers: 1, retries: 0,
  projects: [{ name: 'ui-only-fixed-state', use: { browserName: 'chromium' } }],
  reporter: [['list'], ['json', { outputFile: 'test-results/ui-only-results.json' }], ['html', { outputFolder: 'test-results/ui-only-html', open: 'never' }]],
  outputDir: 'test-results/ui-only',
  use: { baseURL: 'http://127.0.0.1:4177', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, screenshot: 'only-on-failure', trace: 'off' },
  webServer: { command: 'npm run dev:ui-only', url: 'http://127.0.0.1:4177/__ui-only', reuseExistingServer: false, timeout: 20000 },
});
