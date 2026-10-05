import test from 'node:test';
import assert from 'node:assert/strict';
import { Campaign, makeCampaignActor } from '../src/campaign';
import { ActorGrid, moveActors } from '../src/campaign-combat';
import { distanceSquared, laneBasis, terrainHeight, xzDistanceSquared } from '../src/campaign-terrain';
import type { CampaignActor, CampaignState, EntityRef, Vec } from '../src/campaign-types';

const stationary = { playerPosition: { x: 0, y: 300, z: 0 }, playerVelocity: { x: 0, y: 0, z: 0 } };

// Compare the committed one-micrometre physics coordinates in each lane's
// frame. Inverting a rotation may produce sub-ulp differences or negative zero.
function micrometres(value: number): number {
  const integer = Math.round(value * 1e6);
  return integer === 0 ? 0 : integer;
}
function localPosition(position: Vec, lane: number): number[] {
  const { u, v } = laneBasis(lane);
  return [micrometres(position.x * u.x + position.z * u.z), micrometres(position.y),
    micrometres(position.x * v.x + position.z * v.z)];
}
function localRef(ref: EntityRef | null, lane: number): number[] | null {
  return ref === null ? null : [ref.id === 0 ? 0 : ref.id - lane * 50, ref.generation];
}
function actorRole(actor: CampaignActor, lane: number) {
  return {
    id: actor.id - lane * 50, kind: actor.kind, class: actor.class, team: actor.team,
    army: actor.armyId === null ? null : actor.armyId - lane, assignedSite: (actor.assignedSiteId - lane + 7) % 7,
    hp: actor.hp, maxHp: actor.maxHp, origin: actor.origin, waveOrdinal: actor.waveOrdinal, slot: actor.slot,
    position: localPosition(actor.position, lane), previous: localPosition(actor.previous, lane),
    phase: actor.phase, fireAtTick: actor.fireAtTick, cooldownUntilTick: actor.cooldownUntilTick,
    attackReadyTick: actor.attackReadyTick, target: localRef(actor.targetRef, lane),
    lockedAim: actor.lockedAim === null ? null : localPosition(actor.lockedAim, lane),
    movementState: actor.movementState, rescueMissionId: actor.rescueMissionId, blockedTicks: actor.blockedTicks,
    replanWaypoint: actor.replanWaypoint === null ? null : localPosition(actor.replanWaypoint, lane),
    coverUntilTick: actor.coverUntilTick,
    coverPosition: actor.coverPosition === null ? null : localPosition(actor.coverPosition, lane),
    lastAttackers: actor.lastAttackers.map(attacker => ({ ref: localRef(attacker.ref, lane), tick: attacker.tick })),
  };
}

test('the site-centered pursuit query matches the all-search oracle under every rotation, including actors beyond source radius', () => {
  let actorCenteredQueryOmittedTarget = false;
  for (let lane = 0; lane < 7; lane++) {
    const campaign = new Campaign(), state = campaign.state, site = state.sites[lane], { u, v } = laneBasis(lane);
    const position = (radial: number, tangent: number): Vec => {
      const x = site.position.x + u.x * radial + v.x * tangent;
      const z = site.position.z + u.z * radial + v.z * tangent;
      return { x, y: terrainHeight(x, z) + 1, z };
    };
    const source = makeCampaignActor(25 + lane * 50, 'enemy', 'sword', lane, null, position(-15, 4), 'initial', 0, 3);
    const inside = makeCampaignActor(1 + lane * 50, 'friendly', 'sword', lane, lane, position(159.9, 0));
    const outside = makeCampaignActor(2 + lane * 50, 'friendly', 'sword', lane, lane, position(160.1, 0));
    const dead = makeCampaignActor(3 + lane * 50, 'friendly', 'sword', lane, lane, position(0, 0)); dead.hp = 0;
    state.actors = [source, inside, outside, dead];
    const qualifies = (actor: CampaignActor) => actor.team !== source.team && actor.hp > 0 && actor.kind !== 'dragon'
      && xzDistanceSquared(actor.position, site.position) <= 160 ** 2;
    const oracle = state.actors.filter(qualifies).map(actor => actor.id).sort((a, b) => a - b);
    const grid = new ActorGrid(state.actors);
    assert.deepEqual(grid.queryRadius(site.position, 160).filter(qualifies).map(actor => actor.id).sort((a, b) => a - b), oracle);
    assert.deepEqual(oracle, [inside.id]);
    assert.ok(distanceSquared(source.position, inside.position) > 160 ** 2);
    if (!grid.queryRadius(source.position, 160).filter(qualifies).some(actor => actor.id === inside.id)) actorCenteredQueryOmittedTarget = true;
    const before = { ...source.position };
    moveActors(state);
    assert.equal(source.movementState, 'engage', `lane ${lane}`);
    assert.ok(xzDistanceSquared(source.position, before) > .08 ** 2);
  }
  assert.equal(actorCenteredQueryOmittedTarget, true, 'the fixture exposes the former orientation-dependent broad-phase omission');
});
function laneSnapshot(state: CampaignState, lane: number) {
  return {
    actors: state.actors.filter(actor => actor.laneId === lane).map(actor => actorRole(actor, lane)),
    projectiles: state.projectiles.filter(projectile => projectile.laneId === lane).map(projectile => ({
      kind: projectile.kind, source: localRef(projectile.sourceRef, lane), sourceClass: projectile.sourceClass,
      team: projectile.team, damage: projectile.damage, bornTick: projectile.bornTick, ttl: projectile.ttl,
    })),
    site: {
      owner: state.sites[lane].owner, challenger: state.sites[lane].challenger, contested: state.sites[lane].contested,
      progress: state.sites[lane].progress, ownerGeneration: state.sites[lane].ownerGeneration,
    },
    army: {
      status: state.armies[lane].status, reserves: state.armies[lane].reserves,
      reserveCount: state.armies[lane].reserveCount, reservedCapacity: state.armies[lane].reservedCapacity,
    },
  };
}

for (const mode of ['normal', 'easy'] as const) {
  test(`${mode}: all seven stationary-player fronts remain equivalent through 1800 ticks`, { timeout: 120000 }, () => {
    const campaign = new Campaign(mode, 20261005);
    for (let tick = 0; tick < 1800; tick++) {
      campaign.step(stationary);
      const reference = laneSnapshot(campaign.state, 0);
      for (let lane = 1; lane < 7; lane++) {
        assert.deepEqual(laneSnapshot(campaign.state, lane), reference, `tick ${tick}, lane ${lane}`);
      }
    }
    assert.equal(campaign.state.status, 'running');
  });
}
