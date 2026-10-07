import test from 'node:test';
import assert from 'node:assert/strict';
import { collectStartFailureEvidence, START_FAILURE_STATE, START_FAILURE_ERROR, type StartFailureEvidenceOperations } from '../browser-tests/start-failure-evidence';

function harness(failures: string[] = []) {
  const calls: string[] = [], files = new Map<string, string>(), attachments: Array<{ name: string; value: unknown }> = [], warnings: string[] = [];
  const ops: StartFailureEvidenceOperations = {
    async read() { calls.push('read'); if (failures.includes('read')) throw new Error('read failed'); return '{"tick":28,"lastInterruption":{"reason":"frame","gap":0.3},"updateTimes":[2]}'; },
    async persist(name, body) { calls.push(`persist:${name}`); if (failures.includes(name)) throw new Error(`write failed: ${name}`); files.set(name, body); return `/test-output/${name}`; },
    async attach(name, value) { calls.push(`attach:${name}`); if (failures.includes(name)) throw new Error(`attach failed: ${name}`); attachments.push({ name, value }); },
    warn(message) { warnings.push(message); },
  };
  return { ops, calls, files, attachments, warnings };
}

// Same catch/finally ownership as start(): evidence can never replace its error.
async function assertionPath(assertion: () => void, operations: StartFailureEvidenceOperations) {
  try { assertion(); }
  catch (assertionError) {
    try { await collectStartFailureEvidence(operations); }
    finally { throw assertionError; }
  }
}

test('successful assertion does not collect, persist or attach anything', async () => {
  const h = harness(); await assertionPath(() => {}, h.ops);
  assert.deepEqual(h.calls, []); assert.equal(h.files.size, 0); assert.equal(h.attachments.length, 0);
});

test('failed assertion captures exactly one unchanged full-state payload and rethrows the identical error', async () => {
  const h = harness(), original = new Error('original assertion');
  await assert.rejects(assertionPath(() => { throw original; }, h.ops), error => error === original);
  assert.deepEqual(h.calls, ['read', `persist:${START_FAILURE_STATE}.json`, `attach:${START_FAILURE_STATE}`]);
  const saved = JSON.parse(h.files.get(`${START_FAILURE_STATE}.json`)!);
  assert.equal(saved.tick, 28); assert.equal(saved.lastInterruption.gap, .3); assert.deepEqual(saved.updateTimes, [2]);
  assert.deepEqual(h.attachments[0].value, { path: `/test-output/${START_FAILURE_STATE}.json`, contentType: 'application/json' });
});

for (const [failure, stage] of [['read', 'collection'], [`${START_FAILURE_STATE}.json`, 'state-file'], [START_FAILURE_STATE, 'state-attachment']]) {
  test(`${stage} failure is recorded separately without replacing or swallowing the assertion`, async () => {
    const h = harness([failure]), original = new Error('original assertion');
    await assert.rejects(assertionPath(() => { throw original; }, h.ops), error => error === original);
    assert.equal(h.calls.filter(call => call === 'read').length, 1);
    const report = JSON.parse(h.files.get(`${START_FAILURE_ERROR}.json`)!);
    assert.equal(report.stage, stage); assert.match(report.error, /failed/);
    assert.equal(h.attachments.at(-1)!.name, START_FAILURE_ERROR); assert.equal(h.warnings.length, 0);
  });
}

test('error-sidecar write failure falls back to a separate inline error attachment', async () => {
  const h = harness(['read', `${START_FAILURE_ERROR}.json`]), original = new Error('original assertion');
  await assert.rejects(assertionPath(() => { throw original; }, h.ops), error => error === original);
  const attachment = h.attachments[0].value as { body: string };
  const report = JSON.parse(attachment.body);
  assert.equal(report.stage, 'collection'); assert.match(report.errorFileFailure, /write failed/);
});

test('failed error attachment leaves its sidecar and a warning, while the original assertion survives', async () => {
  const h = harness(['read', START_FAILURE_ERROR]), original = new Error('original assertion');
  await assert.rejects(assertionPath(() => { throw original; }, h.ops), error => error === original);
  assert.ok(h.files.has(`${START_FAILURE_ERROR}.json`)); assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0], /errorAttachmentFailure/);
});

test('even all evidence destinations failing or a warning throwing cannot replace the original assertion', async () => {
  const h = harness(['read', `${START_FAILURE_ERROR}.json`, START_FAILURE_ERROR]), original = new Error('original assertion');
  h.ops.warn = () => { throw new Error('warning failed'); };
  await assert.rejects(assertionPath(() => { throw original; }, h.ops), error => error === original);
  assert.equal(h.calls.filter(call => call === 'read').length, 1);
});
