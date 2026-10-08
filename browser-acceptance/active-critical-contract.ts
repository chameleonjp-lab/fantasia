import { terrainHeight } from '../src/campaign-terrain';
import type { CampaignState } from '../src/campaign-types';
import type { TextGeometry } from './text-geometry';

export type CriticalKind = 'low-altitude' | 'boundary' | 'reload' | 'enemy-targeting' | 'bomb-announcement' | 'respawning' | 'protection';
export const CRITICAL_KINDS: CriticalKind[] = ['low-altitude', 'boundary', 'reload', 'enemy-targeting', 'bomb-announcement', 'respawning', 'protection'];
export const FIXED_INSTRUMENTS = ['hud-mode', 'lives-count', 'health', 'altitude', 'speed', 'remaining-time', 'mg-ammo', 'cannon-ammo', 'bomb-ammo'];
export interface CriticalRuntime { phase: string; screen: string; campaign: CampaignState; player: { reloadTicksRemaining: number }; }
export interface CriticalWitness { kind: CriticalKind; runId: string; tick: number; activeTicks: number; eventId?: number; }

/** Activation depends only on the actual scene/campaign snapshot, never DOM labels. */
export function criticalStateActive(kind: CriticalKind, raw: CriticalRuntime, witness?: CriticalWitness): boolean {
  const s = raw.campaign, p = s.player;
  if (raw.screen !== 'playing' || (witness && (witness.runId !== s.runId || witness.kind !== kind))) return false;
  if (kind === 'respawning') return raw.phase === 'respawning' && s.status === 'respawning' && p.hp === 0 && s.livesRemaining > 0;
  if (raw.phase !== 'playing' || s.status !== 'running') return false;
  switch (kind) {
    case 'low-altitude': return p.protectionTicks === 0 && Math.hypot(p.position.x, p.position.z) <= 2100 && p.position.y - terrainHeight(p.position.x, p.position.z) < 65;
    case 'boundary': return Math.hypot(p.position.x, p.position.z) > 2100 && p.boundaryTicks > 0;
    case 'reload': return p.reloadUntilTick !== null && p.reloadUntilTick > s.simTick && raw.player.reloadTicksRemaining > 0 && p.mg === 0 && p.cannon === 0;
    case 'enemy-targeting': return p.protectionTicks === 0 && s.actors.some(a => a.hp > 0 && a.team === 'enemy' && a.phase === 'telegraph' && a.targetRef?.id === p.id && a.fireAtTick !== null && a.fireAtTick > s.simTick);
    case 'protection': return p.protectionTicks > 0 && p.generation > 1 && s.selfLosses > 0;
    case 'bomb-announcement': return witness ? Number.isInteger(witness.eventId) && s.activeTicks >= witness.activeTicks && s.activeTicks - witness.activeTicks < 120 && p.bombs < 2
      : s.events.some(e => e.kind === 'shot' && e.weapon === 'bomb' && e.sourceRef?.id === p.id);
  }
}

export function criticalText(kind: CriticalKind, s: CampaignState): Record<string, string> {
  switch (kind) {
    case 'low-altitude': return { warning: '低空注意 · 機首を上げて' };
    case 'boundary': return { warning: '作戦圏へ戻って' };
    case 'reload': return { 'reload-status': '再装填中 あと' };
    case 'enemy-targeting': return { 'campaign-threat': '自機を照準' };
    case 'bomb-announcement': return { announcement: '爆弾投下 · 地上の味方位置にも注意' };
    case 'respawning': return { 'respawn-status': '戦況と作戦時間は停止中', 'campaign-threat': '復活待機', announcement: '自機喪失' };
    case 'protection': return { warning: '復活保護', 'campaign-threat': '復活保護', 'bomb-hint': '復活保護中', announcement: '復活 · 2秒の保護中' };
  }
}

/** Require a real complete text run for every fixed item. Hidden DOM text,
 * clipped detail descendants, empty warning labels and dormant strings fail. */
export function fixedCriticalTextIssues(geometry: TextGeometry, required: Record<string, string>): string[] {
  const issues: string[] = [];
  const detailKeys = new Set(geometry.regions.filter(r => r.kind === 'detail-viewport').map(r => r.key));
  for (const [id, expected] of Object.entries(required)) {
    const keys = geometry.styles.filter(s => s.key.startsWith(`style:${id}:`)).map(s => s.key);
    const runs = geometry.runs.filter(r => r.styleKeys.some(k => keys.includes(k)));
    if (!runs.length || !runs.every(r => r.text.trim() && r.fragments.length && r.fragments.every(f => f.width > 0 && f.height > 0))) issues.push(`${id}: missing actual text fragments`);
    if (runs.some(r => r.ancestorRegions.some(k => detailKeys.has(k)))) issues.push(`${id}: critical item moved into scrolling details`);
    if (!runs.map(r => r.text).join(' ').includes(expected)) issues.push(`${id}: missing active critical text ${expected}`);
  }
  return issues;
}

/** Every settled sample retains the activated state. Numeric state, rather
 * than a hidden flag or stale warning string, proves warning activation. */
export function activeSampleIssues(kind: CriticalKind, sample: any): string[] {
  const s = sample.statusEvidence, p = s?.position;
  if (!s || !p || ![p.x, p.y, p.z].every(Number.isFinite)) return ['Missing atomic critical-state observation'];
  const expectedPhase = kind === 'respawning' ? 'respawning' : 'playing';
  if (sample.phase !== expectedPhase || s.screen !== 'playing' || s.status !== (kind === 'respawning' ? 'respawning' : 'running')) return ['Critical scene phase changed during traversal'];
  if (kind === 'low-altitude' && !(s.protectionTicks === 0 && Math.hypot(p.x, p.z) <= 2100 && p.y - terrainHeight(p.x, p.z) < 65)) return ['Low-altitude condition expired'];
  if (kind === 'boundary' && !(Math.hypot(p.x, p.z) > 2100)) return ['Boundary condition expired'];
  if (kind === 'reload' && !(s.reloadTicksRemaining > 0)) return ['Reload condition expired'];
  if (kind === 'protection' && !(s.protectionTicks > 0)) return ['Protection condition expired'];
  return [];
}
