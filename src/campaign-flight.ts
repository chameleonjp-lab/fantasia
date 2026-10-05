import { Euler, Quaternion, Vector3 } from 'three';
import { CAMPAIGN_DT } from './campaign-config';
import { distanceSquared } from './campaign-terrain';
import type { CampaignActor, CampaignInput, CampaignPlayer, CampaignState, Vec } from './campaign-types';
import { makeAircraft } from './mission';
import { advanceThrottle, clamp, createFlightController, CRUISE_SPEED, forwardOf, MAX_SPEED, updatePlayerLoop, updateQuaternion } from './flight';
import { applyEasyShotCorrection, autoFireTarget, getFlightAssist, predictedShotDirection } from './flight-assist';
import { FLIGHT_VISIBILITY_RANGE } from './flight-view';
import type { Aircraft, FlightInput } from './types';

function plain(vector: Vec): Vec { return { x: vector.x, y: vector.y, z: vector.z }; }
function plainQuaternion(q: Quaternion): CampaignPlayer['quaternion'] { return { x: q.x, y: q.y, z: q.z, w: q.w }; }

/** Exact pinned K flight/aim equations, connected to Fantasia's authoritative actor state. */
export class CampaignFlightController {
  readonly player: Aircraft;
  private flight;
  private readonly targets = new Map<number, Aircraft & { trackingStrength: number }>();
  lastLoopCompleted = false;
  constructor(state: CampaignState) {
    this.player = makeAircraft(state.player.id, 'friendly', new Vector3(0, 300, 0), -Math.PI / 2, 'player');
    this.player.health = 100; this.player.maxHealth = 100; this.player.torpedoes = 0;
    this.flight = createFlightController(this.player);
    this.sync(state, true);
  }
  clearPending() { this.flight.loopHeld = false; }
  sync(state: CampaignState, resetPose = false) {
    const player = this.player, authoritative = state.player;
    player.health = authoritative.hp; player.maxHealth = authoritative.maxHp;
    player.mg = authoritative.mg; player.cannon = authoritative.cannon; player.bombs = authoritative.bombs;
    player.reloadTicksRemaining = authoritative.reloadUntilTick === null ? 0 : Math.max(0, authoritative.reloadUntilTick - state.simTick);
    player.bombReloadTicks = authoritative.bombReloadUntilTick === null ? 0 : Math.max(0, authoritative.bombReloadUntilTick - state.simTick);
    if (resetPose) {
      player.position.set(authoritative.position.x, authoritative.position.y, authoritative.position.z); player.previous.copy(player.position);
      const q = authoritative.quaternion; player.quaternion.set(q.x, q.y, q.z, q.w);
      const attitude = new Euler().setFromQuaternion(player.quaternion, 'YXZ');
      player.pitch = attitude.x; player.yaw = attitude.y; player.bank = -attitude.z;
      player.speed = Math.hypot(authoritative.velocity.x, authoritative.velocity.y, authoritative.velocity.z) || CRUISE_SPEED;
      player.loopProgress = 0; player.loopCooldown = 0; player.age = 0;
      this.flight = createFlightController(player); this.lastLoopCompleted = false;
    }
  }
  private aimTargets(state: CampaignState) {
    const targets: (Aircraft & { trackingStrength: number })[] = [], live = new Set<number>();
    let distantFallback: CampaignActor | null = null;
    for (const actor of state.actors) {
      if (actor.hp <= 0 || actor.team !== 'enemy') continue;
      live.add(actor.id);
      if (distanceSquared(actor.position, this.player.position) > FLIGHT_VISIBILITY_RANGE ** 2) {
        distantFallback ??= actor;
        continue;
      }
      let target = this.targets.get(actor.id);
      if (!target) {
        // Ground objectives keep the inherited gentle stationary-target pull;
        // dragons retain airborne tracking. No sea-target aim-point offset is used.
        target = Object.assign(makeAircraft(actor.id, 'enemy', new Vector3()), { trackingStrength: actor.kind === 'dragon' ? 1 : .25 });
        this.targets.set(actor.id, target);
      }
      target.position.set(actor.position.x, actor.position.y, actor.position.z);
      target.trackingStrength = actor.kind === 'dragon' ? 1 : .25;
      target.health = actor.hp; target.maxHealth = actor.maxHp;
      target.speed = Math.hypot(actor.velocity.x, actor.velocity.y, actor.velocity.z);
      target.yaw = target.speed > 0 ? Math.atan2(-actor.velocity.x, -actor.velocity.z) : 0;
      target.pitch = target.speed > 0 ? Math.atan2(actor.velocity.y, Math.hypot(actor.velocity.x, actor.velocity.z)) : 0;
      target.bank = 0; updateQuaternion(target); targets.push(target);
    }
    // K increases turn response whenever enemies exist but none are visible.
    // One distant target preserves that condition without projecting every far actor.
    if (targets.length === 0 && distantFallback) {
      let target = this.targets.get(distantFallback.id);
      if (!target) {
        target = Object.assign(makeAircraft(distantFallback.id, 'enemy', new Vector3()), { trackingStrength: 0 });
        this.targets.set(distantFallback.id, target);
      }
      target.position.set(distantFallback.position.x, distantFallback.position.y, distantFallback.position.z);
      target.health = distantFallback.hp;
      targets.push(target);
    }
    for (const id of this.targets.keys()) if (!live.has(id)) this.targets.delete(id);
    return targets;
  }
  /** Advance only the K aircraft. The caller commits this input once with campaign.step(), then syncs. */
  step(state: CampaignState, input: FlightInput): CampaignInput {
    if (state.status !== 'running') throw new Error('Flight can only advance during a running campaign');
    const player = this.player, flight = this.flight, targets = this.aimTargets(state);
    const previousQuaternion = plainQuaternion(player.quaternion);
    player.previous.copy(player.position); player.age += CAMPAIGN_DT;
    const assist = getFlightAssist(player, targets, input, state.mode);
    const slew = (current: number, target: number, rate: number) => current + clamp(target - current, -rate * CAMPAIGN_DT, rate * CAMPAIGN_DT);
    const manual = Math.max(Math.abs(input.turn), Math.abs(input.climb)) >= .35;
    flight.assistTurn = manual ? 0 : slew(flight.assistTurn, assist.turn - input.turn, 2.5);
    flight.assistClimb = manual ? 0 : slew(flight.assistClimb, assist.climb - input.climb, 1.5);
    if (flight.assistTurn * input.turn < 0) flight.assistTurn = 0;
    if (flight.assistClimb * input.climb < 0) flight.assistClimb = 0;
    flight.responseMultiplier = slew(flight.responseMultiplier, assist.responseMultiplier, 2.5);
    const adjusted = { ...input, turn: input.turn + flight.assistTurn, climb: input.climb + flight.assistClimb };
    const loopPressed = input.loop && !flight.loopHeld; flight.loopHeld = input.loop;
    this.lastLoopCompleted = updatePlayerLoop(player, flight, adjusted, input, loopPressed, CAMPAIGN_DT,
      advanceThrottle(flight, input, state.mode, CAMPAIGN_DT), MAX_SPEED, flight.responseMultiplier);
    const forward = forwardOf(player), velocity = forward.clone().multiplyScalar(player.speed);
    const autoTarget = autoFireTarget(player, targets, state.mode, input.viewAspect);
    const gunMuzzles = {
      mg: [-1, 1].map(side => player.position.clone().add(new Vector3(side * .3, .52, -4.25).applyQuaternion(player.quaternion))),
      cannon: [-1, 1].map(side => player.position.clone().add(new Vector3(side * 2.5, 0, -2.4).applyQuaternion(player.quaternion))),
    };
    const shotDirections = {
      mg: gunMuzzles.mg.map(origin => autoTarget && state.mode === 'easy'
        ? applyEasyShotCorrection(forward, predictedShotDirection(origin, forward, autoTarget, player.speed + 820, 1.5)) : forward.clone()),
      cannon: gunMuzzles.cannon.map(origin => autoTarget && state.mode === 'easy'
        ? applyEasyShotCorrection(forward, predictedShotDirection(origin, forward, autoTarget, player.speed + 700, 1.5)) : forward.clone()),
    };
    return {
      playerPosition: plain(player.position), playerVelocity: plain(velocity), playerQuaternion: plainQuaternion(player.quaternion),
      previousQuaternion, forward: plain(forward), fire: state.mode === 'easy' ? autoTarget !== null : input.fire, bomb: !!input.bomb,
      gunMuzzles: { mg: gunMuzzles.mg.map(plain), cannon: gunMuzzles.cannon.map(plain) },
      shotDirections: { mg: shotDirections.mg.map(plain), cannon: shotDirections.cannon.map(plain) },
    };
  }
}
