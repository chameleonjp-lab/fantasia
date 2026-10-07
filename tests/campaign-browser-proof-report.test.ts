import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/report-browser-proof.mjs');
function run(status?: string, attempt?: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'fantasia-proof-report-'));
  mkdirSync(join(cwd, 'test-results'));
  if (status) writeFileSync(join(cwd, 'test-results/clean-browser-proof-results.json'), JSON.stringify({
    suites: [{ specs: [{ title: 'driver proof', tests: [{ projectName: 'controlled-real-renderer-proof', status,
      results: attempt ? [{ status: attempt }] : [] }] }] }],
  }));
  const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  return { result, report: JSON.parse(readFileSync(join(cwd, 'test-results/browser-proof-acceptance.json'), 'utf8')) };
}
test('a passed native driver proof stays explicitly incomplete for product acceptance and release', () => {
  const { result, report } = run('expected', 'passed');
  assert.equal(result.status, 0); assert.equal(report.driverProof, 'passed');
  assert.equal(report.suiteRebuildComplete, false); assert.equal(report.releaseReady, false);
  assert.equal(report.acceptanceCasesCompleted, 0); assert.equal(report.pendingAcceptanceCases.length, 10);
  assert.equal(report.performanceAcceptance, 'not measured');
});
test('missing browser output and discovery-only output cannot pass the proof', () => {
  for (const x of [run(), run('expected')]) {
    assert.equal(x.result.status, 1); assert.notEqual(x.report.driverProof, 'passed'); assert.equal(x.report.releaseReady, false);
  }
});
test('failed and skipped browser results stay nonpassing without retries or reclassification', () => {
  for (const [status, attempt] of [['unexpected', 'failed'], ['skipped', 'skipped']]) {
    const { result, report } = run(status, attempt); assert.equal(result.status, 1);
    assert.equal(report.driverProof, 'not-passed'); assert.equal(report.cases[0].attempts[0].status, attempt);
  }
});
