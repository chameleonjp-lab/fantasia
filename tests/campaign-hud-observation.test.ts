import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { RenderQueue, type RenderQueueContext } from '../src/render-queue';
import { confirmHudObservation, needsNativeConfirmation, waitForNativeFrame, type NativeConfirmation } from '../browser-tests/hud-observation';

// Pure protocol fakes only: these do not establish real GPU/device acceptance.
function fixture() {
  let waitResult = 0x911b, polls = 0;
  const gl: RenderQueueContext = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117, ALREADY_SIGNALED: 0x911a, TIMEOUT_EXPIRED: 0x911b,
    CONDITION_SATISFIED: 0x911c, WAIT_FAILED: 0x911d,
    fenceSync: () => ({} as WebGLSync), clientWaitSync: () => { polls++; return waitResult; },
    deleteSync() {}, flush() {}, isContextLost: () => false,
  };
  const queue = new RenderQueue(gl);
  queue.submit(0);
  assert.equal(queue.poll(900), 'pending');
  const snapshot = (now: number, renderStatus = 'pending') => ({
    runId: 'fantasia:fixture:1', phase: 'playing', pauseReasons: [] as string[], fatalLogicError: null as string | null,
    renderStatus, performanceInterrupted: false, lastInterruption: null as unknown,
    render: { queue: queue.diagnostics(now) },
  });
  return { queue, snapshot, gl, setWaitResult(value: number) { waitResult = value; }, get polls() { return polls; } };
}

for (const signaled of ['ALREADY_SIGNALED', 'CONDITION_SATISFIED'] as const) {
  test(`age-only diagnostics can exceed 1000 ms while the next native ${signaled} poll completes the fence`, async () => {
    const f = fixture(), original = f.snapshot(1014.2), polls = f.polls;
    assert.equal(original.render.queue.status, 'stalled');
    assert.equal(needsNativeConfirmation(original), true);
    assert.equal(f.polls, polls, 'observation and classification never poll GL');
    let confirmations = 0;
    const result = await confirmHudObservation(original, async () => {
      confirmations++;
      f.setWaitResult(f.gl[signaled]);
      assert.equal(f.queue.poll(1015), 'ready', 'the fake application owns this native poll');
      f.queue.submit(1015); // A new pending frame does not undo the old receipt.
      return { stage: 'after-native-raf', observation: f.snapshot(1016, 'ready') };
    });
    assert.equal(confirmations, 1);
    assert.equal(result.outcome, 'pass');
    assert.deepEqual(result.originalProblems, ['render queue is stalled']);
    assert.equal(original.render.queue.status, 'stalled', 'the original is never rewritten to ready');
    assert.equal(original.render.queue.completedCount, 0);
  });
}

for (const nativeResult of ['TIMEOUT_EXPIRED', 'WAIT_FAILED'] as const) {
  test(`the native ${nativeResult} stop remains a failure`, async () => {
    const f = fixture(), original = f.snapshot(1014.2);
    const result = await confirmHudObservation(original, async () => {
      f.setWaitResult(f.gl[nativeResult]);
      const status = f.queue.poll(1015);
      assert.equal(status, nativeResult === 'TIMEOUT_EXPIRED' ? 'stalled' : 'failed');
      return { stage: 'after-native-raf', observation: { ...f.snapshot(1015, status), phase: 'paused',
        pauseReasons: ['render'], performanceInterrupted: true, lastInterruption: { reason: status } } };
    });
    assert.equal(result.outcome, 'fail');
    assert.ok(result.problems.includes('phase is paused'));
    assert.ok(result.problems.includes('interruption history is present or unavailable'));
  });
}

test('ordinary ready/pending observations perform zero confirmation reads', async () => {
  const f = fixture();
  for (const original of [f.snapshot(950), { ...f.snapshot(950, 'ready'), render: { queue: { ...f.queue.diagnostics(950), status: 'ready' } } }]) {
    let reads = 0;
    const result = await confirmHudObservation(original, async () => { reads++; throw new Error('unexpected read'); });
    assert.equal(result.outcome, 'pass'); assert.equal(result.stage, 'original'); assert.equal(reads, 0);
  }
});

test('native completion followed by a frame pause, logic error, or a retained stop history cannot pass', async () => {
  const f = fixture(), original = f.snapshot(1014.2);
  f.setWaitResult(f.gl.ALREADY_SIGNALED); f.queue.poll(1015);
  const live = f.snapshot(1016, 'ready');
  for (const observation of [
    { ...live, phase: 'paused', pauseReasons: ['frame'] },
    { ...live, fatalLogicError: 'simulation failed' },
    { ...live, performanceInterrupted: true },
    { ...live, lastInterruption: { reason: 'stalled' } },
    { ...live, renderStatus: 'failed' },
  ]) {
    const result = await confirmHudObservation(original, async () => ({ stage: 'after-native-raf', observation }));
    assert.equal(result.outcome, 'fail');
    assert.equal(result.nativeConfirmation?.observation, observation, 'raw stop evidence is retained');
  }
});

test('still-pending old receipt is inconclusive, even when statuses look healthy', async () => {
  const f = fixture(), original = f.snapshot(1014.2);
  const observation = f.snapshot(999); // Deliberately inconsistent fake must not prove completion.
  const result = await confirmHudObservation(original, async () => ({ stage: 'after-native-raf', observation }));
  assert.equal(result.outcome, 'inconclusive');
  assert.match(result.problems[0], /original submitted fence/);
});

test('a second age-only stall is not retried or accepted, even after the original receipt completed', async () => {
  const f = fixture(), original = f.snapshot(1014.2);
  let reads = 0;
  const result = await confirmHudObservation(original, async () => {
    reads++; f.setWaitResult(f.gl.ALREADY_SIGNALED); f.queue.poll(1015); f.queue.submit(1015);
    return { stage: 'after-native-raf', observation: f.snapshot(2016, 'ready') };
  });
  assert.notEqual(result.outcome, 'pass'); assert.equal(reads, 1);
  assert.ok(result.problems.includes('render queue is stalled'));
});

test('missing or failed queue and unsafe originals never request confirmation', async () => {
  const f = fixture(), original = f.snapshot(1014.2);
  for (const observation of [null, {}, { ...original, render: null },
    { ...original, render: { queue: { status: 'failed', failure: 'wait-failed' } } },
    { ...original, phase: 'paused' }, { ...original, pauseReasons: ['render'] },
    { ...original, fatalLogicError: 'logic' }, { ...original, renderStatus: 'stalled' },
    { ...original, performanceInterrupted: true }, { ...original, lastInterruption: { reason: 'frame' } },
    { ...original, performanceInterrupted: undefined }, { ...original, lastInterruption: undefined },
  ]) {
    let reads = 0;
    const result = await confirmHudObservation(observation, async () => { reads++; throw new Error('unexpected'); });
    assert.equal(result.outcome, 'fail'); assert.equal(reads, 0);
  }
});

test('missing, inconsistent, or reset counters cannot establish completion', async () => {
  const f = fixture(), original = f.snapshot(1014.2);
  for (const change of [
    { submittedCount: undefined }, { completedCount: undefined }, { submittedCount: 0, completedCount: 0 },
    { submittedCount: 1, completedCount: 2 }, { submittedCount: 1.5 }, { completedCount: NaN },
  ]) {
    const queue = { ...original.render.queue, status: 'ready', ...change };
    const result = await confirmHudObservation(original, async () => ({ stage: 'after-native-raf', observation: { ...original, render: { queue } } }));
    assert.equal(result.outcome, 'inconclusive');
    assert.equal(needsNativeConfirmation({ ...original, render: { queue: { ...queue, status: 'stalled' } } }), false);
  }
});

test('confirmation status and receipt counts must agree for ready and pending', async () => {
  const f = fixture(), original = f.snapshot(1014.2);
  for (const [status, submittedCount, completedCount] of [['pending', 1, 1], ['pending', 4, 1], ['ready', 2, 1]] as const) {
    const observation = { ...original, render: { queue: { ...original.render.queue, status, submittedCount, completedCount } } };
    const result = await confirmHudObservation(original, async () => ({ stage: 'after-native-raf', observation }));
    assert.equal(result.outcome, 'inconclusive');
  }
});

test('normal gate retains prior explicit-resume history without changing its existing UI contract', async () => {
  const f = fixture(), original = { ...f.snapshot(950), performanceInterrupted: true, lastInterruption: { reason: 'stalled' } };
  let reads = 0;
  const before = JSON.stringify(original);
  const result = await confirmHudObservation(original, async () => { reads++; throw new Error('unexpected'); });
  assert.equal(result.outcome, 'pass'); assert.equal(reads, 0);
  assert.equal(JSON.stringify(original), before);
});

test('counters from a restarted run cannot acknowledge the original fence', async () => {
  const f = fixture(), original = f.snapshot(1014.2);
  f.setWaitResult(f.gl.ALREADY_SIGNALED); f.queue.poll(1015);
  for (const runId of ['fantasia:fixture:2', undefined, '']) {
    const observation = { ...f.snapshot(1016, 'ready'), runId };
    const result = await confirmHudObservation(original, async () => ({ stage: 'after-native-raf', observation }));
    assert.equal(result.outcome, 'fail');
    assert.match(result.problems.join(' '), /different or missing run/);
  }
  assert.equal(needsNativeConfirmation({ ...original, runId: undefined }), false);
});

test('missing confirmation snapshots and explicit timeout/unavailable outcomes never pass', async () => {
  const f = fixture(), original = f.snapshot(1014.2);
  for (const confirmation of [{ stage: 'timeout' }, { stage: 'unavailable', error: 'page closed' },
    { stage: 'after-native-raf' }, { stage: 'after-native-raf', observation: null },
    { stage: 'after-native-raf', observation: { ...f.snapshot(1015), render: {} } },
  ] as NativeConfirmation[]) {
    let reads = 0;
    const result = await confirmHudObservation(original, async () => { reads++; return confirmation; });
    assert.notEqual(result.outcome, 'pass'); assert.equal(reads, 1);
    assert.equal(result.nativeConfirmation, confirmation);
  }
  const rejected = await confirmHudObservation(original, async () => { throw new Error('read timed out'); });
  assert.equal(rejected.outcome, 'inconclusive'); assert.match(rejected.nativeConfirmation?.error ?? '', /timed out/);
});

test('frozen original and native observations remain intact', async () => {
  const f = fixture(), original = f.snapshot(1014.2);
  f.setWaitResult(f.gl.ALREADY_SIGNALED); f.queue.poll(1015);
  const observation = f.snapshot(1016, 'ready');
  for (const value of [original, observation]) {
    Object.freeze(value.render.queue); Object.freeze(value.render); Object.freeze(value.pauseReasons); Object.freeze(value);
  }
  const before = JSON.stringify({ original, observation });
  assert.equal((await confirmHudObservation(original, async () => ({ stage: 'after-native-raf', observation }))).outcome, 'pass');
  assert.equal(JSON.stringify({ original, observation }), before);
});

function fakeClock() {
  let now = 0, requested = 0;
  const frames = new Map<number, () => void>(), timers = new Map<number, () => void>();
  const clock = {
    now: () => now,
    requestFrame(callback: () => void) { requested++; frames.set(requested, callback); return requested; },
    cancelFrame(id: number) { frames.delete(id); },
    setTimer(callback: () => void, _delay: number) { timers.set(1, callback); return 1; },
    clearTimer(id: number) { timers.delete(id); },
  };
  return { clock, frames, timers, setNow(value: number) { now = value; }, get requested() { return requested; } };
}

test('next-rAF wait resolves once and clears only its own observation timer', async () => {
  const f = fakeClock(), waiting = waitForNativeFrame(15000, f.clock);
  assert.equal(f.requested, 1); f.setNow(16); f.frames.get(1)!();
  assert.equal(await waiting, 'raf'); assert.equal(f.timers.size, 0); assert.equal(f.requested, 1);
});

test('rAF never arrives: timeout cancels the observation callback and stays blocked if it runs late', async () => {
  const f = fakeClock(), waiting = waitForNativeFrame(15000, f.clock), late = f.frames.get(1)!;
  f.setNow(15000); f.timers.get(1)!();
  assert.equal(await waiting, 'timeout'); assert.equal(f.frames.size, 0);
  late(); assert.equal(await waiting, 'timeout'); assert.equal(f.requested, 1);
});

test('an overdue rAF callback cannot win a delayed timer race and pass', async () => {
  const f = fakeClock(), waiting = waitForNativeFrame(15000, f.clock);
  f.setNow(15001); f.frames.get(1)!();
  assert.equal(await waiting, 'timeout'); assert.equal(f.timers.size, 0);
});

test('the rAF waiter serializes without module closures for page.evaluate', async () => {
  const f = fakeClock();
  const serializedWait = runInNewContext(`(${waitForNativeFrame.toString()})`, {
    performance: { now: f.clock.now }, requestAnimationFrame: f.clock.requestFrame,
    cancelAnimationFrame: f.clock.cancelFrame, window: { setTimeout: f.clock.setTimer, clearTimeout: f.clock.clearTimer },
  });
  const waiting = serializedWait(15000); f.setNow(16); f.frames.get(1)!();
  assert.equal(await waiting, 'raf');
});
