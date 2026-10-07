import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-acceptance', testMatch: 'driver-proof.spec.ts',
  timeout: 60000, globalTimeout: 90000, expect: { timeout: 1000 }, workers: 1, retries: 0,
  projects: [{ name: 'controlled-real-renderer-proof', use: { browserName: 'chromium' } }],
  reporter: [['list'], ['json', { outputFile: 'test-results/clean-browser-proof-results.json' }]],
  outputDir: 'test-results/clean-browser-proof',
  use: { baseURL: 'http://127.0.0.1:4176', viewport: { width: 393, height: 852 },
    isMobile: false, hasTouch: false, deviceScaleFactor: 1, screenshot: 'only-on-failure', trace: 'off',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4176', reuseExistingServer: false, timeout: 30000 },
});
