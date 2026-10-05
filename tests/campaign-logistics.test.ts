import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR_STATS, CAPTURE_MAX, INITIAL_CLASSES, countClasses, emptyClassCounts } from '../src/campaign-config';
import { cancelAllTickets, cancelTicket, isValidReservedTicket, processLogistics, updateArmyStates, updateCapture } from '../src/campaign-logistics';
import { laneBasis, radialPosition, terrainHeight, xzDistanceSquared } from '../src/campaign-terrain';
import type { ActorClass, CampaignActor, CampaignEvent, CampaignState, CampaignTeam, ClassCounts, Origin, Vec } from '../src/campaign-types';

function world(): CampaignState {
  const position = { x: 0, y: 300, z: 0 };
  const quaternion = { x: 0, y: 0, z: 0, w: 1 };
  const state: CampaignState = {
    runId: 'logistics-test', rulesVersion: 'fantasia-capture-v1', mapVersion: 'fantasia-sevenfold-v1',
    seed: 42, rngState: 42, mode: 'normal', startHeading: 0, status: 'running',
    simTick: 0, activeTicks: 0, respawnPenaltyTicks: 0, livesRemaining: 3,
    player: { id: 1, generation: 1, hp: 100, maxHp: 100, position: { ...position }, previous: { ...position },
      velocity: { x: 0, y: 0, z: 0 }, radius: 3, mg: 288, cannon: 96, bombs: 2,
      reloadUntilTick: null, bombReloadUntilTick: null, nextMgTick: 0, nextCannonTick: 0,
      protectionTicks: 0, boundaryTicks: 600, quaternion: { ...quaternion }, previousQuaternion: { ...quaternion } },
    sites: Array.from({ length: 7 }, (_, id) => ({ id, position: radialPosition(id, 1000), owner: 'enemy', ownerGeneration: 1,
      challenger: null, progress: 0, captureProgress: 0, turretId: -1, contested: false,
      firstFriendlyCaptureTick: null, lastOwnerChangeTick: 0, depletedSinceTick: null, rescueCooldownUntilTick: 0 })),
    armies: Array.from({ length: 7 }, (_, id) => ({ id, siteId: id, reserves: emptyClassCounts(),
      initialReserves: { ...INITIAL_CLASSES }, reserveCount: 0, reservedCapacity: 0, status: 'march' })),
    actors: [], projectiles: [], reinforcementTickets: [], rescueMissions: [], events: [], result: null, resultSnapshot: null,
    nextEntityId: 2, nextProjectileId: 1, nextEventId: 1, nextTicketId: 1, nextMissionId: 1,
    friendlyDamage: 0, friendlyKills: 0, friendlyLosses: 0, enemyKills: 0, selfLosses: 0,
    destroyedInitialTurretIds: [], firstCapturedSiteIds: [], lossReason: null,
  };
  for (const site of state.sites) {
    const turret = actor(state, 'turret', 'enemy', site.id, null, radialPosition(site.id, 1000, 6));
    turret.hp = 0;
    site.turretId = turret.id;
  }
  return state;
}

function actor(state: CampaignState, className: ActorClass = 'sword', team: CampaignTeam = 'friendly',
  assignedSiteId = 0, armyId: number | null = team === 'friendly' && className !== 'dragon' && className !== 'turret' ? assignedSiteId : null,
  position: Vec = radialPosition(assignedSiteId, 1000, className === 'dragon' ? 180 : className === 'cavalry' ? 1.5 : 1)): CampaignActor {
  const stats = ACTOR_STATS[className];
  const result: CampaignActor = {
    id: state.nextEntityId++, generation: 1, kind: className === 'dragon' || className === 'turret' ? className : 'ground',
    class: className, team, laneId: armyId ?? assignedSiteId, armyId, assignedSiteId,
    hp: stats.hp, maxHp: stats.hp, position: { ...position }, previous: { ...position },
    velocity: { x: 0, y: 0, z: 0 }, radius: stats.radius, origin: 'initial', waveOrdinal: 0, slot: 0,
    targetRef: null, phase: 'idle', fireAtTick: null, lockedAim: null, cooldownUntilTick: 0, attackReadyTick: 0,
    movementState: 'march', rescueMissionId: null, blockedTicks: 0, replanWaypoint: null,
    coverUntilTick: 0, coverPosition: null, lastAttackers: [],
  };
  state.actors.push(result);
  return result;
}

function reserves(state: CampaignState, counts: ClassCounts = { ...INITIAL_CLASSES }, armyId = 0): void {
  state.armies[armyId].reserves = { ...counts };
  state.armies[armyId].reserveCount = countClasses(counts);
}
function emitFor(state: CampaignState): (event: Omit<CampaignEvent, 'id' | 'eventId' | 'tick'>) => void {
  return event => { const id = state.nextEventId++; state.events.push({ ...event, id, eventId: id, tick: state.simTick }); };
}
function spawnFor(state: CampaignState): (team: CampaignTeam, className: ActorClass, laneId: number, armyId: number | null,
  position: Vec, origin: Origin, waveOrdinal: number, slot: number) => CampaignActor {
  return (team, className, laneId, armyId, position, origin, waveOrdinal, slot) => {
    const result = actor(state, className, team, laneId, armyId, position);
    result.laneId = laneId;
    result.origin = origin;
    result.waveOrdinal = waveOrdinal;
    result.slot = slot;
    return result;
  };
}
function scheduler(state: CampaignState, tick: number): void {
  state.activeTicks = tick;
  state.simTick = tick - 1;
  processLogistics(state, spawnFor(state), emitFor(state));
}
function captureTicks(state: CampaignState, count: number): void {
  for (let i = 0; i < count; i++) { updateCapture(state, emitFor(state)); state.simTick++; state.activeTicks++; }
}
function grid(laneId: number, slot: number, team: CampaignTeam = 'friendly'): Vec {
  const anchor = radialPosition(laneId, team === 'friendly' ? 1320 : 650), { u, v } = laneBasis(laneId);
  const tangent = ((slot % 6) - 2.5) * 8, radial = (Math.floor(slot / 6) - 1.5) * 10;
  const x = anchor.x + v.x * tangent + u.x * radial, z = anchor.z + v.z * tangent + u.z * radial;
  return { x, y: terrainHeight(x, z) + 1, z };
}
function donor(state: CampaignState, siteId: number, count = 12): CampaignActor[] {
  state.sites[siteId].owner = 'friendly';
  return Array.from({ length: count }, () => actor(state, 'sword', 'friendly', siteId));
}

test('four ground units need separate 600-tick neutralization and capture phases; first capture is finite', () => {
  const state = world(), site = state.sites[0];
  const ground = Array.from({ length: 4 }, () => actor(state));
  actor(state, 'dragon'); // Air units do not increase the four-person cap.
  captureTicks(state, 599);
  assert.equal(site.owner, 'enemy');
  assert.equal(site.progress, 59900);
  assert.equal(site.captureProgress, site.progress / 600);
  captureTicks(state, 1);
  assert.equal(site.owner, 'neutral');
  assert.equal(site.challenger, 'friendly');
  assert.equal(site.progress, 0);
  captureTicks(state, 599);
  assert.equal(site.owner, 'neutral');
  captureTicks(state, 1);
  assert.equal(site.owner, 'friendly');
  assert.equal(site.ownerGeneration, 3);
  assert.equal(site.challenger, null);
  assert.deepEqual(state.events.map(event => event.kind), ['neutralize', 'capture']);
  assert.deepEqual(state.firstCapturedSiteIds, [0]);
  const first = site.firstFriendlyCaptureTick;
  for (const unit of ground) unit.hp = 0;
  const enemies = Array.from({ length: 4 }, () => actor(state, 'sword', 'enemy'));
  captureTicks(state, 1200);
  assert.equal(site.owner, 'enemy');
  assert.equal(state.actors.find(unit => unit.id === site.turretId)!.hp, 0);
  for (const unit of enemies) unit.hp = 0;
  for (const unit of ground) unit.hp = unit.maxHp;
  captureTicks(state, 1200);
  assert.equal(site.owner, 'friendly');
  assert.equal(site.firstFriendlyCaptureTick, first);
  assert.deepEqual(state.firstCapturedSiteIds, [0]);
});

test('one cavalry counts once in XZ, dead ground and aircraft count zero, and both teams freeze progress', () => {
  const state = world(), site = state.sites[0];
  actor(state, 'dragon', 'friendly');
  const dead = actor(state); dead.hp = 0;
  updateCapture(state, emitFor(state));
  assert.equal(site.progress, 0);
  const cavalry = actor(state, 'cavalry', 'friendly', 0, 0, { x: site.position.x + 55, y: 1000, z: site.position.z });
  updateCapture(state, emitFor(state));
  assert.equal(site.progress, 25);
  const enemy = actor(state, 'sword', 'enemy');
  for (let i = 0; i < 6; i++) actor(state);
  captureTicks(state, 20);
  assert.equal(site.progress, 25);
  assert.equal(site.contested, true);
  enemy.hp = 0;
  updateCapture(state, emitFor(state));
  assert.equal(site.contested, false);
  assert.equal(site.progress, 125);
  assert.equal(cavalry.hp, 100);
});

test('empty decay, owner recovery, neutral challenger reversal and active-turret gating use exact integer rates', () => {
  const state = world(), site = state.sites[0];
  site.progress = 75; site.challenger = 'friendly';
  updateCapture(state, emitFor(state));
  assert.equal(site.progress, 25);
  updateCapture(state, emitFor(state));
  assert.equal(site.challenger, null);
  const enemy = actor(state, 'sword', 'enemy');
  site.progress = 150; site.challenger = 'friendly';
  updateCapture(state, emitFor(state));
  assert.equal(site.progress, 50);
  updateCapture(state, emitFor(state));
  assert.equal(site.progress, 0);
  assert.equal(site.challenger, null);
  enemy.hp = 0;
  actor(state);
  site.owner = 'neutral'; site.challenger = 'enemy'; site.progress = 50;
  updateCapture(state, emitFor(state));
  assert.equal(site.progress, 25); assert.equal(site.challenger, 'enemy');
  updateCapture(state, emitFor(state));
  assert.equal(site.progress, 0); assert.equal(site.challenger, 'friendly');
  updateCapture(state, emitFor(state));
  assert.equal(site.progress, 25);
  const turret = state.actors.find(unit => unit.id === site.turretId)!;
  turret.hp = turret.maxHp;
  site.owner = 'enemy'; site.progress = 500;
  updateCapture(state, emitFor(state));
  assert.equal(site.progress, 500);
  turret.hp = 0;
  updateCapture(state, emitFor(state));
  assert.equal(site.progress, 525);
  assert.equal(site.captureProgress, site.progress / 600);
  site.owner = 'neutral'; site.progress = CAPTURE_MAX - 10;
  updateCapture(state, emitFor(state));
  assert.equal(site.owner, 'friendly');
  assert.equal(site.progress, 0, 'phase transitions discard excess progress');
});

test('friendly reservation preserves the exact shortage sequence and dispatches at activeTick 2100 after snapshot restoration', () => {
  let state = world(); reserves(state);
  scheduler(state, 0);
  assert.equal(state.reinforcementTickets.length, 0);
  scheduler(state, 1800);
  const ticket = state.reinforcementTickets[0];
  assert.deepEqual(ticket.classCounts, { sword: 4, bow: 2, mage: 1, cavalry: 1 });
  assert.deepEqual(state.armies[0].reserves, { sword: 8, bow: 3, mage: 2, cavalry: 3 });
  assert.equal(ticket.scheduledTick, 2100);
  assert.equal(ticket.firstDueTick, 2100);
  assert.equal(state.armies[0].reservedCapacity, 8);
  assert.equal(state.armies[0].status, 'regrouping');
  scheduler(state, 1800);
  assert.equal(state.reinforcementTickets.length, 1, 'same wave cannot reserve twice');
  state = JSON.parse(JSON.stringify(state)) as CampaignState;
  state.sites[0].owner = 'friendly'; state.sites[0].ownerGeneration = 12;
  scheduler(state, 2099);
  assert.equal(state.actors.filter(unit => unit.kind === 'ground').length, 0);
  scheduler(state, 2100);
  const spawned = state.actors.filter(unit => unit.kind === 'ground');
  assert.deepEqual(spawned.map(unit => unit.class), ['sword', 'bow', 'mage', 'cavalry', 'sword', 'sword', 'bow', 'sword']);
  assert.deepEqual(spawned.map(unit => unit.slot), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(spawned.every(unit => unit.team === 'friendly' && unit.armyId === 0 && unit.assignedSiteId === 0
    && unit.origin === 'reinforcement' && Math.hypot(unit.position.x, unit.position.z) > 1250));
  assert.equal(state.armies[0].reservedCapacity, 0);
  assert.equal(state.armies[0].reserveCount, 16);
  assert.equal(state.reinforcementTickets[0].status, 'spawned');
  scheduler(state, 2100);
  assert.equal(state.actors.filter(unit => unit.kind === 'ground').length, 8);
});

test('army replenishment counts its living soldiers at other fronts and its pending reservations', () => {
  const state = world(); reserves(state);
  for (let i = 0; i < 24; i++) actor(state, 'sword', 'friendly', 2, 0);
  scheduler(state, 1800);
  assert.equal(state.reinforcementTickets.filter(ticket => ticket.team === 'friendly').length, 0);
  for (const unit of state.actors) if (unit.kind === 'ground') unit.hp = 0;
  scheduler(state, 3600);
  // Deliberately leave the first wave pending: the next periodic allocation
  // must include it even though no body has appeared yet.
  state.reinforcementTickets[0].scheduledTick = 6000;
  scheduler(state, 5400);
  assert.equal(state.reinforcementTickets.filter(ticket => ticket.team === 'friendly').reduce((sum, ticket) => sum + countClasses(ticket.classCounts), 0), 16);
  assert.equal(state.armies[0].reservedCapacity, 16);
  assert.equal(state.armies[0].reserveCount, 8);
});

test('finite class inventory limits reservations and cancellation refunds each class and capacity once', () => {
  const state = world(); reserves(state, { sword: 0, bow: 1, mage: 0, cavalry: 0 });
  scheduler(state, 1800);
  const ticket = state.reinforcementTickets[0];
  assert.deepEqual(ticket.classCounts, { sword: 0, bow: 1, mage: 0, cavalry: 0 });
  assert.equal(state.armies[0].reserveCount, 0);
  assert.equal(state.armies[0].reservedCapacity, 1);
  cancelTicket(state, ticket);
  cancelTicket(state, ticket);
  cancelAllTickets(state);
  assert.equal(ticket.status, 'cancelled');
  assert.equal(ticket.reservedCapacity, 0);
  assert.equal(state.armies[0].reservedCapacity, 0);
  assert.deepEqual(state.armies[0].reserves, { sword: 0, bow: 1, mage: 0, cavalry: 0 });
  assert.equal(state.armies[0].reserveCount, 1);
});

test('enemy waves adopt the fixed slot prefix, reserve within lane capacity and retain their team after owner changes', () => {
  const state = world();
  for (let i = 0; i < 30; i++) actor(state, 'sword', 'enemy');
  for (let i = 0; i < 2; i++) actor(state, 'dragon', 'enemy');
  scheduler(state, 2699);
  assert.equal(state.reinforcementTickets.length, 0);
  scheduler(state, 2700);
  const ticket = state.reinforcementTickets.find(candidate => candidate.team === 'enemy' && candidate.laneId === 0)!;
  assert.deepEqual(ticket.classCounts, { sword: 2, bow: 0, mage: 0, cavalry: 0 });
  assert.equal(ticket.scheduledTick, 3000);
  state.sites[0].owner = 'friendly'; state.sites[0].ownerGeneration = 18;
  scheduler(state, 2999);
  assert.equal(ticket.status, 'reserved');
  scheduler(state, 3000);
  const ground = state.actors.filter(unit => unit.kind === 'ground' && unit.team === 'enemy' && unit.laneId === 0 && unit.hp > 0);
  assert.equal(ground.length, 32);
  assert.ok(ground.filter(unit => unit.origin === 'reinforcement').every(unit => Math.hypot(unit.position.x, unit.position.z) < 700
    && xzDistanceSquared(unit.position, state.sites[0].position) > 55 ** 2));
  scheduler(state, 5400);
  assert.equal(state.reinforcementTickets.filter(candidate => candidate.team === 'enemy' && candidate.laneId === 0).length, 1);
  ground[0].hp = 0;
  scheduler(state, 8100);
  const later = state.reinforcementTickets.filter(candidate => candidate.team === 'enemy' && candidate.laneId === 0);
  assert.equal(later.length, 2);
  assert.equal(later[1].waveOrdinal, 3);
  assert.equal(countClasses(later[1].classCounts), 1, 'a skipped full wave is never accumulated');
});

test('5400-tick waves combine ground and dragon in one ticket and keep all fourteen-dragon and ground bounds', () => {
  const state = world();
  for (let lane = 0; lane < 7; lane++) {
    for (let i = 0; i < 24; i++) actor(state, 'sword', 'enemy', lane);
    actor(state, 'dragon', 'enemy', lane);
  }
  scheduler(state, 5400);
  const enemyTickets = state.reinforcementTickets.filter(ticket => ticket.team === 'enemy');
  assert.equal(enemyTickets.length, 7);
  assert.ok(enemyTickets.every(ticket => countClasses(ticket.classCounts) === 8 && ticket.dragonCount === 1 && ticket.reservedCapacity === 9));
  scheduler(state, 5700);
  assert.equal(state.actors.filter(unit => unit.kind === 'ground' && unit.hp > 0).length, 224);
  assert.equal(state.actors.filter(unit => unit.kind === 'dragon' && unit.hp > 0).length, 14);
  assert.ok(state.actors.filter(unit => unit.kind === 'dragon' && unit.origin === 'reinforcement')
    .every(unit => Math.abs(Math.hypot(unit.position.x, unit.position.z) - 650) < 1e-8
      && Math.abs(unit.position.y - terrainHeight(unit.position.x, unit.position.z) - 180) < 1e-8));
  scheduler(state, 10800);
  assert.equal(state.reinforcementTickets.filter(ticket => ticket.team === 'enemy').length, 7);
  state.actors.find(unit => unit.kind === 'dragon' && unit.laneId === 0)!.hp = 0;
  scheduler(state, 13500);
  assert.equal(state.reinforcementTickets.filter(ticket => ticket.team === 'enemy').length, 7);
  scheduler(state, 16200);
  const replacement = state.reinforcementTickets.find(ticket => ticket.team === 'enemy' && ticket.laneId === 0 && ticket.waveOrdinal === 6)!;
  assert.equal(countClasses(replacement.classCounts), 0);
  assert.equal(replacement.dragonCount, 1);
});

test('blocked dispatch is atomic, retries young grid slots and succeeds on the last allowed retry tick', () => {
  const state = world(); reserves(state);
  const blockers = Array.from({ length: 32 }, (_, slot) => actor(state, 'sword', 'enemy', 0, null, grid(0, slot)));
  scheduler(state, 1800);
  const ticket = state.reinforcementTickets[0];
  scheduler(state, 2100);
  assert.equal(ticket.status, 'reserved');
  assert.equal(state.actors.filter(unit => unit.team === 'friendly').length, 0);
  blockers[0].hp = 0;
  scheduler(state, 2219);
  assert.equal(ticket.status, 'reserved');
  assert.equal(state.actors.filter(unit => unit.team === 'friendly').length, 0, 'no partial wave appears');
  for (const blocker of blockers.slice(0, 8)) blocker.hp = 0;
  scheduler(state, 2220);
  assert.equal(ticket.status, 'spawned');
  assert.deepEqual(state.actors.filter(unit => unit.team === 'friendly').map(unit => unit.slot), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(state.armies[0].reserveCount, 16);
});

test('a still-blocked wave cancels at 120 ticks and returns its finite inventory exactly once', () => {
  const state = world(); reserves(state);
  for (let slot = 0; slot < 32; slot++) actor(state, 'sword', 'enemy', 0, null, grid(0, slot));
  scheduler(state, 1800);
  scheduler(state, 2100);
  const ticket = state.reinforcementTickets[0];
  scheduler(state, 2219);
  assert.equal(ticket.status, 'reserved');
  scheduler(state, 2220);
  assert.equal(ticket.status, 'cancelled');
  assert.equal(state.armies[0].reservedCapacity, 0);
  assert.deepEqual(state.armies[0].reserves, INITIAL_CLASSES);
  scheduler(state, 2221);
  cancelAllTickets(state);
  assert.deepEqual(state.armies[0].reserves, INITIAL_CLASSES);
  assert.equal(state.actors.filter(unit => unit.team === 'friendly').length, 0);
});

test('invalid source generations, terminal states and stale run tickets cannot create soldiers or duplicate refunds', () => {
  const invalid = world(); reserves(invalid); scheduler(invalid, 1800);
  invalid.reinforcementTickets[0].sourceGeneration = 2;
  scheduler(invalid, 1801);
  assert.equal(invalid.reinforcementTickets[0].status, 'cancelled');
  assert.deepEqual(invalid.armies[0].reserves, INITIAL_CLASSES);
  const terminal = world(); reserves(terminal); scheduler(terminal, 1800);
  terminal.status = 'victory'; scheduler(terminal, 2100);
  assert.equal(terminal.reinforcementTickets[0].status, 'cancelled');
  assert.equal(terminal.actors.filter(unit => unit.kind === 'ground').length, 0);
  assert.deepEqual(terminal.armies[0].reserves, INITIAL_CLASSES);
  const restarted = world(); reserves(restarted); scheduler(restarted, 1800);
  restarted.runId = 'replacement-run'; reserves(restarted); restarted.armies[0].reservedCapacity = 0;
  scheduler(restarted, 2100);
  assert.equal(restarted.reinforcementTickets[0].status, 'cancelled');
  assert.equal(restarted.actors.filter(unit => unit.kind === 'ground').length, 0);
  assert.deepEqual(restarted.armies[0].reserves, INITIAL_CLASSES);
  assert.equal(restarted.armies[0].reservedCapacity, 0);
});

test('respawning freezes capture, rescue and pending tickets without cancellation', () => {
  const state = world(); reserves(state); scheduler(state, 1800);
  actor(state); state.status = 'respawning';
  const frozen = JSON.stringify(state);
  updateCapture(state, emitFor(state));
  processLogistics(state, spawnFor(state), emitFor(state));
  assert.equal(JSON.stringify(state), frozen);
  state.status = 'running'; scheduler(state, 2100);
  assert.equal(state.reinforcementTickets[0].status, 'spawned');
});

test('only current-run, source-valid reserved tickets prevent front depletion', () => {
  const state = world(); reserves(state, { sword: 1, bow: 0, mage: 0, cavalry: 0 });
  scheduler(state, 1800);
  const ticket = state.reinforcementTickets[0];
  assert.equal(isValidReservedTicket(state, ticket), true);
  assert.equal(state.armies[0].status, 'regrouping');
  for (const changed of [{ sourceGeneration: 2 }, { sourceId: 'obsolete-site-source' }, { runId: 'previous-run' },
    { reservedCapacity: 0 }, { status: 'spawned' as const }]) {
    const saved = { ...ticket };
    Object.assign(ticket, changed);
    assert.equal(isValidReservedTicket(state, ticket), false);
    updateArmyStates(state);
    assert.equal(state.armies[0].status, 'depleted');
    Object.assign(ticket, saved);
  }
  updateArmyStates(state);
  assert.equal(state.armies[0].status, 'regrouping');
});

test('exact capture and local-rescue radius boundaries survive all seven physical rotations', () => {
  for (let lane = 0; lane < 7; lane++) {
    const state = world(), site = state.sites[lane], { u } = laneBasis(lane);
    actor(state, 'sword', 'friendly', lane, lane, {
      x: site.position.x + u.x * 55, y: 1000, z: site.position.z + u.z * 55,
    });
    updateCapture(state, emitFor(state));
    assert.equal(site.progress, 25);
    const rescue = world(), local = donor(rescue, lane);
    for (const unit of local) unit.position = {
      x: rescue.sites[lane].position.x + u.x * 80, y: 1000, z: rescue.sites[lane].position.z + u.z * 80,
    };
    const recipient = (lane + 6) % 7;
    rescue.startHeading = recipient;
    scheduler(rescue, 1);
    assert.equal(rescue.rescueMissions[0].recipientSiteId, recipient);
    assert.equal(rescue.rescueMissions[0].memberRefs.length, 6);
  }
});

test('six rescue soldiers move without cloning and retain inventory army, including completion with one survivor', () => {
  const state = world();
  const members = donor(state, 1);
  members.forEach((unit, index) => { unit.armyId = index < 3 ? 4 : 2; });
  const before = state.actors.length, initialArmies = new Map(members.map(unit => [unit.id, unit.armyId]));
  scheduler(state, 1);
  const mission = state.rescueMissions.find(candidate => candidate.recipientSiteId === 0)!;
  assert.equal(mission.donorSiteId, 1);
  assert.equal(mission.memberRefs.length, 6);
  assert.equal(state.actors.length, before);
  assert.deepEqual(mission.memberRefs.map(ref => ref.id), members.slice(3, 9).map(unit => unit.id));
  const transferred = members.filter(unit => unit.rescueMissionId === mission.id);
  assert.equal(members.filter(unit => unit.assignedSiteId === 1).length, 6);
  assert.ok(transferred.every(unit => unit.assignedSiteId === 0 && unit.armyId === initialArmies.get(unit.id) && unit.movementState === 'rescue'));
  assert.equal(state.armies[0].status, 'rescue');
  assert.equal(state.sites[0].depletedSinceTick, null);
  assert.equal(state.sites[1].rescueCooldownUntilTick, 1801);
  for (const unit of transferred.slice(1)) unit.hp = 0;
  transferred[0].position = { ...state.sites[0].position, x: state.sites[0].position.x + 80 };
  scheduler(state, 2);
  assert.equal(mission.status, 'completed');
  assert.equal(transferred[0].rescueMissionId, null);
  assert.equal(transferred[0].assignedSiteId, 0);
  assert.equal(transferred[0].armyId, initialArmies.get(transferred[0].id));
  assert.equal(transferred[0].movementState, 'capture');
  assert.notEqual(state.armies[0].status, 'depleted');
  assert.equal(state.sites[0].depletedSinceTick, null);
  transferred[0].hp = 0;
  state.sites[5].owner = 'friendly';
  donor(state, 6);
  scheduler(state, 3);
  assert.equal(mission.status, 'failed', 'completed rescue fails when its last survivor dies');
  assert.equal(state.rescueMissions.filter(candidate => candidate.recipientSiteId === 0 && candidate.status === 'enroute').length, 1);
  assert.equal(state.rescueMissions.find(candidate => candidate.recipientSiteId === 0 && candidate.status === 'enroute')!.donorSiteId, 6);
});

test('rescue recipients use depletion age before heading, and heading ties remain equivalent under all seven rotations', () => {
  for (let offset = 0; offset < 7; offset++) {
    const state = world(), previous = (offset + 6) % 7, next = (offset + 1) % 7;
    donor(state, offset);
    state.sites[previous].depletedSinceTick = state.sites[next].depletedSinceTick = 4;
    state.startHeading = previous;
    scheduler(state, 10);
    const mission = state.rescueMissions[0];
    assert.equal(mission.recipientSiteId, previous);
    assert.equal(mission.donorSiteId, offset);
    assert.equal(mission.memberRefs.length, 6);
  }
  const state = world(); donor(state, 0);
  state.sites[6].depletedSinceTick = 4;
  state.sites[1].depletedSinceTick = 3;
  state.startHeading = 6;
  scheduler(state, 10);
  assert.equal(state.rescueMissions[0].recipientSiteId, 1);
});

test('equidistant donors prefer clockwise from the recipient, with one dispatch per donor and no repeated incoming mission', () => {
  const state = world(); donor(state, 1); donor(state, 6);
  state.sites[0].depletedSinceTick = 0;
  scheduler(state, 10);
  assert.equal(state.rescueMissions.find(mission => mission.recipientSiteId === 0)!.donorSiteId, 1);
  const oneDonor = world(); donor(oneDonor, 1, 24);
  scheduler(oneDonor, 1);
  assert.equal(oneDonor.rescueMissions.length, 1);
  assert.equal(oneDonor.rescueMissions[0].recipientSiteId, 0);
  assert.equal(oneDonor.actors.filter(unit => unit.assignedSiteId === 1 && unit.kind === 'ground').length, 18);
  scheduler(oneDonor, 1800);
  assert.equal(oneDonor.rescueMissions.length, 1);
  scheduler(oneDonor, 1801);
  assert.equal(oneDonor.rescueMissions.length, 2);
  assert.equal(oneDonor.rescueMissions[1].recipientSiteId, 2);
  assert.equal(oneDonor.rescueMissions.filter(mission => mission.recipientSiteId === 0 && mission.status === 'enroute').length, 1);
  const ids = oneDonor.rescueMissions.flatMap(mission => mission.memberRefs.map(ref => ref.id));
  assert.equal(new Set(ids).size, 12);
});

test('rescue donor requirements enforce local eligibility, contention, enemy clearance and cooldown', () => {
  for (const condition of ['eleven', 'far', 'busy', 'contested', 'enemy', 'cooldown', 'neutral'] as const) {
    const state = world(), members = donor(state, 1, condition === 'eleven' ? 11 : 12);
    if (condition === 'far') members[0].position = { ...state.sites[1].position, x: state.sites[1].position.x + 80.1 };
    if (condition === 'busy') members[0].rescueMissionId = 1000;
    if (condition === 'contested') state.sites[1].contested = true;
    if (condition === 'enemy') actor(state, 'sword', 'enemy', 1, null, { ...state.sites[1].position, x: state.sites[1].position.x + 160 });
    if (condition === 'cooldown') state.sites[1].rescueCooldownUntilTick = 2;
    if (condition === 'neutral') state.sites[1].owner = 'neutral';
    scheduler(state, 1);
    assert.equal(state.rescueMissions.length, 0, condition);
    assert.equal(members.filter(unit => unit.assignedSiteId === 1).length, members.length);
  }
});

test('front depletion depends on assigned living bodies and original reserves or tickets, rather than original-army survival elsewhere', () => {
  const state = world();
  actor(state, 'sword', 'friendly', 1, 0);
  updateArmyStates(state);
  assert.equal(state.armies[0].status, 'depleted');
  assert.notEqual(state.armies[1].status, 'depleted');
  reserves(state, { sword: 1, bow: 0, mage: 0, cavalry: 0 });
  updateArmyStates(state);
  assert.equal(state.armies[0].status, 'regrouping');
  scheduler(state, 1800);
  assert.equal(state.armies[0].reserveCount, 0);
  assert.equal(state.armies[0].status, 'regrouping');
  cancelAllTickets(state);
  state.armies[0].reserves = emptyClassCounts();
  updateArmyStates(state);
  assert.equal(state.armies[0].status, 'depleted');
});
