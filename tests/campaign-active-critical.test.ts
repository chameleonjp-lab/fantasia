import { readFileSync } from 'node:fs';
import { terrainHeight } from '../src/campaign-terrain';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Campaign } from '../src/campaign';
import { campaignProtectionReadout, campaignSafetyReadout } from '../src/campaign-hud';
import { CampaignFlightController } from '../src/campaign-flight';
import { CRITICAL_KINDS, criticalStateActive, criticalText, fixedCriticalTextIssues, activeSampleIssues, type CriticalKind, type CriticalRuntime, type CriticalWitness } from '../browser-acceptance/active-critical-contract';
import { detailAccessIssues, type DetailAccessEvidence } from '../browser-acceptance/detail-scroll-contract';
import type { FlightInput } from '../src/types';
import { runInNewContext } from 'node:vm';
import { transpileModule } from 'typescript';
import { Vector3 } from 'three';
import { criticalRuntimeEvidence, CriticalAcquisitionDriver } from '../browser-acceptance/active-critical-driver';
import { RealRendererDriver } from '../browser-acceptance/real-driver';

const neutral: FlightInput = { turn: 0, climb: 0, accelerate: false, brake: false, fire: false, bomb: false, loop: false, viewAspect: 1, steeringRevision: 0 };
function sortie(mode: 'normal' | 'easy' = 'normal', viewAspect = 1) {
  const campaign = new Campaign(mode), flight = new CampaignFlightController(campaign.state);
  const read = (): CriticalRuntime => ({ screen: 'playing', phase: campaign.state.status === 'respawning' ? 'respawning' : 'playing', campaign: campaign.snapshot(), player: { reloadTicksRemaining: flight.player.reloadTicksRemaining } });
  const step = (input: Partial<FlightInput> = {}) => { campaign.step(flight.step(campaign.state, { ...neutral, viewAspect, ...input })); flight.sync(campaign.state); };
  const reach = (kind: CriticalKind, input: Partial<FlightInput> = {}, limit = 1300) => {
    for (let n = 0; n < limit; n++) {
      step(input); const raw = read(); if (criticalStateActive(kind, raw)) return raw;
      assert.equal(campaign.state.status, 'running', `Aircraft unexpectedly lost before ${kind}`);
    }
    assert.fail(`Natural path did not reach ${kind}`);
  };
  return { campaign, flight, read, step, reach };
}

test('dormant warning DOM cannot supply any activation at fresh start', () => {
  const s = sortie(), raw = { ...s.read(), text: { warning: '低空注意', announcement: '爆弾投下', 'respawn-status': '復活まで' } };
  for (const kind of CRITICAL_KINDS) assert.equal(criticalStateActive(kind, raw), false, kind);
});

for (const mode of ['normal', 'easy'] as const) {
  test(`${mode}: real flight equations naturally reach low altitude, collision and respawn protection`, () => {
    const s = sortie(mode);
    // Manual climb is now an angular rate, so the first descent step is .82/60
    // rather than the old .95 * (1-exp(-4.2/60)) absolute-pitch response.
    s.step({ climb: -1 }); assert.ok(Math.abs(s.flight.player.pitch + .82 / 60) <= 1e-12);
    const low = s.reach('low-altitude', { climb: -1 }, 239);
    assert.equal(low.campaign.simTick, 180);
    assert.equal(low.campaign.selfLosses, 0);
    const death = s.reach('respawning', { climb: -1 }, 80);
    assert.equal(death.campaign.simTick, 219); assert.equal(death.campaign.selfLosses, 1);
    assert.equal(death.campaign.livesRemaining, 2); assert.equal(death.campaign.player.hp, 0);
    const frozen = death.campaign.activeTicks;
    // Unit adapter boundary only; browser tests wait for the actual native
    // app countdown. This unit call is never counted as browser coverage.
    s.campaign.resumeRespawn(); s.flight.sync(s.campaign.state, true);
    assert.equal(s.campaign.state.activeTicks, frozen);
    assert.equal(criticalStateActive('protection', s.read()), true);
    assert.equal(s.campaign.state.player.protectionTicks, 120);
  });
  test(`${mode}: one natural sortie reaches targeting, manual reload where supported, boundary and bomb event`, () => {
    const s = sortie(mode), targeted = s.reach('enemy-targeting', {}, 500);
    assert.equal(targeted.campaign.simTick, 313);
    for (let i = 0; i < 6; i++) s.step();
    assert.equal(criticalStateActive('enemy-targeting', s.read()), true);
    if (mode === 'normal') {
      const reload = s.reach('reload', { fire: true }, 800);
      assert.equal(reload.campaign.player.mg, 0); assert.equal(reload.campaign.player.cannon, 0);
      assert.ok(reload.player.reloadTicksRemaining > 300);
      for (let i = 0; i < 6; i++) s.step();
    }
    const boundary = s.reach('boundary', {}, 1300);
    assert.ok(boundary.campaign.player.boundaryTicks >= 590);
    s.step({ bomb: true }); const bomb = s.read();
    assert.equal(criticalStateActive('bomb-announcement', bomb), true);
    const event = bomb.campaign.events.find(e => e.kind === 'shot' && e.weapon === 'bomb' && e.sourceRef?.id === bomb.campaign.player.id)!;
    const witness: CriticalWitness = { kind: 'bomb-announcement', runId: bomb.campaign.runId, tick: bomb.campaign.simTick, activeTicks: bomb.campaign.activeTicks, eventId: event.id };
    for (let i = 0; i < 6; i++) s.step();
    assert.equal(criticalStateActive('bomb-announcement', s.read(), witness), true);
    assert.equal(criticalStateActive('bomb-announcement', s.read(), { ...witness, runId: 'other-run' }), false);
  });
}

for (const [width, height] of [[320, 568], [568, 320], [393, 852]]) {
  test(`Easy ${width}x${height}: bounded manual climb and release reach boundary despite visible-target assistance`, () => {
    const s = sortie('easy', width / height);
    s.reach('enemy-targeting', {}, 500);
    for (let i = 0; i < 6; i++) s.step();
    const start = s.campaign.state.simTick;
    // Holding .4 indefinitely now commands continual pitch rotation. Use a
    // real 70-tick climb followed by release, retaining the same total 1000-tick
    // acquisition budget and all live boundary/bomb/zero-loss assertions.
    for (let i = 0; i < 70; i++) s.step({ climb: .4 });
    assert.ok(s.flight.player.pitch > .35 && s.flight.player.pitch < .45);
    const boundary = s.reach('boundary', {}, 930);
    assert.ok(boundary.campaign.simTick - start < 1000);
    assert.equal(boundary.campaign.selfLosses, 0);
    assert.ok(boundary.campaign.player.boundaryTicks >= 590);
    // Releasing the native pointer precedes the unchanged display proof.
    for (let i = 0; i < 6; i++) s.step();
    assert.equal(criticalStateActive('boundary', s.read()), true);
    s.step({ bomb: true });
    assert.equal(criticalStateActive('bomb-announcement', s.read()), true);
  });
}

test('Easy landscape neutral assistance reaches the real boundary warning within the acquisition budget', () => {
  const s = sortie('easy', 568 / 320);
  const boundary = s.reach('boundary', {}, 314 + 1222);
  assert.equal(boundary.campaign.status, 'running');
  assert.equal(boundary.campaign.selfLosses, 0);
  assert.ok(Math.hypot(s.campaign.state.player.position.x, s.campaign.state.player.position.z) >= 2100);
  for (let i = 0; i < 6; i++) s.step();
  assert.equal(criticalStateActive('boundary', s.read()), true);
});

test('bomb announcement witness expires and cannot be a label-only claim', () => {
  const s = sortie(); s.step({ bomb: true }); const raw = s.read();
  const event = raw.campaign.events.find(e => e.kind === 'shot' && e.weapon === 'bomb')!;
  const witness: CriticalWitness = { kind: 'bomb-announcement', runId: raw.campaign.runId, tick: raw.campaign.simTick, activeTicks: raw.campaign.activeTicks, eventId: event.id };
  for (let n = 0; n < 120; n++) s.step();
  assert.equal(criticalStateActive('bomb-announcement', s.read(), witness), false);
  assert.equal(criticalStateActive('bomb-announcement', raw, { ...witness, eventId: undefined }), false);
});

function geometry() {
  return { viewport: { width: 320, height: 568 }, regions: [{ key: 'fixed', kind: 'panel', rect: { x: 10, y: 10, width: 120, height: 20 } }, { key: 'details', kind: 'detail-viewport', rect: { x: 10, y: 100, width: 120, height: 100 } }],
    styles: [{ key: 'style:warning:0' }] as any,
    runs: [{ text: '低空注意 · 機首を上げて', owner: 'fixed', ancestorRegions: ['fixed'], styleKeys: ['style:warning:0'], fragments: [{ x: 10, y: 10, width: 120, height: 20 }] }] };
}
test('fixed active text requires actual fragments outside the scrolling region', () => assert.deepEqual(fixedCriticalTextIssues(geometry(), { warning: '低空注意' }), []));
for (const [name, mutate] of [
  ['missing warning', (g: any) => { g.runs = []; }],
  ['empty dormant string', (g: any) => { g.runs[0].text = ''; }],
  ['wrong active message', (g: any) => { g.runs[0].text = '復活待機'; }],
  ['moved into details', (g: any) => { g.runs[0].ancestorRegions.push('details'); }],
  ['zero-area fragment', (g: any) => { g.runs[0].fragments[0].width = 0; }],
  ['no complete fragments', (g: any) => { g.runs[0].fragments = []; }],
] as const) test(`fixed critical negative: ${name}`, () => { const g = geometry(); mutate(g); assert.ok(fixedCriticalTextIssues(g, { warning: '低空注意' }).length); });

test('every state defines a nonempty required warning message', () => {
  const s = sortie(); for (const kind of CRITICAL_KINDS) { const text = criticalText(kind, s.campaign.state); assert.ok(Object.keys(text).length); assert.ok(Object.values(text).every(v => v.trim())); }
});

test('atomic numeric state rejects expired warnings even if text remains', () => {
  const base = { phase: 'playing', statusEvidence: { screen: 'playing', status: 'running', position: { x: 0, y: 300, z: 0 }, protectionTicks: 0, reloadTicksRemaining: 0 } };
  for (const kind of ['low-altitude', 'boundary', 'reload', 'protection'] as const) assert.ok(activeSampleIssues(kind, base).length, kind);
  const low = structuredClone(base); low.statusEvidence.position.y = 20; assert.deepEqual(activeSampleIssues('low-altitude', low), []);
  assert.ok(activeSampleIssues('respawning', base).length);
  assert.ok(activeSampleIssues('boundary', {}).length);
});

function respawnAccess(): DetailAccessEvidence {
  const ids = ['campaign-mode-status', 'lives-count', 'pause', 'game-sound', ...Array.from({ length: 7 }, (_, i) => `site-${i + 1}`), ...Array.from({ length: 7 }, (_, i) => `campaign-site-state-${i + 1}`)];
  return { active: true, phase: 'respawning', viewportId: 'campaign-hud-details', expectedEntryIds: ['timer'], actualEntryIds: ['timer'], expectedFragments: ['a', 'b'], persistentIds: ids,
    samples: (['keyboard', 'touch'] as const).flatMap(method => [0, 100].map((scrollTop, i) => ({ method, scrollTop, phase: 'respawning', neutralInput: true,
      fullHudScroll: { windowX: 0, windowY: 0, appLeft: 0, appTop: 0, hudLeft: 0, hudTop: 0 }, persistentIds: ids, fullyVisibleFragments: [i ? 'b' : 'a'] }))) };
}
test('explicit respawn traversal requires both full text methods without inventing flight controls', () => assert.deepEqual(detailAccessIssues(respawnAccess(),'respawning'), []));
test('ordinary default remains playing and cannot silently accept respawn', () => { const e = respawnAccess(); delete e.phase; assert.ok(detailAccessIssues(e).some(i => i.includes('lost live state'))); });
test('respawn still rejects unread text, lost lives/site state and whole-HUD scrolling', () => {
  for (const mutate of [(e: DetailAccessEvidence) => { e.samples[0].persistentIds = []; }, (e: DetailAccessEvidence) => { e.samples[1].fullyVisibleFragments = []; }, (e: DetailAccessEvidence) => { e.samples[0].fullHudScroll.hudTop = 10; }]) {
    const e = respawnAccess(); mutate(e); assert.ok(detailAccessIssues(e,'respawning').length);
  }
});

test('untrusted evidence phase cannot relax the original reporter contract', () => assert.ok(detailAccessIssues(respawnAccess()).some(i => i.includes('caller contract'))));

test('raw projection is browser-serializable and keeps activation fields without copying the whole actor set', () => {
  const s = sortie(), raw = { ...s.read(), mode: 'normal', tick: 0, activeTicks: 0, player: s.flight.player, render: {}, controlsInput: {} };
  const project = runInNewContext(`(${criticalRuntimeEvidence.toString()})`), result = project(raw);
  assert.equal(result.campaign.actorCount, 350); assert.equal(result.campaign.actors.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.campaign.player)), JSON.parse(JSON.stringify(raw.campaign.player)));
  assert.ok(JSON.stringify(result).length < JSON.stringify(raw).length / 20);
});
test('acquisition allowance does not change the original 45-second display or native-step budget', () => {
  const page = { on() {} } as any;
  const acquisition = new CriticalAcquisitionDriver(page), display = new RealRendererDriver(page);
  assert.equal(acquisition.budget.wallMs, 120000); assert.equal(acquisition.budget.maxSteps, 1800);
  assert.equal(display.budget.wallMs, 45000); assert.equal(display.budget.maxSteps, 120);
});

test('browser-side acquisition projection retains real targeting activation and original actor count', async () => {
  const s = sortie(); s.reach('enemy-targeting');
  const raw = { ...s.read(), mode: 'normal', tick: s.campaign.state.simTick, activeTicks: s.campaign.state.activeTicks,
    player: s.flight.player, render: { calls: 1, triangles: 2, queue: { failure: null }, hudLayout: { large: 'diagnostics' } }, controlsInput: {} };
  const before = JSON.stringify(raw); let reads = 0;
  const page = { on() {}, evaluate(source: string) { return Promise.resolve(runInNewContext(source, {
    window: { __fantasiaReadState(argument: unknown) { assert.equal(argument, false); reads++; return raw; } },
  })); } } as any;
  const driver = new CriticalAcquisitionDriver(page), observed = await driver.full();
  assert.equal(reads, 1); assert.equal(criticalStateActive('enemy-targeting', observed), true);
  assert.equal(observed.campaign.actorCount, 350); assert.ok(observed.campaign.actors.length > 0);
  assert.equal(criticalRuntimeEvidence(observed).campaign.actorCount, 350);
  assert.equal(observed.render.hudLayout, undefined); assert.equal(observed.render.queue.failure, null);
  assert.equal(JSON.stringify(raw), before); assert.equal(driver.budget.steps, 0);
});

test('acquisition counts all four native frames, keeps single-event steps, and never extends the frame cap', async () => {
  const calls: unknown[] = [];
  const page = { on() {}, clock: { async runFor(ms: number) { calls.push(ms); } } } as any;
  const driver = new CriticalAcquisitionDriver(page);
  driver.drainNativeGpu = async () => { calls.push('native GPU completion'); };
  await driver.step(); assert.equal(driver.budget.steps, 4);
  await driver.stepOne(); assert.equal(driver.budget.steps, 5);
  assert.deepEqual(calls, ['native GPU completion', 64, 'native GPU completion', 16]);
  driver.budget.steps = 1799; calls.length = 0;
  await assert.rejects(driver.step(), /animation-step budget exceeded/);
  assert.deepEqual(calls, []); assert.equal(driver.budget.maxSteps, 1800); assert.equal(driver.budget.wallMs, 120000);
});

// Exercise the actual fixed-state adapter, with only its renderer/DOM boundary
// stubbed. Campaign and flight projection are the production implementations.
function fixedHudFixture(alert: string, width = 320, height = 568, mode: 'normal' | 'easy' = 'normal') {
  const source = readFileSync(new URL('../scripts/ui-only-adapter.js', import.meta.url), 'utf8')
    .replace('import.meta.env.DEV', 'true');
  const elements = new Map<string, any>();
  const context: any = { window: { innerWidth: width, innerHeight: height }, Vector3, audio: { event() {}, worldEvent() {}, finishFlight() {}, resetFlight() {}, update() {} }, location: { pathname: '/__ui-only' }, selectedMode: 'normal',
    terrainHeight, screen: 'home', respawnRemaining: 0, announcementUntil: 0, announcementPriority: 0,
    bombPrediction: null, bombPredictionTick: 0, CAMPAIGN_DT: 1 / 60, CAMPAIGN_LIMIT_TICKS: 72000,
    performance: { now: () => 1000 }, requestAnimationFrame() { return 0; }, disposed: false,
    startPreparation: { ownsRendering: false }, contextLost: false, renderStatus: 'ready',
    lastFrame: 0, lastFrameGap: 0, frameId: 0, accumulator: 0, pendingLoop: false, pendingBomb: false,
    frameIntervals: [], updateTimes: [], inputAudit: [], inputAuditSignature: '', inputAuditDropped: 0,
    controls: { sample() { return { ...neutral }; }, sampleThrottle() { return undefined; } },
    clearInput() {}, syncAudio() {}, syncMode() {}, updateHUD() {}, el(id: string) { if (!elements.has(id)) elements.set(id, { textContent: '', dataset: {} }); return elements.get(id); },
    setScreen(value: string) { context.screen = value; },
    scene: { camera: { aspect: width / height }, pollRender() { return 'ready'; }, setUiOnlyThreat() {}, setOverlayVisible() {}, render() { return true; }, diagnostics() { return { queue: { status: 'ready' } }; } },
    resetCampaign() { context.campaign = new Campaign(context.selectedMode); context.state = context.campaign.state;
      context.flight = new CampaignFlightController(context.state); context.player = context.flight.player; },
  };
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  runInNewContext(transpileModule(main.slice(main.indexOf('function announce('), main.indexOf('function syncAudio(')), {}).outputText, context);
  runInNewContext(transpileModule(main.slice(main.indexOf('function handleEvents('), main.indexOf('function consumeTick(')), {}).outputText, context);
  runInNewContext(transpileModule(main.slice(main.indexOf('function completeRespawn('), main.indexOf('function frame(')), {}).outputText, context);
  runInNewContext(transpileModule(main.slice(main.indexOf('function consumeTick('), main.indexOf('function updateBombCue(')).replace('import.meta.env.DEV', 'true'), {}).outputText, context);
  runInNewContext(transpileModule(main.slice(main.indexOf('function frame('), main.indexOf("for (const id of ['start'")), {}).outputText, context);
  runInNewContext(source, context);
  context.fixture = context.window.__fantasiaUiOnlyTest.hud(mode, alert, 4);
  context.announcementText = context.el('announcement').textContent;
  return context;
}

for (const alert of ['clear', 'outside', 'low']) test(`UI fixture ${alert}: reload state and displayed flight ammo agree`, () => {
  const x = fixedHudFixture(alert);
  assert.equal(criticalStateActive('reload', { screen: x.screen, phase: 'playing', campaign: x.state, player: x.player }), true);
  assert.equal(x.player.mg, x.state.player.mg); assert.equal(x.player.cannon, x.state.player.cannon);
  assert.equal(x.player.health, x.state.player.hp);
});
test('UI fixture respawn carries a real loss, zero HP and a single record penalty', () => {
  const x = fixedHudFixture('respawn');
  assert.equal(criticalStateActive('respawning', { screen: x.screen, phase: 'respawning', campaign: x.state, player: x.player }), true);
  assert.equal(x.state.selfLosses, 1); assert.equal(x.state.livesRemaining, 2); assert.equal(x.state.respawnPenaltyTicks, 600);
  assert.equal(x.player.health, 0);
});
test('UI fixture protection follows actual respawn restoration, without stale reload', () => {
  const x = fixedHudFixture('protected');
  assert.equal(criticalStateActive('protection', { screen: x.screen, phase: 'playing', campaign: x.state, player: x.player }), true);
  assert.equal(x.state.player.protectionTicks, 120);
  assert.equal(x.state.player.reloadUntilTick, null); assert.equal(x.player.reloadTicksRemaining, 0);
  assert.equal(x.player.mg, 288); assert.equal(x.player.cannon, 96); assert.equal(x.player.bombs, 2);
});

for (const alert of ['clear', 'outside', 'low']) test(`UI fixture ${alert}: announcement and threat refer to the same live turret`, () => {
  const x = fixedHudFixture(alert), turret = x.state.actors.find((a: any) => a.team === 'enemy' && a.class === 'turret');
  assert.equal(turret.targetRef.generation, x.state.player.generation);
  assert.equal(turret.fireAtTick - x.state.simTick, 72);
  assert.equal(x.announcementText, `砲台の予告 · 陣地${turret.laneId + 1} · 1.2秒`);
});
for (const alert of ['protected', 'respawn']) test(`UI fixture ${alert}: lifecycle notice is not an unrelated fabricated turret warning`, () => {
  const x = fixedHudFixture(alert);
  assert.equal(x.announcementText, alert === 'protected' ? '復活 · 2秒の保護中は自機も攻撃できません' : '自機喪失 · 復活すると記録時間に10秒加算');
  if (alert === 'protected') assert.equal(x.state.actors.some((a: any) => a.targetRef?.id === x.state.player.id && a.targetRef.generation !== x.state.player.generation), false);
});

test('reachable reload-loss fixture uses real flight steps and actual loss notice without synthetic world overrides', () => {
  const x = fixedHudFixture('reachable-reload-loss');
  assert.equal(x.fixture.fixtureKind, 'input-equations-reachable-state');
  assert.equal(x.state.seed, 20261005);
  assert.equal(x.state.simTick, 933); assert.equal(x.state.activeTicks, 933);
  assert.equal(x.state.status, 'respawning'); assert.equal(x.player.reloadTicksRemaining, 142);
  assert.equal(x.state.player.mg, 0); assert.equal(x.state.player.cannon, 0);
  assert.equal(x.state.selfLosses, 1); assert.equal(x.state.respawnPenaltyTicks, 600);
  assert.equal(x.announcementPriority, 5);
  assert.equal(x.announcementText, '自機喪失 · 復活すると記録時間に10秒加算');
  assert.equal(x.state.sites.every((site: any) => site.owner === 'enemy' && !site.contested), true);
  const direct = sortie('normal', 320 / 568);
  for (let tick = 0; tick < 716; tick++) direct.step({ fire: true });
  for (let tick = 0; tick < 217; tick++) direct.step({ climb: -1 });
  const normalize = (state: any) => JSON.parse(JSON.stringify({ ...state, runId: undefined }));
  assert.deepEqual(normalize(x.state), normalize(direct.campaign.state));
});

// Real input controller; DOM events are unit doubles, not browser-native input.
test('cleared lifecycle input cannot replay late release, cancel or held-key repeat after revival', async () => {
  const { FlightControls } = await import('../src/input');
  class ControlElement extends EventTarget {
    style = { left: '', top: '', setProperty() {}, removeProperty() {} };
    classList = { add() {}, remove() {}, toggle() {} }; captures = new Set<number>(); attributes = new Map<string, string>();
    getAttribute(k: string) { return this.attributes.get(k) ?? null; }
    setAttribute(k: string, v: string) { this.attributes.set(k, v); }
    getBoundingClientRect() { return { left: 0, top: 100, bottom: 244, width: 72, height: 144 }; }
    closest(selector: string) { return selector === '#app' || (selector.includes('[role="slider"]') && this.attributes.get('role') === 'slider') ? this : null; }
    querySelector() { return this; }
    setPointerCapture(id: number) { this.captures.add(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    focus() {}
  }
  const originals = ['window', 'document', 'HTMLElement'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  const win = Object.assign(new EventTarget(), { visualViewport: new EventTarget() });
  const doc = Object.assign(new EventTarget(), { hidden: false, getElementById: () => new ControlElement() });
  for (const [key, value] of [['window', win], ['document', doc], ['HTMLElement', ControlElement]] as const)
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const surface = new ControlElement(), buttons = { fire: new ControlElement(), loop: new ControlElement(), bomb: new ControlElement(), throttle: new ControlElement() };
  buttons.throttle.setAttribute('role', 'slider');
  let active = true;
  const controls = new FlightControls(surface as any, buttons as any, () => active);
  const pointer = (type: string, pointerId: number) => Object.assign(new Event(type, { cancelable: true }),
    { pointerId, clientX: 100, clientY: 200, pointerType: 'touch', button: 0, buttons: 1, isPrimary: false });
  const key = (type: string, repeat = false) => Object.assign(new Event(type, { cancelable: true }), { code: 'Space', repeat });
  try {
    for (const [i, button] of Object.values(buttons).entries()) button.dispatchEvent(pointer('pointerdown', i + 1));
    surface.dispatchEvent(pointer('pointerdown', 5)); win.dispatchEvent(key('keydown'));
    assert.equal(Object.values(controls.peek().heldPointers).flat().length, 3);
    assert.deepEqual(controls.peek().keys, ['Space']);
    assert.equal(controls.peek().throttlePointer, 4);
    assert.notEqual(controls.sample(false).throttle, 0);
    assert.equal(controls.peek().steerPointer, 5);
    // Queue fresh edges after the preceding sample consumed any prior ones.
    buttons.loop.dispatchEvent(pointer('pointerdown', 6)); win.dispatchEvent(pointer('pointerup', 6)); buttons.loop.releasePointerCapture(6);
    buttons.bomb.dispatchEvent(pointer('pointerdown', 7)); win.dispatchEvent(pointer('pointerup', 7)); buttons.bomb.releasePointerCapture(7);
    controls.clear(); active = false;
    assert(Object.values(buttons).every(button => button.captures.size === 0)); assert.equal(surface.captures.size, 0);
    win.dispatchEvent(pointer('pointerup', 1)); win.dispatchEvent(pointer('pointercancel', 2));
    active = true;
    win.dispatchEvent(pointer('pointerup', 3)); win.dispatchEvent(pointer('pointercancel', 4)); win.dispatchEvent(key('keydown', true));
    const sample = controls.sample();
    assert.equal(sample.fire, false); assert.equal(sample.loop, false); assert.equal(sample.bomb, false);
    assert.equal(sample.throttle, 0); assert.equal(controls.peek().throttlePointer, null);
    assert.equal(sample.turn, 0); assert.equal(sample.climb, 0); assert.deepEqual(controls.peek().keys, []);
    win.dispatchEvent(key('keyup')); win.dispatchEvent(key('keydown'));
    assert.equal(controls.sample().fire, true, 'a new deliberate press still works');
  } finally {
    controls.dispose();
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});


test('protection projection retains revival, remaining seconds and all-attack restriction from state', () => {
  const x = fixedHudFixture('protected');
  assert.equal(campaignProtectionReadout(x.state), '復活保護 あと2.0秒 · 自機攻撃不可');
  x.state.player.protectionTicks = 63;
  assert.equal(campaignProtectionReadout(x.state), '復活保護 あと1.1秒 · 自機攻撃不可');
  x.state.player.protectionTicks = 0;
  assert.equal(campaignProtectionReadout(x.state), '');
  x.state.player.protectionTicks = 120; x.state.status = 'respawning';
  assert.equal(campaignProtectionReadout(x.state), '', 'waiting is a separate lifecycle with its own full text');
});


test('protection projection never absorbs independent boundary danger or waiting penalty', () => {
  const x = fixedHudFixture('protected');
  assert.equal(campaignSafetyReadout(x.state), '');
  x.state.player.position.x = 2200; x.state.player.boundaryTicks = 123;
  assert.equal(campaignSafetyReadout(x.state), '作戦圏へ戻って · あと3秒');
  assert.equal(campaignProtectionReadout(x.state), '復活保護 あと2.0秒 · 自機攻撃不可');
  const waiting = fixedHudFixture('respawn');
  assert.equal(campaignSafetyReadout(waiting.state), '');
  assert.equal(waiting.state.respawnPenaltyTicks, 600);
  assert.match(waiting.announcementText, /10秒加算/);
});


test('reachable landscape protection uses actual production revival after natural flight loss', () => {
  const x = fixedHudFixture('reachable-protection', 568, 320);
  assert.equal(x.state.status, 'running'); assert.equal(x.state.player.generation, 2);
  assert.equal(x.state.selfLosses, 1); assert.equal(x.state.player.protectionTicks, 120);
  assert.equal(x.state.player.mg, 288); assert.equal(x.state.player.cannon, 96);
  assert.equal(x.state.player.reloadUntilTick, null);
  assert.equal(x.fixture.reachability.stateOverrides, false);
  assert.equal(x.fixture.reachability.controlledRespawnBoundary, true);
  assert.equal(x.fixture.reachability.nativeInput, false);
  assert.equal(x.fixture.reachability.selfLossEvent.kind, 'selfLoss');
  const expected = sortie('normal', 568 / 320);
  for (const stage of x.fixture.reachability.path)
    for (let i = 0; i < stage.steps; i++) expected.step(stage.action === 'fire' ? { fire: true } : { climb: -1 });
  expected.campaign.resumeRespawn(); expected.flight.sync(expected.campaign.state, true);
  const normalized = (state: any) => { const copy = JSON.parse(JSON.stringify(state)); delete copy.runId; return copy; };
  assert.deepEqual(normalized(x.state), normalized(expected.campaign.state));
});


test('protection contract rejects missing attack meaning, stale countdown and hidden canonical text', () => {
  const g = geometry(); g.styles[0].key = 'style:campaign-threat:0'; g.runs[0].styleKeys = ['style:campaign-threat:0'];
  g.runs[0].text = '復活保護 あと1.1秒 · 自機攻撃不可';
  assert.deepEqual(fixedCriticalTextIssues(g, { 'campaign-threat': '復活保護 あと' }), []);
  const sample = { phase: 'playing', statusEvidence: { screen: 'playing', status: 'running', position: { x: 0, y: 300, z: 0 }, protectionTicks: 63 }, geometry: g };
  assert.deepEqual(activeSampleIssues('protection', sample), []);
  g.runs[0].text = '復活保護 あと2.0秒 · 自機攻撃不可';
  assert.ok(activeSampleIssues('protection', sample).length);
  g.runs[0].text = '復活保護 あと1.1秒';
  assert.ok(fixedCriticalTextIssues(g, { 'campaign-threat': '復活保護 あと' }).length);
  g.runs[0].text = '復活保護 あと1.1秒 · 自機攻撃不可'; g.runs[0].fragments = [];
  assert.ok(activeSampleIssues('protection', sample).length);
});


test('only the actual protection producer tags its duplicate announcement', () => {
  assert.equal(fixedHudFixture('protected').el('announcement').dataset.lifecycle, 'protection');
  for (const alert of ['clear', 'low', 'outside', 'respawn'])
    assert.equal(fixedHudFixture(alert).el('announcement').dataset.lifecycle, '', alert);
});


test('low terrain danger stays independent while revival protection is active', () => {
  const x = fixedHudFixture('protected');
  x.state.player.position = { x: 0, y: terrainHeight(0, 0) + 30, z: 0 };
  assert.equal(campaignSafetyReadout(x.state), '低空注意 · 機首を上げて');
  assert.equal(campaignProtectionReadout(x.state), '復活保護 あと2.0秒 · 自機攻撃不可');
});

for (const mode of ['normal', 'easy'] as const) for (const alert of ['clear', 'low', 'outside']) test(`deadline branch ${mode}/${alert}: real frame crosses 30-second threshold with explicit synthetic preconditions`, () => {
  const x = fixedHudFixture(`deadline-${alert}`, 568, 320, mode);
  assert.equal(x.state.activeTicks, 70200);
  assert.equal(x.state.simTick, 70200);
  assert.equal(x.announcementText, '作戦期限まで、あと30秒');
  assert.equal(x.announcementPriority, 4);
  assert.equal(x.announcementUntil, 70500);
  assert.equal(x.fixture.fixtureKind, 'state-controlled-deadline-branch');
  assert.equal(x.fixture.reachability.stateOverrides, true);
  assert.equal(x.fixture.reachability.fullRunReachable, false);
  assert.equal(x.fixture.reachability.beforeActiveTicks, 70199);
  assert.equal(x.player.reloadTicksRemaining, 107);
  const turret = x.state.actors.find((a: any) => a.team === 'enemy' && a.class === 'turret');
  assert.equal(turret.phase, 'telegraph'); assert.ok(turret.hp > 0);
  assert.equal(turret.targetRef.id, x.state.player.id);
  assert.equal(turret.targetRef.generation, x.state.player.generation);
  assert.equal(turret.fireAtTick - x.state.simTick, 71);
  if (alert === 'low') assert.ok(campaignSafetyReadout(x.state).includes('低空'));
  if (alert === 'outside') assert.equal(x.state.player.boundaryTicks, 89);
});

test('deadline priority cannot replace an unexpired higher-priority lifecycle notice', () => {
  const x = fixedHudFixture('deadline-clear');
  x.announce('自機喪失', 5, 5);
  x.announce('作戦期限まで、あと30秒', 5, 4);
  assert.equal(x.el('announcement').textContent, '自機喪失');
  assert.equal(x.announcementPriority, 5);
  x.state.activeTicks = x.announcementUntil;
  x.announce('作戦期限まで、あと30秒', 5, 4);
  assert.equal(x.el('announcement').textContent, '作戦期限まで、あと30秒');
  assert.equal(x.announcementPriority, 4);
});

test('bounded reflow diagnostics preserve the original result and vary only text shape', () => {
  const source = readFileSync(new URL('../browser-ui-only/ui-only.spec.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('function hudReflowProbePlans('), source.indexOf('async function captureHudReflowProbes('));
  const context: any = {}; runInNewContext(transpileModule(block, {}).outputText, context);
  for (const [bounds, side] of [[304, 106.2], [552, 218.8]]) {
    const plans = context.hudReflowProbePlans(bounds, side);
    assert.equal(plans.length, 6);
    assert.deepEqual(Array.from(plans.slice(4), (p: any) => p.alertWidth), [140, 160]);
    assert.equal(new Set(plans.map((p: any) => p.name)).size, 6);
    assert.ok(plans.every((p: any) => p.alertWidth >= 44 && p.alertWidth <= bounds && p.detailHeight === 64));
    assert.equal(plans.filter((p: any) => p.wrapBands).length, 3);
  }
  const implementation = source.slice(source.indexOf('async function captureHudReflowProbes('), source.indexOf('async function runFreshHudCase('));
  assert.ok(implementation.includes('finally {'));
  assert.ok(implementation.includes('original failures retained'));
  assert.ok(!implementation.includes("setProperty('font"));
  assert.ok(!implementation.includes('textContent ='));
  assert.ok(!implementation.includes('innerHTML ='));
});
