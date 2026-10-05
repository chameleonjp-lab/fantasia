import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Campaign gates plus inherited modules still used by the Fantasia runtime.
// Naval mission suites remain available via test:legacy; they are not Fantasia acceptance.
const shared = ['aim-indicator', 'control-settings', 'keyboard-settings', 'dialog-focus',
  'flight', 'easy-shot-correction', 'input-ownership', 'input-recovery', 'payload-input',
  'review-input-ownership', 'render-queue', 'audio'];
const files = readdirSync('tests').filter(name => /^campaign.*\.test\.ts$/.test(name)
  || shared.includes(name.replace('.test.ts', ''))).sort().map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=2', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
