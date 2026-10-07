import type { ActorClass, CampaignFeatures, ClassCounts, GroundClass } from './campaign-types';

export const BASE_CAMPAIGN_RULES_VERSION = 'fantasia-capture-v1';
export const SUSPENDED_CAMPAIGN_RULES_VERSION = 'fantasia-capture-v1-dragon-fireballs-suspended';
// Temporary mitigation while the reported iPhone freeze remains unresolved.
// Restoring dragonFireballs also restores the original, separate rules identity.
export const DEFAULT_CAMPAIGN_FEATURES: CampaignFeatures = Object.freeze({ dragonFireballs: false });
export function campaignRulesVersion(features: CampaignFeatures): string {
  return features.dragonFireballs ? BASE_CAMPAIGN_RULES_VERSION : SUSPENDED_CAMPAIGN_RULES_VERSION;
}
export const CAMPAIGN_RULES_VERSION = campaignRulesVersion(DEFAULT_CAMPAIGN_FEATURES);
export function validateCampaignFeatures(features: CampaignFeatures): void {
  if (!features || typeof features !== 'object' || Array.isArray(features)
    || Reflect.ownKeys(features).length !== 1 || !Object.hasOwn(features, 'dragonFireballs')
    || typeof features.dragonFireballs !== 'boolean') throw new RangeError('Invalid campaign features');
}
export const CAMPAIGN_MAP_VERSION = 'fantasia-sevenfold-v1';
export const CAMPAIGN_DT = 1 / 60;
export const SITE_COUNT = 7;
export const CAPTURE_MAX = 60000;
export const CAPTURE_RADIUS = 55;
export const CAMPAIGN_LIMIT_TICKS = 72000;
export const MAX_PROJECTILES = 4096;
export const GROUND_CLASSES: readonly GroundClass[] = ['sword', 'bow', 'mage', 'cavalry'];
export const INITIAL_CLASSES: Readonly<ClassCounts> = Object.freeze({ sword: 12, bow: 5, mage: 3, cavalry: 4 });
export const ENEMY_WAVE_CLASSES: readonly GroundClass[] = ['sword', 'sword', 'sword', 'sword', 'bow', 'bow', 'mage', 'cavalry'];
export interface ActorStats {
  hp: number; speed: number; range: number; damage: number; recovery: number;
  telegraph: number; lock: number; projectileSpeed: number; ttl: number; radius: number;
}
export const ACTOR_STATS: Readonly<Record<ActorClass, Readonly<ActorStats>>> = Object.freeze({
  sword: { hp: 40, speed: 5.5, range: 3, damage: 10, recovery: 48, telegraph: 12, lock: 0, projectileSpeed: 0, ttl: 0, radius: .8 },
  bow: { hp: 30, speed: 5, range: 95, damage: 8, recovery: 84, telegraph: 12, lock: 6, projectileSpeed: 90, ttl: 120, radius: .8 },
  mage: { hp: 32, speed: 4.5, range: 115, damage: 14, recovery: 144, telegraph: 36, lock: 12, projectileSpeed: 75, ttl: 120, radius: .8 },
  cavalry: { hp: 100, speed: 12, range: 4, damage: 20, recovery: 72, telegraph: 18, lock: 0, projectileSpeed: 0, ttl: 0, radius: 1.8 },
  dragon: { hp: 180, speed: 38, range: 450, damage: 22, recovery: 180, telegraph: 54, lock: 12, projectileSpeed: 95, ttl: 300, radius: 8 },
  turret: { hp: 600, speed: 0, range: 850, damage: 30, recovery: 240, telegraph: 72, lock: 18, projectileSpeed: 160, ttl: 360, radius: 6 },
});
export function emptyClassCounts(): ClassCounts { return { sword: 0, bow: 0, mage: 0, cavalry: 0 }; }
export function countClasses(counts: ClassCounts): number { return GROUND_CLASSES.reduce((n, c) => n + counts[c], 0); }
export function validateClassCounts(counts: ClassCounts): void {
  for (const c of GROUND_CLASSES) if (!Number.isInteger(counts[c]) || counts[c] < 0) throw new RangeError(`Invalid class inventory: ${c}`);
}
export function classDamage(source: ActorClass | 'player', target: ActorClass | 'player', damage: number): number {
  let multiplier = 1;
  if (source === 'sword' && target === 'bow' || source === 'bow' && target === 'mage' || source === 'cavalry' && target === 'sword') multiplier = 1.25;
  else if (source === 'mage' && target === 'cavalry') multiplier = 1.5;
  else if (source === 'bow' && target === 'cavalry') multiplier = .7;
  return Math.floor(Math.max(0, damage) * multiplier + .5);
}
