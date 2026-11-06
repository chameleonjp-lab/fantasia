import { normalizeAngle } from './flight';
import type { Aircraft } from './types';
import type { CampaignState, Vec } from './campaign-types';

/** Fixed-step snapshots are presentation-only. Combat never consumes this view. */
export class CampaignPresentation {
  private state: CampaignState | null = null;
  private tick = -1;
  private generation = -1;
  private player: Aircraft | null = null;
  private actors = new Map<number, { generation: number; hp: number; position: Vec }>();
  reset() { this.state = null; this.player = null; this.actors.clear(); }
  capture(state: CampaignState, player: Aircraft) {
    this.state = state; this.tick = state.simTick; this.generation = state.player.generation;
    this.player = { ...player, position: player.position.clone(), quaternion: player.quaternion.clone() };
    this.actors.clear();
    for (const actor of state.actors) this.actors.set(actor.id, { generation: actor.generation, hp: actor.hp, position: { ...actor.position } });
  }
  sample(state: CampaignState, player: Aircraft, alpha: number) {
    if (state.status !== 'running') { this.reset(); return { state, player }; }
    if (this.state !== state || this.tick !== state.simTick - 1 || this.generation !== state.player.generation || !this.player || player.health <= 0) return { state, player };
    const t = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1, before = this.player;
    const lerp = (a: Vec, b: Vec): Vec => ({ x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t, z: a.z + (b.z-a.z)*t });
    const presented: Aircraft = { ...player, position: before.position.clone().lerp(player.position,t), quaternion: before.quaternion.clone().slerp(player.quaternion,t),
      pitch: before.pitch+normalizeAngle(player.pitch-before.pitch)*t, yaw: before.yaw+normalizeAngle(player.yaw-before.yaw)*t, bank: before.bank+normalizeAngle(player.bank-before.bank)*t };
    const q = presented.quaternion;
    const view: CampaignState = { ...state, player: { ...state.player, position: { ...presented.position }, quaternion: { x:q.x, y:q.y, z:q.z, w:q.w } },
      actors: state.actors.map(actor => { const prior = this.actors.get(actor.id); return prior && prior.generation === actor.generation && prior.hp > 0 && actor.hp > 0 ? { ...actor, position: lerp(prior.position,actor.position) } : actor; }),
      projectiles: state.projectiles.map(round => ({ ...round, position: lerp(round.previous,round.position) })) };
    return { state: view, player: presented };
  }
}
