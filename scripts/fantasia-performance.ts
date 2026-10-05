import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Campaign, ACTOR_STATS, formationPosition, campaignStateHash, validateCampaignState } from '../src/campaign';

const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] ?? 0;
function maxLoad() {
  const game = new Campaign('normal');
  for (const actor of game.state.actors) {
    // Artificial longevity fixture: every ground body is a bow shooter and all
    // bodies have enough HP to sustain the exact 470-actor load for 120 seconds.
    // This is not a gameplay/balance or hardware-rendering acceptance run.
    actor.hp = actor.maxHp = 1_000_000;
    if (actor.kind === 'ground') {
      actor.class = 'bow'; actor.radius = ACTOR_STATS.bow.radius;
      actor.position = formationPosition(actor.laneId, actor.team === 'friendly' ? 1020 : 980, actor.slot, 'bow');
      actor.previous = { ...actor.position };
    }
  }
  for (let lane = 0; lane < 7; lane++) {
    for (const team of ['friendly', 'enemy'] as const) {
      for (let slot = 24; slot < 32; slot++) {
        const actor = game.spawnActor(team, 'bow', lane, team === 'friendly' ? lane : null,
          formationPosition(lane, team === 'friendly' ? 1020 : 980, slot, 'bow'), 'reinforcement', 1, slot);
        actor.hp = actor.maxHp = 1_000_000;
      }
    }
    const first = game.state.actors.find(a => a.kind === 'dragon' && a.laneId === lane)!;
    const actor = game.spawnActor('enemy', 'dragon', lane, null,
      { ...first.position, x: first.position.x - 50 }, 'reinforcement', 1);
    actor.hp = actor.maxHp = 1_000_000;
  }
  validateCampaignState(game.state);
  return game;
}
const game = maxLoad(), timing: number[] = [];
let minimumActors = Infinity, maxProjectiles = 0, shots = 0;
for (let tick = 0; tick < 7200; tick++) {
  const start = performance.now();
  game.step({ playerPosition: { x: 0, y: 300, z: 0 }, playerVelocity: { x: 0, y: 0, z: 0 }, fire: true });
  timing.push(performance.now() - start);
  minimumActors = Math.min(minimumActors, 1 + game.state.actors.filter(a => a.hp > 0).length);
  maxProjectiles = Math.max(maxProjectiles, game.state.projectiles.length);
  shots += game.state.events.filter(e => e.kind === 'shot').length;
}
if (minimumActors !== 470 || game.state.activeTicks !== 7200) throw new Error('Max load fixture lost actors or stopped early');
const restartChecks = Array.from({ length: 10 }, () => {
  const run = new Campaign('easy');
  for (let i = 0; i < 60; i++) run.step();
  run.dispose();
  return run.state.reinforcementTickets.every(t => t.status !== 'reserved');
});
const report = {
  environment: { runtime: process.version, platform: process.platform, arch: process.arch },
  fixture: 'synthetic 470 actors, 448 bow shooters, 14 dragons, 7 turrets, 1 player; high HP; all lanes active; stationary benchmark player',
  simulationOnly: true, physicalDesktop: false, physicalPhone: false,
  durationSimSeconds: game.state.activeTicks / 60, minimumActors, maxProjectiles, shots,
  millisecondsPerTick: { median: percentile(timing, .5), p95: percentile(timing, .95), p99: percentile(timing, .99), max: Math.max(...timing) },
  stateHash: campaignStateHash(game.state), logicalRestartChecks: restartChecks,
  limitations: ['No WebGL frame timings', 'No physical-device qualification', 'No 20 minute WebGL soak', 'No browser listener/texture/memory leak assertion', 'Not a normal gameplay victory'],
};
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/fantasia-performance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
