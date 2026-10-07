import { test, expect } from '@playwright/test';
import { RealRendererDriver } from './real-driver';

test('real-renderer driver proof: Normal and Easy tick-zero start, one input, pause and deliberate resume', async ({ page }, info) => {
  const driver = new RealRendererDriver(page);
  let backend: Record<string, unknown> | undefined, outcome = 'failed';
  try {
    await driver.boot(); backend = await driver.backend();
    for (const mode of ['normal', 'easy'] as const) {
      await driver.click(`label:has(input[name="game-mode"][value="${mode}"])`);
      await driver.click('#start');
      const preparing = await driver.requireState(`${mode}:after-start`);
      expect(preparing.phase).toBe('preparing'); expect(preparing.tick).toBe(0);
      const live = await driver.reachPlaying();
      expect(live.mode).toBe(mode); expect(live.render.calls).toBeGreaterThan(0);
      expect(live.render.triangles).toBeGreaterThan(0); expect(live.render.hudLayout.measurements).toBeGreaterThan(0);
      expect(live.render.hudLayout.status).toBe('placed'); expect(live.bombs).toBe(2);
      await driver.key('z');
      const used = await driver.nextTick(); expect(used.bombs).toBe(1);
      const released = await driver.nextTick(); expect(released.bombs).toBe(1);
      await driver.click('#pause'); const paused = await driver.requireState(`${mode}:paused`);
      expect(paused.phase).toBe('paused'); expect(paused.pauseReasons).toEqual(['manual']);
      for (let frame = 0; frame < 3; frame++) await driver.step();
      const frozen = await driver.requireState(`${mode}:frozen`);
      expect(frozen.tick).toBe(paused.tick); expect(frozen.activeTicks).toBe(paused.activeTicks);
      expect(frozen.queue.submittedCount).toBe(paused.queue.submittedCount); expect(frozen.queue.status).toBe('ready');
      await driver.click('#resume'); const resumed = await driver.nextTick();
      expect(resumed.tick).toBe(paused.tick + 1); expect(resumed.bombs).toBe(1); expect(resumed.pauseReasons).toEqual([]);
      await driver.click('#pause'); await driver.click('#pause-home');
      const home = await driver.requireState(`${mode}:home`);
      expect(home.phase).toBe('ready'); expect(home.tick).toBe(0); expect(home.runId).not.toBe(live.runId);
    }
    expect(driver.pageErrors).toEqual([]); expect(driver.releasedFences).toBe(driver.createdFences);
    outcome = 'passed';
  } finally {
    try { await info.attach('controlled-clock-real-renderer-proof', { contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 1, classification: 'controlled-clock-functional-driver-proof', outcome,
      runtimeMocked: false, rendererMocked: false, applicationQueueModified: false,
      suiteRebuildComplete: false, physicalDeviceAcceptance: 'unverified', performanceAcceptance: 'not-measured',
      backend, clockStepMs: 16, externalWallBudgetMs: driver.budget.wallMs, steps: driver.budget.steps,
      ownedFencesCreated: driver.createdFences, ownedFencesReleased: driver.releasedFences,
      pageErrors: driver.pageErrors, observations: driver.evidence,
    }, null, 2) }); } catch (evidenceError) {
      if (outcome === 'passed') throw evidenceError;
      console.warn('Driver proof evidence attachment failed:', String(evidenceError));
    }
  }
});
