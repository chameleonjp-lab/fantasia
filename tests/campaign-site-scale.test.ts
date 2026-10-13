import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Mesh, Vector3 } from 'three';
import { Campaign } from '../src/campaign';
import { ACTOR_STATS, CAMPAIGN_SITE_SCALE, CAMPAIGN_TURRET_AIM_HEIGHT } from '../src/campaign-config';
import { CampaignScene } from '../src/campaign-scene';
import { heightAt } from '../src/campaign-terrain';

test('all seven site visuals scale together and enlarged curbs still follow the terrain', () => {
  const campaign = new Campaign('easy');
  const scene = Object.create(CampaignScene.prototype) as any;
  Object.assign(scene, { scene: new Group(), geometries: new Set(), materials: new Set(), siteVisuals: new Map() });
  try {
    const visuals = campaign.state.sites.map(site => ({
      site,
      visual: scene.createSite(site.id, site.position),
      turretActor: campaign.state.actors.find(actor => actor.id === site.turretId)!,
    }));
    scene.scene.updateMatrixWorld(true);
    for (const { site, visual, turretActor } of visuals) {
      assert.deepEqual(visual.root.scale.toArray(), [CAMPAIGN_SITE_SCALE, CAMPAIGN_SITE_SCALE, CAMPAIGN_SITE_SCALE]);
      assert.equal(turretActor.radius, ACTOR_STATS.turret.radius);
      assert.equal(turretActor.radius, 6 * CAMPAIGN_SITE_SCALE);
      assert.ok(Math.abs(turretActor.position.y - site.position.y - CAMPAIGN_TURRET_AIM_HEIGHT) < 1e-9);
      const crystal = visual.crystal.getWorldPosition(new Vector3());
      assert.ok(Math.abs(crystal.y - turretActor.position.y) < 1e-9, `site ${site.id} turret aim point aligns with its crystal`);
      const curbs = visual.root.children.filter((child: unknown): child is Mesh => child instanceof Mesh && child.geometry.type === 'BoxGeometry');
      assert.equal(curbs.length, 12);
      for (const curb of curbs) {
        const world = curb.getWorldPosition(new Vector3());
        assert.ok(Math.abs(world.y - (heightAt(world.x, world.z) + .18 * CAMPAIGN_SITE_SCALE)) < 1e-8,
          `site ${site.id} curb center follows the scaled footprint terrain`);
      }
    }
  } finally {
    for (const geometry of scene.geometries) geometry.dispose();
    for (const material of scene.materials) material.dispose();
  }
});
