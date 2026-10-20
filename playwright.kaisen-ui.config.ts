import {defineConfig} from '@playwright/test';
import acceptance from './playwright.acceptance.config';
export default defineConfig({...acceptance,testMatch:'kaisen-ui-parity.spec.ts',
  reporter:[['list'],['json',{outputFile:'test-results/kaisen-ui-parity-results.json'}]],
  outputDir:'test-results/kaisen-ui-parity',
});
