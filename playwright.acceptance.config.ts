import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-acceptance', testMatch: 'acceptance.spec.ts',
  timeout: 65000, globalTimeout: 1500000, expect: { timeout: 1500 }, workers: 1, retries: 0,
  projects: [{ name: 'clean-browser-acceptance', use: { browserName: 'chromium' } }],
  reporter: [['list'], ['json', { outputFile: 'test-results/clean-browser-acceptance-results.json' }]],
  outputDir: 'test-results/clean-browser-acceptance',
  use: { baseURL: 'http://127.0.0.1:4176', viewport: { width: 393, height: 852 },
    isMobile: false, hasTouch: true, deviceScaleFactor: 1, screenshot: 'only-on-failure', trace: 'off',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4176', reuseExistingServer: false, timeout: 30000 },
});
