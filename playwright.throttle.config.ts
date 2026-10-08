import {defineConfig} from '@playwright/test';
import acceptance from './playwright.acceptance.config';
export default defineConfig({...acceptance,testMatch:'throttle-integration.spec.ts',
  reporter:[['list'],['json',{outputFile:'supplemental-results/throttle-integration-results.json'}]],
  outputDir:'supplemental-results/throttle-integration',
});
