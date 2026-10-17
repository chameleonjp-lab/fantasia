import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Vector3 } from 'three';
import { advanceThrottle, createFlightController, MAX_SPEED, STALL_SPEED, updateAircraftMotion, updatePlayerLoop } from '../src/flight';
import { makeAircraft } from '../src/mission';

const neutral = { turn: 0, climb: 0, fire: false, loop: false };
const dt = 1 / 60;
/** Independent reference equations transcribed from source 025cad49 updateAircraftMotion. */
function referenceStep(p: { pitch: number; yaw: number; bank: number; speed: number; position: Vector3 }, turn: number, climb: number, trim: number): void {
  const limit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const authority = (p.speed <= 85 ? .92 + ((p.speed - 65) / 20) * .23 : p.speed <= 110 ? 1.15 - ((p.speed - 85) / 25) * .15 : 1)
    * limit(1 - Math.max(0, p.speed - 115) * .008, .78, 1);
  p.pitch += (climb * .95 - p.pitch) * (1 - Math.exp(-dt * 4.2));
  p.yaw = ((p.yaw - turn * .82 * authority * dt + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  p.bank += (turn * .72 - p.bank) * (1 - Math.exp(-dt * 5.5));
  p.speed = limit(p.speed + ((trim - p.speed) * .72 - Math.abs(turn) * 2.7 - Math.max(0, climb) * 2.1 - Math.sin(p.pitch) * 2.6) * dt, 65, 141);
  p.position.addScaledVector(new Vector3(0, 0, -1).applyEuler(new Euler(p.pitch, p.yaw, -p.bank, 'YXZ')), p.speed * dt);
}

test('source motion parity across slow/cruise/fast throttle and changing stick traces', () => {
  for (const speed of [65, 85, 110, 141]) {
    const actual = makeAircraft(1, 'friendly', new Vector3(0, 2400, 0), 0, 'player'); actual.speed = speed;
    const expected = { pitch: 0, yaw: 0, bank: 0, speed, position: actual.position.clone() };
    for (let tick = 0; tick < 600; tick++) {
      const turn = Math.sin(tick / 73) * .8, climb = Math.cos(tick / 110) * .6, preferred = tick < 300 ? 141 : 65;
      updateAircraftMotion(actual, turn, climb, dt, preferred, false, 141, .95); referenceStep(expected, turn, climb, preferred);
    }
    assert.ok(actual.position.distanceTo(expected.position) < 1e-8);
    for (const key of ['pitch', 'yaw', 'bank', 'speed'] as const) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-10, key);
  }
});

test('five second source loop restores heading and pitch then has two second cooldown', () => {
  const plane = makeAircraft(1, 'friendly', new Vector3(0, 800, 0), .3, 'player'); plane.pitch = .12;
  const control = createFlightController(plane); let completed = 0;
  for (let i = 0; i < 300; i++) completed += Number(updatePlayerLoop(plane, control, neutral, neutral, i === 0, dt, 110, 141, 1));
  assert.equal(completed, 1); assert.equal(plane.loopProgress, 0); assert.equal(plane.loopCooldown, 2);
  assert.equal(plane.yaw, .3); assert.equal(plane.pitch, .12); assert.ok(plane.position.toArray().every(Number.isFinite));
  updatePlayerLoop(plane, control, neutral, neutral, true, dt, 110, 141, 1); assert.equal(plane.loopProgress, 0);
});

test('intent revision cancels a loop smoothly and throttle retains source mode semantics', () => {
  const plane = makeAircraft(1, 'friendly', new Vector3(0, 800, 0), 0, 'player'); const control = createFlightController(plane);
  const input = { ...neutral, steeringRevision: 1 };
  for (let i = 0; i < 90; i++) updatePlayerLoop(plane, control, input, input, i === 0, dt, 110, 141, 1);
  const before = plane.position.clone();
  const steering = { ...neutral, turn: .5, steeringRevision: 2 };
  updatePlayerLoop(plane, control, steering, steering, false, dt, 110, 141, 1);
  assert.equal(plane.loopProgress, 0); assert.equal(plane.loopCooldown, 2); assert.ok(plane.position.distanceTo(before) < 3);
  for (let i = 0; i < 600; i++) advanceThrottle(control, { ...neutral, accelerate: true }, 'easy', dt);
  assert.equal(control.playerTargetSpeed, 110);
  for (let i = 0; i < 600; i++) advanceThrottle(control, { ...neutral, accelerate: true }, 'normal', dt);
  assert.equal(control.playerTargetSpeed, MAX_SPEED);
  for (let i = 0; i < 600; i++) advanceThrottle(control, { ...neutral, brake: true }, 'normal', dt);
  assert.equal(control.playerTargetSpeed, STALL_SPEED);
});

// Camera contract: measure the complete before/after optical-axis angle. No
// neutral-baseline subtraction can hide pitch movement during a horizontal turn.
import { Quaternion } from 'three';
import { updateQuaternion } from '../src/flight';
import { getFlightCameraPose } from '../src/flight-view';
import type { Aircraft, FlightInput, GameMode } from '../src/types';
const cameraAngle = (a: Vector3, b: Vector3) => Math.atan2(new Vector3().crossVectors(a, b).length(), a.dot(b));
function cameraPose(plane: Aircraft, mode: GameMode) {
  const position = new Vector3(), rotation = new Quaternion();
  getFlightCameraPose(plane, mode, position, rotation);
  return { position, rotation, forward: new Vector3(0, 0, -1).applyQuaternion(rotation).normalize() };
}
function cameraPlane(pitch = 0, bank = 0, yaw = 0, speed = 110) {
  const plane = makeAircraft(1, 'friendly', new Vector3(0, 2400, 0), yaw, 'player');
  Object.assign(plane, { pitch, bank, speed }); updateQuaternion(plane); return plane;
}
const steeringAuthority = (speed: number) => (speed <= 85 ? .92 + (speed - 65) / 20 * .23
  : speed <= 110 ? 1.15 - (speed - 85) / 25 * .15 : 1) * Math.max(.78, Math.min(1, 1 - Math.max(0, speed - 115) * .008));
function manualStep(plane: Aircraft, input: FlightInput, mode: GameMode, response = 1) {
  updatePlayerLoop(plane, createFlightController(plane), input, input, false, dt, 110, 141, response, mode);
}

test('camera total-angle contract matches manual rates for every axis, mode, speed and attitude', () => {
  for (const mode of ['easy', 'normal'] as const) for (const speed of [65, 85, 110, 141])
    for (const pitch of [-.9, 0, .9]) for (const bank of [-.72, 0, .72]) for (const yaw of [-3.14, 0, 3.14])
      for (let direction = 0; direction < 8; direction++) for (const strength of [.25, .45, .6]) {
        const theta = direction * Math.PI / 4;
        const input = { ...neutral, turn: Math.cos(theta) * strength, climb: Math.sin(theta) * strength, steeringActive: true };
        const plane = cameraPlane(pitch, bank, yaw, speed), before = cameraPose(plane, mode).forward;
        manualStep(plane, input, mode);
        const actual = cameraAngle(before, cameraPose(plane, mode).forward), expected = .82 * steeringAuthority(speed) * dt * strength;
        assert.ok(Math.abs(actual - expected) <= 1e-12, JSON.stringify({ mode, speed, pitch, bank, yaw, direction, strength, actual, expected }));
        if (Math.abs(input.climb) < 1e-8) assert.equal(plane.pitch, pitch, 'horizontal steering retains pitch');
      }
});

test('manual diagonal budget, reversal, pitch limit, neutral recovery and horizontal-only response stay bounded', () => {
  for (const mode of ['easy', 'normal'] as const) for (const speed of [65, 85, 110, 141]) for (const pitch of [-.9, 0, .9]) {
    const step = .82 * steeringAuthority(speed) * dt;
    for (const sign of [-1, 1]) {
      const diagonal = cameraPlane(pitch, .72, 3.14, speed), before = cameraPose(diagonal, mode).forward;
      manualStep(diagonal, { ...neutral, turn: sign, climb: sign, steeringActive: true }, mode);
      assert.ok(Math.abs(cameraAngle(before, cameraPose(diagonal, mode).forward) - step) <= 1e-12);
      for (const axis of ['turn', 'climb'] as const) {
        const angles = [1, 1.65].map(response => {
          const plane = cameraPlane(pitch, 0, 0, speed), start = cameraPose(plane, mode).forward;
          manualStep(plane, { ...neutral, [axis]: sign * .6, steeringActive: true }, mode, response);
          return cameraAngle(start, cameraPose(plane, mode).forward);
        });
        assert.ok(Math.abs(angles[1] / angles[0] - (axis === 'turn' ? 1.65 : 1)) <= 1e-12);
      }
      const limit = cameraPlane(sign * .949, 0, 0, speed);
      manualStep(limit, { ...neutral, climb: sign, steeringActive: true }, mode);
      assert.equal(limit.pitch, sign * .95);
      const atLimit = limit.pitch, reverseStep = .82 * steeringAuthority(limit.speed) * dt;
      manualStep(limit, { ...neutral, climb: -sign, steeringActive: true }, mode);
      assert.ok(Math.abs(limit.pitch - (atLimit - sign * reverseStep)) <= 1e-12);
    }
    for (const steeringActive of [false, true]) {
      const plane = cameraPlane(pitch, 0, 0, speed);
      manualStep(plane, { ...neutral, steeringActive }, mode);
      assert.ok(Math.abs(plane.pitch - pitch) <= step + 1e-12);
      assert.ok(Math.abs(plane.pitch) <= Math.abs(pitch));
    }
  }
});

test('automatic absolute pitch stays legacy while manual ownership and neutral use rate semantics', () => {
  const adjusted = { ...neutral, turn: .2, climb: .6 };
  for (const mode of ['easy', 'normal'] as const) {
    const automatic = cameraPlane(.4), expected = cameraPlane(.4);
    updatePlayerLoop(automatic, createFlightController(automatic), adjusted, neutral, false, dt, 110, 141, 1.65, mode);
    updateAircraftMotion(expected, adjusted.turn, adjusted.climb, dt, 110, false, 141, .95, 1.65);
    assert.deepEqual(automatic, expected);
    const held = cameraPlane(.4);
    updatePlayerLoop(held, createFlightController(held), neutral, { ...neutral, steeringActive: true }, false, dt, 110, 141, 1, mode);
    assert.ok(Math.abs(held.pitch - .4) <= .82 * dt + 1e-12);
  }
});

test('loop aborts keep the continuous camera branch across vertical and bound recovery pitch', () => {
  for (const mode of ['easy', 'normal'] as const) for (const startPitch of [-.95, 0, .95])
    for (const ticks of [1, 25, 50, 75, 90, 100, 125, 150, 175, 200, 225, 250, 275, 299])
      for (const turn of [-1, 0, 1]) for (const climb of [-1, 0, 1]) {
        const plane = cameraPlane(startPitch), control = createFlightController(plane), original = { ...neutral, steeringRevision: 1 };
        for (let i = 0; i < ticks; i++) updatePlayerLoop(plane, control, original, original, i === 0, dt, 110, 141, 1, mode);
        const before = cameraPose(plane, mode), previousPitch = plane.pitch;
        const input = { ...neutral, turn, climb, steeringActive: true, steeringRevision: 2 };
        updatePlayerLoop(plane, control, input, input, false, dt, 110, 141, 1, mode);
        assert.equal(plane.loopProgress, 0); assert.equal(control.playerLoopActive, false);
        assert.ok(before.rotation.angleTo(cameraPose(plane, mode).rotation) < .1, `${mode} ${startPitch} ${ticks} ${turn} ${climb}`);
        assert.ok(Math.abs(Math.atan2(Math.sin(plane.pitch - previousPitch), Math.cos(plane.pitch - previousPitch))) < .016);
      }
});
