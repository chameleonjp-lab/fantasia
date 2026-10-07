/** Authoritative, serializable 60 Hz campaign state. No rendering objects. */
export interface Vec { x: number; y: number; z: number }
export type CampaignMode = 'easy' | 'normal';
export interface CampaignFeatures { readonly dragonFireballs: boolean }
export type CampaignTeam = 'friendly' | 'enemy';
export type SiteOwner = CampaignTeam | 'neutral';
export type GroundClass = 'sword' | 'bow' | 'mage' | 'cavalry';
export type ActorClass = GroundClass | 'dragon' | 'turret';
export type ActorKind = 'ground' | 'dragon' | 'turret';
export type CampaignStatus = 'running' | 'respawning' | 'victory' | 'defeat';
export type MovementState = 'march' | 'engage' | 'capture' | 'garrison' | 'regrouping' | 'depleted' | 'rescue';
export type Origin = 'initial' | 'reinforcement' | 'rescue';
export interface EntityRef { id: number; generation: number }
export type ClassCounts = Record<GroundClass, number>;

export interface CampaignPlayer {
  id: number; generation: number; hp: number; maxHp: number;
  position: Vec; previous: Vec; velocity: Vec; radius: number;
  mg: number; cannon: number; bombs: number;
  reloadUntilTick: number | null; bombReloadUntilTick: number | null;
  nextMgTick: number; nextCannonTick: number; protectionTicks: number;
  boundaryTicks: number; quaternion: { x: number; y: number; z: number; w: number };
  previousQuaternion: { x: number; y: number; z: number; w: number };
}
export interface CampaignActor {
  id: number; generation: number; kind: ActorKind; class: ActorClass; team: CampaignTeam;
  laneId: number; armyId: number | null; assignedSiteId: number;
  hp: number; maxHp: number; position: Vec; previous: Vec; velocity: Vec; radius: number;
  origin: Origin; waveOrdinal: number; slot: number; targetRef: EntityRef | null;
  phase: 'idle' | 'telegraph' | 'recovery'; fireAtTick: number | null;
  lockedAim: Vec | null; cooldownUntilTick: number; attackReadyTick: number;
  movementState: MovementState; rescueMissionId: number | null;
  blockedTicks: number; replanWaypoint: Vec | null;
  coverUntilTick: number; coverPosition: Vec | null;
  lastAttackers: { ref: EntityRef; tick: number }[];
}
export interface CampaignSite {
  id: number; position: Vec; owner: SiteOwner; ownerGeneration: number;
  challenger: CampaignTeam | null; progress: number; /** Percentage; progress holds authoritative 60000 units. */ captureProgress: number;
  turretId: number; contested: boolean; firstFriendlyCaptureTick: number | null;
  lastOwnerChangeTick: number; depletedSinceTick: number | null;
  rescueCooldownUntilTick: number;
}
export interface CampaignArmy {
  id: number; siteId: number; reserves: ClassCounts; initialReserves: ClassCounts;
  reserveCount: number; reservedCapacity: number; status: MovementState;
}
export interface ReinforcementTicket {
  id: number; ticketId: number; runId: string; sourceId: string; sourceGeneration: number;
  team: CampaignTeam; laneId: number; armyId: number | null;
  classCounts: ClassCounts; dragonCount: number; reserveCost: ClassCounts;
  scheduledTick: number; firstDueTick: number; reservedCapacity: number;
  waveOrdinal: number; status: 'reserved' | 'spawned' | 'cancelled';
}
export interface RescueMission {
  id: number; missionId: number; donorSiteId: number; recipientSiteId: number;
  memberRefs: EntityRef[]; status: 'enroute' | 'completed' | 'failed'; startedTick: number;
}
export type ProjectileKind = 'mg' | 'cannon' | 'bomb' | 'arrow' | 'magic' | 'fireball' | 'turret';
export interface CampaignProjectile {
  id: number; generation: number; kind: ProjectileKind; team: CampaignTeam;
  sourceRef: EntityRef; sourceClass: ActorClass | 'player'; fromPlayer: boolean;
  laneId?: number;
  position: Vec; previous: Vec; velocity: Vec; radius: number; damage: number;
  bornTick: number; ttl: number;
}
export type EventKind = 'telegraph' | 'shot' | 'hit' | 'kill' | 'explosion' | 'capture' | 'neutralize' | 'reinforcement' | 'rescue' | 'selfLoss' | 'respawn' | 'victory' | 'defeat';
export interface CampaignEvent {
  id: number; eventId: number; tick: number; kind: EventKind;
  sourceRef?: EntityRef; sourceTeamAtFire?: CampaignTeam; targetRef?: EntityRef;
  position?: Vec; siteId?: number; team?: CampaignTeam; weapon?: ProjectileKind | ActorClass;
  rawDamage?: number; effectiveDamage?: number; killCredit?: boolean; reason?: string;
}
export interface ScoreBreakdown {
  capture: number; turrets: number; success: number; speed: number;
  friendlyDamage: number; friendlyKills: number; selfLoss: number; total: number;
}
export interface CampaignResult {
  status: 'victory' | 'defeat'; reason: string; activeTicks: number;
  respawnPenaltyTicks: number; recordTicks: number; capturedSites: number;
  livesRemaining: number; score: number; breakdown: ScoreBreakdown;
  friendlyLosses: number; enemyKills: number; selfLosses: number;
  mode: CampaignMode; seed: number; rulesVersion: string; mapVersion: string; startHeading: number;
}
export interface CampaignState {
  runId: string; rulesVersion: string; mapVersion: string; seed: number; rngState: number;
  readonly features: CampaignFeatures;
  mode: CampaignMode; startHeading: number; status: CampaignStatus;
  simTick: number; activeTicks: number; respawnPenaltyTicks: number; livesRemaining: number;
  player: CampaignPlayer; sites: CampaignSite[]; actors: CampaignActor[];
  projectiles: CampaignProjectile[]; armies: CampaignArmy[];
  reinforcementTickets: ReinforcementTicket[]; rescueMissions: RescueMission[];
  events: CampaignEvent[]; result: CampaignResult | null; resultSnapshot: CampaignResult | null;
  nextEntityId: number; nextProjectileId: number; nextEventId: number; nextTicketId: number; nextMissionId: number;
  friendlyDamage: number; friendlyKills: number; friendlyLosses: number; enemyKills: number;
  selfLosses: number; destroyedInitialTurretIds: number[]; firstCapturedSiteIds: number[];
  lossReason: string | null;
}
export interface CampaignInput {
  playerPosition?: Vec; playerVelocity?: Vec;
  playerQuaternion?: { x: number; y: number; z: number; w: number };
  previousQuaternion?: { x: number; y: number; z: number; w: number };
  fire?: boolean; bomb?: boolean; muzzles?: Vec[]; forward?: Vec;
  gunMuzzles?: { mg: Vec[]; cannon: Vec[] };
  shotDirections?: { mg: Vec[]; cannon: Vec[] };
}
