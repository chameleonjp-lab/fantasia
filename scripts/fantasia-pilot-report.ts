import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { Vector3 } from 'three';
import { Campaign, campaignStateHash, predictBombImpact } from '../src/campaign';
import { CampaignFlightController } from '../src/campaign-flight';
import { CAMPAIGN_DT, CAMPAIGN_LIMIT_TICKS, CAPTURE_RADIUS, MAX_PROJECTILES } from '../src/campaign-config';
import type { CampaignActor, CampaignMode, CampaignState } from '../src/campaign-types';
import { forwardOf, MAX_SPEED, normalizeAngle } from '../src/flight';
import { PLAYER_MAX_PITCH } from '../src/flight-assist';
import type { Aircraft, FlightInput } from '../src/types';

type Policy = 'turret-sweep' | 'frontline-support' | 'dragon-sweep';
type Mode = CampaignMode;
type VecLike = { x: number; y: number; z: number };
type RespawnMarker = { afterInput: number; waitFrames: number; generation: number };
type PilotResult = {
  campaign: Campaign;
  flight: CampaignFlightController;
  inputs: FlightInput[];
  respawns: RespawnMarker[];
  inputHash: string;
  wallFrames: number;
  maxTranslation: number;
  maxProjectiles: number;
  tactics: { targetChanges: number; turretTicks: number; dragonTicks: number; groundTicks: number; evadeTicks: number; fireCommands: number; bombCommands: number };
  timeline: Array<{ tick: number; owners: string; turrets: number; friendly: number; enemy: number }>;
  pilot: CampaignPilot;
};

const DEFAULT_ASPECT = 393 / 852;
const RESPawn_WAIT_FRAMES = 180;
const clamp = (value: number, low = -1, high = 1) => Math.max(low, Math.min(high, value));
const v3 = (p: VecLike) => new Vector3(p.x, p.y, p.z);
const sqrDistance = (a: VecLike, b: VecLike) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
const xzDistance = (a: VecLike, b: VecLike) => Math.hypot(a.x - b.x, a.z - b.z);
const countsNearSite = (state: CampaignState, siteId: number, team: 'friendly' | 'enemy') => {
  const site = state.sites[siteId];
  return state.actors.filter(actor => actor.hp > 0 && actor.team === team && actor.kind === 'ground'
    && xzDistance(actor.position, site.position) <= CAPTURE_RADIUS).length;
};

function normalizedInput(input: FlightInput): FlightInput {
  const turn = Number.isFinite(input.turn) ? clamp(input.turn) : 0;
  const climb = Number.isFinite(input.climb) ? clamp(input.climb) : 0;
  const length = Math.hypot(turn, climb);
  const limited = length > 1 ? { turn: turn / length, climb: climb / length } : { turn, climb };
  return { ...input, ...limited };
}

function assertLegalInput(input: FlightInput, tick: number): void {
  if (![input.turn, input.climb].every(Number.isFinite)) throw new Error(`Non-finite FlightInput at ${tick}`);
  if (Math.hypot(input.turn, input.climb) > 1 + 1e-9) throw new Error(`Stick outside the legal unit circle at ${tick}`);
  for (const key of ['fire', 'loop', 'bomb', 'accelerate', 'brake'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`Invalid ${key} FlightInput at ${tick}`);
  }
}

function nearest<T extends { position: VecLike; id: number }>(player: VecLike, items: T[]): T | null {
  return items.slice().sort((a, b) => sqrDistance(player, a.position) - sqrDistance(player, b.position) || a.id - b.id)[0] ?? null;
}

function frontlineThreat(state: CampaignState): { siteId: number; actors: CampaignActor[]; score: number } | null {
  const candidates = state.sites.map(site => {
    const allies = countsNearSite(state, site.id, 'friendly');
    const enemyActors = state.actors.filter(actor => actor.hp > 0 && actor.team === 'enemy' && actor.kind === 'ground'
      && xzDistance(actor.position, site.position) <= CAPTURE_RADIUS);
    return { siteId: site.id, actors: enemyActors, score: enemyActors.length ? allies * 2 + enemyActors.length : 0 };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.siteId - b.siteId);
  return candidates[0] ?? null;
}

function dragonThreat(state: CampaignState, player: VecLike): CampaignActor | null {
  const live = state.actors.filter(actor => actor.hp > 0 && actor.team === 'enemy' && actor.kind === 'dragon');
  const supports = live.map(actor => {
    const site = state.sites[actor.laneId];
    const friendly = countsNearSite(state, site.id, 'friendly');
    const enemy = countsNearSite(state, site.id, 'enemy');
    return { actor, strategic: friendly > 0 || enemy > 0 || site.owner !== 'friendly', distance: sqrDistance(player, actor.position) };
  }).filter(item => item.strategic).sort((a, b) => a.distance - b.distance || a.actor.id - b.actor.id);
  return supports[0]?.actor ?? null;
}

function chooseTarget(state: CampaignState, player: Aircraft, policy: Policy, pinnedId: number | null): CampaignActor | null {
  const pinned = pinnedId === null ? null : state.actors.find(actor => actor.id === pinnedId && actor.hp > 0 && actor.team === 'enemy') ?? null;
  const turrets = state.actors.filter(actor => actor.hp > 0 && actor.team === 'enemy' && actor.kind === 'turret');
  const frontline = frontlineThreat(state);
  const dragons = dragonThreat(state, player.position);

  if (policy === 'frontline-support' && frontline) {
    const local = pinned && frontline.actors.some(actor => actor.id === pinned.id) ? pinned : nearest(player.position, frontline.actors);
    if (local) return local;
  }
  if (policy === 'dragon-sweep' && dragons && sqrDistance(player.position, dragons.position) <= 1800 ** 2) return dragons;
  if (pinned && (pinned.kind === 'turret' ? turrets.some(actor => actor.id === pinned.id) : !frontline || !frontline.actors.length)) return pinned;
  if (turrets.length) return nearest(player.position, turrets);
  if (frontline) return nearest(player.position, frontline.actors);
  if (dragons) return dragons;
  const ground = state.actors.filter(actor => actor.hp > 0 && actor.team === 'enemy' && actor.kind === 'ground');
  return nearest(player.position, ground);
}

function incomingProjectile(state: CampaignState, player: Aircraft): boolean {
  const playerVelocity = forwardOf(player).multiplyScalar(player.speed);
  for (const round of state.projectiles) {
    if (round.team !== 'enemy') continue;
    const relative = v3(round.position).sub(player.position);
    const relativeVelocity = v3(round.velocity).sub(playerVelocity);
    const speedSq = relativeVelocity.lengthSq();
    if (speedSq < 1e-8) continue;
    const time = -relative.dot(relativeVelocity) / speedSq;
    if (time < .04 || time > 1.2) continue;
    if (relative.addScaledVector(relativeVelocity, time).length() <= 24 && time > 0.04) return true;
  }
  const generation = state.player.generation;
  return state.actors.some(actor => actor.hp > 0 && actor.team === 'enemy' && actor.phase === 'telegraph'
    && actor.targetRef?.id === state.player.id && actor.targetRef.generation === generation
    && actor.fireAtTick !== null && actor.fireAtTick - state.simTick <= 9);
}

class CampaignPilot {
  private targetId: number | null = null;
  private escapeUntil = 0;
  private escapePoint = new Vector3();
  private lastBombTick = -100000;
  private dodgeUntil = 0;
  private dodgeTurn = 0;
  private dodgeClimb = 0;
  private lastTargetId: number | null = null;
  readonly stats = { targetChanges: 0, turretTicks: 0, dragonTicks: 0, groundTicks: 0, evadeTicks: 0, fireCommands: 0, bombCommands: 0 };

  constructor(private readonly policy: Policy) {}

  next(state: CampaignState, flight: CampaignFlightController): FlightInput {
    const player = flight.player;
    const candidate = chooseTarget(state, player, this.policy, this.targetId);
    const target = candidate && candidate.hp > 0 ? candidate : null;
    this.targetId = target?.id ?? null;
    if (this.targetId !== this.lastTargetId) { this.stats.targetChanges++; this.lastTargetId = this.targetId; }

    const threat = incomingProjectile(state, player);
    if (threat && state.simTick >= this.dodgeUntil) {
      const right = new Vector3(1, 0, 0).applyQuaternion(player.quaternion);
      const hostile = state.projectiles.filter(round => round.team === 'enemy')
        .sort((a, b) => sqrDistance(a.position, player.position) - sqrDistance(b.position, player.position))[0];
      const side = hostile ? v3(hostile.position).sub(player.position).dot(right) >= 0 ? -1 : 1 : player.bank >= 0 ? -1 : 1;
      this.dodgeTurn = side * .9;
      this.dodgeClimb = player.position.y < 420 ? .43 : -.43;
      this.dodgeUntil = state.simTick + 36;
    }
    if (state.simTick < this.dodgeUntil) {
      this.stats.evadeTicks++;
      return normalizedInput({ turn: this.dodgeTurn * Math.sqrt(1 - this.dodgeClimb ** 2), climb: this.dodgeClimb,
        fire: false, loop: false, bomb: false, accelerate: player.speed < 115, brake: player.speed > 125, viewAspect: DEFAULT_ASPECT });
    }

    if (target) {
      if (target.kind === 'turret') this.stats.turretTicks++;
      else if (target.kind === 'dragon') this.stats.dragonTicks++;
      else this.stats.groundTicks++;
    }

    let aim: Vector3;
    let evasive = false;
    if (this.escapeUntil > state.simTick) {
      aim = this.escapePoint.clone(); evasive = true;
    } else if (target) {
      const position = v3(target.position);
      const distance = position.distanceTo(player.position);
      const horizontal = xzDistance(position, player.position);
      // Pull out of a close ground-attack pass through ordinary steering. The
      // controller then flies another real circuit before engaging again.
      const forward = forwardOf(player);
      if (target.kind !== 'turret' && distance < 145 || distance < 180 && horizontal < 170
        || distance < 260 && v3(position).sub(player.position).dot(forward) < -80) {
        this.escapeUntil = state.simTick + 180;
        this.escapePoint.copy(player.position).addScaledVector(forward, 600);
        this.escapePoint.y = Math.max(500, player.position.y + 240);
        evasive = true; aim = this.escapePoint.clone();
      } else {
        const intercept = position.addScaledVector(v3(target.velocity), Math.min(1.25, distance / (player.speed + 760)));
        aim = intercept;
      }
    } else {
      // If no enemy survives locally, circle above the nearest unfinished site
      // while ground forces and scheduled waves resolve through the real step.
      const site = state.sites.filter(item => item.owner !== 'friendly')
        .sort((a, b) => sqrDistance(player.position, a.position) - sqrDistance(player.position, b.position) || a.id - b.id)[0];
      aim = site ? v3(site.position).add(new Vector3(0, 500, 0)) : player.position.clone().addScaledVector(forwardOf(player), 300);
    }

    // Keep the aircraft well clear of terrain while preserving low-angle gun
    // passes. A legal steep climb is used only near the ground.
    if (player.position.y < 150 && aim.y < player.position.y) aim.y = player.position.y + 260;
    const relative = aim.clone().sub(player.position);
    const horizontal = Math.max(1e-6, Math.hypot(relative.x, relative.z));
    const desiredYaw = Math.atan2(-relative.x, -relative.z);
    const yawError = normalizeAngle(desiredYaw - player.yaw);
    let turn = clamp(-yawError * 2.2);
    const desiredPitch = Math.atan2(relative.y, horizontal);
    let climb = clamp(desiredPitch / PLAYER_MAX_PITCH);
    if (player.position.y < 190 && climb < .16) climb = .16;
    if (player.position.y > 1250 && climb > -.12) climb = -.12;
    const norm = Math.hypot(turn, climb);
    if (norm > 1) { turn /= norm; climb /= norm; }

    const direction = relative.clone().normalize();
    const forward = forwardOf(player);
    const alignment = forward.angleTo(direction);
    const distance = relative.length();
    const fire = !!target && !evasive && distance <= 1150 && alignment <= .105;
    let bomb = false;
    if (target?.kind === 'turret' && state.player.bombs > 0 && state.simTick - this.lastBombTick > 120
      && distance < 1050 && state.simTick % 15 === 0) {
      const predicted = predictBombImpact(
        { x: player.position.x, y: player.position.y, z: player.position.z },
        { x: forward.x * player.speed, y: forward.y * player.speed, z: forward.z * player.speed },
        { x: player.quaternion.x, y: player.quaternion.y, z: player.quaternion.z, w: player.quaternion.w },
      );
      if (predicted && sqrDistance(predicted.position, target.position) <= 24 ** 2) {
        bomb = true;
        this.lastBombTick = state.simTick;
      }
    }
    if (fire) this.stats.fireCommands++;
    if (bomb) this.stats.bombCommands++;
    return normalizedInput({ turn, climb, fire, loop: false, bomb, accelerate: player.speed < 100,
      brake: player.speed > 120, viewAspect: DEFAULT_ASPECT });
  }
}

function hashInputs(inputs: readonly FlightInput[]): string {
  const hash = createHash('sha256');
  for (const input of inputs) { hash.update(JSON.stringify(input)); hash.update('\n'); }
  return hash.digest('hex');
}

function reportTimeline(state: CampaignState) {
  return {
    tick: state.simTick,
    owners: state.sites.map(site => site.owner === 'friendly' ? 'F' : site.owner === 'enemy' ? 'E' : 'N').join(''),
    turrets: state.actors.filter(actor => actor.kind === 'turret' && actor.hp > 0).length,
    friendly: state.actors.filter(actor => actor.team === 'friendly' && actor.kind === 'ground' && actor.hp > 0).length,
    enemy: state.actors.filter(actor => actor.team === 'enemy' && actor.hp > 0 && actor.kind === 'ground').length,
  };
}

function makeTimelineSample(state: CampaignState, result: PilotResult['timeline']): void {
  if (state.activeTicks > 0 && state.activeTicks % 600 === 0) result.push(reportTimeline(state));
}

async function runPilot(mode: Mode, seed: number, policy: Policy, maxTicks: number): Promise<PilotResult> {
  const campaign = new Campaign(mode, seed);
  const flight = new CampaignFlightController(campaign.state);
  const pilot = new CampaignPilot(policy);
  const inputs: FlightInput[] = [];
  const respawns: RespawnMarker[] = [];
  const timeline: PilotResult['timeline'] = [reportTimeline(campaign.state)];
  const hash = createHash('sha256');
  let wallFrames = 0, maxTranslation = 0, maxProjectiles = campaign.state.projectiles.length;

  while (campaign.state.status === 'running' || campaign.state.status === 'respawning') {
    if (campaign.state.status === 'respawning') {
      // The 3s respawn delay is wall time. It intentionally consumes no
      // campaign or flight step; resumeRespawn is the production transition.
      respawns.push({ afterInput: inputs.length, waitFrames: RESPawn_WAIT_FRAMES, generation: campaign.state.player.generation });
      wallFrames += RESPawn_WAIT_FRAMES;
      campaign.resumeRespawn();
      flight.sync(campaign.state, true);
      flight.clearPending();
      if (campaign.state.status === 'running') continue;
      break;
    }
    if (campaign.state.activeTicks >= maxTicks) break;

    const input = normalizedInput(pilot.next(campaign.state, flight));
    assertLegalInput(input, campaign.state.simTick);
    const previous = { ...campaign.state.player.position };
    const worldInput = flight.step(campaign.state, input);
    if (!worldInput.playerPosition) throw new Error('Flight adapter returned no integrated aircraft pose');
    const moved = Math.sqrt(sqrDistance(previous, worldInput.playerPosition));
    if (moved > MAX_SPEED * CAMPAIGN_DT + 1e-6 || moved < 0.25) throw new Error(`Aircraft pose was not a single legal K flight step (${moved}m)`);
    maxTranslation = Math.max(maxTranslation, moved);
    inputs.push({ ...input });
    hash.update(JSON.stringify(input)); hash.update('\n');

    campaign.step(worldInput);
    flight.sync(campaign.state);
    wallFrames++;
    maxProjectiles = Math.max(maxProjectiles, campaign.state.projectiles.length);
    makeTimelineSample(campaign.state, timeline);
  }

  return {
    campaign, flight, inputs, respawns, inputHash: hash.digest('hex'), wallFrames,
    maxTranslation, maxProjectiles, tactics: pilot.stats, timeline, pilot,
  };
}

async function replayInputs(mode: Mode, seed: number, source: PilotResult, maxTicks: number) {
  const campaign = new Campaign(mode, seed);
  const flight = new CampaignFlightController(campaign.state);
  let inputIndex = 0, respawnIndex = 0, wallFrames = 0;
  const replayHash = createHash('sha256');
  const replayRespawns: RespawnMarker[] = [];
  while (campaign.state.status === 'running' || campaign.state.status === 'respawning') {
    if (campaign.state.status === 'respawning') {
      const marker = source.respawns[respawnIndex++];
      if (!marker || marker.afterInput !== inputIndex || marker.generation !== campaign.state.player.generation) {
        throw new Error(`Replay respawn boundary mismatch at input ${inputIndex}`);
      }
      replayRespawns.push(marker);
      wallFrames += marker.waitFrames;
      campaign.resumeRespawn();
      flight.sync(campaign.state, true);
      flight.clearPending();
      if (campaign.state.status === 'running') continue;
      break;
    }
    if (campaign.state.activeTicks >= maxTicks || inputIndex >= source.inputs.length) break;
    const input = source.inputs[inputIndex++];
    assertLegalInput(input, campaign.state.simTick);
    const worldInput = flight.step(campaign.state, input);
    campaign.step(worldInput);
    flight.sync(campaign.state);
    replayHash.update(JSON.stringify(input)); replayHash.update('\n');
    wallFrames++;
  }
  if (inputIndex !== source.inputs.length) throw new Error(`Replay consumed ${inputIndex} of ${source.inputs.length} FlightInput entries`);
  if (respawnIndex !== source.respawns.length) throw new Error(`Replay consumed ${respawnIndex} of ${source.respawns.length} respawn events`);
  const hash = campaignStateHash(campaign.state);
  const inputHash = replayHash.digest('hex');
  const expectedHash = campaignStateHash(source.campaign.state);
  const status = campaign.state.status === source.campaign.state.status;
  const sameInputs = inputHash === source.inputHash;
  const sameHash = hash === expectedHash;
  if (!status || !sameInputs || !sameHash || wallFrames !== source.wallFrames) {
    throw new Error(`Replay diverged (${status ? 'status ok' : 'status'}; ${sameInputs ? 'input hash ok' : 'input hash'}; ${sameHash ? 'state hash ok' : `state hash ${hash} != ${expectedHash}`}; ${wallFrames} != ${source.wallFrames} wall frames)`);
  }
  return { status: campaign.state.status, activeTicks: campaign.state.activeTicks, wallFrames,
    stateHash: hash, inputHash, inputCount: inputIndex, respawns: replayRespawns.length, matches: sameHash && sameInputs && status };
}

function summarizeRun(mode: Mode, seed: number, policy: Policy, run: PilotResult, replay: Awaited<ReturnType<typeof replayInputs>>, maxTicks: number) {
  const state = run.campaign.state;
  const terminal = state.status === 'victory' || state.status === 'defeat';
  const outcome = terminal ? state.status : 'limit';
  return {
    mode, seed, policy, outcome, terminal, reason: state.result?.reason ?? 'reached pilot tick limit without a terminal verdict',
    activeTicks: state.activeTicks, wallFrames: run.wallFrames, recordTicks: state.result?.recordTicks ?? state.activeTicks + state.respawnPenaltyTicks,
    activeSeconds: state.activeTicks * CAMPAIGN_DT, recordSeconds: (state.activeTicks + state.respawnPenaltyTicks) * CAMPAIGN_DT,
    capturedSites: state.sites.filter(site => site.owner === 'friendly').length,
    owners: state.sites.map(site => site.owner),
    turretIdsDestroyed: state.destroyedInitialTurretIds.slice().sort((a, b) => a - b),
    initialTurretsRemaining: state.actors.filter(actor => actor.kind === 'turret' && actor.origin === 'initial' && actor.hp > 0).length,
    initialDragonsRemaining: state.actors.filter(actor => actor.kind === 'dragon' && actor.origin === 'initial' && actor.hp > 0).length,
    friendlyGround: state.actors.filter(actor => actor.kind === 'ground' && actor.team === 'friendly' && actor.hp > 0).length,
    enemyGround: state.actors.filter(actor => actor.kind === 'ground' && actor.team === 'enemy' && actor.hp > 0).length,
    friendlyLosses: state.friendlyLosses, enemyKills: state.enemyKills, selfLosses: state.selfLosses,
    livesRemaining: state.livesRemaining, player: { hp: state.player.hp, generation: state.player.generation, position: state.player.position },
    score: state.result?.score ?? null, replay, inputHash: run.inputHash, stateHash: campaignStateHash(state),
    inputCount: run.inputs.length, respawns: run.respawns, maxIntegratedTranslationMetres: run.maxTranslation,
    maxProjectiles: run.maxProjectiles, projectilesWithinSpecifiedPool: run.maxProjectiles <= MAX_PROJECTILES,
    tacticInputCounts: run.tactics, timeline: run.timeline,
    pilotLimitTicks: maxTicks,
  };
}

type Options = { seeds: number; startSeed: number; modes: Mode[]; policies: Policy[]; maxTicks: number; outDir: string; replay: boolean };
function parseArgs(args: string[]): Options {
  const map = new Map(args.filter(arg => arg.startsWith('--')).map(arg => {
    const [key, ...value] = arg.slice(2).split('=');
    return [key, value.join('=')];
  }));
  const readInt = (key: string, fallback: number, max: number) => {
    const raw = map.get(key); if (!raw) return fallback;
    const parsed = Number(raw); if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`Invalid --${key}=${raw}`); return parsed;
  };
  const modes = (map.get('modes') ?? 'normal,easy').split(',').filter(Boolean) as Mode[];
  const policies = (map.get('policies') ?? 'turret-sweep').split(',').filter(Boolean) as Policy[];
  if (!modes.length || modes.some(mode => mode !== 'normal' && mode !== 'easy')) throw new Error('Modes must be normal and/or easy');
  if (!policies.length || policies.some(policy => !['turret-sweep', 'frontline-support', 'dragon-sweep'].includes(policy))) {
    throw new Error('Policies: turret-sweep, frontline-support, dragon-sweep');
  }
  const startSeed = Number(map.get('start-seed') ?? '20261005');
  if (!Number.isInteger(startSeed) || startSeed < 0 || startSeed > 0xffffffff) throw new Error('Start seed must be a uint32');
  const maxTicks = Number(map.get('max-ticks') ?? String(CAMPAIGN_LIMIT_TICKS));
  if (!Number.isInteger(maxTicks) || maxTicks < 1 || maxTicks > CAMPAIGN_LIMIT_TICKS) throw new Error(`--max-ticks must be 1..${CAMPAIGN_LIMIT_TICKS}`);
  return {
    seeds: readInt('seeds', 10, 100), startSeed, modes, policies, maxTicks,
    outDir: resolve(map.get('out') ?? '/tmp/fantasia-pilot-report'),
    replay: map.get('replay') !== 'false',
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const combinations = options.modes.length * options.policies.length * options.seeds;
  const report: Record<string, unknown> = {
    title: 'Fantasia physical FlightInput campaign pilot and deterministic replay report',
    environment: 'Headless pure Campaign.step() runs with the K CampaignFlightController; this is not browser/F19 proof or physical-device evidence.',
    method: {
      authority: 'Every world tick is advanced once by Campaign.step() after CampaignFlightController integrates one bounded K aircraft motion step.',
      inputs: 'The pilot emits ordinary FlightInput turn/climb/fire/loop/bomb/throttle values. Bombs are one-tick releases and use the actual terrain predictor.',
      mutation: 'The policy reads state and never assigns actor HP, site ownership, captures, player position, velocity, or projectile hits. Campaign methods own all world state changes.',
      replay: 'The exact consumed FlightInput stream and 3-second respawn boundaries are replayed in a fresh seeded Campaign and compared by SHA-256 input hash and canonical campaignStateHash.',
      wallTime: 'Respawn wait is 180 virtual frames with no campaign step; resumeRespawn() is the authoritative game transition.',
      targetPolicy: 'Clear accessible site turrets, protect contested frontline bodies or nearby dragons according to the selected policy, then continue against live enemy actors until a terminal result or tick limit.',
      feasibility: 'A victory, if achieved, is produced by physical flight, campaign projectiles, ground combat, and seven real capture progressions. No victory state is injected.',
    },
    tacticalAlternatives: [
      { policy: 'turret-sweep', status: options.policies.includes('turret-sweep') ? 'run' : 'available', behavior: 'Finish the nearest living magic turret before turning to the next site; afterward clear active fronts, then dragons and remaining ground threats.' },
      { policy: 'frontline-support', status: options.policies.includes('frontline-support') ? 'run' : 'available', behavior: 'Interrupt the turret sweep when enemy ground bodies contest a site already reached by friendly ground forces.' },
      { policy: 'dragon-sweep', status: options.policies.includes('dragon-sweep') ? 'run' : 'available', behavior: 'Prioritize a dragon within 1.8 km of the aircraft, then resume the nearest turret and active-front route.' },
    ],
    configuration: { seeds: options.seeds, startSeed: options.startSeed, modes: options.modes, policies: options.policies, maxTicks: options.maxTicks, replay: options.replay, runs: combinations },
    runs: [] as unknown[],
    artifactDirectory: options.outDir,
  };
  await mkdir(options.outDir, { recursive: true });

  let completed = 0;
  for (const mode of options.modes) for (const policy of options.policies) for (let i = 0; i < options.seeds; i++) {
    const seed = (options.startSeed + i) >>> 0;
    const run = await runPilot(mode, seed, policy, options.maxTicks);
    const replay = options.replay
      ? await replayInputs(mode, seed, run, options.maxTicks)
      : { status: 'not-run', activeTicks: 0, wallFrames: 0, stateHash: null, inputHash: null, inputCount: 0, respawns: 0, matches: false };
    const shortHash = run.inputHash.slice(0, 12);
    const traceName = `${mode}-${policy}-${String(seed).padStart(10, '0')}-${shortHash}.inputs.json.gz`;
    const tracePayload = JSON.stringify({ schema: 'fantasia-flight-input-trace-v1', mode, seed, policy,
      inputCount: run.inputs.length, inputHash: run.inputHash, respawns: run.respawns, inputs: run.inputs });
    await writeFile(resolve(options.outDir, traceName), gzipSync(Buffer.from(tracePayload)));
    const summary = summarizeRun(mode, seed, policy, run, replay, options.maxTicks) as Record<string, unknown>;
    summary.inputTrace = traceName;
    (report.runs as unknown[]).push(summary);
    completed++;
    process.stdout.write(`[${completed}/${combinations}] ${mode}/${policy} seed=${seed}: ${String(summary.outcome)} ${String(summary.capturedSites)}/7, ${String(summary.activeTicks)} ticks, replay=${replay.matches ? 'same' : 'skip'}\n`);
  }

  const results = report.runs as Array<{ mode: Mode; policy: Policy; outcome: string; capturedSites: number; replay?: { matches: boolean } }>;
  report.totals = options.modes.flatMap(mode => options.policies.map(policy => {
    const group = results.filter(result => result.mode === mode && result.policy === policy);
    return { mode, policy, runs: group.length, victories: group.filter(result => result.outcome === 'victory').length,
      defeats: group.filter(result => result.outcome === 'defeat').length, tickLimits: group.filter(result => result.outcome === 'limit').length,
      averageCapturedSites: group.reduce((sum, result) => sum + result.capturedSites, 0) / Math.max(1, group.length),
      deterministicReplays: group.filter(result => result.replay?.matches).length };
  }));
  const reportPath = resolve(options.outDir, 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`Report: ${reportPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
}
