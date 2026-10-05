import type { ActorClass, CampaignActor, CampaignEvent, CampaignInput, CampaignPlayer, CampaignProjectile, CampaignState, EntityRef, ProjectileKind, Vec } from './campaign-types';
import { ACTOR_STATS, CAMPAIGN_DT, classDamage, MAX_PROJECTILES } from './campaign-config';
import { addVec, copyVec, distanceSquared, laneBasis, lerpVec, normalized, quantizeLanePosition, radialPosition, route, scaleVec, segmentSphereEntry, subtractVec, sweepObstacles, sweepSphere, terrainHeight, TERRAIN_OBSTACLES, xzDistanceSquared } from './campaign-terrain';
import { rotateVec, sweptPlayerHit } from './campaign-airframe';

export type CampaignEmit = (event: Omit<CampaignEvent, 'id' | 'eventId' | 'tick'>) => CampaignEvent;
type Target = CampaignActor | CampaignPlayer;
export interface PendingDamage { id: number; sourceRef: EntityRef; sourceClass: ActorClass | 'player'; team: 'friendly' | 'enemy'; fromPlayer: boolean; targetRef: EntityRef; damage: number; weapon: ProjectileKind | ActorClass; position: Vec }
export interface CombatTick { damages: PendingDamage[]; readyToFire: CampaignActor[]; grid: ActorGrid }
export function entityRef(entity: { id: number; generation: number }): EntityRef { return { id: entity.id, generation: entity.generation }; }
export function resolveTarget(state: CampaignState, ref: EntityRef | null): Target | null {
  if (!ref) return null;
  const candidate = ref.id === state.player.id ? state.player : state.actors.find(a => a.id === ref.id);
  return candidate && candidate.generation === ref.generation && candidate.hp > 0 ? candidate : null;
}
export function isPlayer(actor: Target): actor is CampaignPlayer { return !('kind' in actor); }
function teamOf(target: Target): 'friendly' | 'enemy' { return isPlayer(target) ? 'friendly' : target.team; }
function classOf(target: Target): ActorClass | 'player' { return isPlayer(target) ? 'player' : target.class; }
function isGround(target: Target): target is CampaignActor & { kind: 'ground' } { return !isPlayer(target) && target.kind === 'ground'; }

/** Search optimization only: oracle functions below retain all-search semantics. */
export class ActorGrid {
  private cells = new Map<string, CampaignActor[]>();
  readonly size = 40;
  constructor(readonly actors: readonly CampaignActor[]) {
    for (const actor of actors) if (actor.hp > 0) {
      const minX = Math.floor((Math.min(actor.previous.x, actor.position.x) - actor.radius) / this.size);
      const maxX = Math.floor((Math.max(actor.previous.x, actor.position.x) + actor.radius) / this.size);
      const minZ = Math.floor((Math.min(actor.previous.z, actor.position.z) - actor.radius) / this.size);
      const maxZ = Math.floor((Math.max(actor.previous.z, actor.position.z) + actor.radius) / this.size);
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        const key = `${x},${z}`, bucket = this.cells.get(key); if (bucket) bucket.push(actor); else this.cells.set(key, [actor]);
      }
    }
  }
  queryBounds(minX: number, minZ: number, maxX: number, maxZ: number): CampaignActor[] {
    const seen = new Set<number>(), result: CampaignActor[] = [];
    for (let x = Math.floor(minX / this.size); x <= Math.floor(maxX / this.size); x++) for (let z = Math.floor(minZ / this.size); z <= Math.floor(maxZ / this.size); z++) {
      for (const actor of this.cells.get(`${x},${z}`) ?? []) if (!seen.has(actor.id)) { seen.add(actor.id); result.push(actor); }
    }
    return result.sort((a, b) => a.id - b.id);
  }
  queryRadius(center: Vec, radius: number): CampaignActor[] { return this.queryBounds(center.x - radius, center.z - radius, center.x + radius, center.z + radius); }
  querySegment(from: Vec, to: Vec, radius: number): CampaignActor[] { return this.queryBounds(Math.min(from.x, to.x) - radius, Math.min(from.z, to.z) - radius, Math.max(from.x, to.x) + radius, Math.max(from.z, to.z) + radius); }
}

export function attackEligible(state: CampaignState, source: CampaignActor, target: Target): boolean {
  if (source.hp <= 0 || target.hp <= 0 || teamOf(target) === source.team) return false;
  if (isPlayer(target) && (state.player.protectionTicks > 0 || state.player.hp <= 0)) return false;
  const stats = ACTOR_STATS[source.class], distance = Math.sqrt(distanceSquared(source.position, target.position));
  if (source.class === 'sword' || source.class === 'cavalry') {
    if (isPlayer(target) || !isGround(target) && target.class !== 'turret') return false;
    if (Math.max(0, distance - source.radius - target.radius) > stats.range + 1e-8) return false;
  } else {
    const range = source.class === 'turret' && !isPlayer(target) ? 500 : stats.range;
    if (distance > range + 1e-8) return false;
    if ((source.class === 'bow' || source.class === 'mage') && !isGround(target) && classOf(target) !== 'turret') {
      if (target.position.y - terrainHeight(target.position.x, target.position.z) > 120 + 1e-8) return false;
    }
    if (source.class === 'turret' && !isPlayer(target) && !isGround(target)) return false;
    if (source.class === 'dragon' && !isPlayer(target) && (!isGround(target) || target.assignedSiteId !== source.laneId)) return false;
  }
  return sweepSphere(source.position, target.position, 0) === null;
}
const PRIORITIES: Record<string, readonly (ActorClass | 'player')[]> = {
  sword: ['bow', 'mage', 'sword', 'cavalry', 'turret'], bow: ['mage', 'dragon', 'player', 'sword', 'bow', 'cavalry', 'turret'],
  mage: ['cavalry', 'dragon', 'player', 'sword', 'bow', 'mage', 'turret'], cavalry: ['sword', 'bow', 'mage', 'cavalry', 'turret'],
};
function candidateRank(source: CampaignActor, target: Target, tick: number): number[] {
  const attacks = source.lastAttackers.filter(a => a.ref.id === target.id && a.ref.generation === target.generation && tick - a.tick <= 180);
  const recent = attacks.reduce((n, a) => Math.max(n, a.tick), -Infinity);
  const priorities = PRIORITIES[source.class] ?? [];
  const targetClass = classOf(target), priority = priorities.indexOf(targetClass === 'player' ? 'dragon' : targetClass);
  if (recent !== -Infinity) return [0, -recent, 0, distanceSquared(source.position, target.position), target.id];
  return [1, 0, priority < 0 ? 999 : priority, distanceSquared(source.position, target.position), target.id];
}
function compareRank(a: number[], b: number[]): number { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > (i === 3 ? 1e-8 : 0)) return a[i] - b[i]; return 0; }
export function selectTarget(state: CampaignState, source: CampaignActor, actors: readonly CampaignActor[] = state.actors): Target | null {
  if (source.class === 'turret' || source.class === 'dragon') {
    if (attackEligible(state, source, state.player)) return state.player;
    const candidates = actors.filter(a => a.team !== source.team && isGround(a) && attackEligible(state, source, a));
    candidates.sort((a, b) => {
      if (source.class === 'turret') {
        const site = state.sites[source.laneId].position;
        const aInside = xzDistanceSquared(a.position, site) <= 55 ** 2, bInside = xzDistanceSquared(b.position, site) <= 55 ** 2;
        if (aInside !== bInside) return aInside ? -1 : 1;
      }
      const distance = distanceSquared(source.position, a.position) - distanceSquared(source.position, b.position);
      return Math.abs(distance) > 1e-8 ? distance : a.id - b.id;
    });
    return candidates[0] ?? null;
  }
  const candidates: Target[] = actors.filter(a => attackEligible(state, source, a));
  if (attackEligible(state, source, state.player)) candidates.push(state.player);
  candidates.sort((a, b) => compareRank(candidateRank(source, a, state.simTick), candidateRank(source, b, state.simTick)));
  return candidates[0] ?? null;
}
function groundDestination(state: CampaignState, actor: CampaignActor, grid: ActorGrid): Vec {
  const site = state.sites[actor.assignedSiteId], basis = laneBasis(site.id);
  if (actor.replanWaypoint && xzDistanceSquared(actor.position, actor.replanWaypoint) < 3 ** 2) actor.replanWaypoint = null;
  if (actor.blockedTicks >= 120 && !actor.replanWaypoint) {
    // Rejoin the fixed radial road at the current radial progress. The
    // movement still obeys the ordinary speed/solid sweep, never a warp.
    const radial = Math.max(650, Math.min(1320, actor.position.x * basis.u.x + actor.position.z * basis.u.z));
    actor.replanWaypoint = radialPosition(site.id, radial); actor.blockedTicks = 0;
  }
  if (actor.replanWaypoint) return actor.replanWaypoint;
  if (actor.coverPosition && state.simTick >= actor.coverUntilTick) actor.coverPosition = null;
  if (!actor.coverPosition && xzDistanceSquared(actor.position, site.position) <= 160 ** 2) {
    const threat = state.actors.find(a => a.hp > 0 && a.kind === 'dragon' && a.team !== actor.team && a.phase === 'telegraph'
      && (a.targetRef?.id === actor.id && a.targetRef.generation === actor.generation
        || a.lockedAim && xzDistanceSquared(a.lockedAim, actor.position) <= 15 ** 2));
    if (threat) {
      const shelters: Vec[] = [];
      for (const rock of TERRAIN_OBSTACLES) if (Math.floor(rock.id / 2) === site.id) {
        const sourceSide = (threat.position.x - rock.position.x) * basis.u.x + (threat.position.z - rock.position.z) * basis.u.z;
        const shelter = addVec(rock.position, scaleVec(basis.u, (sourceSide >= 0 ? -1 : 1) * (rock.halfSize.x + actor.radius + 2)));
        shelter.y = terrainHeight(shelter.x, shelter.z) + (actor.class === 'cavalry' ? 1.5 : 1);
        if (xzDistanceSquared(shelter, site.position) <= 160 ** 2 && sweepObstacles(shelter, shelter, actor.radius) === null) shelters.push(shelter);
      }
      shelters.sort((a, b) => {
        const difference = xzDistanceSquared(a, actor.position) - xzDistanceSquared(b, actor.position);
        // Tangential order is relative to the rotated lane, not world X/Z.
        return Math.abs(difference) > 1e-8 ? difference : (a.x - b.x) * basis.v.x + (a.z - b.z) * basis.v.z;
      });
      if (shelters.length) { actor.coverPosition = shelters[0]; actor.coverUntilTick = state.simTick + 120; }
    }
  }
  if (actor.coverPosition) { actor.movementState = 'engage'; return actor.coverPosition; }
  if (actor.rescueMissionId !== null) {
    const mission = state.rescueMissions.find(m => m.id === actor.rescueMissionId && m.status === 'enroute');
    if (mission && xzDistanceSquared(actor.position, site.position) > 80 ** 2) {
      const points = route(mission.donorSiteId, mission.recipientSiteId);
      let closest = 0;
      for (let i = 1; i < points.length; i++) if (xzDistanceSquared(actor.position, points[i]) < xzDistanceSquared(actor.position, points[closest])) closest = i;
      actor.movementState = 'rescue'; return points[Math.min(closest + 1, points.length - 1)];
    }
  }
  // Ranged units advance into the circle rather than remaining on a remote
  // firing line forever. Melee follows only local threats and returns after.
  if ((actor.class === 'sword' || actor.class === 'cavalry') && xzDistanceSquared(actor.position, site.position) <= 160 ** 2) {
    const nearby = grid.queryRadius(site.position, 160).filter(a => a.team !== actor.team && a.hp > 0 && a.kind !== 'dragon' && xzDistanceSquared(a.position, site.position) <= 160 ** 2);
    nearby.sort((a, b) => {
      const d = distanceSquared(actor.position, a.position) - distanceSquared(actor.position, b.position);
      return Math.abs(d) > 1e-8 ? d : a.id - b.id;
    });
    const target = nearby[0];
    if (target) {
      const reach = ACTOR_STATS[actor.class].range + actor.radius + target.radius;
      if (distanceSquared(actor.position, target.position) > reach * reach * .81) { actor.movementState = 'engage'; return copyVec(target.position); }
    }
  }
  const index = actor.slot % 32, tangent = ((index % 6) - 2.5) * 8, radial = (Math.floor(index / 6) - 1.5) * 10;
  const x = site.position.x + basis.v.x * tangent + basis.u.x * radial;
  const z = site.position.z + basis.v.z * tangent + basis.u.z * radial;
  actor.movementState = site.owner === actor.team ? 'garrison' : xzDistanceSquared(actor.position, site.position) <= 55 ** 2 ? 'capture' : 'march';
  return { x, y: terrainHeight(x, z), z };
}
/** All movement candidates use the same tick-start positions. */
export function moveActors(state: CampaignState): void {
  const ground = state.actors.filter(a => a.hp > 0 && a.kind === 'ground'), initialGrid = new ActorGrid(state.actors);
  const candidates = new Map<number, Vec>();
  for (const actor of state.actors) {
    actor.previous = copyVec(actor.position); actor.velocity = { x: 0, y: 0, z: 0 };
    if (actor.hp <= 0 || actor.kind === 'turret') continue;
    if (actor.kind === 'dragon') {
      const site = state.sites[actor.laneId], phase = state.simTick * ACTOR_STATS.dragon.speed / 180 / 60 + actor.laneId * 2 * Math.PI / 7 + (actor.waveOrdinal % 2) * Math.PI;
      const angle = phase, x = site.position.x + 180 * Math.cos(angle), z = site.position.z + 180 * Math.sin(angle);
      const altitude = 180 + 50 * Math.sin(state.simTick / 450 + (actor.waveOrdinal % 2) * Math.PI);
      const destination = { x, y: terrainHeight(x, z) + altitude, z }, delta = subtractVec(destination, actor.position);
      const distance = Math.hypot(delta.x, delta.y, delta.z);
      const maximumStep = 50 / 60 - 1e-6;
      actor.position = quantizeLanePosition(distance > maximumStep ? addVec(actor.position, scaleVec(delta, maximumStep / distance)) : destination, actor.laneId);
      actor.velocity = scaleVec(subtractVec(actor.position, actor.previous), 60); continue;
    }
    if (actor.phase === 'telegraph') { candidates.set(actor.id, copyVec(actor.position)); continue; }
    const destination = groundDestination(state, actor, initialGrid), delta = subtractVec(destination, actor.position); delta.y = 0;
    const distance = Math.hypot(delta.x, delta.z), step = Math.min(distance, ACTOR_STATS[actor.class].speed * CAMPAIGN_DT);
    const candidate = distance > 1e-8 ? addVec(actor.position, scaleVec(delta, step / distance)) : copyVec(actor.position);
    candidate.y = terrainHeight(candidate.x, candidate.z) + (actor.class === 'cavalry' ? 1.5 : 1);
    const collision = sweepObstacles(actor.position, candidate, actor.radius);
    if (collision && collision.obstacleId !== null) {
      actor.blockedTicks++;
      // Deterministic tangential avoidance stays within the road corridor.
      const { v } = laneBasis(actor.assignedSiteId), side = actor.slot % 2 === 0 ? -1 : 1;
      const alternative = addVec(actor.position, scaleVec(v, step * side)); alternative.y = terrainHeight(alternative.x, alternative.z) + (actor.class === 'cavalry' ? 1.5 : 1);
      const retry = sweepObstacles(actor.position, alternative, actor.radius);
      candidates.set(actor.id, retry?.obstacleId !== null && retry ? copyVec(actor.position) : alternative);
    } else { actor.blockedTicks = 0; candidates.set(actor.id, candidate); }
  }
  // Symmetric accumulated pushbacks avoid sequential ID advantages. The pair
  // order is stable and is independent of the site array traversal.
  for (const actor of ground) actor.position = candidates.get(actor.id) ?? actor.position;
  const corrections = new Map<number, Vec>(), candidateActors = state.actors.filter(a => a.hp > 0 && a.kind !== 'dragon');
  const candidateGrid = new ActorGrid(candidateActors);
  for (const actor of candidateActors) if (actor.kind === 'ground') {
    for (const other of candidateGrid.queryRadius(actor.position, actor.radius + 6.5)) {
      if (other.id === actor.id || other.kind === 'ground' && other.id < actor.id) continue;
      const separation = actor.radius + other.radius + (actor.team === other.team ? .2 : 0);
      const dy = actor.position.y - other.position.y, requiredXZ = Math.sqrt(Math.max(0, separation ** 2 - dy ** 2));
      const dx = actor.position.x - other.position.x, dz = actor.position.z - other.position.z, distance = Math.hypot(dx, dz);
      if (distance >= requiredXZ || requiredXZ <= 0) continue;
      const { v } = laneBasis(actor.assignedSiteId), nx = distance > 1e-9 ? dx / distance : v.x, nz = distance > 1e-9 ? dz / distance : v.z;
      const push = requiredXZ - distance, factor = other.kind === 'turret' ? 1 : .5;
      const update = (id: number, amount: number) => { const old = corrections.get(id) ?? { x: 0, y: 0, z: 0 }; old.x += nx * amount; old.z += nz * amount; corrections.set(id, old); };
      update(actor.id, push * factor); if (other.kind === 'ground') update(other.id, -push * factor);
    }
  }
  for (const actor of ground) {
    const candidate = candidates.get(actor.id) ?? actor.position, correction = corrections.get(actor.id);
    if (correction) { candidate.x += correction.x; candidate.z += correction.z; }
    // Units do not cross the operation boundary or acquire arbitrary road
    // shortcuts through solid terrain.
    const r = Math.hypot(candidate.x, candidate.z);
    if (r > 2050) { candidate.x *= 2050 / r; candidate.z *= 2050 / r; }
    candidate.y = terrainHeight(candidate.x, candidate.z) + (actor.class === 'cavalry' ? 1.5 : 1);
    const finalCollision = sweepObstacles(actor.previous, candidate, actor.radius);
    if (finalCollision) {
      const fraction = Math.max(0, finalCollision.fraction - 1e-4);
      actor.position = lerpVec(actor.previous, candidate, fraction);
      actor.position.y = terrainHeight(actor.position.x, actor.position.z) + (actor.class === 'cavalry' ? 1.5 : 1);
    } else actor.position = candidate;
    actor.position = quantizeLanePosition(actor.position, actor.assignedSiteId);
    actor.velocity = scaleVec(subtractVec(actor.position, actor.previous), 60);
  }
}

export function predictAim(origin: Vec, target: Target, speed: number): Vec {
  const p = subtractVec(target.position, origin), v = target.velocity;
  const a = v.x ** 2 + v.y ** 2 + v.z ** 2 - speed ** 2, b = 2 * (p.x * v.x + p.y * v.y + p.z * v.z), c = p.x ** 2 + p.y ** 2 + p.z ** 2;
  let time = Math.sqrt(c) / speed;
  if (Math.abs(a) < 1e-9) { if (Math.abs(b) > 1e-9 && -c / b >= 0) time = -c / b; }
  else { const d = b * b - 4 * a * c; if (d >= 0) { const r = Math.sqrt(d), t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a); const roots = [t1, t2].filter(t => t >= 0); if (roots.length) time = Math.min(...roots); } }
  return addVec(target.position, scaleVec(v, Math.min(8, time)));
}
function projectileCanHit(state: CampaignState, projectile: CampaignProjectile, actor: CampaignActor): boolean {
  if (actor.hp <= 0 || actor.id === projectile.sourceRef.id && actor.generation === projectile.sourceRef.generation) return false;
  if (actor.team === projectile.team) return projectile.kind !== 'bomb' && projectile.fromPlayer && state.mode === 'normal' && actor.kind === 'ground';
  return true;
}
export interface ProjectileActorHit { fraction: number; actor: Target }
export function projectileActorHitOracle(state: CampaignState, projectile: CampaignProjectile, candidates: readonly CampaignActor[] = state.actors): ProjectileActorHit | null {
  let earliest: ProjectileActorHit | null = null;
  for (const actor of candidates) if (projectileCanHit(state, projectile, actor)) {
    const fraction = segmentSphereEntry(subtractVec(projectile.previous, actor.previous), subtractVec(projectile.position, actor.position), actor.radius + projectile.radius);
    if (fraction !== null && (!earliest || fraction < earliest.fraction - 1e-10 || Math.abs(fraction - earliest.fraction) <= 1e-10 && actor.id < earliest.actor.id)) earliest = { fraction, actor };
  }
  if (!projectile.fromPlayer && projectile.team === 'enemy' && state.player.hp > 0 && state.player.protectionTicks <= 0) {
    const fraction = sweptPlayerHit(projectile.previous, projectile.position, state.player, projectile.radius);
    if (fraction !== null && (!earliest || fraction < earliest.fraction - 1e-10 || Math.abs(fraction - earliest.fraction) <= 1e-10 && state.player.id < earliest.actor.id)) earliest = { fraction, actor: state.player };
  }
  return earliest;
}
export function projectileActorHit(state: CampaignState, projectile: CampaignProjectile, grid: ActorGrid): ProjectileActorHit | null {
  return projectileActorHitOracle(state, projectile, grid.querySegment(projectile.previous, projectile.position, projectile.radius));
}
function pendingHit(state: CampaignState, projectile: CampaignProjectile, target: Target, raw: number, position: Vec): PendingDamage {
  let damage = classDamage(projectile.sourceClass, classOf(target), raw);
  if (projectile.fromPlayer && !isPlayer(target) && target.class === 'turret' && projectile.kind === 'mg') damage = Math.floor(damage * .25 + .5);
  if (projectile.fromPlayer && teamOf(target) === 'friendly') damage = state.mode === 'normal' ? Math.ceil(damage * .25) : 0;
  if (isPlayer(target) && state.player.protectionTicks > 0) damage = 0;
  return { id: state.nextEventId++, sourceRef: { ...projectile.sourceRef }, sourceClass: projectile.sourceClass, team: projectile.team, fromPlayer: projectile.fromPlayer, targetRef: entityRef(target), damage, weapon: projectile.kind, position };
}
function explosion(state: CampaignState, projectile: CampaignProjectile, point: Vec, direct: Target | null, damages: PendingDamage[], emit: CampaignEmit): void {
  const radius = projectile.kind === 'bomb' ? 45 : 10, maximum = projectile.kind === 'bomb' ? 240 : 12;
  const aboveGround = { ...point, y: Math.max(point.y, terrainHeight(point.x, point.z)) + .1 };
  const targets: Target[] = [...state.actors.filter(a => a.hp > 0), state.player];
  for (const target of targets) {
    if (target.hp <= 0 || projectile.kind === 'fireball' && teamOf(target) === projectile.team) continue;
    if (projectile.kind === 'bomb' && teamOf(target) === projectile.team && (!projectile.fromPlayer || state.mode === 'easy')) continue;
    const distance = Math.sqrt(distanceSquared(point, target.position)), isDirect = direct?.id === target.id;
    if (distance > radius && !isDirect) continue;
    if (sweepSphere(aboveGround, target.position, 0) !== null) continue;
    const blast = Math.floor(Math.max(0, maximum * (1 - distance / radius)) + .5);
    const raw = Math.max(blast, isDirect ? projectile.damage : 0);
    if (raw > 0) damages.push(pendingHit(state, projectile, target, raw, copyVec(point)));
  }
  emit({ kind: 'explosion', sourceRef: projectile.sourceRef, sourceTeamAtFire: projectile.team, position: copyVec(point), weapon: projectile.kind });
}
function stepExistingProjectiles(state: CampaignState, grid: ActorGrid, damages: PendingDamage[], emit: CampaignEmit): void {
  const survivors: CampaignProjectile[] = [];
  for (const projectile of state.projectiles) {
    projectile.previous = copyVec(projectile.position);
    if (projectile.kind === 'bomb') {
      projectile.position = addVec(projectile.position, scaleVec(projectile.velocity, CAMPAIGN_DT));
      projectile.position.y -= .5 * 9.81 * CAMPAIGN_DT ** 2; projectile.velocity.y -= 9.81 * CAMPAIGN_DT;
    } else projectile.position = addVec(projectile.position, scaleVec(projectile.velocity, CAMPAIGN_DT));
    projectile.position = quantizeLanePosition(projectile.position, projectile.laneId ?? state.startHeading);
    projectile.ttl--;
    // Bombs detonate on solid scenery or enemy bodies; friendly bodies cannot
    // trigger early detonation in either mode.
    const obstacle = sweepSphere(projectile.previous, projectile.position, projectile.kind === 'bomb' ? 0 : projectile.radius);
    const hit = projectileActorHit(state, projectile, grid);
    if (obstacle && (!hit || obstacle.fraction <= hit.fraction + 1e-10)) {
      if (projectile.ttl <= 0 && obstacle.fraction >= 1 - 1e-10) continue;
      if (projectile.kind === 'bomb' || projectile.kind === 'fireball') explosion(state, projectile, obstacle.point, null, damages, emit);
      continue;
    }
    if (hit) {
      if (projectile.ttl <= 0 && hit.fraction >= 1 - 1e-10) continue;
      const point = lerpVec(projectile.previous, projectile.position, hit.fraction);
      if (projectile.kind === 'fireball' || projectile.kind === 'bomb') explosion(state, projectile, point, hit.actor, damages, emit);
      else damages.push(pendingHit(state, projectile, hit.actor, projectile.damage, point));
      continue;
    }
    if (projectile.ttl > 0) survivors.push(projectile);
  }
  state.projectiles = survivors;
}
export function collectCombat(state: CampaignState, emit: CampaignEmit): CombatTick {
  const grid = new ActorGrid(state.actors), damages: PendingDamage[] = [], readyToFire: CampaignActor[] = [];
  stepExistingProjectiles(state, grid, damages, emit);
  const t = state.simTick;
  for (const actor of state.actors) if (actor.hp > 0) {
    if (actor.phase === 'recovery' && t >= actor.cooldownUntilTick) actor.phase = 'idle';
    const retainedTarget = resolveTarget(state, actor.targetRef);
    if (actor.phase === 'idle' && t >= actor.cooldownUntilTick && (actor.kind !== 'ground' || t % 12 === 0 || !retainedTarget || !attackEligible(state, actor, retainedTarget))) {
      const range = ACTOR_STATS[actor.class].range + (actor.kind === 'ground' ? 10 : 0);
      const target = selectTarget(state, actor, grid.queryRadius(actor.position, range));
      actor.targetRef = target ? entityRef(target) : null;
      if (target) {
        actor.phase = 'telegraph'; actor.fireAtTick = t + ACTOR_STATS[actor.class].telegraph; actor.lockedAim = null;
        emit({ kind: 'telegraph', sourceRef: entityRef(actor), targetRef: entityRef(target), sourceTeamAtFire: actor.team, position: copyVec(actor.position), weapon: actor.class });
      }
    }
    if (actor.phase !== 'telegraph' || actor.fireAtTick === null) continue;
    const stats = ACTOR_STATS[actor.class], target = resolveTarget(state, actor.targetRef);
    if (stats.lock > 0 && actor.lockedAim === null && t === actor.fireAtTick - stats.lock && target) actor.lockedAim = quantizeLanePosition(predictAim(actor.position, target, stats.projectileSpeed), actor.laneId);
    if (t < actor.fireAtTick) continue;
    if (stats.projectileSpeed > 0) { readyToFire.push(actor); continue; }
    if (target && attackEligible(state, actor, target)) {
      damages.push({ id: state.nextEventId++, sourceRef: entityRef(actor), sourceClass: actor.class, team: actor.team, fromPlayer: false, targetRef: entityRef(target), damage: classDamage(actor.class, classOf(target), stats.damage), weapon: actor.class, position: copyVec(target.position) });
      actor.cooldownUntilTick = t + stats.recovery;
    } else actor.cooldownUntilTick = t + 30;
    actor.attackReadyTick = actor.cooldownUntilTick; actor.phase = 'recovery'; actor.fireAtTick = null; actor.lockedAim = null;
  }
  return { damages, readyToFire, grid };
}
/** Largest-remainder integer apportionment avoids overkill score inflation. */
export function allocateEffectiveDamage(hp: number, damages: readonly { id: number; damage: number }[]): number[] {
  const sum = damages.reduce((s, d) => s + d.damage, 0), effective = Math.min(hp, sum);
  if (sum <= 0) return damages.map(() => 0);
  const allocated = damages.map(d => Math.floor(effective * d.damage / sum));
  const ranks = damages.map((d, i) => ({ i, remainder: effective * d.damage % sum, id: d.id })).sort((a, b) => b.remainder - a.remainder || a.id - b.id);
  let remaining = effective - allocated.reduce((a, b) => a + b, 0);
  for (const ranked of ranks) { if (remaining-- <= 0) break; allocated[ranked.i]++; }
  return allocated;
}
export function applyDamages(state: CampaignState, damages: PendingDamage[], emit: CampaignEmit): void {
  const groups = new Map<number, PendingDamage[]>();
  for (const damage of damages) { const group = groups.get(damage.targetRef.id); if (group) group.push(damage); else groups.set(damage.targetRef.id, [damage]); }
  for (const [targetId, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const target = resolveTarget(state, group[0].targetRef); if (!target || target.id !== targetId) continue;
    const valid = group.filter(d => d.targetRef.generation === target.generation), effective = allocateEffectiveDamage(target.hp, valid);
    const total = effective.reduce((a, b) => a + b, 0), killed = total >= target.hp && total > 0;
    let credit = -1;
    for (let i = 0; i < valid.length; i++) if (credit < 0 || effective[i] > effective[credit] || effective[i] === effective[credit] && valid[i].id < valid[credit].id) credit = i;
    target.hp = Math.max(0, target.hp - total);
    for (let i = 0; i < valid.length; i++) {
      const damage = valid[i];
      state.events.push({ id: damage.id, eventId: damage.id, tick: state.simTick, kind: 'hit', sourceRef: damage.sourceRef, sourceTeamAtFire: damage.team, targetRef: damage.targetRef, weapon: damage.weapon, rawDamage: damage.damage, effectiveDamage: effective[i], killCredit: killed && credit === i, position: copyVec(damage.position) });
      if (damage.fromPlayer && teamOf(target) === 'friendly' && !isPlayer(target)) state.friendlyDamage += effective[i];
      if (!isPlayer(target) && effective[i] > 0) {
        target.lastAttackers = target.lastAttackers.filter(a => state.simTick - a.tick <= 180 && a.ref.id !== damage.sourceRef.id);
        target.lastAttackers.push({ ref: damage.sourceRef, tick: state.simTick });
      }
    }
    if (killed && !isPlayer(target)) {
      target.phase = 'idle'; target.fireAtTick = null; target.lockedAim = null;
      if (target.team === 'friendly') { state.friendlyLosses++; if (valid[credit]?.fromPlayer) state.friendlyKills++; }
      else state.enemyKills++;
      if (target.kind === 'turret' && target.origin === 'initial' && !state.destroyedInitialTurretIds.includes(target.id)) state.destroyedInitialTurretIds.push(target.id);
      emit({ kind: 'kill', sourceRef: valid[credit]?.sourceRef, sourceTeamAtFire: valid[credit]?.team, targetRef: entityRef(target), position: copyVec(target.position), weapon: valid[credit]?.weapon, team: target.team });
    }
  }
}
function spawnProjectile(state: CampaignState, source: CampaignActor | CampaignPlayer, kind: ProjectileKind, position: Vec, velocity: Vec, damage: number, ttl: number, radius: number, emit: CampaignEmit): void {
  if (state.projectiles.length >= MAX_PROJECTILES) throw new Error('Campaign projectile capacity 4096 exceeded');
  const player = isPlayer(source), projectile: CampaignProjectile = {
    id: state.nextProjectileId++, generation: 1, kind, team: teamOf(source), sourceRef: entityRef(source), sourceClass: classOf(source), fromPlayer: player, laneId: player ? state.startHeading : source.laneId,
    position: copyVec(position), previous: copyVec(position), velocity: copyVec(velocity), damage, ttl, radius, bornTick: state.simTick,
  };
  state.projectiles.push(projectile);
  emit({ kind: 'shot', sourceRef: entityRef(source), sourceTeamAtFire: projectile.team, position: copyVec(position), weapon: kind });
}
export function commitActorFire(state: CampaignState, ready: readonly CampaignActor[], emit: CampaignEmit): void {
  for (const actor of ready) {
    if (actor.hp <= 0) continue;
    const target = resolveTarget(state, actor.targetRef), stats = ACTOR_STATS[actor.class], origin = actor.position;
    if (!target || !attackEligible(state, actor, target) || sweepSphere(origin, origin, 0) !== null || !actor.lockedAim) actor.cooldownUntilTick = state.simTick + (actor.kind === 'ground' ? 30 : 60);
    else {
      const kind: ProjectileKind = actor.class === 'bow' ? 'arrow' : actor.class === 'mage' ? 'magic' : actor.class === 'dragon' ? 'fireball' : 'turret';
      spawnProjectile(state, actor, kind, origin, scaleVec(normalized(subtractVec(actor.lockedAim, origin)), stats.projectileSpeed), stats.damage, stats.ttl, kind === 'fireball' ? .6 : .2, emit);
      actor.cooldownUntilTick = state.simTick + stats.recovery;
    }
    actor.attackReadyTick = actor.cooldownUntilTick; actor.phase = 'recovery'; actor.fireAtTick = null; actor.lockedAim = null;
  }
}
export function tickPlayerAmmo(state: CampaignState): void {
  const player = state.player, t = state.simTick;
  if (player.reloadUntilTick !== null && t >= player.reloadUntilTick) { player.mg = 288; player.cannon = 96; player.reloadUntilTick = null; }
  if (player.bombReloadUntilTick !== null && t >= player.bombReloadUntilTick) { player.bombs = 2; player.bombReloadUntilTick = null; }
}
export function commitPlayerFire(state: CampaignState, input: CampaignInput, emit: CampaignEmit): void {
  const player = state.player, t = state.simTick;
  if (player.hp <= 0 || player.protectionTicks > 0) return;
  const forward = normalized(input.forward ?? rotateVec({ x: 0, y: 0, z: -1 }, player.quaternion));
  if (input.fire && player.reloadUntilTick === null) {
    for (const kind of ['mg', 'cannon'] as const) {
      const ammunition = player[kind], next = kind === 'mg' ? player.nextMgTick : player.nextCannonTick;
      if (ammunition < 2 || t < next) continue;
      if (state.projectiles.length + 2 > MAX_PROJECTILES) throw new Error('Campaign paired gun capacity exceeded');
      const offsets = kind === 'mg' ? [{ x: -.3, y: .52, z: -4.25 }, { x: .3, y: .52, z: -4.25 }] : [{ x: -2.5, y: 0, z: -2.4 }, { x: 2.5, y: 0, z: -2.4 }];
      const muzzles = input.gunMuzzles?.[kind] ?? (kind === 'mg' && input.muzzles?.length === 2 ? input.muzzles : offsets.map(v => addVec(player.position, rotateVec(v, player.quaternion))));
      if (muzzles.length !== 2) throw new RangeError('Both K gun muzzles are required');
      if (muzzles.some(v => sweepSphere(v, v, 0) !== null)) continue;
      const directions = input.shotDirections?.[kind] ?? [forward, forward];
      if (directions.length !== 2) throw new RangeError('Both K gun shot directions are required');
      const speed = Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z) + (kind === 'mg' ? 820 : 700);
      for (let i = 0; i < 2; i++) spawnProjectile(state, player, kind, muzzles[i], scaleVec(normalized(directions[i]), speed), kind === 'mg' ? 4 : 12, 90, .12, emit);
      player[kind] -= 2;
      if (kind === 'mg') player.nextMgTick = t + 5; else player.nextCannonTick = t + 15;
    }
    if (player.mg === 0 && player.cannon === 0) player.reloadUntilTick = t + 360;
  }
  if (input.bomb && player.bombs > 0) {
    if (state.projectiles.length >= MAX_PROJECTILES) throw new Error('Campaign bomb capacity exceeded');
    const origin = addVec(player.position, rotateVec({ x: 0, y: -.9, z: .4 }, player.quaternion));
    if (sweepSphere(origin, origin, 0) === null) {
      spawnProjectile(state, player, 'bomb', origin, player.velocity, 240, 1800, .35, emit); player.bombs--;
      if (player.bombs === 0) player.bombReloadUntilTick = t + 1800;
    }
  }
}
export interface BombPrediction { position: Vec; flightTicks: number; blockedBy: number | null; radius: number }
/** Uses the exact same fixed-step gravity and terrain sweep as live bombs. */
export function predictBombImpact(position: Vec, velocity: Vec, quaternion?: CampaignPlayer['quaternion'], laneId = 0): BombPrediction | null {
  let current = quaternion ? addVec(position, rotateVec({ x: 0, y: -.9, z: .4 }, quaternion)) : copyVec(position), speed = copyVec(velocity);
  for (let tick = 1; tick <= 1800; tick++) {
    const next = quantizeLanePosition(addVec(current, scaleVec(speed, CAMPAIGN_DT)), laneId); next.y = Math.round((current.y + speed.y * CAMPAIGN_DT - .5 * 9.81 * CAMPAIGN_DT ** 2) * 1e6) / 1e6; speed.y -= 9.81 * CAMPAIGN_DT;
    const hit = sweepSphere(current, next, 0);
    if (hit) return tick === 1800 && hit.fraction >= 1 - 1e-10 ? null : { position: hit.point, flightTicks: tick, blockedBy: hit.obstacleId, radius: 45 };
    current = next;
  }
  return null;
}
