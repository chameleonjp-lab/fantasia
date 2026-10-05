import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const gate = JSON.parse(readFileSync('docs/RELEASE_GATE.json', 'utf8'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(gate.ready, true, 'P7/P8 acceptance remains incomplete; see FANTASIA_VERIFICATION.md');
assert.match(gate.candidateCommit ?? '', /^[0-9a-f]{40}$/, 'Release evidence must identify a candidate commit');
execFileSync('git', ['cat-file', '-e', `${gate.candidateCommit}^{commit}`]);
// Acceptance documentation may be committed after the tested source. Runtime,
// tests and build/deployment scripts must be identical to that candidate.
execFileSync('git', ['diff', '--exit-code', gate.candidateCommit, head, '--',
  'src', 'public', 'tests', 'browser-tests', 'scripts', 'index.html',
  'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'playwright.config.ts', '.github']);
for (let i = 1; i <= 20; i++) {
  const id = `F-${String(i).padStart(2, '0')}`;
  assert.equal(gate.acceptance[id]?.status, 'pass', `${id} is not accepted`);
  assert.ok(gate.acceptance[id]?.evidence?.length, `${id} has no evidence`);
}
assert.equal(gate.physicalPhoneVerified, true, 'Emulation cannot replace the specified physical phone gate');
assert.equal(gate.independentReview, 'pass', 'Independent pre-publication review is required');
console.log(`Release gates accepted for ${head}`);
