import test from 'node:test';
import assert from 'node:assert/strict';
import { oneTickPulseEvidence, type InputAudit } from '../browser-tests/input-audit';

const row = (tick: number, bomb: boolean, loop = false, pitch = 0) => ({ tick, input: { bomb, loop, pitch } });
const audit = (...entries: InputAudit['entries']) => ({ dropped: 0, entries });

for (const action of ['bomb', 'loop'] as const) {
  const pulseRow = (tick: number, active: boolean, pitch = 0) => ({ tick, input: { [action]: active, pitch } });

  test(`${action}: a complete closed one-tick pulse passes with diagnostic boundaries`, () => {
    const result = oneTickPulseEvidence(audit(pulseRow(0, false), pulseRow(8, true), pulseRow(9, false)), action);
    assert.equal(result.status, 'pass');
    assert.deepEqual([result.startTick, result.endTick, result.durationTicks], [8, 9, 1]);
    assert.match(result.reason, /Exactly one/);
  });

  for (const duration of [2, 3, 60]) {
    test(`${action}: one compressed true row lasting ${duration} ticks fails`, () => {
      const result = oneTickPulseEvidence(audit(pulseRow(0, false), pulseRow(8, true), pulseRow(8 + duration, false)), action);
      assert.equal(result.status, 'fail');
      assert.deepEqual([result.startTick, result.endTick, result.durationTicks], [8, 8 + duration, duration]);
      assert.match(result.reason, /persisted/);
    });
  }

  test(`${action}: trailing true remains pending until an explicit false boundary arrives`, () => {
    for (const entries of [
      [pulseRow(0, false), pulseRow(8, true)],
      [pulseRow(0, false), pulseRow(8, true), pulseRow(9, true, 0.5)],
    ]) {
      const result = oneTickPulseEvidence(audit(...entries), action);
      assert.equal(result.status, 'pending');
      assert.deepEqual([result.startTick, result.endTick, result.durationTicks], [8, null, null]);
      assert.match(result.reason, /no explicit false/);
    }
  });

  test(`${action}: a delayed or immediate second pulse invalidates the first, even if still open`, () => {
    const first = [pulseRow(0, false), pulseRow(8, true), pulseRow(9, false)];
    for (const tick of [10, 1000]) {
      for (const extra of [[pulseRow(tick, true)], [pulseRow(tick, true), pulseRow(tick + 1, false)]]) {
        const result = oneTickPulseEvidence(audit(...first, ...extra), action);
        assert.equal(result.status, 'fail');
        assert.deepEqual([result.startTick, result.endTick, result.durationTicks], [8, 9, 1]);
        assert.match(result.reason, new RegExp(`later ${action} pulse starts at tick ${tick}`));
      }
    }
  });

  test(`${action}: other-field signature changes do not create or close a pulse`, () => {
    const result = oneTickPulseEvidence(audit(pulseRow(0, false), pulseRow(2, false, 0.5),
      pulseRow(8, true, 0.5), pulseRow(9, true, -0.5), pulseRow(10, false, -0.5)), action);
    assert.equal(result.status, 'fail');
    assert.deepEqual([result.startTick, result.endTick, result.durationTicks], [8, 10, 2]);
    assert.equal(oneTickPulseEvidence(audit(pulseRow(0, false), pulseRow(2, false, 0.5),
      pulseRow(8, true, 0.5), pulseRow(9, false, -0.5), pulseRow(12, false, 1)), action).status, 'pass');
  });

  test(`${action}: no pulse is pending, not a pass`, () => {
    for (const entries of [[], [pulseRow(0, false), pulseRow(100, false, 0.5)]]) {
      const result = oneTickPulseEvidence(audit(...entries), action);
      assert.equal(result.status, 'pending');
      assert.deepEqual([result.startTick, result.endTick, result.durationTicks], [null, null, null]);
    }
  });
}

test('a pulse at tick zero has a complete baseline and can pass when closed at tick one', () => {
  const result = oneTickPulseEvidence(audit(row(0, true), row(1, false)), 'bomb');
  assert.equal(result.status, 'pass');
  assert.deepEqual([result.startTick, result.endTick, result.durationTicks], [0, 1, 1]);
});

test('missing, malformed, or dropped audit evidence never passes', () => {
  const valid = audit(row(0, false), row(8, true), row(9, false));
  for (const value of [undefined, null, false, [], {}, { entries: valid.entries },
    ...[undefined, null, '0', false, 1, -1, NaN, Infinity].map(dropped => ({ ...valid, dropped })),
    { dropped: 0 }, { dropped: 0, entries: null }, { dropped: 0, entries: {} }]) {
    assert.equal(oneTickPulseEvidence(value, 'bomb').status, 'fail');
  }
});

test('ticks must be ordered, unique, safe nonnegative integers from the start of the run', () => {
  for (const entries of [
    [row(4, false), row(8, true), row(9, false)],
    [row(0, false), row(8, true), row(8, false)],
    [row(0, false), row(8, true), row(7, false)],
    [row(0, false), row(8, true), row(9, false), row(8, false)],
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '9', null, undefined]
      .map(tick => [row(0, false), row(8, true), { tick, input: { bomb: false } }]),
    [row(0, false), row(8, true), row(9, false), null],
  ]) {
    assert.equal(oneTickPulseEvidence({ dropped: 0, entries }, 'bomb').status, 'fail');
  }
});

test('every row must carry an explicit boolean, including before and after a valid interval', () => {
  for (const input of [null, [], {}, { loop: false }, { bomb: 0 }, { bomb: 1 },
    { bomb: 'false' }, { bomb: 'true' }, { bomb: null }, Object.create({ bomb: false })]) {
    for (const entries of [
      [{ tick: 0, input }, row(8, true), row(9, false)],
      [row(0, false), row(8, true), { tick: 9, input }],
      [row(0, false), row(8, true), row(9, false), { tick: 10, input }],
    ]) assert.equal(oneTickPulseEvidence({ dropped: 0, entries }, 'bomb').status, 'fail');
  }
});

test('checking one action does not treat another action as its pulse or closing boundary', () => {
  const evidence = audit(row(0, false), row(8, true), row(9, false), row(12, false, true), row(13, false, false));
  assert.equal(oneTickPulseEvidence(evidence, 'bomb').status, 'pass');
  assert.equal(oneTickPulseEvidence(evidence, 'loop').status, 'pass');
  assert.equal(oneTickPulseEvidence(audit(row(0, false), row(8, true), row(9, true, true), row(10, false)), 'bomb').durationTicks, 2);
});

test('valid, pending, failing, and unsorted frozen evidence is never mutated', () => {
  for (const entries of [
    [row(0, false), row(8, true), row(9, false)],
    [row(0, false), row(8, true)],
    [row(0, false), row(8, true), row(10, false)],
    [row(0, false), row(9, false), row(8, true)],
  ]) {
    for (const entry of entries) { Object.freeze(entry.input); Object.freeze(entry); }
    const evidence = Object.freeze({ dropped: 0, entries: Object.freeze(entries) });
    const before = JSON.stringify(evidence);
    const first = oneTickPulseEvidence(evidence, 'bomb');
    assert.deepEqual(oneTickPulseEvidence(evidence, 'bomb'), first);
    assert.equal(JSON.stringify(evidence), before);
  }
});
