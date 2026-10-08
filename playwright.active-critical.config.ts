import { defineConfig } from '@playwright/test';
import original from './playwright.acceptance.config';

// Additive suite only. The original 34-case command and CI are not changed.
export default defineConfig({
  ...original, testMatch: 'active-critical.spec.ts', timeout: 720000, globalTimeout: 1500000,
  reporter: [['list'], ['json', { outputFile: 'supplemental-results/active-critical-results.json' }]],
  outputDir: 'supplemental-results/active-critical',
  projects: [{ name: 'active-critical-candidate', use: { browserName: 'chromium' } }],
});
