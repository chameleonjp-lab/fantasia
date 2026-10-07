import { expect } from '@playwright/test';
import { RealRendererDriver } from './real-driver';
import { RunBudget } from './run-budget';
import { createVisibilityPredicate, meetsMinimumTarget, assertFreshGeometry } from './geometry-contract';
import { collectHudTextGeometry, detailGeometrySnapshot, textGeometryIssues, type TextRegion } from './text-geometry';
import { verifyDetailScroll } from './detail-scroll';
import { criticalStateActive, criticalText, fixedCriticalTextIssues, activeSampleIssues, FIXED_INSTRUMENTS, type CriticalKind, type CriticalWitness } from './active-critical-contract';

/** Long acquisition has its own hard bound. The unchanged RealRendererDriver
 * is constructed separately for each 45 s / 120-step display proof. Runtime
 * frame/GPU safety rules, native fences, and geometry tolerances are untouched. */
/** Evidence-only projection: retain source values used by the oracle and
 * targeting actors, never duplicate the full 350-actor campaign snapshot. */
export function criticalRuntimeEvidence(raw: any) {
  const s = raw.campaign;
  return { phase: raw.phase, screen: raw.screen, mode: raw.mode, tick: raw.tick, activeTicks: raw.activeTicks,
    status: raw.status, performanceInterrupted: raw.performanceInterrupted, fatalLogicError: raw.fatalLogicError,
    player: { position: raw.player.position, speed: raw.player.speed, health: raw.player.health, maxHealth: raw.player.maxHealth,
      reloadTicksRemaining: raw.player.reloadTicksRemaining, bombReloadTicks: raw.player.bombReloadTicks },
    campaign: { runId: s.runId, seed: s.seed, simTick: s.simTick, activeTicks: s.activeTicks, status: s.status,
      livesRemaining: s.livesRemaining, selfLosses: s.selfLosses, player: s.player, events: s.events,
      actorCount: s.actorCount ?? s.actors.length, actors: s.actors.filter((a: any) => a.team === 'enemy' && a.phase === 'telegraph' && a.targetRef?.id === s.player.id)
        .map((a: any) => ({ id: a.id, generation: a.generation, hp: a.hp, team: a.team, class: a.class, phase: a.phase, targetRef: a.targetRef, fireAtTick: a.fireAtTick })),
      sites: s.sites.map((a: any) => ({ id: a.id, owner: a.owner, contested: a.contested, progress: a.progress })) },
    render: raw.render, controlsInput: raw.controlsInput, respawnRemaining: raw.respawnRemaining };
}

export class CriticalAcquisitionDriver extends RealRendererDriver {
  override readonly budget = new RunBudget(120000, 1800);
  override async step(): Promise<void> {
    // Only the natural-flight acquisition batches four real animation frames.
    // Count every frame against the original cap and retain native GPU completion.
    // Single-tick event acquisition and all display proofs keep the 16ms step.
    for (let frame = 0; frame < 4; frame++) this.budget.step();
    await this.drainNativeGpu();
    await this.call('advance four controlled acquisition frames', () => this.page.clock.runFor(64));
  }
  async stepOne(): Promise<void> { await super.step(); }
  override async full(): Promise<any> {
    // Project inside the browser before transport. Acquisition still reads the
    // actual state each native step; the separate atomic display capture keeps
    // the full geometry. Do not transfer 350 actors and layout search diagnostics
    // on every frame of a long natural flight.
    return this.call('read critical source observation', () => this.page.evaluate(`(() => {
      const raw = window.__fantasiaReadState(false);
      const value = (${criticalRuntimeEvidence.toString()})(raw);
      value.render = { calls: raw.render.calls, triangles: raw.render.triangles, queue: raw.render.queue };
      return value;
    })()`));
  }
}

export async function acquireCritical(d: CriticalAcquisitionDriver, kind: CriticalKind): Promise<CriticalWitness> {
  const key = ['low-altitude', 'respawning', 'protection'].includes(kind) ? 'ArrowDown' : kind === 'reload' ? 'Space' : kind === 'bomb-announcement' ? 'z' : null;
  const before = await d.full();
  let down = false, last = before, reached = false;
  try {
    // Protection is reached only after a real crash and the real 3-second
    // respawn countdown; release steering as soon as that countdown begins.
    if (before.phase === 'playing') {
      // The preceding full-text traversal deliberately retains detail focus.
      // A native click returns ownership to the real canvas before piloting.
      await d.click('#flight'); await expect(d.page.locator('#flight')).toBeFocused();
      if (key) { await d.page.keyboard.down(key); down = true; }
    }
    for (let frame = 0; frame < 1800; frame++) {
      if (criticalStateActive(kind, last)) {
        // Present persistent conditions in a fresh real renderer frame before
        // handing over to the unchanged display driver. Bomb events use their
        // original one-frame probe so an edge cannot disappear between reads.
        if (kind !== 'bomb-announcement') {
          await d.stepOne(); last = await d.full();
          if (!criticalStateActive(kind, last)) continue;
        }
        const event = last.campaign.events.find((e: any) => e.kind === 'shot' && e.weapon === 'bomb' && e.sourceRef?.id === last.campaign.player.id);
        const witness: CriticalWitness = { kind, runId: last.campaign.runId, tick: last.tick, activeTicks: last.activeTicks, ...(event ? { eventId: event.id } : {}) };
        reached = true;
        d.evidence.push({ label: 'critical-native-acquisition', kind, frames: d.budget.steps, probes: frame, key, before: criticalRuntimeEvidence(before), reached: criticalRuntimeEvidence(last), witness, audit: await d.audit() });
        expect(last.performanceInterrupted).toBe(false); expect(last.fatalLogicError).toBeNull(); expect(d.pageErrors).toEqual([]);
        return witness;
      }
      if (last.phase === 'respawning' && down) { await d.page.keyboard.up(key!); down = false; }
      if (!['playing', 'respawning'].includes(last.phase)) throw new Error(`Critical acquisition interrupted: ${kind}, phase=${last.phase}`);
      if (last.phase === 'respawning' && !['respawning', 'protection'].includes(kind)) throw new Error(`Critical acquisition lost aircraft before ${kind}`);
      if (kind === 'bomb-announcement') await d.stepOne(); else await d.step();
      last = await d.full();
      if (last.fatalLogicError || last.performanceInterrupted || last.render?.queue?.failure || d.pageErrors.length) throw new Error(`Critical acquisition encountered a runtime/native-renderer failure: ${kind}`);
    }
    throw new Error(`Critical state not naturally reached within 1800 frames: ${kind}`);
  } finally {
    if (down) await d.page.keyboard.up(key!);
    d.evidence.push({ label: 'critical-acquisition-final-state', kind, ...(reached ? {} : { state: criticalRuntimeEvidence(last) }), steps: d.budget.steps });
  }
}

/** Read-only atomic scene + DOM + renderer evidence. No warning node or game
 * state is synthesized, and no live node is reparented by this collector. */
async function capture(d: RealRendererDriver) {
  const visible = await d.page.evaluateHandle(createVisibilityPredicate);
  const collect = await d.page.evaluateHandle(`(${collectHudTextGeometry.toString()})`);
  const project = await d.page.evaluateHandle(`(${criticalRuntimeEvidence.toString()})`);
  try {
    return await d.call('atomic active-critical DOM and scene', () => d.page.evaluate(({ visible, collect, project }) => {
      const raw = (window as any).__fantasiaReadState(false), geometry = collect(visible);
      const canvas = document.querySelector('#flight')!.getBoundingClientRect();
      const compact = document.querySelector('#app')?.getAttribute('data-campaign-hud') === 'compact';
      const panels = [...document.querySelectorAll<HTMLElement>('.flight-data > *, .hud-top .time-block, #campaign-threat, #payload-status, #reload-status, #warning, #announcement, #respawn-status, #flight-tip, #campaign-hud-details, #campaign-mode-status, #hud > .target-tally, #hud > #bomb-hint')]
        .filter(n => visible(n) && !n.parentElement?.closest('#campaign-hud-details') && (!n.matches('.hud-top .time-block') || compact || (canvas.width <= 360 && canvas.height > canvas.width)));
      const obstacles = [...document.querySelectorAll<HTMLElement>('.hud-top, #campaign-sites .campaign-site[data-site], #hud button, #hud [role="slider"], #hud [data-flight-control]')].filter(visible);
      const local = (n: HTMLElement) => { const r = n.getBoundingClientRect(); return { id: n.id || n.className, x: r.x - canvas.x, y: r.y - canvas.y, width: r.width, height: r.height }; };
      const controls = [...document.querySelectorAll<HTMLElement>('#hud button, #hud [role="slider"], #hud [data-flight-control]')].filter(visible);
      const targets = [...new Set(controls)].map(n => {
        const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { id: n.id, role: n.getAttribute('role'), disabled: (n as HTMLButtonElement).disabled === true, inDetails: !!n.closest('#campaign-hud-details'),
          x: r.x, y: r.y, width: r.width, height: r.height, hit: !!hit && n.contains(hit) };
      });
      return { raw: project(raw), geometry, compact, targets, panels: panels.map(local), obstacles: [...new Set(obstacles)].map(local), canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
        sites: [...document.querySelectorAll<HTMLElement>('#campaign-sites [data-site]')].map(n => { const r = n.getBoundingClientRect(); return { number: n.dataset.site, owner: n.dataset.owner, ownerText: n.querySelector('.campaign-site-owner')?.textContent ?? '', stateText: n.querySelector('.campaign-site-state')?.textContent ?? '', visible: visible(n), inDetails: !!n.closest('#campaign-hud-details'), x: r.x, y: r.y, width: r.width, height: r.height }; }),
        scroll: { x: scrollX, y: scrollY, app: document.querySelector('#app')!.scrollTop, hud: document.querySelector('#hud')!.scrollTop } };
    }, { visible, collect, project } as any));
  } finally { await project.dispose(); await collect.dispose(); await visible.dispose(); }
}

export async function verifyActiveCritical(d: RealRendererDriver, witness: CriticalWitness) {
  const first = await capture(d), kind = witness.kind;
  const required = { ...Object.fromEntries((kind === 'respawning' ? ['hud-mode', 'lives-count'] : FIXED_INSTRUMENTS).map(id => [id, ''])), ...criticalText(kind, first.raw.campaign) };
  const validate = (value: typeof first) => {
    const { raw, geometry, canvas } = value, layout = raw.render.hudLayout;
    expect(criticalStateActive(kind, raw, witness), `${kind}: source state must remain active`).toBe(true);
    expect(layout.status).toBe('placed');
    assertFreshGeometry(value.panels, (layout.panels ?? []).map((p: any) => ({ id: p.id, ...p.rect })), 'active critical panels');
    assertFreshGeometry(value.obstacles, layout.obstacles.filter((r: any) => !['aim-and-reload-ring', 'central-flight-lane'].includes(r.id)), 'active critical obstacles'); expect(raw.render.calls).toBeGreaterThan(0); expect(raw.render.triangles).toBeGreaterThan(0);
    expect(value.sites.map(s => s.number).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(value.sites.every(s => s.visible && !s.inDetails && s.stateText.trim())).toBe(true);
    expect(raw.render.sites).toBe(7);
    for (const site of value.sites) {
      const source = raw.campaign.sites.find((s: any) => s.id + 1 === Number(site.number));
      expect(source).toBeTruthy(); expect(site.owner).toBe(source.owner);
      expect(site.ownerText).toContain(({ friendly: '味方', enemy: '敵', neutral: '中立' } as Record<string, string>)[source.owner]);
    }
    expect(Object.values(value.scroll).every(v => v === 0)).toBe(true);
    const sight = layout.obstacles.find((r: any) => r.id === 'aim-and-reload-ring'); expect(sight).toBeTruthy();
    const overlap = (a: any, b: any) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .75 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .75;
    const inside = (r: any) => { expect([r.x, r.y, r.width, r.height].every(Number.isFinite)).toBe(true); expect(r.width).toBeGreaterThan(0); expect(r.height).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThanOrEqual(-.75); expect(r.y).toBeGreaterThanOrEqual(-.75); expect(r.x + r.width).toBeLessThanOrEqual(canvas.width + .75); expect(r.y + r.height).toBeLessThanOrEqual(canvas.height + .75); };
    inside(sight); inside(layout.radar.rect);
    const siteRects = value.sites.map(s => ({ ...s, x: s.x - canvas.x, y: s.y - canvas.y }));
    for (const r of siteRects) { inside(r); expect(overlap(r, sight)).toBe(false); expect(overlap(r, layout.radar.rect)).toBe(false); }
    for (let i = 0; i < siteRects.length; i++) for (let j = i + 1; j < siteRects.length; j++) expect(overlap(siteRects[i], siteRects[j])).toBe(false);
    const reservations: TextRegion[] = [{ key: 'canvas:radar', kind: 'radar', rect: layout.radar.rect },
      ...layout.obstacles.filter((r: any) => ['aim-and-reload-ring', 'central-flight-lane'].includes(r.id)).map((r: any) => ({ key: `canvas:${r.id}`, kind: 'sight-reservation', rect: r })),
      ...(layout.canvasLabels ?? []).filter((r: any) => r.rect).map((r: any) => ({ key: `canvas:${r.id}`, kind: 'canvas-label', rect: r.rect }))]
      .map(r => ({ ...r, rect: { ...r.rect, x: r.rect.x + canvas.x, y: r.rect.y + canvas.y } }));
    const projected = value.compact ? detailGeometrySnapshot(geometry) : null;
    expect(fixedCriticalTextIssues(geometry, required)).toEqual([]);
    expect([...(projected?.completenessIssues ?? []), ...textGeometryIssues(projected?.projected ?? geometry, reservations)]).toEqual([]);
    if (kind !== 'respawning') {
      for (const id of ['pause', 'bomb', 'loop', ...(raw.mode === 'normal' ? ['fire', 'throttle'] : [])]) expect(value.targets.some(t => t.id === id && !t.disabled)).toBe(true);
      for (const t of value.targets.filter(t => !t.disabled)) {
        const local = { x: t.x - canvas.x, y: t.y - canvas.y, width: t.width, height: t.height };
        expect(Math.min(local.x + local.width, sight.x + sight.width) - Math.max(local.x, sight.x) > .75 && Math.min(local.y + local.height, sight.y + sight.height) - Math.max(local.y, sight.y) > .75, `${t.id} overlaps the actual sight`).toBe(false);
        expect(t.inDetails).toBe(false); expect(t.hit, `${t.id} must have an unobscured native hit target`).toBe(true);
        expect(meetsMinimumTarget(t.width) && meetsMinimumTarget(t.height)).toBe(true);
        expect(t.x).toBeGreaterThanOrEqual(-.75); expect(t.y).toBeGreaterThanOrEqual(-.75);
        expect(t.x + t.width).toBeLessThanOrEqual(geometry.viewport.width + .75); expect(t.y + t.height).toBeLessThanOrEqual(geometry.viewport.height + .75);
      }
    }
    return reservations;
  };
  d.evidence.push({ label: 'active-critical-before', witness, ...first });
  const reservations = validate(first);
  if (first.compact) {
    await verifyDetailScroll(d, reservations, kind === 'respawning' ? 'respawning' : 'playing');
    const samples = d.evidence.filter(e => e.label === 'detail-scroll-snapshot');
    expect(samples.length).toBeGreaterThan(3);
    for (const sample of samples) {
      expect(activeSampleIssues(kind, sample)).toEqual([]);
      expect(fixedCriticalTextIssues(sample.geometry as any, required)).toEqual([]);
    }
  }
  const last = await capture(d); d.evidence.push({ label: 'active-critical-after', witness, ...last }); validate(last);
  expect(d.pageErrors).toEqual([]); expect(d.createdFences).toBe(d.releasedFences);
  d.evidence.push({ label: 'active-critical-proof-completed', kind, detailTraversal: first.compact, phase: last.raw.phase });
}
