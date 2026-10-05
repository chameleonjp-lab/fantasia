import test from 'node:test';
import assert from 'node:assert/strict';
import { Campaign } from '../src/campaign';
import { campaignSiteReadouts, campaignThreatReadout } from '../src/campaign-hud';
import type { ReinforcementTicket } from '../src/campaign-types';

test('a mixed ground/dragon reservation is counted in both enemy dispatch clocks without mutating a frozen snapshot', () => {
  const campaign = new Campaign();
  campaign.state.reinforcementTickets.push({
    status: 'reserved', team: 'enemy', laneId: 0, scheduledTick: 300,
    classCounts: { sword: 1, bow: 0, mage: 0, cavalry: 0 }, dragonCount: 1,
  } as ReinforcementTicket);
  const snapshot = campaign.snapshot();
  const before = JSON.stringify(snapshot);
  const site = campaignSiteReadouts(snapshot)[0];
  assert.equal(site.enemyWaveSeconds, 5);
  assert.equal(site.dragonWaveSeconds, 5);
  assert.equal(site.enemyDispatch, true);
  assert.equal(JSON.stringify(snapshot), before);
});

test('the player warning names a bow projectile as an arrow', () => {
  const campaign = new Campaign();
  const bow = campaign.state.actors.find(actor => actor.team === 'enemy' && actor.class === 'bow')!;
  bow.phase = 'telegraph'; bow.targetRef = { id: campaign.state.player.id, generation: campaign.state.player.generation };
  bow.fireAtTick = 60;
  assert.match(campaignThreatReadout(campaign.snapshot()), /弓兵の矢/);
});
