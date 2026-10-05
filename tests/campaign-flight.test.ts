import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { Campaign } from '../src/campaign';
import { CampaignFlightController } from '../src/campaign-flight';
import { createGame, startGame, stepGame } from '../src/simulation';
import { updateQuaternion } from '../src/flight';
import { makeAircraft } from '../src/mission';
import type { FlightInput, GameMode } from '../src/types';

const neutral: FlightInput = { turn: 0, climb: 0, fire: false, loop: false, viewAspect: 1, steeringRevision: 0 };

for (const mode of ['normal', 'easy'] as const) {
  test(`campaign adapter retains pinned K flight through throttle, loop and manual abort in ${mode}`, () => {
    const campaign = new Campaign(mode), adapter = new CampaignFlightController(campaign.state);
    const baseline = createGame(20261005, mode);
    baseline.player.position.set(0, 300, 0); baseline.player.previous.copy(baseline.player.position);
    baseline.player.yaw = -Math.PI / 2; baseline.player.pitch = 0; baseline.player.bank = 0; updateQuaternion(baseline.player);
    baseline.allies = []; baseline.ships = [];
    baseline.enemies = [makeAircraft(9999, 'enemy', new Vector3(100000, 300, 100000))];
    // A distant enemy preserves K's off-screen response while remaining irrelevant to this flight fixture.
    const enemy = campaign.state.actors.find(actor => actor.team === 'enemy' && actor.kind === 'turret')!;
    enemy.position = { x: 100000, y: 300, z: 100000 }; enemy.previous = { ...enemy.position };
    campaign.state.actors = [enemy];
    startGame(baseline);
    for (let tick = 0; tick < 240; tick++) {
      const input: FlightInput = {
        ...neutral, turn: tick < 60 ? .4 : tick >= 150 && tick < 180 ? -.6 : 0,
        climb: tick < 60 ? .1 : 0, accelerate: tick < 60, brake: tick >= 60 && tick < 120,
        loop: tick === 120, steeringRevision: tick >= 150 ? 1 : 0,
      };
      stepGame(baseline, input);
      campaign.step(adapter.step(campaign.state, input)); adapter.sync(campaign.state);
      assert.equal(campaign.state.status, 'running');
      for (const field of ['yaw', 'pitch', 'bank', 'speed', 'loopProgress', 'loopCooldown'] as const) {
        assert.ok(Math.abs(adapter.player[field] - baseline.player[field]) < 1e-8, `${field} at tick ${tick}`);
      }
      assert.ok(adapter.player.position.distanceTo(baseline.player.position) < 1e-7, `position at tick ${tick}`);
    }
  });
}

test('the plain campaign input preserves distinct K barrel origins, forward direction and swept orientation', () => {
  const campaign = new Campaign('normal'), adapter = new CampaignFlightController(campaign.state);
  const originalQuaternion = adapter.player.quaternion.clone();
  const output = adapter.step(campaign.state, { ...neutral, turn: .5, climb: .2, fire: true });
  assert.equal(output.fire, true);
  assert.equal(output.gunMuzzles?.mg.length, 2); assert.equal(output.gunMuzzles?.cannon.length, 2);
  const inverse = adapter.player.quaternion.clone().invert();
  for (const [kind, expected] of [['mg', [[-.3, .52, -4.25], [.3, .52, -4.25]]], ['cannon', [[-2.5, 0, -2.4], [2.5, 0, -2.4]]]] as const) {
    for (let barrel = 0; barrel < 2; barrel++) {
      const origin = output.gunMuzzles![kind][barrel];
      const local = new Vector3(origin.x, origin.y, origin.z).sub(adapter.player.position).applyQuaternion(inverse);
      assert.ok(local.distanceTo(new Vector3(...expected[barrel])) < 1e-8);
    }
  }
  assert.deepEqual(output.previousQuaternion, { x: originalQuaternion.x, y: originalQuaternion.y, z: originalQuaternion.z, w: originalQuaternion.w });
  assert.ok(output.playerQuaternion);
  assert.ok(Math.abs(Object.values(output.playerQuaternion).reduce((sum, value) => sum + value * value, 0) - 1) < 1e-8);
});

test('Easy fires only through the inherited camera firing gate and Normal respects manual fire', () => {
  function prepare(mode: GameMode, position: Vector3) {
    const campaign = new Campaign(mode), adapter = new CampaignFlightController(campaign.state);
    const dragon = campaign.state.actors.find(actor => actor.kind === 'dragon')!;
    dragon.position = { x: position.x, y: position.y, z: position.z }; dragon.previous = { ...dragon.position };
    campaign.state.actors = [dragon];
    return { campaign, adapter };
  }
  const aligned = prepare('easy', new Vector3(500, 300, 0));
  assert.equal(aligned.adapter.step(aligned.campaign.state, neutral).fire, true);
  const behind = prepare('easy', new Vector3(-500, 300, 0));
  assert.equal(behind.adapter.step(behind.campaign.state, { ...neutral, fire: true }).fire, false);
  const distant = prepare('easy', new Vector3(1300, 300, 0));
  assert.equal(distant.adapter.step(distant.campaign.state, neutral).fire, false);
  const normal = prepare('normal', new Vector3(500, 300, 0));
  assert.equal(normal.adapter.step(normal.campaign.state, neutral).fire, false);
  assert.equal(normal.adapter.step(normal.campaign.state, { ...neutral, fire: true }).fire, true);
});

test('respawn synchronization restores the chosen authoritative pose and K flight controller', () => {
  const campaign = new Campaign('normal'), adapter = new CampaignFlightController(campaign.state);
  campaign.step({ playerPosition: { x: 0, y: 0, z: 0 } });
  adapter.sync(campaign.state);
  assert.equal(campaign.state.status, 'respawning');
  assert.equal(adapter.player.health, 0);
  const frozen = campaign.state.simTick;
  campaign.step({ fire: true, bomb: true }); assert.equal(campaign.state.simTick, frozen);
  campaign.resumeRespawn(); adapter.sync(campaign.state, true); adapter.clearPending();
  assert.equal(adapter.player.health, 100); assert.equal(adapter.player.bombs, 2);
  assert.equal(adapter.player.loopProgress, 0); assert.equal(adapter.player.loopCooldown, 0);
  assert.deepEqual(adapter.player.position.toArray(), Object.values(campaign.state.player.position));
  assert.equal(campaign.state.player.protectionTicks, 120);
});
