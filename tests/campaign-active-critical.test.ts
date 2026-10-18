import { readFileSync } from 'node:fs';
import { terrainHeight } from '../src/campaign-terrain';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Campaign } from '../src/campaign';
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
  const ids = ['campaign-mode-status', 'lives-count', ...Array.from({ length: 7 }, (_, i) => `site-${i + 1}`), ...Array.from({ length: 7 }, (_, i) => `campaign-site-state-${i + 1}`)];
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
function fixedHudFixture(alert: string) {
  const source = readFileSync(new URL('../scripts/ui-only-adapter.js', import.meta.url), 'utf8')
    .replace('import.meta.env.DEV', 'true');
  const context: any = { window: { innerWidth: 320, innerHeight: 568 }, Vector3, audio: { event() {}, worldEvent() {}, finishFlight() {} }, location: { pathname: '/__ui-only' }, selectedMode: 'normal',
    terrainHeight, screen: 'home', respawnRemaining: 0, announcementUntil: 0, announcementPriority: 0,
    bombPrediction: null, bombPredictionTick: 0,
    syncMode() {}, updateHUD() {}, announce(text: string, _duration: number, priority: number) { context.announcementText = text; context.announcementPriority = priority; }, el() { return { textContent: '' }; },
    setScreen(value: string) { context.screen = value; },
    scene: { setUiOnlyThreat() {}, setOverlayVisible() {}, render() { return true; }, diagnostics() { return {}; } },
    resetCampaign() { context.campaign = new Campaign(context.selectedMode); context.state = context.campaign.state;
      context.flight = new CampaignFlightController(context.state); context.player = context.flight.player; },
  };
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  runInNewContext(transpileModule(main.slice(main.indexOf('function handleEvents('), main.indexOf('function consumeTick(')), {}).outputText, context);
  runInNewContext(source, context);
  context.fixture = context.window.__fantasiaUiOnlyTest.hud('normal', alert, 4);
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
