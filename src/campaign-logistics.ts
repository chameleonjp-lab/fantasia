import {
  ACTOR_STATS, CAPTURE_MAX, CAPTURE_RADIUS, ENEMY_WAVE_CLASSES,
  GROUND_CLASSES, INITIAL_CLASSES, SITE_COUNT, countClasses, emptyClassCounts,
} from './campaign-config';
import { distanceSquared, laneBasis, radialPosition, route, terrainHeight, xzDistanceSquared } from './campaign-terrain';
import type {
  ActorClass, CampaignActor, CampaignArmy, CampaignEvent, CampaignSite,
  CampaignState, CampaignTeam, ClassCounts, GroundClass, Origin,
  ReinforcementTicket, RescueMission, Vec,
} from './campaign-types';

type Emit = (event: Omit<CampaignEvent, 'id' | 'eventId' | 'tick'>) => void;
type Spawn = (team: CampaignTeam, className: ActorClass, laneId: number,
  armyId: number | null, position: Vec, origin: Origin, waveOrdinal: number,
  slot: number) => CampaignActor;

// The sequence is serialized with the ticket, so delayed dispatch and restored
// snapshots preserve the per-body shortage allocation, rather than regrouping
// the chosen classes into a different formation.
type OrderedTicket = ReinforcementTicket & { classSequence?: GroundClass[] };
const GROUND_CAPACITY = 32;
const DRAGON_CAPACITY = 2;
const FRIENDLY_PERIOD = 1800;
const ENEMY_PERIOD = 2700;
const DRAGON_PERIOD = 5400;
const DISPATCH_DELAY = 300;
const SPAWN_RETRY_TICKS = 120;
const RESCUE_COUNT = 6;
const RESCUE_RADIUS = 80;
const RESCUE_COOLDOWN = 1800;
const TAU = Math.PI * 2;

function livingGround(actor: CampaignActor): boolean {
  return actor.kind === 'ground' && actor.hp > 0;
}
function reservedTickets(state: CampaignState): ReinforcementTicket[] {
  return state.reinforcementTickets.filter(ticket => isValidReservedTicket(state, ticket));
}
function withinXZ(a: Vec, b: Vec, radius: number): boolean {
  return xzDistanceSquared(a, b) <= radius ** 2 + 1e-8;
}
function setProgress(site: CampaignSite, progress: number): void {
  site.progress = Math.max(0, Math.min(CAPTURE_MAX, progress));
  site.captureProgress = site.progress / 600;
}

/** Called after simultaneous damage, before the terminal verdict. */
export function updateCapture(state: CampaignState, emit: Emit): void {
  if (state.status !== 'running') return;
  // Count from one snapshot. A capture in an earlier site cannot alter the
  // bodies counted in a later site, or change a reinforcement's allegiance.
  const counts = state.sites.map(site => {
    const result = { friendly: 0, enemy: 0 };
    for (const actor of state.actors) {
      if (livingGround(actor) && withinXZ(actor.position, site.position, CAPTURE_RADIUS)) result[actor.team]++;
    }
    return result;
  });
  state.sites.forEach((site, index) => {
    const count = counts[index];
    setProgress(site, site.progress);
    site.contested = count.friendly > 0 && count.enemy > 0;
    if (site.contested) return;
    if (count.friendly === 0 && count.enemy === 0) {
      setProgress(site, site.progress - 50);
      if (site.progress === 0) site.challenger = null;
      return;
    }
    const team: CampaignTeam = count.friendly > 0 ? 'friendly' : 'enemy';
    if (site.owner === team) {
      setProgress(site, site.progress - 100);
      if (site.progress === 0) site.challenger = null;
      return;
    }
    const speed = 25 * Math.min(count[team], 4);
    if (site.owner === 'neutral' && site.challenger !== null && site.challenger !== team) {
      setProgress(site, site.progress - speed);
      if (site.progress === 0) site.challenger = team;
      return; // Changing a challenger never spends leftover progress this tick.
    }
    site.challenger = team;
    if (team === 'friendly' && !state.actors.some(actor => actor.id === site.turretId && actor.kind === 'turret' && actor.hp <= 0)) return;
    setProgress(site, site.progress + speed);
    if (site.progress !== CAPTURE_MAX) return;
    const wasNeutral = site.owner === 'neutral';
    site.owner = wasNeutral ? team : 'neutral';
    site.ownerGeneration++;
    site.lastOwnerChangeTick = state.simTick;
    setProgress(site, 0);
    if (wasNeutral) {
      site.challenger = null;
      if (team === 'friendly') {
        if (site.firstFriendlyCaptureTick === null) site.firstFriendlyCaptureTick = state.simTick;
        if (!state.firstCapturedSiteIds.includes(site.id)) state.firstCapturedSiteIds.push(site.id);
      }
    }
    emit({ kind: wasNeutral ? 'capture' : 'neutralize', siteId: site.id, team, position: { ...site.position } });
  });
}

function missionMembers(state: CampaignState, mission: RescueMission): CampaignActor[] {
  return mission.memberRefs.flatMap(ref => {
    const actor = state.actors.find(candidate => candidate.id === ref.id && candidate.generation === ref.generation);
    return actor && livingGround(actor) && actor.team === 'friendly' ? [actor] : [];
  });
}

/** A front's state follows assigned soldiers, not just its original army. */
export function updateArmyStates(state: CampaignState): void {
  const tickets = reservedTickets(state);
  for (const army of state.armies) {
    army.reserveCount = countClasses(army.reserves);
    const site = state.sites.find(candidate => candidate.id === army.siteId);
    if (!site) continue;
    const assigned = state.actors.filter(actor => livingGround(actor) && actor.team === 'friendly' && actor.assignedSiteId === site.id);
    const incoming = state.rescueMissions.some(mission => mission.status === 'enroute' && mission.recipientSiteId === site.id
      && missionMembers(state, mission).some(actor => actor.rescueMissionId === mission.id && actor.assignedSiteId === site.id));
    const hasTicket = tickets.some(ticket => ticket.team === 'friendly' && ticket.armyId === army.id && ticket.reservedCapacity > 0);
    if (assigned.length === 0 && !incoming && army.reserveCount === 0 && !hasTicket) {
      army.status = 'depleted';
      site.depletedSinceTick ??= state.simTick;
      continue;
    }
    site.depletedSinceTick = null;
    if (incoming) army.status = 'rescue';
    else if (assigned.length === 0) army.status = 'regrouping';
    else if (site.contested || assigned.some(actor => actor.movementState === 'engage')) army.status = 'engage';
    else if (site.owner === 'friendly') army.status = 'garrison';
    else if (assigned.some(actor => withinXZ(actor.position, site.position, CAPTURE_RADIUS))) army.status = 'capture';
    else army.status = 'march';
  }
}

/** Releasing the same ticket twice must never mint reserves or capacity. */
export function cancelTicket(state: CampaignState, ticket: ReinforcementTicket): void {
  if (ticket.status !== 'reserved') return;
  ticket.status = 'cancelled';
  // An old run's callback cannot refund resources into a replacement run.
  if (ticket.runId === state.runId && ticket.team === 'friendly') {
    const army = state.armies.find(candidate => candidate.id === ticket.armyId);
    if (army) {
      for (const className of GROUND_CLASSES) army.reserves[className] += ticket.reserveCost[className];
      army.reserveCount = countClasses(army.reserves);
      army.reservedCapacity = Math.max(0, army.reservedCapacity - ticket.reservedCapacity);
    }
  }
  ticket.reservedCapacity = 0;
}

export function cancelAllTickets(state: CampaignState): void {
  for (const ticket of state.reinforcementTickets) cancelTicket(state, ticket);
}

function friendlyCounts(state: CampaignState, army: CampaignArmy): ClassCounts {
  const counts = emptyClassCounts();
  for (const actor of state.actors) if (livingGround(actor) && actor.team === 'friendly' && actor.armyId === army.id) counts[actor.class as GroundClass]++;
  for (const ticket of reservedTickets(state)) {
    if (ticket.team !== 'friendly' || ticket.armyId !== army.id) continue;
    for (const className of GROUND_CLASSES) counts[className] += ticket.classCounts[className];
  }
  return counts;
}

function enemyCounts(state: CampaignState, laneId: number): { ground: number; dragons: number } {
  const result = { ground: 0, dragons: 0 };
  for (const actor of state.actors) {
    if (actor.team !== 'enemy' || actor.laneId !== laneId || actor.hp <= 0) continue;
    if (actor.kind === 'ground') result.ground++;
    if (actor.kind === 'dragon') result.dragons++;
  }
  for (const ticket of reservedTickets(state)) {
    if (ticket.team !== 'enemy' || ticket.laneId !== laneId) continue;
    result.ground += countClasses(ticket.classCounts);
    result.dragons += ticket.dragonCount;
  }
  return result;
}

function newTicket(state: CampaignState, team: CampaignTeam, laneId: number,
  armyId: number | null, waveOrdinal: number, classSequence: GroundClass[], dragonCount = 0): OrderedTicket {
  const classCounts = emptyClassCounts();
  for (const className of classSequence) classCounts[className]++;
  const id = state.nextTicketId++;
  const ticket: OrderedTicket = {
    id, ticketId: id, runId: state.runId,
    sourceId: team === 'friendly' ? `friendly-army-${armyId}` : `enemy-gate-${laneId}`,
    sourceGeneration: 1, team, laneId, armyId, classCounts,
    dragonCount, reserveCost: team === 'friendly' ? { ...classCounts } : emptyClassCounts(),
    scheduledTick: state.activeTicks + DISPATCH_DELAY,
    firstDueTick: state.activeTicks + DISPATCH_DELAY,
    reservedCapacity: classSequence.length + dragonCount,
    waveOrdinal, status: 'reserved', classSequence,
  };
  state.reinforcementTickets.push(ticket);
  return ticket;
}

function waveExists(state: CampaignState, team: CampaignTeam, laneId: number, waveOrdinal: number): boolean {
  return state.reinforcementTickets.some(ticket => ticket.runId === state.runId && ticket.team === team
    && ticket.laneId === laneId && ticket.waveOrdinal === waveOrdinal);
}

function reserveWaves(state: CampaignState): void {
  const tick = state.activeTicks;
  if (tick % FRIENDLY_PERIOD === 0) {
    for (const army of state.armies) {
      const waveOrdinal = tick / FRIENDLY_PERIOD;
      if (waveExists(state, 'friendly', army.siteId, waveOrdinal)) continue;
      const current = friendlyCounts(state, army);
      const wanted = Math.min(8, 24 - countClasses(current), GROUND_CAPACITY - countClasses(current));
      const sequence: GroundClass[] = [];
      for (let i = 0; i < wanted; i++) {
        let chosen: GroundClass | null = null;
        for (const className of GROUND_CLASSES) {
          if (army.reserves[className] <= 0 || current[className] >= INITIAL_CLASSES[className]) continue;
          // Integer cross-products retain the specified tie order exactly.
          if (chosen === null || (INITIAL_CLASSES[className] - current[className]) * INITIAL_CLASSES[chosen]
            > (INITIAL_CLASSES[chosen] - current[chosen]) * INITIAL_CLASSES[className]) chosen = className;
        }
        if (chosen === null) break;
        sequence.push(chosen);
        current[chosen]++;
        army.reserves[chosen]--;
      }
      if (sequence.length > 0) {
        const ticket = newTicket(state, 'friendly', army.siteId, army.id, waveOrdinal, sequence);
        army.reservedCapacity += ticket.reservedCapacity;
      }
      army.reserveCount = countClasses(army.reserves);
    }
  }
  if (tick % ENEMY_PERIOD === 0) {
    for (let laneId = 0; laneId < SITE_COUNT; laneId++) {
      const waveOrdinal = tick / ENEMY_PERIOD;
      if (waveExists(state, 'enemy', laneId, waveOrdinal)) continue;
      const current = enemyCounts(state, laneId);
      const groundCount = Math.max(0, Math.min(8, GROUND_CAPACITY - current.ground));
      const dragonCount = tick % DRAGON_PERIOD === 0 && current.dragons < DRAGON_CAPACITY ? 1 : 0;
      if (groundCount + dragonCount > 0) newTicket(state, 'enemy', laneId, null, waveOrdinal, ENEMY_WAVE_CLASSES.slice(0, groundCount), dragonCount);
    }
  }
}

function sourceValid(state: CampaignState, ticket: ReinforcementTicket): boolean {
  if (ticket.runId !== state.runId || ticket.sourceGeneration !== 1 || !Number.isInteger(ticket.laneId)
    || ticket.laneId < 0 || ticket.laneId >= SITE_COUNT) return false;
  if (ticket.team === 'enemy') return ticket.armyId === null && ticket.sourceId === `enemy-gate-${ticket.laneId}`;
  return ticket.sourceId === `friendly-army-${ticket.armyId}`
    && state.armies.some(army => army.id === ticket.armyId && army.siteId === ticket.laneId);
}

/** Used by the terminal verdict before any due ticket can dispatch. */
export function isValidReservedTicket(state: CampaignState, ticket: ReinforcementTicket): boolean {
  return ticket.status === 'reserved' && ticket.runId === state.runId
    && ticket.reservedCapacity > 0 && sourceValid(state, ticket);
}

function gridPosition(laneId: number, team: CampaignTeam, slot: number, className: GroundClass): Vec {
  const anchor = radialPosition(laneId, team === 'friendly' ? 1320 : 650);
  const { u, v } = laneBasis(laneId);
  const tangent = ((slot % 6) - 2.5) * 8;
  const radial = (Math.floor(slot / 6) - 1.5) * 10;
  const x = anchor.x + v.x * tangent + u.x * radial;
  const z = anchor.z + v.z * tangent + u.z * radial;
  return { x, y: terrainHeight(x, z) + (className === 'cavalry' ? 1.5 : 1), z };
}

interface Placement { className: ActorClass; position: Vec; slot: number; team: CampaignTeam; radius: number }
function positionAvailable(state: CampaignState, candidate: Placement, selected: Placement[]): boolean {
  for (const actor of state.actors) {
    if (actor.hp <= 0) continue;
    const margin = candidate.className !== 'dragon' && actor.kind === 'ground' && actor.team === candidate.team ? .2 : 0;
    if (distanceSquared(candidate.position, actor.position) < (candidate.radius + actor.radius + margin) ** 2 - 1e-9) return false;
  }
  for (const other of selected) {
    const margin = candidate.className !== 'dragon' && other.className !== 'dragon' && candidate.team === other.team ? .2 : 0;
    if (distanceSquared(candidate.position, other.position) < (candidate.radius + other.radius + margin) ** 2 - 1e-9) return false;
  }
  return state.player.hp <= 0 || distanceSquared(candidate.position, state.player.position) >= (candidate.radius + state.player.radius) ** 2 - 1e-9;
}

function ticketSequence(ticket: OrderedTicket): GroundClass[] {
  if (ticket.classSequence) {
    const counts = emptyClassCounts();
    for (const className of ticket.classSequence) counts[className]++;
    if (GROUND_CLASSES.every(className => counts[className] === ticket.classCounts[className])) return ticket.classSequence;
  }
  // Minimum-contract tickets from a save or fixture still dispatch their exact
  // class inventory; newly reserved tickets always carry the original order.
  return GROUND_CLASSES.flatMap(className => Array<GroundClass>(ticket.classCounts[className]).fill(className));
}

function placementsFor(state: CampaignState, ticket: OrderedTicket): Placement[] | null {
  const selected: Placement[] = [];
  const usedSlots = new Set<number>();
  for (const className of ticketSequence(ticket)) {
    let placed = false;
    for (let slot = 0; slot < GROUND_CAPACITY; slot++) {
      if (usedSlots.has(slot)) continue;
      const candidate = { className, position: gridPosition(ticket.laneId, ticket.team, slot, className), slot,
        team: ticket.team, radius: ACTOR_STATS[className].radius };
      if (!positionAvailable(state, candidate, selected)) continue;
      usedSlots.add(slot);
      selected.push(candidate);
      placed = true;
      break;
    }
    if (!placed) return null;
  }
  for (let i = 0; i < ticket.dragonCount; i++) {
    const candidate: Placement = { className: 'dragon', position: radialPosition(ticket.laneId, 650, 180),
      slot: i, team: ticket.team, radius: ACTOR_STATS.dragon.radius };
    if (!positionAvailable(state, candidate, selected)) return null;
    selected.push(candidate);
  }
  return selected;
}

function dispatchDue(state: CampaignState, spawn: Spawn, emit: Emit): void {
  for (const ticket of state.reinforcementTickets) {
    if (ticket.status !== 'reserved' || ticket.scheduledTick > state.activeTicks) continue;
    const requested = countClasses(ticket.classCounts) + ticket.dragonCount;
    const army = state.armies.find(candidate => candidate.id === ticket.armyId);
    const enemy = ticket.team === 'enemy' ? enemyCounts(state, ticket.laneId) : null;
    const capacityValid = requested > 0 && ticket.reservedCapacity === requested
      && (ticket.team === 'friendly'
        ? army !== undefined && ticket.dragonCount === 0 && army.reservedCapacity >= requested
          && countClasses(friendlyCounts(state, army)) <= GROUND_CAPACITY
        : enemy !== null && enemy.ground <= GROUND_CAPACITY && enemy.dragons <= DRAGON_CAPACITY);
    if (!sourceValid(state, ticket) || !capacityValid || state.activeTicks > ticket.firstDueTick + SPAWN_RETRY_TICKS) {
      cancelTicket(state, ticket);
      continue;
    }
    const placements = placementsFor(state, ticket);
    if (!placements) {
      if (state.activeTicks >= ticket.firstDueTick + SPAWN_RETRY_TICKS) cancelTicket(state, ticket);
      continue;
    }
    for (const placement of placements) {
      const actor = spawn(ticket.team, placement.className, ticket.laneId, ticket.armyId,
        placement.position, 'reinforcement', ticket.waveOrdinal, placement.slot);
      actor.assignedSiteId = army?.siteId ?? ticket.laneId;
    }
    ticket.status = 'spawned';
    if (ticket.team === 'friendly' && army) army.reservedCapacity -= ticket.reservedCapacity;
    ticket.reservedCapacity = 0;
    emit({ kind: 'reinforcement', siteId: ticket.laneId, team: ticket.team,
      position: radialPosition(ticket.laneId, ticket.team === 'friendly' ? 1320 : 650), reason: `wave-${ticket.waveOrdinal}` });
  }
}

function finishRescues(state: CampaignState, emit: Emit): void {
  for (const mission of state.rescueMissions) {
    if (mission.status === 'failed') continue;
    const members = missionMembers(state, mission);
    const recipient = state.sites.find(site => site.id === mission.recipientSiteId);
    if (members.length === 0 || !recipient) {
      mission.status = 'failed';
      for (const actor of members) if (actor.rescueMissionId === mission.id) actor.rescueMissionId = null;
      emit({ kind: 'rescue', team: 'friendly', siteId: mission.recipientSiteId, reason: 'failed' });
    } else if (mission.status === 'enroute' && members.every(actor => withinXZ(actor.position, recipient.position, RESCUE_RADIUS))) {
      mission.status = 'completed';
      for (const actor of members) {
        if (actor.rescueMissionId === mission.id) actor.rescueMissionId = null;
        actor.movementState = recipient.owner === 'friendly' ? 'garrison' : 'capture';
      }
      emit({ kind: 'rescue', team: 'friendly', siteId: recipient.id, position: { ...recipient.position }, reason: 'completed' });
    }
  }
}

function positiveAngle(angle: number): number {
  const normalized = (angle % TAU + TAU) % TAU;
  return normalized > TAU - 1e-9 ? 0 : normalized;
}
function siteAngle(site: CampaignSite): number { return Math.atan2(site.position.z, site.position.x); }
function routeLength(donor: CampaignSite, recipient: CampaignSite): number {
  const points = [donor.position, ...route(donor.id, recipient.id)];
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.sqrt(distanceSquared(points[i - 1], points[i]));
  return length;
}

function assignRescues(state: CampaignState, emit: Emit): void {
  const recipients = state.sites.filter(site => site.owner !== 'friendly' && site.depletedSinceTick !== null
    && !state.rescueMissions.some(mission => mission.recipientSiteId === site.id && mission.status === 'enroute'))
    .sort((a, b) => (a.depletedSinceTick! - b.depletedSinceTick!)
      || positiveAngle(siteAngle(a) - state.startHeading * TAU / SITE_COUNT)
        - positiveAngle(siteAngle(b) - state.startHeading * TAU / SITE_COUNT));
  // Build every donor candidate from the same pre-assignment snapshot.
  const donors = state.sites.flatMap(site => {
    if (site.owner !== 'friendly' || site.contested || state.activeTicks < site.rescueCooldownUntilTick
      || state.actors.some(actor => livingGround(actor) && actor.team === 'enemy' && withinXZ(actor.position, site.position, 160))) return [];
    const members = state.actors.filter(actor => livingGround(actor) && actor.team === 'friendly'
      && actor.assignedSiteId === site.id && actor.rescueMissionId === null
      && withinXZ(actor.position, site.position, RESCUE_RADIUS))
      .sort((a, b) => (a.armyId! - b.armyId!) || a.id - b.id);
    return members.length >= RESCUE_COUNT * 2 ? [{ site, members }] : [];
  });
  const usedDonors = new Set<number>();
  const reservedMembers = new Set<number>();
  for (const recipient of recipients) {
    const candidates = donors.filter(donor => {
      const delta = (donor.site.id - recipient.id + SITE_COUNT) % SITE_COUNT;
      return (delta === 1 || delta === SITE_COUNT - 1) && !usedDonors.has(donor.site.id);
    }).sort((a, b) => {
      const difference = routeLength(a.site, recipient) - routeLength(b.site, recipient);
      return Math.abs(difference) > 1e-6 ? difference
        : positiveAngle(siteAngle(a.site) - siteAngle(recipient)) - positiveAngle(siteAngle(b.site) - siteAngle(recipient));
    });
    const donor = candidates.find(candidate => candidate.members.filter(actor => !reservedMembers.has(actor.id)).length >= RESCUE_COUNT * 2);
    if (!donor) continue;
    const members = donor.members.filter(actor => !reservedMembers.has(actor.id)).slice(0, RESCUE_COUNT);
    const id = state.nextMissionId++;
    const mission: RescueMission = { id, missionId: id, donorSiteId: donor.site.id, recipientSiteId: recipient.id,
      memberRefs: members.map(actor => ({ id: actor.id, generation: actor.generation })), status: 'enroute', startedTick: state.simTick };
    state.rescueMissions.push(mission);
    usedDonors.add(donor.site.id);
    donor.site.rescueCooldownUntilTick = state.activeTicks + RESCUE_COOLDOWN;
    for (const actor of members) {
      reservedMembers.add(actor.id);
      actor.assignedSiteId = recipient.id;
      actor.rescueMissionId = id;
      actor.movementState = 'rescue';
      actor.origin = 'rescue';
      actor.targetRef = null;
      actor.phase = 'idle';
      actor.fireAtTick = null;
      actor.lockedAim = null;
    }
    emit({ kind: 'rescue', team: 'friendly', siteId: recipient.id, position: { ...donor.site.position }, reason: 'enroute' });
  }
}

/** Tick-order step 7; activeTicks has already advanced and terminal won first. */
export function processLogistics(state: CampaignState, spawn: Spawn, emit: Emit): void {
  if (state.status === 'victory' || state.status === 'defeat') {
    cancelAllTickets(state);
    return;
  }
  if (state.status !== 'running') return;
  if (state.activeTicks <= 0) return;
  for (const ticket of state.reinforcementTickets) {
    if (ticket.status === 'reserved' && !sourceValid(state, ticket)) cancelTicket(state, ticket);
  }
  finishRescues(state, emit);
  updateArmyStates(state);
  reserveWaves(state);
  assignRescues(state, emit);
  dispatchDue(state, spawn, emit);
  updateArmyStates(state);
}
