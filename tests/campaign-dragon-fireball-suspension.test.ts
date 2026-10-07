import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { Campaign, validateCampaignState } from '../src/campaign';
import { CampaignScene } from '../src/campaign-scene';
import { BASE_CAMPAIGN_RULES_VERSION, CAMPAIGN_RULES_VERSION, DEFAULT_CAMPAIGN_FEATURES, SUSPENDED_CAMPAIGN_RULES_VERSION } from '../src/campaign-config';
import { applyDamages, collectCombat, commitActorFire, commitPlayerFire, entityRef } from '../src/campaign-combat';
import { processLogistics } from '../src/campaign-logistics';
import { terrainHeight } from '../src/campaign-terrain';
import type { CampaignActor, CampaignEvent, CampaignFeatures, CampaignProjectile, CampaignState } from '../src/campaign-types';

const stationary = { playerPosition: { x: 0, y: 300, z: 0 }, playerVelocity: { x: 0, y: 0, z: 0 } };
function emit(state: CampaignState) {
  return (event: Omit<CampaignEvent, 'id' | 'eventId' | 'tick'>): CampaignEvent => {
    const id = state.nextEventId++, complete = { ...event, id, eventId: id, tick: state.simTick };
    state.events.push(complete); return complete;
  };
}
function isolated(dragonFireballs = false): Campaign {
  const run = new Campaign('normal', 20261005, { dragonFireballs });
  run.state.actors = [];
  run.state.player.velocity = { x: 0, y: 0, z: 0 };
  return run;
}
function projectile(run: Campaign, kind: CampaignProjectile['kind'] = 'fireball'): CampaignProjectile {
  return { id: run.state.nextProjectileId++, generation: 1, kind, team: 'enemy',
    sourceRef: { id: 999, generation: 1 }, sourceClass: 'dragon', fromPlayer: false, laneId: 0,
    position: { x: 1, y: 300, z: 0 }, previous: { x: 1, y: 300, z: 0 },
    velocity: { x: -95, y: 0, z: 0 }, radius: .6, damage: 22, ttl: 300, bornTick: 0 };
}

test('both modes default to the separately versioned suspension; explicit restoration copies and freezes valid features', () => {
  assert.deepEqual(DEFAULT_CAMPAIGN_FEATURES, { dragonFireballs: false });
  assert.equal(CAMPAIGN_RULES_VERSION, SUSPENDED_CAMPAIGN_RULES_VERSION);
  for (const mode of ['normal', 'easy'] as const) {
    const suspended = new Campaign(mode);
    assert.equal(suspended.state.features.dragonFireballs, false);
    assert.equal(suspended.state.rulesVersion, SUSPENDED_CAMPAIGN_RULES_VERSION);
    const options = { dragonFireballs: true }, restored = new Campaign(mode, 20261005, options);
    options.dragonFireballs = false;
    assert.equal(restored.state.features.dragonFireballs, true);
    assert.equal(restored.state.rulesVersion, BASE_CAMPAIGN_RULES_VERSION);
    assert.ok(Object.isFrozen(restored.state.features));
    assert.deepEqual(suspended.state.actors, restored.state.actors);
    validateCampaignState(suspended.state); validateCampaignState(restored.state);
    restored.state.rulesVersion = SUSPENDED_CAMPAIGN_RULES_VERSION;
    assert.throws(() => validateCampaignState(restored.state), /features and rules version/);
  }
  for (const malformed of [null, false, 1, [], {}, { dragonFireballs: undefined }, { dragonFireballs: 'true' },
    { dragonFireballs: true, typo: false }, { dragonFireballs: false, [Symbol('unknown')]: true }]) {
    assert.throws(() => new Campaign('normal', 1, malformed as unknown as CampaignFeatures), /features/);
  }
});

test('suspension clears an existing dragon telegraph and also rejects a previously prepared fire list', () => {
  const run = isolated(), state = run.state;
  const dragon = run.spawnActor('enemy', 'dragon', 0, null, { x: 100, y: 300, z: 0 });
  const prepare = () => {
    dragon.phase = 'telegraph'; dragon.fireAtTick = state.simTick;
    dragon.lockedAim = { ...state.player.position }; dragon.targetRef = entityRef(state.player);
    dragon.cooldownUntilTick = 10; dragon.attackReadyTick = 10;
  };
  prepare();
  const combat = collectCombat(state, emit(state));
  assert.equal(combat.readyToFire.length, 0); assert.equal(combat.damages.length, 0);
  assert.equal(dragon.phase, 'idle'); assert.equal(dragon.fireAtTick, null);
  assert.equal(dragon.lockedAim, null); assert.equal(dragon.targetRef, null);
  assert.equal(dragon.cooldownUntilTick, 0); assert.equal(dragon.attackReadyTick, 0);
  prepare(); commitActorFire(state, [dragon], emit(state));
  assert.equal(dragon.phase, 'idle'); assert.equal(dragon.fireAtTick, null);
  assert.equal(dragon.targetRef, null); assert.equal(dragon.lockedAim, null);
  assert.equal(state.projectiles.length, 0); assert.equal(state.events.length, 0);
});

test('restoring the feature retains the 54-tick telegraph, 12-tick aim lock and 180-tick dragon recovery', () => {
  const run = isolated(true), state = run.state;
  const dragon = run.spawnActor('enemy', 'dragon', 0, null, { x: 100, y: 300, z: 0 });
  collectCombat(state, emit(state));
  assert.equal(dragon.phase, 'telegraph'); assert.equal(dragon.fireAtTick, 54);
  state.simTick = 41; collectCombat(state, emit(state)); assert.equal(dragon.lockedAim, null);
  state.simTick = 42; collectCombat(state, emit(state)); assert.deepEqual(dragon.lockedAim, state.player.position);
  state.simTick = 54;
  const combat = collectCombat(state, emit(state)); commitActorFire(state, combat.readyToFire, emit(state));
  assert.equal(state.projectiles.length, 1); assert.equal(state.projectiles[0].kind, 'fireball');
  assert.equal(state.projectiles[0].damage, 22); assert.equal(state.projectiles[0].ttl, 300);
  assert.equal(dragon.phase, 'recovery'); assert.equal(dragon.cooldownUntilTick, 234);
  assert.deepEqual(state.events.map(event => event.kind), ['telegraph', 'shot']);
});

test('all seven dragons keep the same movement with attacks disabled, while simulation time continues', () => {
  const suspended = new Campaign(), restored = new Campaign('normal', 20261005, { dragonFireballs: true });
  let restoredFireballs = 0;
  for (let tick = 0; tick < 240; tick++) {
    suspended.step(stationary); restored.step(stationary);
    for (const dragon of suspended.state.actors.filter(actor => actor.kind === 'dragon')) {
      const original = restored.state.actors.find(actor => actor.id === dragon.id)!;
      assert.deepEqual(dragon.position, original.position); assert.deepEqual(dragon.velocity, original.velocity);
      assert.equal(dragon.phase, 'idle');
    }
    assert.equal(suspended.state.projectiles.some(shot => shot.kind === 'fireball'), false);
    assert.equal(suspended.state.events.some(event => event.weapon === 'dragon' || event.weapon === 'fireball'), false);
    restoredFireballs += restored.state.events.filter(event => event.kind === 'shot' && event.weapon === 'fireball').length;
  }
  assert.equal(suspended.state.simTick, 240); assert.equal(suspended.state.activeTicks, 240);
  assert.equal(suspended.state.status, 'running'); assert.ok(restoredFireballs > 0);
  validateCampaignState(suspended.state); validateCampaignState(restored.state);
});

test('present fireballs are removed before motion and damage without skipping or modifying adjacent projectile kinds', () => {
  const run = isolated(), state = run.state;
  const otherKinds = ['arrow', 'magic', 'turret', 'mg', 'cannon', 'bomb'] as const;
  const others = otherKinds.map(kind => ({ ...projectile(run, kind), sourceClass: 'player' as const,
    position: { x: 10000, y: 5000, z: 10000 }, previous: { x: 10000, y: 5000, z: 10000 }, velocity: { x: 30, y: 0, z: 0 } }));
  const fireballs = [projectile(run), projectile(run), projectile(run)];
  const untouched = structuredClone(fireballs);
  state.projectiles = [fireballs[0], ...others.slice(0, 3), fireballs[1], ...others.slice(3), fireballs[2]];
  const originalArray = state.projectiles;
  const combat = collectCombat(state, emit(state)); applyDamages(state, combat.damages, emit(state));
  assert.deepEqual(fireballs, untouched, 'disabled shots never reach motion, TTL or collision code');
  assert.equal(originalArray.length, 9, 'iteration must not splice its input array');
  assert.deepEqual(state.projectiles.map(shot => shot.kind), otherKinds);
  for (let i = 0; i < others.length; i++) { assert.equal(state.projectiles[i], others[i]); assert.equal(others[i].ttl, 299); }
  assert.equal(state.player.hp, 100); assert.equal(combat.damages.length, 0); assert.equal(state.events.length, 0);
});

test('the existing scene updates clear removed fireball bodies, trails and glow without disposing GPU resources', () => {
  const run = isolated(), state = run.state, fireball = projectile(run), arrow = projectile(run, 'arrow');
  arrow.position = { x: 100, y: 300, z: 0 }; arrow.previous = { ...arrow.position };
  state.projectiles = [fireball, arrow];
  const mesh = () => ({ count: 0, instanceMatrix: { count: 4, needsUpdate: false }, setMatrixAt() {},
    dispose() { assert.fail('projectile removal must not dispose shared resources'); } });
  const geometry = () => ({ drawRange: { start: 0, count: 0 }, attributes: { position: { needsUpdate: false }, color: { needsUpdate: false } },
    setDrawRange(start: number, count: number) { this.drawRange = { start, count }; },
    dispose() { assert.fail('projectile removal must not dispose shared resources'); } });
  const fireballBody = mesh(), arrowBody = mesh();
  const scene = { projectileBodies: new Map([['fireball', fireballBody], ['arrow', arrowBody]]),
    tempRotation: new Quaternion(), tempPosition: new Vector3(), tempScale: new Vector3(), tempMatrix: new Matrix4(), up: new Vector3(0, 1, 0),
    trailPositions: new Float32Array(24), trailColors: new Float32Array(24), trailGeometry: geometry(), aircraftTracers: { update() {} },
    lastEvent: 0, visualTime: 0, particles: [], reducedMotion: null, pointGeometry: geometry(),
    pointPositions: new Float32Array(12), pointColors: new Float32Array(12), pointSizes: new Float32Array(4), pointOpacity: new Float32Array(4) };
  const methods = CampaignScene.prototype as unknown as {
    updateProjectiles(this: typeof scene, state: CampaignState): void;
    updateEffects(this: typeof scene, state: CampaignState): void;
  };
  methods.updateProjectiles.call(scene, state); methods.updateEffects.call(scene, state);
  assert.equal(fireballBody.count, 1); assert.equal(arrowBody.count, 1);
  assert.equal(scene.trailGeometry.drawRange.count, 4); assert.equal(scene.pointGeometry.drawRange.count, 1);
  collectCombat(state, emit(state));
  methods.updateProjectiles.call(scene, state); methods.updateEffects.call(scene, state);
  assert.equal(fireballBody.count, 0); assert.equal(arrowBody.count, 1);
  assert.equal(scene.trailGeometry.drawRange.count, 2); assert.equal(scene.pointGeometry.drawRange.count, 0);
  assert.equal(scene.projectileBodies.get('fireball'), fireballBody); assert.equal(scene.particles.length, 0);
});

test('one incoming fireball produces no damage or impact events for 180 suspended ticks; restoration retains one 22-HP hit', () => {
  for (const enabled of [false, true]) {
    const run = isolated(enabled), state = run.state, shot = projectile(run);
    state.projectiles.push(shot);
    const hits: CampaignEvent[] = [], explosions: CampaignEvent[] = [];
    assert.equal(state.player.hp, 100); assert.equal(state.projectiles[0].id, shot.id);
    for (let tick = 1; tick <= 180; tick++) {
      run.step(stationary);
      hits.push(...state.events.filter(event => event.kind === 'hit' && event.sourceRef?.id === 999));
      explosions.push(...state.events.filter(event => event.kind === 'explosion' && event.sourceRef?.id === 999));
      assert.equal(state.player.hp, enabled ? 78 : 100);
      assert.equal(state.projectiles.some(projectile => projectile.id === shot.id), false);
      assert.equal(state.simTick, tick); assert.equal(state.status, 'running');
    }
    assert.equal(hits.length, enabled ? 1 : 0); assert.equal(explosions.length, enabled ? 1 : 0);
    if (enabled) {
      assert.equal(hits[0].effectiveDamage, 22); assert.equal(hits[0].tick, 0);
      assert.deepEqual([hits[0].id, explosions[0].id], [1, 2]);
    } else assert.equal(state.nextEventId, 1, 'no new events can feed fireball effects or audio');
  }
});

test('suspended dragons remain vulnerable to player gunfire', () => {
  const run = isolated(), state = run.state;
  const dragon = run.spawnActor('enemy', 'dragon', 0, null, { x: 100, y: 300, z: 0 });
  state.projectiles.push({ ...projectile(run, 'mg'), team: 'friendly', sourceClass: 'player', fromPlayer: true,
    sourceRef: entityRef(state.player), position: { x: 80, y: 300, z: 0 }, previous: { x: 80, y: 300, z: 0 },
    velocity: { x: 1200, y: 0, z: 0 }, damage: 4 });
  const combat = collectCombat(state, emit(state)); applyDamages(state, combat.damages, emit(state));
  assert.equal(dragon.hp, 176);
  assert.equal(state.events.filter(event => event.kind === 'hit' && event.targetRef?.id === dragon.id).length, 1);
});

test('sword, cavalry, bow, mage, turret and all player weapons remain active in the suspension', () => {
  for (const actorClass of ['sword', 'cavalry', 'bow', 'mage', 'turret'] as const) {
    const run = isolated(), state = run.state;
    const y = terrainHeight(1000, 0) + 6;
    const attacker = run.spawnActor('enemy', actorClass, 0, null, { x: 1000, y, z: 0 });
    const target = run.spawnActor('friendly', 'sword', 0, 0, { x: 1002, y, z: 0 });
    attacker.phase = 'telegraph'; attacker.fireAtTick = 0; attacker.targetRef = entityRef(target); attacker.lockedAim = { ...target.position };
    const combat = collectCombat(state, emit(state)); applyDamages(state, combat.damages, emit(state));
    commitActorFire(state, combat.readyToFire, emit(state));
    if (actorClass === 'sword' || actorClass === 'cavalry') assert.ok(target.hp < 40, actorClass);
    else assert.equal(state.projectiles[0]?.kind, actorClass === 'bow' ? 'arrow' : actorClass === 'mage' ? 'magic' : 'turret');
  }
  const run = isolated(); commitPlayerFire(run.state, { fire: true, bomb: true }, emit(run.state));
  assert.deepEqual(run.state.projectiles.map(shot => shot.kind), ['mg', 'mg', 'cannon', 'cannon', 'bomb']);
});

test('dragon reinforcement counts and placement are unchanged by the feature setting', () => {
  const dragons: CampaignActor[][] = [];
  for (const enabled of [false, true]) {
    const run = new Campaign('normal', 20261005, { dragonFireballs: enabled }), state = run.state;
    const spawn = run.spawnActor.bind(run);
    state.activeTicks = 5400; state.simTick = 5399; processLogistics(state, spawn, emit(state));
    state.activeTicks = 5700; state.simTick = 5699; processLogistics(state, spawn, emit(state));
    const alive = state.actors.filter(actor => actor.kind === 'dragon' && actor.hp > 0);
    assert.equal(alive.length, 14); assert.equal(alive.filter(actor => actor.origin === 'reinforcement').length, 7);
    dragons.push(alive); validateCampaignState(state);
  }
  assert.deepEqual(dragons[0], dragons[1]);
});

test('actual main dispatch sends no suspended fireball audio and preserves one impact plus one damage cue when restored', () => {
  const source = ts.createSourceFile('main.ts', readFileSync('src/main.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const dispatch = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleEvents');
  assert.ok(dispatch, 'test runs the real browser dispatcher rather than a copied mapping');
  const code = ts.transpileModule(`${dispatch.getText(source)}; handleEvents(events);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const enabled of [false, true]) {
    const run = isolated(enabled), state = run.state;
    state.projectiles.push(projectile(run)); run.step(stationary);
    const calls: Array<{ method: string; type: string; playerEvent?: boolean }> = [];
    runInNewContext(code, {
      Vector3, state, player: { id: state.player.id }, events: state.events,
      audio: {
        worldEvent(event: { type: string }) { calls.push({ method: 'world', type: event.type }); },
        event(event: { type: string }, playerEvent: boolean) { calls.push({ method: 'event', type: event.type, playerEvent }); },
      },
      announce() { throw new Error('A nonlethal isolated fireball must not create an unrelated announcement'); },
    });
    assert.deepEqual(calls, enabled ? [
      { method: 'event', type: 'damage', playerEvent: true },
      { method: 'world', type: 'ordnance-impact' },
    ] : []);
  }
});
