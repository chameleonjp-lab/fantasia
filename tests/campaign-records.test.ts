import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { CAMPAIGN_RECORDS_KEY, CampaignRecords } from '../src/campaign-records';
import { SUSPENDED_CAMPAIGN_RULES_VERSION } from '../src/campaign-config';
import type { CampaignResult } from '../src/campaign-types';
import { getFlightAssist } from '../src/flight-assist';
import { makeAircraft } from '../src/mission';

function result(overrides: Partial<CampaignResult> = {}): CampaignResult {
  return {
    status: 'victory', reason: 'all-sites', activeTicks: 1000, respawnPenaltyTicks: 600,
    recordTicks: 1600, capturedSites: 7, livesRemaining: 2, score: 20000,
    breakdown: { capture: 7000, turrets: 2100, success: 5000, speed: 11740, friendlyDamage: 0, friendlyKills: 0, selfLoss: -500, total: 25340 },
    friendlyLosses: 0, enemyKills: 0, selfLosses: 1,
    mode: 'easy', seed: 20261005, rulesVersion: 'fantasia-capture-v1', mapVersion: 'fantasia-sevenfold-v1', startHeading: 0,
    ...overrides,
  };
}
class MemoryStorage {
  values = new Map<string, string>(); writes = 0;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes++; this.values.set(key, value); }
}

test('records prefer integer time, then score, and separate every comparison dimension', () => {
  const storage = new MemoryStorage(), records = new CampaignRecords(storage), base = result();
  assert.equal(records.save(base, 2), 'saved');
  assert.equal(records.save(result({ score: 25000, recordTicks: 1601, activeTicks: 1001 }), 0), 'unchanged');
  assert.equal(records.save(result({ score: 21000 }), 1), 'saved');
  assert.equal(records.best(base)?.score, 21000);
  assert.equal(records.best(base)?.pauseCount, 1);
  for (const change of [{ mode: 'normal' as const }, { rulesVersion: 'v2' }, { mapVersion: 'v2' }, { seed: 1 }, { startHeading: 1 }]) {
    const alternate = result(change);
    assert.equal(records.best(alternate), null);
    assert.equal(records.save(alternate, 0), 'saved');
  }
  assert.equal(storage.values.size, 1);
  assert.ok(storage.values.has(CAMPAIGN_RECORDS_KEY));
  assert.equal(JSON.parse(storage.values.get(CAMPAIGN_RECORDS_KEY)!).records.length, 6);
  assert.equal(records.best(base)?.score, 21000);
});

test('defeat, performance interruption and invalid result cannot enter best records', () => {
  const storage = new MemoryStorage(), records = new CampaignRecords(storage);
  for (const invalid of [result({ status: 'defeat' }), result({ recordTicks: Number.NaN }), result({ recordTicks: 0 }), result({ score: 26101 }), result({ startHeading: 0.5 })]) {
    assert.equal(records.save(invalid, 0), 'ineligible');
  }
  assert.equal(records.save(result(), 0, true), 'ineligible');
  assert.equal(records.useSessionOnly(result(), 0, true), 'ineligible');
  assert.equal(storage.writes, 0);
});

test('future or malformed records remain untouched including a version written by another tab', () => {
  const storage = new MemoryStorage(), records = new CampaignRecords(storage);
  assert.equal(records.save(result(), 0), 'saved');
  const future = '{"version":2,"records":[],"futureField":true}';
  storage.values.set(CAMPAIGN_RECORDS_KEY, future);
  assert.equal(records.save(result({ activeTicks: 900, recordTicks: 1500 }), 0), 'future-version');
  assert.equal(storage.values.get(CAMPAIGN_RECORDS_KEY), future);
  storage.values.set(CAMPAIGN_RECORDS_KEY, '{broken');
  assert.equal(records.save(result(), 0), 'unavailable');
  assert.equal(storage.values.get(CAMPAIGN_RECORDS_KEY), '{broken');
  assert.equal(storage.writes, 1);
});

test('temporary dragon-fireball suspension writes no best and preserves every existing record byte', () => {
  const storage = new MemoryStorage(), records = new CampaignRecords(storage), original = result();
  assert.equal(records.save(original, 1), 'saved');
  const before = storage.values.get(CAMPAIGN_RECORDS_KEY), writes = storage.writes;
  const temporary = result({ rulesVersion: SUSPENDED_CAMPAIGN_RULES_VERSION, activeTicks: 1, respawnPenaltyTicks: 0, recordTicks: 1 });
  assert.equal(records.save(temporary, 0), 'ineligible');
  assert.equal(records.useSessionOnly(temporary, 0), 'ineligible');
  assert.equal(storage.writes, writes);
  assert.equal(storage.values.get(CAMPAIGN_RECORDS_KEY), before);
  assert.equal(records.best(temporary), null);
  assert.equal(records.best(original)?.recordTicks, original.recordTicks);
  for (const prior of ['{"version":2,"records":[],"futureField":true}', '{broken']) {
    storage.values.set(CAMPAIGN_RECORDS_KEY, prior);
    assert.equal(records.save(temporary, 0), 'ineligible');
    assert.equal(records.useSessionOnly(temporary, 0), 'ineligible');
    assert.equal(storage.values.get(CAMPAIGN_RECORDS_KEY), prior);
    assert.equal(storage.writes, writes);
  }
});

test('denied storage keeps play possible and session saving requires an explicit choice', () => {
  const records = new CampaignRecords({
    getItem() { throw new Error('Storage denied'); },
    setItem() { throw new Error('Storage denied'); },
  });
  assert.equal(records.save(result(), 0), 'unavailable');
  assert.equal(records.best(result()), null);
  assert.equal(records.useSessionOnly(result(), 3), 'session-only');
  assert.equal(records.best(result())?.pauseCount, 3);
  const copy = records.best(result())!;
  copy.score = 0;
  assert.equal(records.best(result())?.score, 20000);
});

test('stationary campaign targets use a gentle pull while manual opposite steering wins', () => {
  const player = makeAircraft(1, 'friendly', new Vector3(0, 300, 0), 0, 'player');
  const target = makeAircraft(2, 'enemy', new Vector3(100, 300, -400));
  const input = { turn: 0, climb: 0, fire: false, loop: false, viewAspect: 1 };
  const air = getFlightAssist(player, [{ ...target, trackingStrength: 1 }], input, 'easy');
  const ground = getFlightAssist(player, [{ ...target, trackingStrength: .25 }], input, 'easy');
  assert.ok(air.turn > 0);
  assert.ok(Math.abs(ground.turn / air.turn - .25) < 1e-9);
  assert.equal(getFlightAssist(player, [{ ...target, trackingStrength: .25 }], { ...input, turn: -.2 }, 'easy').turn, -.2);
  assert.equal(getFlightAssist(player, [{ ...target, trackingStrength: .25 }], input, 'normal').turn, 0);
});
