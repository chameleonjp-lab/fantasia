import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignStartPreparation, START_PREPARATION_TIMEOUT_MS, type StartFrameReceipt } from '../src/campaign-start';
import { RenderQueue, type RenderQueueContext } from '../src/render-queue';

// Protocol tests, not GPU timing or browser acceptance evidence.
function harness() {
  let now = 0, signaled = false, lost = false, waitFailed = false, serial = 0;
  const deleted: WebGLSync[] = [], timers: Array<{ callback: () => void; delay: number; cancelled: boolean }> = [];
  const gl: RenderQueueContext = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, TIMEOUT_EXPIRED: 4, WAIT_FAILED: 5,
    fenceSync: () => ({ serial: ++serial }) as WebGLSync, flush() {}, isContextLost: () => lost,
    clientWaitSync: () => waitFailed ? 5 : signaled ? 2 : 4,
    deleteSync: fence => { if (fence) deleted.push(fence); },
  };
  const queue = new RenderQueue(gl), submitted: string[] = [], completed: string[] = [], failed: string[] = [];
  let override: StartFrameReceipt | null = null;
  const controller = new CampaignStartPreparation<string>({
    now: () => now,
    poll: () => { queue.poll(now); return override ?? queue.diagnostics(now); },
    submit: mode => { submitted.push(mode); signaled = false; queue.submit(now); return queue.diagnostics(now); },
    schedule: (callback, delay) => { const timer = { callback, delay, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    complete: mode => completed.push(mode), failed: reason => failed.push(reason),
  });
  return { controller, queue, submitted, completed, failed, deleted, timers,
    step: (time = now + 16) => { now = time; controller.step(); },
    signal: () => { signaled = true; }, lose: () => { lost = true; }, restore: () => { lost = false; queue.reset(); },
    failWait: () => { waitFailed = true; }, override: (receipt: StartFrameReceipt) => { override = receipt; },
  };
}

test('Start drains a home frame, yields a paint, submits selected Normal exactly once and acknowledges that exact frame', () => {
  const h = harness(); h.queue.submit(0);
  assert.equal(h.controller.begin('normal'), true);
  assert.equal(h.controller.begin('easy'), false, 'double Start does not change the selected attempt');
  h.step(); h.step(1200);
  assert.equal(h.controller.snapshot().phase, 'draining'); assert.equal(h.controller.ownsRendering, true);
  assert.deepEqual(h.submitted, []); assert.deepEqual(h.completed, []); assert.deepEqual(h.deleted, []);
  h.signal(); h.step(1600);
  assert.equal(h.controller.snapshot().phase, 'submitting'); assert.deepEqual(h.submitted, []);
  h.step(1616); assert.deepEqual(h.submitted, ['normal']); assert.equal(h.controller.snapshot().submittedFrame, 2);
  h.step(3000); assert.deepEqual(h.completed, []); assert.equal(h.queue.diagnostics(3000).status, 'stalled');
  h.signal(); h.step(3016); h.step(3032);
  assert.deepEqual(h.completed, ['normal']); assert.deepEqual(h.submitted, ['normal']);
  assert.equal(h.controller.ownsRendering, false); assert.equal(h.timers[0].cancelled, true);
});

for (const phase of ['draining', 'submitting', 'waiting'] as const) {
  test(`cancel in ${phase} invalidates callbacks and preserves outstanding work for a changed-mode Start`, () => {
    const h = harness(); h.controller.begin('easy');
    if (phase !== 'draining') h.step();
    if (phase === 'waiting') h.step();
    h.controller.cancel(); h.timers[0].callback(); h.signal(); h.step();
    assert.deepEqual(h.completed, []); assert.deepEqual(h.failed, []);
    assert.deepEqual(h.deleted, [], 'cancel neither resets nor releases a live fence');
    h.controller.begin('normal'); h.step(); h.step();
    assert.equal(h.submitted.at(-1), 'normal'); h.signal(); h.step();
    assert.deepEqual(h.completed, ['normal']);
  });
}

test('15-second timeout stays visible/owned; explicit retry drains the retained frame without auto-retry', () => {
  const h = harness(); h.controller.begin('normal'); h.step(); h.step(); h.step(14999);
  assert.deepEqual(h.failed, []); h.step(15000);
  assert.deepEqual(h.failed, ['timeout']); assert.equal(h.controller.ownsRendering, true); assert.deepEqual(h.deleted, []);
  h.signal(); h.step(20000); assert.deepEqual(h.completed, []); assert.deepEqual(h.submitted, ['normal']);
  assert.equal(h.controller.begin('easy'), true); h.timers[0].callback(); h.step(20016); h.step(20032);
  assert.deepEqual(h.submitted, ['normal', 'easy']); assert.equal(h.deleted.length, 1);
  h.signal(); h.step(); assert.deepEqual(h.completed, ['easy']);
});

test('timeout timer also bounds a suspended rAF and stale timers cannot fail a newer attempt', () => {
  const h = harness(); h.controller.begin('normal');
  assert.equal(h.timers[0].delay, START_PREPARATION_TIMEOUT_MS);
  h.timers[0].callback(); assert.deepEqual(h.failed, ['timeout']);
  h.controller.begin('normal'); h.timers[0].callback();
  assert.deepEqual(h.failed, ['timeout']); h.step(); h.step(); h.signal(); h.step();
  assert.deepEqual(h.completed, ['normal']);
});

test('a completion observed at the deadline does not commit an expired attempt', () => {
  const h = harness(); h.controller.begin('easy'); h.step(); h.step(); h.signal(); h.step(15000);
  assert.deepEqual(h.completed, []); assert.deepEqual(h.failed, ['timeout']);
});

test('a failed queue is sticky and cannot silently retry even if polled repeatedly', () => {
  const h = harness(); h.controller.begin('normal'); h.step(); h.step(); h.failWait(); h.step();
  assert.deepEqual(h.failed, ['render-failed']); h.step(); h.controller.begin('easy'); h.step();
  assert.deepEqual(h.submitted, ['normal']); assert.deepEqual(h.completed, []);
  assert.deepEqual(h.failed, ['render-failed', 'render-failed']);
});

for (const receipt of [
  { status: 'ready', submittedCount: 0, completedCount: 0 },
  { status: 'ready', submittedCount: 2, completedCount: 2 },
  { status: 'ready', submittedCount: 1, completedCount: 0 },
] as StartFrameReceipt[]) {
  test(`reset/foreign/incomplete receipt ${JSON.stringify(receipt)} cannot certify the selected frame`, () => {
    const h = harness(); h.controller.begin('easy'); h.step(); h.step(); h.override(receipt); h.step();
    assert.deepEqual(h.completed, []); assert.deepEqual(h.failed, ['render-failed']);
  });
}

test('context loss invalidates completion; only explicit retry after context restoration can start', () => {
  const h = harness(); h.controller.begin('normal'); h.step(); h.step();
  h.lose(); h.controller.interrupt('context-lost'); h.restore(); h.signal(); h.step();
  assert.deepEqual(h.completed, []); assert.deepEqual(h.failed, ['context-lost']);
  h.controller.begin('normal'); h.step(); h.step(); h.signal(); h.step();
  assert.deepEqual(h.completed, ['normal']);
});

test('context loss after timeout updates recovery feedback without reviving the attempt', () => {
  const h = harness(); h.controller.begin('normal'); h.timers[0].callback(); h.controller.interrupt('context-lost');
  assert.equal(h.controller.snapshot().failure, 'context-lost'); assert.deepEqual(h.failed, ['timeout', 'context-lost']);
});

for (const action of ['interrupted', 'dispose'] as const) {
  test(`${action} prevents stale completion and timer callbacks from starting flight`, () => {
    const h = harness(); h.controller.begin('normal'); h.step(); h.step();
    if (action === 'dispose') h.controller.dispose(); else h.controller.interrupt(action);
    h.signal(); h.step(); h.timers[0].callback();
    assert.deepEqual(h.completed, []); assert.equal(h.submitted.length, 1);
    if (action === 'dispose') { assert.equal(h.controller.begin('easy'), false); assert.equal(h.controller.ownsRendering, false); }
  });
}

test('completion-callback errors become an owned failed preparation rather than a silently successful attempt', () => {
  let receipt: StartFrameReceipt = { status: 'ready', submittedCount: 0, completedCount: 0 }, commits = 0;
  const failures: string[] = [];
  const controller = new CampaignStartPreparation({
    now: () => 0, poll: () => receipt,
    submit: () => receipt = { status: 'pending', submittedCount: 1, completedCount: 0 },
    schedule: () => () => {}, complete: () => { commits++; throw new Error('Screen/HUD commit failed'); },
    failed: reason => failures.push(reason),
  });
  controller.begin('normal'); controller.step(); controller.step();
  receipt = { status: 'ready', submittedCount: 1, completedCount: 1 }; controller.step(); controller.step();
  assert.equal(commits, 1); assert.deepEqual(failures, ['render-failed']);
  assert.equal(controller.snapshot().phase, 'failed'); assert.equal(controller.ownsRendering, true);
});
