import { test, expect } from '@playwright/test';
import { RealRendererDriver } from './real-driver';
import { CriticalAcquisitionDriver, acquireCritical, verifyActiveCritical } from './active-critical-driver';
import type { CriticalKind } from './active-critical-contract';
import { gzipSync } from 'node:zlib';

const profiles = [
  { id: 'small-portrait', width: 320, height: 568, dpr: 2, textScale: 1 },
  { id: 'small-landscape', width: 568, height: 320, dpr: 2, textScale: 1 },
  { id: 'portrait-text-200', width: 393, height: 852, dpr: 3, textScale: 2 },
];

for (const profile of profiles) test.describe(`active-critical-${profile.id}`, () => {
  test.use({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr, hasTouch: true });
  for (const mode of ['normal', 'easy'] as const) for (const sequence of ['descent-lifecycle', 'flight-warning-sequence'] as const) {
    test(`${sequence}-${mode}`, async ({ page }, info) => {
      let stage = 'boot', outcome = 'failed';
      const startup = new RealRendererDriver(page), evidence: Array<Record<string, unknown>> = [];
      const acquisitions: CriticalAcquisitionDriver[] = [], displays: RealRendererDriver[] = [];
      let backend: unknown;
      try {
        await startup.boot(); backend = await startup.backend(); await startup.start(mode);
        if (profile.textScale === 2) {
          const enlargement = await page.evaluate(() => {
            const nodes = [...document.querySelectorAll<HTMLElement>('#app *')].filter(n => !['CANVAS', 'SCRIPT', 'STYLE'].includes(n.tagName));
            const sizes = nodes.map(node => ({ node, before: parseFloat(getComputedStyle(node).fontSize) }));
            for (const { node, before } of sizes) node.style.setProperty('font-size', `${before * 2}px`, 'important');
            return sizes.map(({ node, before }) => ({ id: node.id || node.tagName, before, after: parseFloat(getComputedStyle(node).fontSize) }));
          });
          expect(enlargement.length).toBeGreaterThan(20);
          for (const size of enlargement) expect(size.after).toBeCloseTo(size.before * 2, 2);
          evidence.push({ label: 'actual-200-percent-text', enlargement }); await startup.nextTick();
        }
        // One real sortie per sequence. Each observed critical state keeps its
        // own activation witness and display proof, without rebooting its peers.
        const kinds: CriticalKind[] = sequence === 'descent-lifecycle'
          ? ['low-altitude', 'respawning', 'protection']
          : ['enemy-targeting', ...(mode === 'normal' ? ['reload' as const] : []), 'boundary', 'bomb-announcement'];
        for (const kind of kinds) {
          stage = `acquisition:${kind}`;
          const acquisition = new CriticalAcquisitionDriver(page); acquisitions.push(acquisition);
          const witness = await acquireCritical(acquisition, kind);
          stage = `display:${kind}`;
          const display = new RealRendererDriver(page); displays.push(display);
          await verifyActiveCritical(display, witness);
          await info.attach(`active-critical-${kind}`, { contentType: 'image/png', body: await page.screenshot() });
          evidence.push({ label: 'critical-state-completed', kind, witness });
        }
        stage = 'complete'; outcome = 'passed';
      } finally {
        await info.attach('active-critical-evidence', { contentType: 'application/gzip', body: gzipSync(Buffer.from(JSON.stringify({
          schemaVersion: 1, profile, mode, sequence, stage, outcome,
          failureClass: outcome === 'passed' ? null : stage.startsWith('acquisition:') ? 'state-not-reached-or-runtime-interruption' : stage.startsWith('display:') ? 'active-display-or-scroll-proof-failed' : 'startup-or-text-enlargement-failed',
          classification: 'controlled-clock-functional', runtimeMocked: false, rendererMocked: false, applicationQueueModified: false,
          stateInjected: false, warningDomFabricated: false, physicalDeviceAcceptance: 'unverified', performanceAcceptance: 'not-measured', releaseReady: false,
          acquisitionBudget: { wallMsPerState: 120000, maxFramesPerState: 1800, probeClockMs: 64, eventProbeClockMs: 16 }, displayBudget: { wallMsPerState: 45000, maxStepsPerState: 120 },
          backend, evidence, startup: startup.evidence,
          acquisitions: acquisitions.map(d => ({ steps: d.budget.steps, createdFences: d.createdFences, releasedFences: d.releasedFences, pageErrors: d.pageErrors, observations: d.evidence })),
          displays: displays.map(d => ({ steps: d.budget.steps, createdFences: d.createdFences, releasedFences: d.releasedFences, pageErrors: d.pageErrors, observations: d.evidence })),
        }, null, 2))) });
      }
    });
  }
});
