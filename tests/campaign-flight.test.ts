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

import { Frustum, Matrix4, Object3D, PerspectiveCamera, Quaternion } from 'three';
import { CampaignScene } from '../src/campaign-scene';
import { FLIGHT_FOV, getFlightCameraPose, projectFlightTarget } from '../src/flight-view';
import { projectGunSight } from '../src/gun-sight';

function opticalAxis(player: CampaignFlightController['player'], mode: GameMode) {
  const position = new Vector3(), rotation = new Quaternion();
  getFlightCameraPose(player, mode, position, rotation);
  return new Vector3(0, 0, -1).applyQuaternion(rotation).normalize();
}
const angle = (a: Vector3, b: Vector3) => Math.atan2(new Vector3().crossVectors(a, b).length(), a.dot(b));

test('campaign adapter forwards the camera mode and only multiplies off-screen horizontal response', () => {
  for (const mode of ['easy', 'normal'] as const) for (const pitch of [-.9, 0, .9]) for (const axis of ['turn', 'climb'] as const)
    for (const distant of [false, true]) {
      const campaign = new Campaign(mode), adapter = new CampaignFlightController(campaign.state);
      campaign.state.actors = distant ? campaign.state.actors.filter(actor => actor.kind === 'turret').slice(0, 1) : [];
      for (const actor of campaign.state.actors) { actor.position = { x: 100000, y: 2400, z: 100000 }; actor.previous = { ...actor.position }; }
      adapter.player.position.set(0, 2400, 0); adapter.player.pitch = pitch; adapter.player.bank = .72; updateQuaternion(adapter.player);
      const before = opticalAxis(adapter.player, mode);
      adapter.step(campaign.state, { ...neutral, [axis]: .6, steeringActive: true });
      const actual = angle(before, opticalAxis(adapter.player, mode));
      const expected = .82 / 60 * .6 * (axis === 'turn' && distant ? 1 + 2.5 / 60 : 1);
      assert.ok(Math.abs(actual - expected) <= 1e-12, JSON.stringify({ mode, pitch, axis, distant, actual, expected }));
    }
});

test('actual CampaignScene render uses the bank-independent optical axis and the same target and bore projection', () => {
  // Exercise the real render method and PerspectiveCamera; avoid constructing a
  // WebGL context in this numeric test. Native GPU execution is a separate gate.
  for (const mode of ['easy', 'normal'] as const) for (const pitch of [-Math.PI, -Math.PI / 2, -.9, 0, .9, Math.PI / 2, Math.PI])
    for (const bank of [-.72, 0, .72]) for (const [width, height] of [[393, 852], [393, 648], [568, 320], [852, 393], [1280, 720]]) {
      const campaign = new Campaign(mode), adapter = new CampaignFlightController(campaign.state), player = adapter.player;
      player.position.set(0, 2400, 0); player.pitch = pitch; player.bank = bank; player.yaw = 3.14; updateQuaternion(player);
      const camera = new PerspectiveCamera(FLIGHT_FOV, width / height, .5, 22000);
      let rendered: PerspectiveCamera | undefined;
      const scene = Object.assign(Object.create(CampaignScene.prototype), {
        disposed: false, runId: campaign.state.runId, lastTick: 0, visualTime: 0, prepared: false,
        pollRender: () => 'ready', hero: { root: new Object3D(), propeller: new Object3D(), ailerons: [new Object3D(), new Object3D()], elevator: new Object3D() },
        camera, sky: new Object3D(), groundView: new Frustum(), viewProjection: new Matrix4(), scene: {},
        updateActors() {}, updateProjectiles() {}, updateTelegraphs() {}, updateEffects() {}, drawOverlay() {},
        renderer: { render(_scene: unknown, actual: PerspectiveCamera) { rendered = actual; } },
      });
      assert.equal(scene.render(campaign.state, player, mode), true); assert.equal(rendered, camera);
      const position = new Vector3(0, 11, 29).applyQuaternion(player.quaternion.clone().multiply(
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), bank * .55))).add(player.position);
      assert.equal(camera.position.distanceTo(position), 0, 'old offset bytes remain identical');
      const unbanked = player.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), bank));
      const expectedForward = new Vector3(0, 0, -1).applyQuaternion(unbanked.multiply(
        new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), mode === 'easy' ? -Math.atan2(11, 479) : -.19)));
      assert.ok(angle(camera.getWorldDirection(new Vector3()), expectedForward) <= 1e-12, 'bank is optical-axis roll only');
      const bore = new Vector3(0, 0, -504.5).applyQuaternion(player.quaternion).add(player.position);
      const actual = bore.clone().project(camera), projected = projectFlightTarget(player, bore, width / height, mode);
      assert.ok(Math.abs(actual.x - projected.x) <= 1e-12); assert.ok(Math.abs(actual.y - projected.y) <= 1e-12);
      if (mode === 'normal') {
        const sight = projectGunSight(player, [], width, height);
        assert.ok(Math.abs(sight.x - (.5 + .5 * actual.x) * width) <= 1e-9);
        assert.ok(Math.abs(sight.y - (.5 - .5 * actual.y) * height) <= 1e-9);
      }
      // Simulate an authoritative collision/interpolation quaternion that differs
      // from the scalar pitch/yaw. The real render path must use that quaternion.
      player.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .17));
      const beforeCorrection = camera.getWorldDirection(new Vector3()); scene.render(campaign.state, player, mode);
      const correctedForward = beforeCorrection.clone().applyAxisAngle(new Vector3(0, 1, 0), .17);
      assert.ok(angle(correctedForward, camera.getWorldDirection(new Vector3())) <= 1e-12, 'render follows the authoritative quaternion correction');
    }
});


test('campaign turret acquisition starts absolute pitch from current pose', () => {
  for (const pitch of [-.05, .05]) {
    const campaign = new Campaign('easy'), adapter = new CampaignFlightController(campaign.state);
    adapter.player.position.set(0, 2400, 0); adapter.player.pitch = pitch; adapter.player.yaw = 0; updateQuaternion(adapter.player);
    const position = new Vector3(), rotation = new Quaternion();
    getFlightCameraPose(adapter.player, 'easy', position, rotation);
    const point = new Vector3(0, Math.sign(pitch)*.6*500*Math.tan(FLIGHT_FOV*Math.PI/360), -500).applyQuaternion(rotation).add(position);
    const turret = campaign.state.actors.find(a => a.team === 'enemy' && a.kind === 'turret')!;
    turret.position = {x:point.x,y:point.y,z:point.z}; turret.previous = {...turret.position};
    campaign.state.actors = [turret];
    adapter.step(campaign.state, neutral);
    assert.ok((adapter.player.pitch - pitch)*pitch > 0, 'must approach the turret without a horizontal dip');
    const before = adapter.player.pitch;
    adapter.step(campaign.state, {...neutral, turn:.1});
    assert.ok(Math.abs(adapter.player.pitch-before) < .0005, 'turn-only optional steering must not reuse absolute history');
  }
});
