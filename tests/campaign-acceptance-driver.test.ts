import test from 'node:test';
import assert from 'node:assert/strict';
import { pollOwnedFence, releaseOwnedFence, type OwnedFence } from '../browser-acceptance/native-fence';
import { RunBudget } from '../browser-acceptance/run-budget';

// Ownership/protocol tests only; these mocks do not establish native GPU proof.
function fixture() {
  const owned = {}, foreign = {}, waits: unknown[][] = [], deleted: unknown[] = [];
  let reply = 1, lost = false;
  const gl = { ALREADY_SIGNALED: 1, CONDITION_SATISFIED: 2, TIMEOUT_EXPIRED: 3,
    isContextLost: () => lost, clientWaitSync: (...args: unknown[]) => { waits.push(args); return reply; },
    deleteSync: (sync: unknown) => { deleted.push(sync); } };
  return { owner: { gl, sync: owned, released: false } as unknown as OwnedFence,
    owned, foreign, waits, deleted, reply: (value: number) => { reply = value; }, lost: () => { lost = true; } };
}

test('proof fence polls only its own handle with zero flags and zero timeout', () => {
  const f = fixture(); f.reply(3); assert.equal(pollOwnedFence(f.owner), 'pending');
  f.reply(2); assert.equal(pollOwnedFence(f.owner), 'ready');
  assert.deepEqual(f.waits, [[f.owned, 0, 0], [f.owned, 0, 0]]); assert.deepEqual(f.deleted, []);
});
test('proof fence cleanup is idempotent and never deletes a foreign application fence', () => {
  const f = fixture(); releaseOwnedFence(f.owner); releaseOwnedFence(f.owner);
  assert.deepEqual(f.deleted, [f.owned]); assert.ok(!f.deleted.includes(f.foreign));
  assert.throws(() => pollOwnedFence(f.owner), /released/);
});
test('lost context and failed native waits fail rather than becoming ready', () => {
  const f = fixture(); f.reply(999); assert.throws(() => pollOwnedFence(f.owner), /failed/);
  f.lost(); assert.throws(() => pollOwnedFence(f.owner), /Context lost/);
});
test('runner wall budget is independent of page time and cannot be extended by polling', () => {
  let now = 100; const b = new RunBudget(40, 3, () => now);
  assert.equal(b.remaining('begin'), 40); now = 139; assert.equal(b.remaining('end'), 1);
  now = 140; assert.throws(() => b.remaining('late'), /wall-clock/);
});
test('animation steps have an independent finite limit', () => {
  const b = new RunBudget(100, 2, () => 0); b.step(); b.step();
  assert.throws(() => b.step(), /step budget/);
});
