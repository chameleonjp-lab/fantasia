import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { Campaign, makeCampaignActor } from '../src/campaign';
import { CampaignFlightController } from '../src/campaign-flight';
import { FLIGHT_FOV, getFlightCameraPose } from '../src/flight-view';
import type { ActorClass, CampaignTeam } from '../src/campaign-types';
import type { FlightInput } from '../src/types';

const neutral: FlightInput = { turn: 0, climb: 0, fire: false, loop: false, viewAspect: 1, steeringRevision: 0 };

function targetPosition(adapter: CampaignFlightController, x: number, y: number, depth: number): Vector3 {
  const cameraPosition = new Vector3(), cameraRotation = new Quaternion();
  getFlightCameraPose(adapter.player, 'easy', cameraPosition, cameraRotation);
  const tan = Math.tan(FLIGHT_FOV * Math.PI / 360);
  return new Vector3(x * depth * tan, y * depth * tan, -depth).applyQuaternion(cameraRotation).add(cameraPosition);
}

function fixture(actorClass?: ActorClass, screenX = 0, screenY = 0, depth = 500, team: CampaignTeam = 'enemy') {
  const campaign = new Campaign('easy');
  campaign.state.actors = [];
  const adapter = new CampaignFlightController(campaign.state);
  if (!actorClass) return { campaign, adapter, actor: null };
  const actor = makeCampaignActor(900, team, actorClass, 0, team === 'friendly' ? 0 : null,
    { x: 0, y: 0, z: 0 });
  const position = targetPosition(adapter, screenX, screenY, depth);
  actor.position = { x: position.x, y: position.y, z: position.z };
  actor.previous = { ...actor.position };
  actor.velocity = { x: 0, y: 0, z: 8 };
  campaign.state.actors = [actor];
  return { campaign, adapter, actor };
}

function assistance(adapter: CampaignFlightController) {
  return (adapter as unknown as { flight: { assistTurn: number; assistClimb: number } }).flight;
}

test('visible moving enemy soldiers and dragons stay selectable without steering pull, including small manual input', () => {
  for (const actorClass of ['sword', 'bow', 'mage', 'cavalry', 'dragon'] as const) {
    for (const controls of [neutral, { ...neutral, turn: .1, climb: .05 }]) {
      const expected = fixture();
      const actual = fixture(actorClass, .8, .15, 400);
      const expectedInput = expected.adapter.step(expected.campaign.state, controls);
      const actualInput = actual.adapter.step(actual.campaign.state, controls);
      assert.equal(actual.adapter.selectedTargetId, actual.actor!.id, `${actorClass} retains the shared target lock`);
      assert.equal(assistance(actual.adapter).assistTurn, 0, `${actorClass} does not pull turn`);
      assert.equal(assistance(actual.adapter).assistClimb, 0, `${actorClass} does not pull climb`);
      assert.deepEqual(actualInput.playerQuaternion, expectedInput.playerQuaternion, `${actorClass} leaves the camera trajectory alone`);
      assert.deepEqual(actualInput.playerPosition, expectedInput.playerPosition, `${actorClass} leaves the aircraft trajectory alone`);
    }
  }
});

test('friendly NPCs never become camera-assist targets', () => {
  const expected = fixture(), actual = fixture('sword', .8, .15, 400, 'friendly');
  const expectedInput = expected.adapter.step(expected.campaign.state, neutral);
  const actualInput = actual.adapter.step(actual.campaign.state, neutral);
  assert.equal(actual.adapter.selectedTargetId, null);
  assert.deepEqual(actualInput.playerQuaternion, expectedInput.playerQuaternion);
  assert.deepEqual(actualInput.playerPosition, expectedInput.playerPosition);
});

test('Easy automatic fire and moving-target shot correction remain active for enemy NPCs', () => {
  for (const actorClass of ['sword', 'bow', 'mage', 'cavalry', 'dragon'] as const) {
    const actual = fixture(actorClass, 0, 0, 450);
    const output = actual.adapter.step(actual.campaign.state, neutral);
    assert.equal(actual.adapter.selectedTargetId, actual.actor!.id, `${actorClass} remains selected`);
    assert.equal(output.fire, true, `${actorClass} remains eligible for Easy automatic fire`);
    const forward = new Vector3(0, 0, -1).applyQuaternion(actual.adapter.player.quaternion);
    const corrected = new Vector3(...Object.values(output.shotDirections!.mg[0]) as [number, number, number]);
    assert.ok(corrected.angleTo(forward) > 1e-7, `${actorClass} retains moving-target shot correction`);
  }
});

test('fixed turrets retain their gentle camera pull', () => {
  const actual = fixture('turret', .8, 0, 400);
  const output = actual.adapter.step(actual.campaign.state, neutral);
  assert.equal(actual.adapter.selectedTargetId, actual.actor!.id);
  assert.equal(output.fire, false, 'an off-circle target does not pass the firing gate');
  assert.ok(Math.abs(assistance(actual.adapter).assistTurn) > 0, 'a turret still contributes camera steering');
});
