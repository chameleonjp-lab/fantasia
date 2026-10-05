import type { ActorClass, CampaignActor, CampaignEvent, CampaignInput, CampaignMode, CampaignResult, CampaignState, CampaignTeam, ClassCounts, Origin, ScoreBreakdown, Vec } from './campaign-types';
import { ACTOR_STATS, CAMPAIGN_DT, CAMPAIGN_LIMIT_TICKS, CAMPAIGN_MAP_VERSION, CAMPAIGN_RULES_VERSION, CAPTURE_MAX, countClasses, GROUND_CLASSES, INITIAL_CLASSES, validateClassCounts } from './campaign-config';
import { addVec, copyVec, distanceSquared, laneBasis, radialPosition, scaleVec, terrainHeight } from './campaign-terrain';
import { aircraftTerrainContact } from './campaign-airframe';
import { applyDamages, collectCombat, commitActorFire, commitPlayerFire, moveActors, tickPlayerAmmo, type CampaignEmit } from './campaign-combat';
import { cancelAllTickets, isValidReservedTicket, processLogistics, updateArmyStates, updateCapture } from './campaign-logistics';
export * from './campaign-types';
export * from './campaign-config';
export * from './campaign-terrain';
export { predictBombImpact, predictAim, allocateEffectiveDamage } from './campaign-combat';

let runOrdinal = 0;
function validVec(v: Vec): void { if (![v.x, v.y, v.z].every(Number.isFinite)) throw new RangeError('Campaign vectors must be finite'); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child); }
  return value;
}
export function formationPosition(laneId: number, anchorRadius: number, slot: number, kind: ActorClass): Vec {
  const { u, v } = laneBasis(laneId), tangent = ((slot % 6) - 2.5) * 8, radial = (Math.floor(slot / 6) - 1.5) * 10;
  const x = u.x * (anchorRadius + radial) + v.x * tangent, z = u.z * (anchorRadius + radial) + v.z * tangent;
  return { x, y: terrainHeight(x, z) + (kind === 'cavalry' ? 1.5 : 1), z };
}
/** New IDs are always allocated by the run, never recycled after death. */
export function makeCampaignActor(id: number, team: CampaignTeam, actorClass: ActorClass, laneId: number, armyId: number | null, position: Vec, origin: Origin = 'initial', waveOrdinal = 0, slot = 0): CampaignActor {
  validVec(position);
  const stats = ACTOR_STATS[actorClass]; if (!stats) throw new RangeError('Invalid actor class');
  if (!Number.isInteger(laneId) || laneId < 0 || laneId >= 7 || armyId !== null && (!Number.isInteger(armyId) || armyId < 0 || armyId >= 7)) throw new RangeError('Invalid army/lane');
  return {
    id, generation: 1, team, class: actorClass, kind: actorClass === 'dragon' ? 'dragon' : actorClass === 'turret' ? 'turret' : 'ground',
    laneId, armyId, assignedSiteId: laneId, hp: stats.hp, maxHp: stats.hp,
    position: copyVec(position), previous: copyVec(position), velocity: { x: 0, y: 0, z: 0 }, radius: stats.radius,
    origin, waveOrdinal, slot, targetRef: null, phase: 'idle', fireAtTick: null, lockedAim: null,
    cooldownUntilTick: 0, attackReadyTick: 0, movementState: team === 'friendly' ? 'march' : 'garrison',
    rescueMissionId: null, blockedTicks: 0, replanWaypoint: null, coverUntilTick: 0, coverPosition: null, lastAttackers: [],
  };
}
export function campaignScore(state: CampaignState, victory = state.status === 'victory'): ScoreBreakdown {
  const recordTicks = state.activeTicks + state.respawnPenaltyTicks;
  const breakdown: ScoreBreakdown = {
    capture: state.firstCapturedSiteIds.length * 1000, turrets: state.destroyedInitialTurretIds.length * 300,
    success: victory ? 5000 : 0, speed: victory ? Math.max(0, 12000 - Math.floor(recordTicks / 60) * 10) : 0,
    friendlyDamage: -state.friendlyDamage * 2, friendlyKills: -state.friendlyKills * 100, selfLoss: -state.selfLosses * 500, total: 0,
  };
  breakdown.total = Math.max(0, breakdown.capture + breakdown.turrets + breakdown.success + breakdown.speed + breakdown.friendlyDamage + breakdown.friendlyKills + breakdown.selfLoss);
  return breakdown;
}
export function formatCampaignTicks(ticks: number): string {
  const centiseconds = Math.floor(ticks * 100 / 60), seconds = Math.floor(centiseconds / 100);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
}
/** FNV-1a of deterministic simulation state, normalizing the restart identity. */
export function campaignStateHash(state: CampaignState): string {
  const serialized = JSON.stringify(state, (key, value) => key === 'runId' ? `seed:${state.seed}` : value);
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i++) { hash ^= serialized.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function validateCampaignState(state: CampaignState): void {
  if (state.sites.length !== 7 || state.armies.length !== 7) throw new Error('Campaign needs seven sites and armies');
  const ids = new Set<number>([state.player.id]);
  for (const actor of state.actors) {
    if (ids.has(actor.id)) throw new Error('Duplicate campaign actor ID'); ids.add(actor.id);
    if (!Number.isFinite(actor.hp) || actor.hp < 0 || actor.hp > actor.maxHp) throw new Error('Invalid actor health');
    validVec(actor.position); validVec(actor.previous); validVec(actor.velocity);
  }
  validVec(state.player.position); validVec(state.player.previous); validVec(state.player.velocity);
  if (!Number.isFinite(state.player.hp) || state.player.hp < 0 || state.player.hp > state.player.maxHp) throw new Error('Invalid player health');
  for (const site of state.sites) {
    if (site.progress < 0 || site.progress > CAPTURE_MAX || !Number.isInteger(site.progress) || site.captureProgress !== site.progress / 600) throw new Error('Invalid capture progress');
  }
  for (const army of state.armies) {
    validateClassCounts(army.reserves);
    if (countClasses(army.reserves) !== army.reserveCount || army.reservedCapacity < 0) throw new Error('Invalid army reserve ledger');
    const alive = state.actors.filter(a => a.hp > 0 && a.kind === 'ground' && a.team === 'friendly' && a.armyId === army.id).length;
    const reserved = state.reinforcementTickets.filter(t => t.team === 'friendly' && t.armyId === army.id && t.status === 'reserved').reduce((n, t) => n + t.reservedCapacity, 0);
    if (alive + reserved > 32) throw new Error('Friendly capacity exceeded');
  }
  for (let lane = 0; lane < 7; lane++) {
    const tickets = state.reinforcementTickets.filter(t => t.team === 'enemy' && t.laneId === lane && t.status === 'reserved');
    const ground = state.actors.filter(a => a.hp > 0 && a.team === 'enemy' && a.laneId === lane && a.kind === 'ground').length;
    const dragons = state.actors.filter(a => a.hp > 0 && a.team === 'enemy' && a.laneId === lane && a.kind === 'dragon').length;
    if (ground + tickets.reduce((n, t) => n + countClasses(t.classCounts), 0) > 32 || dragons + tickets.reduce((n, t) => n + t.dragonCount, 0) > 2) throw new Error('Enemy capacity exceeded');
  }
  if (state.projectiles.length > 4096) throw new Error('Projectile capacity exceeded');
}

/** The only owner of battle time; rendering and wall time cannot advance it. */
export class Campaign {
  readonly state: CampaignState;
  private emit: CampaignEmit;
  constructor(mode: CampaignMode = 'normal', seed = 20261005) {
    if (mode !== 'normal' && mode !== 'easy') throw new RangeError('Unknown campaign mode');
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be a uint32');
    const heading = { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    const initialReserve = Object.fromEntries(GROUND_CLASSES.map(c => [c, INITIAL_CLASSES[c] * (mode === 'easy' ? 2 : 1)])) as ClassCounts;
    this.state = {
      runId: `fantasia:${seed}:${++runOrdinal}`, rulesVersion: CAMPAIGN_RULES_VERSION, mapVersion: CAMPAIGN_MAP_VERSION,
      seed, rngState: seed || 1, mode, startHeading: 0, status: 'running', simTick: 0, activeTicks: 0, respawnPenaltyTicks: 0, livesRemaining: 3,
      player: { id: 0, generation: 1, hp: 100, maxHp: 100, position: { x: 0, y: 300, z: 0 }, previous: { x: 0, y: 300, z: 0 }, velocity: { x: 110, y: 0, z: 0 }, radius: 8, mg: 288, cannon: 96, bombs: 2, reloadUntilTick: null, bombReloadUntilTick: null, nextMgTick: 0, nextCannonTick: 0, protectionTicks: 0, boundaryTicks: 600, quaternion: { ...heading }, previousQuaternion: { ...heading } },
      sites: Array.from({ length: 7 }, (_, id) => ({ id, position: radialPosition(id, 1000), owner: 'enemy', ownerGeneration: 1, challenger: null, progress: 0, captureProgress: 0, turretId: -1, contested: false, firstFriendlyCaptureTick: null, lastOwnerChangeTick: 0, depletedSinceTick: null, rescueCooldownUntilTick: 0 })),
      actors: [], projectiles: [], armies: Array.from({ length: 7 }, (_, id) => ({ id, siteId: id, reserves: { ...initialReserve }, initialReserves: { ...initialReserve }, reserveCount: countClasses(initialReserve), reservedCapacity: 0, status: 'march' })),
      reinforcementTickets: [], rescueMissions: [], events: [], result: null, resultSnapshot: null,
      nextEntityId: 1, nextProjectileId: 1, nextEventId: 1, nextTicketId: 1, nextMissionId: 1,
      friendlyDamage: 0, friendlyKills: 0, friendlyLosses: 0, enemyKills: 0, selfLosses: 0, destroyedInitialTurretIds: [], firstCapturedSiteIds: [], lossReason: null,
    };
    this.emit = event => {
      const id = this.state.nextEventId++, complete = { ...event, id, eventId: id, tick: this.state.simTick };
      this.state.events.push(complete); return complete;
    };
    for (let lane = 0; lane < 7; lane++) {
      for (const team of ['friendly', 'enemy'] as const) {
        let slot = 0;
        for (const actorClass of GROUND_CLASSES) for (let j = 0; j < INITIAL_CLASSES[actorClass]; j++) {
          this.spawnActor(team, actorClass, lane, team === 'friendly' ? lane : null, formationPosition(lane, team === 'friendly' ? 1320 : 970, slot, actorClass), 'initial', 0, slot++);
        }
      }
      const site = this.state.sites[lane], { u } = laneBasis(lane);
      const dragonPosition = addVec(site.position, scaleVec(u, 180)); dragonPosition.y = terrainHeight(dragonPosition.x, dragonPosition.z) + 180;
      this.spawnActor('enemy', 'dragon', lane, null, dragonPosition, 'initial');
      const turret = this.spawnActor('enemy', 'turret', lane, null, radialPosition(lane, 1000, 6), 'initial'); site.turretId = turret.id;
    }
    validateCampaignState(this.state);
  }
  spawnActor(team: CampaignTeam, actorClass: ActorClass, laneId: number, armyId: number | null, position: Vec, origin: Origin = 'initial', waveOrdinal = 0, slot = 0): CampaignActor {
    const actor = makeCampaignActor(this.state.nextEntityId++, team, actorClass, laneId, armyId, position, origin, waveOrdinal, slot);
    this.state.actors.push(actor); return actor;
  }
  private finalize(status: 'victory' | 'defeat', reason: string): void {
    const state = this.state; state.status = status; cancelAllTickets(state);
    const breakdown = campaignScore(state, status === 'victory');
    const result: CampaignResult = {
      status, reason, activeTicks: state.activeTicks, respawnPenaltyTicks: state.respawnPenaltyTicks,
      recordTicks: state.activeTicks + state.respawnPenaltyTicks, capturedSites: state.sites.filter(s => s.owner === 'friendly').length,
      livesRemaining: state.livesRemaining, score: breakdown.total, breakdown,
      friendlyLosses: state.friendlyLosses, enemyKills: state.enemyKills, selfLosses: state.selfLosses,
      mode: state.mode, seed: state.seed, rulesVersion: state.rulesVersion, mapVersion: state.mapVersion, startHeading: state.startHeading,
    };
    state.result = deepFreeze(result); state.resultSnapshot = state.result;
    this.emit({ kind: status, reason });
  }
  step(input: CampaignInput = {}): void {
    const state = this.state; if (state.status !== 'running') return;
    const player = state.player; state.events = [];
    player.previous = copyVec(player.position); player.previousQuaternion = { ...(input.previousQuaternion ?? player.quaternion) };
    if (input.playerVelocity) { validVec(input.playerVelocity); player.velocity = copyVec(input.playerVelocity); }
    if (input.playerPosition) { validVec(input.playerPosition); player.position = copyVec(input.playerPosition); }
    else player.position = addVec(player.position, scaleVec(player.velocity, CAMPAIGN_DT));
    if (input.playerQuaternion) player.quaternion = { ...input.playerQuaternion };
    moveActors(state); tickPlayerAmmo(state);
    const terrainContact = aircraftTerrainContact(player), combat = collectCombat(state, this.emit);
    applyDamages(state, combat.damages, this.emit);
    const outside = Math.hypot(player.position.x, player.position.z) > 2100;
    player.boundaryTicks = outside ? Math.max(0, player.boundaryTicks - 1) : 600;
    const lossReason = terrainContact ? '地形に接触' : player.hp <= 0 ? '撃墜' : player.boundaryTicks === 0 ? '作戦圏外' : null;
    let selfLoss = false;
    if (lossReason) {
      selfLoss = true; player.hp = 0; state.livesRemaining = Math.max(0, state.livesRemaining - 1); state.selfLosses++; state.lossReason = lossReason;
      if (state.livesRemaining > 0) state.respawnPenaltyTicks += 600;
      this.emit({ kind: 'selfLoss', targetRef: { id: player.id, generation: player.generation }, position: copyVec(terrainContact ?? player.position), reason: lossReason });
    }
    state.actors = state.actors.filter(a => a.hp > 0 || a.kind === 'turret');
    updateCapture(state, this.emit); state.activeTicks++;
    const noFriendly = !state.actors.some(a => a.hp > 0 && a.kind === 'ground' && a.team === 'friendly');
    const noReserves = !state.armies.some(a => countClasses(a.reserves) > 0);
    const noTickets = !state.reinforcementTickets.some(t => t.team === 'friendly' && isValidReservedTicket(state, t));
    if (state.livesRemaining === 0) this.finalize('defeat', state.lossReason ?? '残機なし');
    else if (noFriendly && noReserves && noTickets) this.finalize('defeat', '全軍の再建不能');
    else if (state.sites.every(site => site.owner === 'friendly')) this.finalize('victory', '7陣地を同時占領');
    else if (state.activeTicks >= CAMPAIGN_LIMIT_TICKS) this.finalize('defeat', '作戦期限20分');
    else {
      commitActorFire(state, combat.readyToFire, this.emit); commitPlayerFire(state, input, this.emit);
      processLogistics(state, (...args) => this.spawnActor(...args), this.emit); updateArmyStates(state);
      if (selfLoss) state.status = 'respawning';
    }
    if (player.protectionTicks > 0) player.protectionTicks--;
    state.events.sort((a, b) => a.id - b.id); state.simTick++;
  }
  /** Wall-time animation is owned by the adapter; this never adds elapsed time. */
  resumeRespawn(): void {
    const state = this.state; if (state.status !== 'respawning') return;
    const enemy = state.projectiles.filter(p => p.team === 'enemy'), candidates = Array.from({ length: 7 }, (_, offset) => radialPosition((state.startHeading + offset) % 7, 250));
    for (const candidate of candidates) candidate.y = Math.max(300, candidate.y + 200);
    let best = candidates[0], separation = -Infinity;
    for (const candidate of candidates) {
      const minimum = enemy.reduce((min, p) => Math.min(min, distanceSquared(candidate, p.position)), Infinity);
      if (minimum > separation + 1e-8) { separation = minimum; best = candidate; }
    }
    const player = state.player;
    player.hp = player.maxHp; player.generation++; player.position = copyVec(best); player.previous = copyVec(best);
    player.velocity = { x: 110, y: 0, z: 0 }; player.quaternion = { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }; player.previousQuaternion = { ...player.quaternion };
    player.mg = 288; player.cannon = 96; player.bombs = 2; player.reloadUntilTick = null; player.bombReloadUntilTick = null;
    player.nextMgTick = state.simTick; player.nextCannonTick = state.simTick; player.protectionTicks = 120; player.boundaryTicks = 600;
    state.status = 'running'; state.lossReason = null; state.events = [];
    this.emit({ kind: 'respawn', targetRef: { id: player.id, generation: player.generation }, position: copyVec(best) });
  }
  snapshot(): CampaignState { return deepFreeze(structuredClone(this.state)); }
  dispose(): void { cancelAllTickets(this.state); }
}
