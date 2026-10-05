import assert from 'node:assert/strict';
import test from 'node:test';
import { Campaign, campaignScore, campaignStateHash, formationPosition, formatCampaignTicks, terrainHeight, validateCampaignState } from '../src/campaign';
import { ACTOR_STATS, classDamage } from '../src/campaign-config';
import { ActorGrid, allocateEffectiveDamage, applyDamages, attackEligible, collectCombat, commitActorFire, commitPlayerFire, entityRef, moveActors, predictBombImpact, projectileActorHit, projectileActorHitOracle, selectTarget, tickPlayerAmmo } from '../src/campaign-combat';
import { aircraftTerrainContact, sweptPlayerHit } from '../src/campaign-airframe';
import { distanceSquared, laneBasis, radialPosition, sweepObstacles } from '../src/campaign-terrain';
import type { CampaignActor, CampaignEvent, CampaignMode, CampaignProjectile, CampaignState, Vec } from '../src/campaign-types';

function emit(state: CampaignState) {
  return (event: Omit<CampaignEvent, 'id' | 'eventId' | 'tick'>): CampaignEvent => {
    const id = state.nextEventId++, result = { ...event, id, eventId: id, tick: state.simTick };
    state.events.push(result); return result;
  };
}
function isolated(mode: CampaignMode = 'normal'): Campaign {
  const run = new Campaign(mode);
  run.state.actors = run.state.actors.filter(a => a.kind === 'turret');
  for (const actor of run.state.actors) { actor.hp = 0; actor.phase = 'idle'; }
  run.state.player.velocity = { x: 0, y: 0, z: 0 };
  return run;
}
function actor(run: Campaign, team: 'friendly' | 'enemy', className: CampaignActor['class'], x = 1000, z = 0): CampaignActor {
  return run.spawnActor(team, className, 0, team === 'friendly' && className !== 'turret' && className !== 'dragon' ? 0 : null, { x, y: terrainHeight(x, z) + (className === 'turret' ? 6 : className === 'dragon' ? 100 : className === 'cavalry' ? 1.5 : 1), z });
}
function projectile(run: Campaign, kind: CampaignProjectile['kind'], from: Vec, velocity: Vec, options: Partial<CampaignProjectile> = {}): CampaignProjectile {
  return { id: run.state.nextProjectileId++, generation: 1, kind, team: 'friendly', sourceRef: entityRef(run.state.player), sourceClass: 'player', fromPlayer: true, position: { ...from }, previous: { ...from }, velocity: { ...velocity }, radius: 0, damage: kind === 'bomb' ? 240 : kind === 'fireball' ? 22 : 4, bornTick: run.state.simTick - 1, ttl: 90, ...options };
}

test('fixed initial composition, IDs, sevenfold formations and independent finite inventories', () => {
  for (const mode of ['normal', 'easy'] as const) {
    const run = new Campaign(mode), state = run.state;
    assert.equal(state.sites.length, 7); assert.equal(state.armies.length, 7);
    assert.equal(state.actors.filter(a => a.team === 'friendly' && a.kind === 'ground').length, 168);
    assert.equal(state.actors.filter(a => a.team === 'enemy' && a.kind === 'ground').length, 168);
    assert.equal(state.actors.filter(a => a.kind === 'dragon').length, 7);
    assert.equal(state.actors.filter(a => a.kind === 'turret').length, 7);
    assert.equal(new Set([state.player.id, ...state.actors.map(a => a.id)]).size, 351);
    assert.deepEqual([state.player.mg, state.player.cannon, state.player.bombs, state.player.hp, state.livesRemaining], [288, 96, 2, 100, 3]);
    for (const army of state.armies) assert.equal(army.reserveCount, mode === 'normal' ? 24 : 48);
    state.armies[0].reserves.sword--; assert.notEqual(state.armies[0].reserves.sword, state.armies[1].reserves.sword);
    state.armies[0].reserves.sword++;
    for (let lane = 0; lane < 7; lane++) {
      const site = state.sites[lane]; assert.ok(Math.abs(Math.hypot(site.position.x, site.position.z) - 1000) < 1e-9);
      assert.equal(site.progress, 0); assert.equal(site.captureProgress, 0); assert.equal(site.owner, 'enemy');
      for (let slot = 0; slot < 24; slot++) {
        const p = formationPosition(lane, 1320, slot, 'sword'), { u, v } = laneBasis(lane);
        assert.ok(Math.abs(p.x * u.x + p.z * u.z - 1320 - (Math.floor(slot / 6) - 1.5) * 10) < 1e-9);
        assert.ok(Math.abs(p.x * v.x + p.z * v.z - ((slot % 6) - 2.5) * 8) < 1e-9);
      }
    }
    validateCampaignState(state);
  }
  assert.throws(() => new Campaign('invalid' as CampaignMode), /mode/);
  assert.throws(() => new Campaign('normal', NaN), /uint32/);
});

test('one tick advances all seven armies simultaneously; scene-free snapshots are deep immutable copies', () => {
  const run = new Campaign(), before = run.snapshot();
  run.step({ playerPosition: { x: 0, y: 300, z: 0 }, playerVelocity: { x: 0, y: 0, z: 0 } });
  assert.equal(run.state.activeTicks, 1); assert.equal(run.state.simTick, 1);
  for (let lane = 0; lane < 7; lane++) {
    const soldier = run.state.actors.find(a => a.team === 'friendly' && a.laneId === lane && a.class === 'sword')!;
    const previous = before.actors.find(a => a.id === soldier.id)!;
    assert.ok(distanceSquared(soldier.position, previous.position) > 0);
  }
  assert.equal(before.activeTicks, 0); assert.ok(Object.isFrozen(before.player.position));
  assert.throws(() => { before.player.hp = 0; }, TypeError);
  assert.throws(() => run.step({ playerPosition: { x: NaN, y: 10, z: 0 } }), /finite/);
});

test('all class multipliers use half-up integers and apply no infantry matchup to a turret', () => {
  for (const [from, to, amount, result] of [
    ['sword', 'bow', 10, 13], ['bow', 'mage', 8, 10], ['mage', 'cavalry', 14, 21],
    ['cavalry', 'sword', 20, 25], ['bow', 'cavalry', 8, 6], ['mage', 'turret', 14, 14],
    ['sword', 'sword', 10, 10], ['player', 'dragon', 12, 12],
  ] as const) assert.equal(classDamage(from, to, amount), result);
});

test('attack eligibility uses 3D ranged distance, surface melee reach and 120 m air ceiling', () => {
  const run = isolated(), archer = actor(run, 'friendly', 'bow'), enemy = actor(run, 'enemy', 'mage', 1095);
  enemy.position.y = archer.position.y;
  assert.equal(attackEligible(run.state, archer, enemy), true);
  enemy.position.x += 1e-5; assert.equal(attackEligible(run.state, archer, enemy), false);
  const swordsman = actor(run, 'friendly', 'sword', 1010), turret = actor(run, 'enemy', 'turret', 1013);
  assert.equal(attackEligible(run.state, swordsman, turret), true);
  const dragon = actor(run, 'enemy', 'dragon'); dragon.position.y = terrainHeight(1000, 0) + 120;
  archer.position.y = dragon.position.y; assert.equal(attackEligible(run.state, archer, dragon), true);
  dragon.position.y += 1e-5; assert.equal(attackEligible(run.state, archer, dragon), false);
  assert.equal(attackEligible(run.state, swordsman, dragon), false);
});

test('recent self-defense uses latest hit then distance; dragon and player have the same airborne rank', () => {
  const run = isolated(), sword = actor(run, 'friendly', 'sword'), nearCavalry = actor(run, 'enemy', 'cavalry', 1003), farBow = actor(run, 'enemy', 'bow', 1004);
  sword.lastAttackers = [{ ref: entityRef(nearCavalry), tick: 10 }, { ref: entityRef(farBow), tick: 10 }]; run.state.simTick = 20;
  assert.equal(selectTarget(run.state, sword)?.id, nearCavalry.id);
  sword.lastAttackers[1].tick = 11; assert.equal(selectTarget(run.state, sword)?.id, farBow.id);
  const mage = actor(run, 'enemy', 'mage'), dragon = actor(run, 'friendly', 'dragon', 1040);
  dragon.position.y = mage.position.y;
  run.state.player.position = { x: 1030, y: mage.position.y, z: 0 }; run.state.player.previous = { ...run.state.player.position };
  assert.equal(selectTarget(run.state, mage)?.id, run.state.player.id);
});

test('turret player priority falls back when protected or out of range; exact 72/18 lock and recovery ticks', () => {
  const run = isolated(), turret = actor(run, 'enemy', 'turret'), ground = actor(run, 'friendly', 'sword', 1020);
  run.state.player.position = { x: 1000, y: turret.position.y + 500, z: 0 };
  run.state.player.previous = { ...run.state.player.position }; run.state.player.velocity = { x: 20, y: 0, z: 0 };
  assert.equal(selectTarget(run.state, turret)?.id, 0);
  run.state.player.protectionTicks = 1; assert.equal(selectTarget(run.state, turret)?.id, ground.id);
  run.state.player.protectionTicks = 0;
  let pending = collectCombat(run.state, emit(run.state)); assert.equal(turret.fireAtTick, 72); assert.equal(turret.lockedAim, null);
  run.state.simTick = 53; collectCombat(run.state, emit(run.state)); assert.equal(turret.lockedAim, null);
  run.state.simTick = 54; collectCombat(run.state, emit(run.state)); const lock = { ...turret.lockedAim! }; assert.ok(lock.x > 1000);
  run.state.player.position.x += 20; run.state.simTick = 71; collectCombat(run.state, emit(run.state)); assert.deepEqual(turret.lockedAim, lock);
  run.state.simTick = 72; pending = collectCombat(run.state, emit(run.state)); commitActorFire(run.state, pending.readyToFire, emit(run.state));
  assert.equal(run.state.projectiles.filter(p => p.sourceRef.id === turret.id).length, 1);
  assert.equal(turret.cooldownUntilTick, 312); assert.equal(turret.phase, 'recovery');
  const shot = run.state.projectiles.find(p => p.sourceRef.id === turret.id)!; assert.deepEqual(shot.previous, shot.position); assert.equal(shot.bornTick, 72);
  run.state.simTick = 311; collectCombat(run.state, emit(run.state)); assert.equal(turret.phase, 'recovery');
  run.state.simTick = 312; collectCombat(run.state, emit(run.state)); assert.equal(turret.phase, 'telegraph');
});

test('range departure at turret fire tick causes 60-tick misfire recovery and no projectile', () => {
  const run = isolated(), turret = actor(run, 'enemy', 'turret');
  run.state.player.position = { x: 1000, y: turret.position.y + 700, z: 0 };
  collectCombat(run.state, emit(run.state)); run.state.simTick = 54; collectCombat(run.state, emit(run.state));
  run.state.player.position.y = turret.position.y + 850.001; run.state.simTick = 72;
  const pending = collectCombat(run.state, emit(run.state)); commitActorFire(run.state, pending.readyToFire, emit(run.state));
  assert.equal(run.state.projectiles.length, 0); assert.equal(turret.cooldownUntilTick, 132);
});

test('solid scenery blocks a turret player target and its eligible ground fallback remains active', () => {
  const run = isolated(), turret = actor(run, 'enemy', 'turret', 930), ground = actor(run, 'friendly', 'sword', 950);
  run.state.player.position = { x: 930, y: turret.position.y, z: 150 };
  assert.equal(attackEligible(run.state, turret, run.state.player), false);
  assert.equal(selectTarget(run.state, turret)?.id, ground.id);
});

test('an invalid retained infantry target is reconsidered immediately between 12-tick AI decisions', () => {
  const run = isolated(), bow = actor(run, 'friendly', 'bow'), departed = actor(run, 'enemy', 'sword', 1200), mage = actor(run, 'enemy', 'mage', 1050);
  bow.targetRef = entityRef(departed); run.state.simTick = 1;
  collectCombat(run.state, emit(run.state)); assert.equal(bow.targetRef?.id, mage.id); assert.equal(bow.phase, 'telegraph'); assert.equal(bow.fireAtTick, 13);
});

test('dead ranged shooters never commit, existing released bolts persist, and melee has simultaneous last blows', () => {
  const run = isolated(), first = actor(run, 'friendly', 'sword'), second = actor(run, 'enemy', 'sword', 1002);
  first.hp = second.hp = 10; first.phase = second.phase = 'telegraph'; first.fireAtTick = second.fireAtTick = 12;
  first.targetRef = entityRef(second); second.targetRef = entityRef(first); run.state.simTick = 12;
  const pending = collectCombat(run.state, emit(run.state)); applyDamages(run.state, pending.damages, emit(run.state));
  assert.equal(first.hp, 0); assert.equal(second.hp, 0);
  const turret = actor(run, 'enemy', 'turret'), friendly = actor(run, 'friendly', 'sword', 1030);
  turret.phase = 'telegraph'; turret.fireAtTick = 12; turret.lockedAim = { ...friendly.position }; turret.targetRef = entityRef(friendly);
  const ranged = collectCombat(run.state, emit(run.state)); turret.hp = 0; commitActorFire(run.state, ranged.readyToFire, emit(run.state));
  assert.equal(run.state.projectiles.length, 0);
  run.state.projectiles.push(projectile(run, 'turret', { x: 1000, y: 100, z: 0 }, { x: 0, y: 0, z: 0 }, { team: 'enemy', sourceClass: 'turret', sourceRef: entityRef(turret), fromPlayer: false }));
  collectCombat(run.state, emit(run.state)); assert.equal(run.state.projectiles.length, 1);
});

test('overkill is apportioned by integer remainder, with only effective friendly HP and kill-credit penalties', () => {
  assert.deepEqual(allocateEffectiveDamage(10, [{ id: 1, damage: 30 }, { id: 2, damage: 10 }]), [8, 2]);
  assert.deepEqual(allocateEffectiveDamage(1, [{ id: 8, damage: 1 }, { id: 7, damage: 1 }]), [0, 1]);
  const run = isolated(), friendly = actor(run, 'friendly', 'sword'); friendly.hp = 10;
  applyDamages(run.state, [
    { id: 1, sourceRef: entityRef(run.state.player), sourceClass: 'player', team: 'friendly', fromPlayer: true, targetRef: entityRef(friendly), damage: 30, weapon: 'bomb', position: friendly.position },
    { id: 2, sourceRef: { id: 999, generation: 1 }, sourceClass: 'turret', team: 'enemy', fromPlayer: false, targetRef: entityRef(friendly), damage: 10, weapon: 'turret', position: friendly.position },
  ], emit(run.state));
  assert.equal(friendly.hp, 0); assert.equal(run.state.friendlyDamage, 8); assert.equal(run.state.friendlyKills, 1);
  const score = campaignScore(run.state); assert.equal(score.friendlyDamage, -16); assert.equal(score.friendlyKills, -100);
});

test('spatial projectile search equals all-search oracle for swept moving targets and earliest sphere hit', () => {
  const run = isolated();
  for (let i = 0; i < 32; i++) { const target = actor(run, 'enemy', 'sword', 800 + i * 8, i % 4 * 9); target.previous = { ...target.position, x: target.position.x - 3 }; }
  const grid = new ActorGrid(run.state.actors);
  for (let i = 0; i < 100; i++) {
    const start = { x: 780 + i * 3, y: 21, z: i % 8 * 5 }, p = projectile(run, 'mg', start, { x: 0, y: 0, z: 0 }); p.position = { x: start.x + 35, y: 21, z: start.z - 3 };
    assert.deepEqual(projectileActorHit(run.state, p, grid), projectileActorHitOracle(run.state, p));
  }
});

test('K five swept collision spheres include wings and moving targets, without a single-sphere shortcut', () => {
  const run = isolated(), player = run.state.player;
  player.quaternion = player.previousQuaternion = { x: 0, y: 0, z: 0, w: 1 };
  player.position = player.previous = { x: 0, y: 100, z: 0 };
  assert.notEqual(sweptPlayerHit({ x: 6, y: 100, z: -10 }, { x: 6, y: 100, z: 10 }, player), null);
  assert.equal(sweptPlayerHit({ x: 7, y: 100, z: -10 }, { x: 7, y: 100, z: 10 }, player), null);
  player.previous = { x: -100, y: 100, z: 0 }; player.position = { x: 100, y: 100, z: 0 };
  assert.notEqual(sweptPlayerHit({ x: 0, y: 100, z: 0 }, { x: 0, y: 100, z: 0 }, player), null);
});

test('actual K hull contacts terrain through roll while a clear support hull is not rejected by bounding radius', () => {
  const run = isolated(), player = run.state.player;
  player.quaternion = player.previousQuaternion = { x: 0, y: 0, z: 0, w: 1 };
  player.position = player.previous = { x: 0, y: terrainHeight(0, 0) + 2, z: 0 };
  assert.equal(aircraftTerrainContact(player), null);
  player.quaternion = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
  assert.notEqual(aircraftTerrainContact(player), null);
});

test('reinforcement dragons approach their patrol at <=50m/s instead of teleporting from the inner gate', () => {
  const run = isolated(), dragon = run.spawnActor('enemy', 'dragon', 0, null, radialPosition(0, 650, 180), 'reinforcement', 2);
  for (let tick = 0; tick < 120; tick++) { const previous = { ...dragon.position }; run.state.simTick = tick; moveActors(run.state); assert.ok(Math.sqrt(distanceSquared(previous, dragon.position)) <= 50 / 60 + 1e-8); assert.ok(Math.hypot(dragon.velocity.x, dragon.velocity.y, dragon.velocity.z) <= 50 + 1e-7); }
});

test('cavalry ground overlap cannot mask a solid rock, including collision after pair pushes', () => {
  const run = isolated(), cavalry = actor(run, 'friendly', 'cavalry', 930, -100);
  const direct = { x: 930, y: cavalry.position.y, z: -70 };
  assert.notEqual(sweepObstacles(cavalry.position, direct, cavalry.radius), null);
  for (let i = 0; i < 240; i++) { run.state.simTick = i; moveActors(run.state); assert.equal(sweepObstacles(cavalry.position, cavalry.position, cavalry.radius), null); }
});

test('120 blocked ticks replan to the fixed road without teleporting or crossing scenery', () => {
  const run = isolated(), cavalry = actor(run, 'friendly', 'cavalry', 907, 85); cavalry.blockedTicks = 120;
  const before = { ...cavalry.position }; moveActors(run.state);
  assert.ok(cavalry.replanWaypoint); assert.ok(Math.abs(cavalry.replanWaypoint.z) < 1e-12);
  assert.ok(Math.sqrt(distanceSquared(before, cavalry.position)) < .21);
  assert.equal(sweepObstacles(cavalry.previous, cavalry.position, cavalry.radius), null);
  assert.ok(cavalry.position.z < before.z);
});

test('a dragon telegraph triggers bounded shelter retreat and returns to the assigned site after danger', () => {
  const run = isolated(), soldier = actor(run, 'friendly', 'bow'), dragon = actor(run, 'enemy', 'dragon', 1180);
  dragon.phase = 'telegraph'; dragon.fireAtTick = 54; dragon.targetRef = entityRef(soldier);
  moveActors(run.state);
  assert.ok(soldier.coverPosition); assert.equal(soldier.coverUntilTick, 120);
  const shelter = { ...soldier.coverPosition }; assert.ok(distanceSquared(shelter, run.state.sites[0].position) < 160 ** 2);
  assert.ok(Math.abs(shelter.z) <= 100); assert.equal(sweepObstacles(shelter, shelter, soldier.radius), null);
  dragon.phase = 'idle'; run.state.simTick = 120; moveActors(run.state);
  assert.equal(soldier.coverPosition, null); assert.equal(soldier.assignedSiteId, 0);
});

test('paired K gun firing preserves left and right rates, bounds, ammo and birth-tick immobility', () => {
  const run = isolated(), fire = { fire: true, forward: { x: 1, y: 0, z: 0 } };
  commitPlayerFire(run.state, fire, emit(run.state));
  assert.deepEqual([run.state.player.mg, run.state.player.cannon], [286, 94]); assert.equal(run.state.projectiles.length, 4);
  for (const p of run.state.projectiles) { assert.deepEqual(p.previous, p.position); assert.equal(p.bornTick, 0); assert.equal(p.ttl, 90); }
  run.state.simTick = 4; commitPlayerFire(run.state, fire, emit(run.state)); assert.equal(run.state.projectiles.length, 4);
  run.state.simTick = 5; commitPlayerFire(run.state, fire, emit(run.state)); assert.equal(run.state.projectiles.length, 6);
  run.state.simTick = 15; commitPlayerFire(run.state, fire, emit(run.state)); assert.equal(run.state.projectiles.length, 10);
  run.state.player.mg = run.state.player.cannon = 2; run.state.simTick = 30; commitPlayerFire(run.state, fire, emit(run.state)); assert.equal(run.state.player.reloadUntilTick, 390);
  run.state.player.protectionTicks = 120; run.state.simTick = 390; commitPlayerFire(run.state, { fire: true, bomb: true }, emit(run.state)); assert.equal(run.state.player.bombs, 2);
});

test('gun reload and last-bomb replenishment obey 360/1800 exact simulation tick boundaries', () => {
  const run = isolated(), player = run.state.player;
  player.mg = player.cannon = 0; player.reloadUntilTick = 360;
  run.state.simTick = 359; tickPlayerAmmo(run.state); assert.equal(player.mg, 0);
  run.state.simTick = 360; tickPlayerAmmo(run.state); assert.equal(player.mg, 288); assert.equal(player.cannon, 96);
  commitPlayerFire(run.state, { bomb: true }, emit(run.state)); assert.equal(player.bombs, 1); assert.equal(player.bombReloadUntilTick, null);
  run.state.simTick = 361; commitPlayerFire(run.state, { bomb: true }, emit(run.state)); assert.equal(player.bombs, 0); assert.equal(player.bombReloadUntilTick, 2161);
  run.state.simTick = 2160; tickPlayerAmmo(run.state); assert.equal(player.bombs, 0);
  run.state.simTick = 2161; tickPlayerAmmo(run.state); assert.equal(player.bombs, 2);
});

test('Normal friendly bullets stop with ceil25% damage; Easy bullets pass friendly infantry', () => {
  for (const mode of ['normal', 'easy'] as const) {
    const run = isolated(mode), friendly = actor(run, 'friendly', 'sword', 1000), enemy = actor(run, 'enemy', 'sword', 1005);
    enemy.position.y = friendly.position.y; enemy.previous = { ...enemy.position };
    run.state.projectiles.push(projectile(run, 'cannon', { x: 990, y: friendly.position.y, z: 0 }, { x: 1200, y: 0, z: 0 }, { damage: 12 }));
    const pending = collectCombat(run.state, emit(run.state)); applyDamages(run.state, pending.damages, emit(run.state));
    assert.equal(friendly.hp, mode === 'normal' ? 37 : 40); assert.equal(enemy.hp, mode === 'normal' ? 40 : 28);
  }
});

test('bomb trajectory forecast shares terrain contact with actual physics and splash is not doubled on direct impact', () => {
  const run = isolated(), target = actor(run, 'enemy', 'turret'), start = { x: 1000, y: 100, z: 0 }, velocity = { x: 0, y: 0, z: 0 };
  const forecast = predictBombImpact(start, velocity); assert.ok(forecast); assert.equal(forecast.radius, 45);
  run.state.projectiles.push(projectile(run, 'bomb', start, velocity, { ttl: 1800 }));
  let hitEvents = 0;
  for (let i = 0; i < forecast.flightTicks; i++) {
    run.state.simTick = i; run.state.events = []; const tick = collectCombat(run.state, emit(run.state)); applyDamages(run.state, tick.damages, emit(run.state));
    hitEvents += run.state.events.filter(e => e.kind === 'hit' && e.targetRef?.id === target.id).length;
    if (run.state.projectiles.length === 0) break;
  }
  assert.equal(target.hp, 360); assert.equal(hitEvents, 1); // 240 direct, not 240+blast.
  const empty = isolated(); empty.state.projectiles.push(projectile(empty, 'bomb', start, velocity, { ttl: 1800 }));
  let explosionPoint: Vec | undefined;
  for (let i = 0; i < forecast.flightTicks; i++) { empty.state.events = []; collectCombat(empty.state, emit(empty.state)); explosionPoint = empty.state.events.find(e => e.kind === 'explosion')?.position ?? explosionPoint; }
  assert.ok(explosionPoint); assert.ok(distanceSquared(explosionPoint, forecast.position) < 1e-12);
});

test('friendly bodies cannot prematurely trigger bomb impact in either mode and TTL expiry is a dud', () => {
  for (const mode of ['normal', 'easy'] as const) {
    const run = isolated(mode), friendly = actor(run, 'friendly', 'cavalry');
    run.state.projectiles.push(projectile(run, 'bomb', { x: 1000, y: friendly.position.y + 2, z: 0 }, { x: 0, y: -60, z: 0 }, { ttl: 2 }));
    const first = collectCombat(run.state, emit(run.state)); assert.equal(first.damages.length, 0); assert.equal(run.state.projectiles.length, 1);
  }
  const run = isolated(); run.state.projectiles.push(projectile(run, 'bomb', { x: 1000, y: 5000, z: 0 }, { x: 0, y: -1, z: 0 }, { ttl: 1 }));
  const last = collectCombat(run.state, emit(run.state)); assert.equal(last.damages.length, 0); assert.equal(run.state.projectiles.length, 0); assert.equal(run.state.events.some(e => e.kind === 'explosion'), false);
});

test('a bomb may impact before the end of its final lifetime interval, but exact expiration contact is a dud', () => {
  for (const atBoundary of [false, true]) {
    const run = isolated(), start = { x: 0, y: 10 + (atBoundary ? 1 : .5) * (1 + .5 * 9.81 / 3600), z: 0 };
    run.state.projectiles.push(projectile(run, 'bomb', start, { x: 0, y: -60, z: 0 }, { ttl: 1 }));
    collectCombat(run.state, emit(run.state));
    assert.equal(run.state.projectiles.length, 0);
    assert.equal(run.state.events.some(e => e.kind === 'explosion'), !atBoundary);
  }
});

test('dragon fireball direct damage and 10m splash use one event per actor and never hit its own team', () => {
  const run = isolated(), direct = actor(run, 'friendly', 'sword'), splash = actor(run, 'friendly', 'sword', 1005), immune = actor(run, 'enemy', 'sword', 1002);
  for (const unit of [splash, immune]) { unit.position.y = direct.position.y; unit.previous = { ...unit.position }; }
  run.state.projectiles.push(projectile(run, 'fireball', { x: 990, y: direct.position.y, z: 0 }, { x: 1200, y: 0, z: 0 }, { damage: 22, fromPlayer: false, sourceClass: 'dragon', sourceRef: { id: 999, generation: 1 }, team: 'enemy', ttl: 300 }));
  const pending = collectCombat(run.state, emit(run.state)); applyDamages(run.state, pending.damages, emit(run.state));
  assert.equal(direct.hp, 18); assert.ok(splash.hp < 40 && splash.hp > 28); assert.equal(immune.hp, 40);
  assert.equal(run.state.events.filter(e => e.kind === 'hit' && e.targetRef?.id === direct.id).length, 1);
});

test('respawn freezes all logic, applies penalty once, picks safest candidate, and protection lasts 120 running ticks', () => {
  const run = isolated(); run.state.player.hp = 0; run.step();
  assert.equal(run.state.status, 'respawning'); assert.equal(run.state.livesRemaining, 2); assert.equal(run.state.respawnPenaltyTicks, 600);
  const frozen = campaignStateHash(run.state); for (let i = 0; i < 400; i++) run.step({ fire: true, bomb: true }); assert.equal(campaignStateHash(run.state), frozen);
  run.state.projectiles.push(projectile(run, 'turret', radialPosition(0, 250, 290), { x: 0, y: 0, z: 0 }, { fromPlayer: false, team: 'enemy', ttl: 360 }));
  run.resumeRespawn(); assert.equal(run.state.player.hp, 100); assert.equal(run.state.status, 'running'); assert.equal(run.state.player.protectionTicks, 120);
  assert.ok(Math.hypot(run.state.player.position.x - 250, run.state.player.position.z) > 100);
  const savedPosition = { ...run.state.player.position };
  for (let i = 0; i < 120; i++) run.step({ playerPosition: savedPosition, playerVelocity: { x: 0, y: 0, z: 0 }, fire: true, bomb: true });
  assert.equal(run.state.player.protectionTicks, 0); assert.equal(run.state.player.mg, 288); assert.equal(run.state.player.bombs, 2);
  run.step({ playerPosition: savedPosition, fire: true }); assert.equal(run.state.player.mg, 286);
});

test('outside grace requires 600 consecutive running ticks and re-entry resets it', () => {
  const run = isolated(), outside = { x: 2200, y: 300, z: 0 };
  for (let i = 0; i < 599; i++) run.step({ playerPosition: outside, playerVelocity: { x: 0, y: 0, z: 0 } });
  assert.equal(run.state.status, 'running'); assert.equal(run.state.player.boundaryTicks, 1);
  run.step({ playerPosition: { x: 0, y: 300, z: 0 } }); assert.equal(run.state.player.boundaryTicks, 600);
  for (let i = 0; i < 600; i++) run.step({ playerPosition: outside });
  assert.equal(run.state.status, 'respawning'); assert.equal(run.state.livesRemaining, 2); assert.equal(run.state.selfLosses, 1); assert.equal(run.state.lossReason, '作戦圏外');
});

test('same-tick terrain, HP and boundary loss are one loss; final loss has no respawn penalty', () => {
  const run = isolated(); run.state.livesRemaining = 1; run.state.player.hp = 0; run.state.player.boundaryTicks = 1;
  run.step({ playerPosition: { x: 2200, y: 0, z: 0 } });
  assert.equal(run.state.status, 'defeat'); assert.equal(run.state.respawnPenaltyTicks, 0); assert.equal(run.state.selfLosses, 1);
  assert.equal(run.state.result?.reason, '地形に接触'); assert.equal(run.state.events.filter(e => e.kind === 'selfLoss').length, 1);
});

test('verdict priorities include victory with remaining-life loss penalty, deadline victory, and no-army defeat', () => {
  for (const scenario of ['loss', 'deadline', 'final-loss', 'unrebuildable'] as const) {
    const run = isolated(); for (const site of run.state.sites) site.owner = 'friendly';
    if (scenario === 'loss' || scenario === 'final-loss') run.state.player.hp = 0;
    if (scenario === 'final-loss') run.state.livesRemaining = 1;
    if (scenario === 'deadline') run.state.activeTicks = 71999;
    if (scenario === 'unrebuildable') for (const army of run.state.armies) { army.reserves = { sword: 0, bow: 0, mage: 0, cavalry: 0 }; army.reserveCount = 0; }
    run.step();
    assert.equal(run.state.status, scenario === 'final-loss' || scenario === 'unrebuildable' ? 'defeat' : 'victory');
    assert.equal(run.state.respawnPenaltyTicks, scenario === 'loss' ? 600 : 0);
    const frozen = campaignStateHash(run.state); run.step({ fire: true }); run.resumeRespawn(); assert.equal(campaignStateHash(run.state), frozen);
    assert.ok(Object.isFrozen(run.state.result?.breakdown));
  }
});

test('20-minute active deadline excludes respawn penalty and one depleted army does not end the campaign', () => {
  const run = isolated(); run.state.activeTicks = 71999; run.state.respawnPenaltyTicks = 1200; run.step();
  assert.equal(run.state.result?.reason, '作戦期限20分'); assert.equal(run.state.result?.recordTicks, 73200);
  const one = isolated(); one.state.armies[0].reserves = { sword: 0, bow: 0, mage: 0, cavalry: 0 }; one.state.armies[0].reserveCount = 0; one.step(); assert.equal(one.state.status, 'running');
});

test('finite scoring caps at 26100, penalizes losses and cannot earn enemy unit or repeat-capture points', () => {
  const run = isolated(); run.state.firstCapturedSiteIds = [0, 1, 2, 3, 4, 5, 6]; run.state.destroyedInitialTurretIds = run.state.sites.map(s => s.turretId);
  assert.equal(campaignScore(run.state, true).total, 26100);
  run.state.enemyKills = 100000; assert.equal(campaignScore(run.state, true).total, 26100);
  run.state.activeTicks = 600; run.state.respawnPenaltyTicks = 600; run.state.selfLosses = 1; run.state.friendlyDamage = 3; run.state.friendlyKills = 1;
  assert.equal(campaignScore(run.state, true).total, 25294);
  run.state.friendlyDamage = 100000; assert.equal(campaignScore(run.state, false).total, 0);
  assert.equal(formatCampaignTicks(59), '00:00.98'); assert.equal(formatCampaignTicks(60), '00:01.00'); assert.equal(formatCampaignTicks(72000), '20:00.00');
});

test('same seed and consumed tick inputs produce the same simulation hash across independent runs', () => {
  const hashes = [];
  for (let runId = 0; runId < 10; runId++) {
    const run = new Campaign('normal', 20261005);
    for (let tick = 0; tick < 120; tick++) run.step({ playerPosition: { x: tick / 60 * 110, y: 300, z: 0 }, playerVelocity: { x: 110, y: 0, z: 0 }, fire: tick % 4 < 2, bomb: tick === 40 });
    validateCampaignState(run.state); hashes.push(campaignStateHash(run.state));
  }
  assert.equal(new Set(hashes).size, 1);
});
