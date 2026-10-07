import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as three from 'three';
import * as campaign from '../src/campaign';
import * as config from '../src/campaign-config';
import * as combat from '../src/campaign-combat';
import * as flight from '../src/campaign-flight';
import * as terrain from '../src/campaign-terrain';
import * as flightMath from '../src/flight';
import * as start from '../src/campaign-start';
import { RenderQueue, type RenderQueueContext } from '../src/render-queue';

// Runs the actual main.ts event/rAF wiring with deterministic DOM/audio/renderer
// doubles and the real campaign/start/queue. This is not browser/GPU acceptance.
const compiledMain = ts.transpileModule(readFileSync('src/main.ts', 'utf8').replaceAll('import.meta.env.DEV', 'true'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
class Target {
  handlers = new Map<string, Array<(event: any) => void>>();
  addEventListener(type: string, handler: (event: any) => void) {
    this.handlers.set(type, [...this.handlers.get(type) ?? [], handler]);
  }
  fire(type: string, properties: any = {}) { for (const fn of this.handlers.get(type) ?? []) fn({ preventDefault() {}, ...properties }); }
}
async function appHarness() {
  let now = 100, nextId = 0, signaled = false, lost = false, waitFailed = false, sampleCalls = 0, unlockInGesture = 0, gesture = false;
  const rafs = new Map<number, () => void>(), timers = new Map<number, () => void>(), deleted: WebGLSync[] = [];
  const nodes = new Map<string, any>();
  const doc = Object.assign(new Target(), { hidden: false, activeElement: null as any,
    getElementById: (id: string) => nodes.get(id), querySelectorAll: () => radios });
  const node = (id: string) => {
    const n = Object.assign(new Target(), { id, hidden: true, disabled: false, textContent: '', innerHTML: '', dataset: {} as any,
      style: { removeProperty() {}, width: '', top: '', left: '' },
      attributes: new Map<string, string>(), inert: false,
      setAttribute(name: string, value: string) { n.attributes.set(name, value); },
      removeAttribute(name: string) { n.attributes.delete(name); },
      getAttribute(name: string) { return n.attributes.get(name) ?? null; }, focus() { if (!n.hidden && !n.disabled) doc.activeElement = n; }, querySelectorAll: () => [] });
    nodes.set(id, n); return n;
  };
  for (const match of readFileSync('index.html', 'utf8').matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) node(match[1]).hidden = /\bhidden\b/.test(match[0]);
  node('control-settings'); nodes.get('home').hidden = false;
  const radios = ['easy', 'normal'].map(value => Object.assign(new Target(), { value, checked: value === 'easy' }));
  const win = Object.assign(new Target(), { visualViewport: new Target() }) as any;
  let scene: Scene, controls: Controls, audio: Audio;
  const gl: RenderQueueContext = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, TIMEOUT_EXPIRED: 4, WAIT_FAILED: 5,
    fenceSync: () => ({}) as WebGLSync, flush() {}, isContextLost: () => lost,
    clientWaitSync: () => waitFailed ? 5 : signaled ? 2 : 4,
    deleteSync: fence => { if (fence) deleted.push(fence); },
  };
  class Scene {
    queue = new RenderQueue(gl); camera = { aspect: 1 }; prepared = false; disposed = false; resets = 0; resizes = 0; renderAttempts = 0; lastState: any = null; overlayVisible = false; hudMeasured = false; failHud = false;
    submissions: Array<{ mode: string; tick: number; runId: string; overlay: boolean; hudHidden: boolean; hudInert: boolean; hudAriaHidden: string | null; hint: string; announcement: string; announcementAriaHidden: string | null }> = [];
    constructor() { scene = this; }
    async prepare() { this.prepared = true; }
    setOverlayVisible(visible: boolean) { this.overlayVisible = visible; } resize() { this.resizes++; } gunSight() { return { x: 0, y: 0 }; }
    pollRender() { return this.queue.poll(now); }
    resetRenderQueue() { this.resets++; this.queue.reset(); }
    render(state: any, _player: unknown, mode: string) {
      this.renderAttempts++; this.lastState = state;
      if (!this.prepared) return true;
      if (this.pollRender() !== 'ready') return false;
      if (this.overlayVisible && !nodes.get('hud').hidden && !this.failHud) this.hudMeasured = true;
      this.submissions.push({ mode, tick: state.simTick, runId: state.runId, overlay: this.overlayVisible,
        hudHidden: nodes.get('hud').hidden, hudInert: nodes.get('hud').inert, hudAriaHidden: nodes.get('hud').getAttribute('aria-hidden'),
        hint: nodes.get('bomb-hint').textContent, announcement: nodes.get('announcement').textContent,
        announcementAriaHidden: nodes.get('announcement').getAttribute('aria-hidden') });
      signaled = false; this.queue.submit(now); return true;
    }
    diagnostics() { return { queue: this.queue.diagnostics(now), hudLayout: { measurements: this.hudMeasured ? 1 : 0, canvas: this.hudMeasured ? { width: 393, height: 852 } : undefined } }; }
    dispose() { this.disposed = true; this.queue.dispose(); }
  }
  class Controls {
    pending = false;
    constructor(_canvas: unknown, _buttons: unknown, readonly active: () => boolean) { controls = this; }
    clear() { this.pending = false; } clearPending() {} setMode() {} dispose() {}
    peek() { return { pending: this.pending }; }
    sampleThrottle() { return 0; }
    sample() { sampleCalls++; return { turn: 0, climb: 0, loop: this.pending, fire: false, bomb: this.pending }; }
  }
  class Settings { isOpen = false; setActiveMode() {} open() { this.isOpen = true; } close() { this.isOpen = false; } dispose() {} }
  class Keys { describe() { return ''; } subscribe() { return () => {}; } matchesPause(e: any) { return e.key === 'Escape'; } }
  class Presentation { value = 'touch'; subscribe() { return () => {}; } dispose() {} }
  class Audio {
    enabled = false; active = false; failed = false; failOnActiveSync = false; activeEffectVoiceCount = 0; activeEffectSourceCount = 0;
    constructor() { audio = this; }
    async unlock() { if (gesture) unlockInGesture++; else throw new Error('Audio unlock outside user gesture'); }
    sync() { if (this.active && this.failOnActiveSync) { this.failOnActiveSync = false; throw new Error('Mock completion audio failure'); } } resetFlight() {} finishFlight() {} update() {} event() {} worldEvent() {} dispose() {}
  }
  const modules: Record<string, any> = {
    three, './campaign': campaign, './campaign-config': config, './campaign-combat': combat,
    './campaign-flight': flight, './campaign-terrain': terrain, './flight': flightMath,
    './campaign-start': start, './campaign-scene': { CampaignScene: Scene }, './campaign-hud': { updateCampaignHud() {} },
    './campaign-records': { CampaignRecords: class { status = 'ready'; best() { return null; } save() { return 'ineligible'; } } },
    './input': { FlightControls: Controls }, './control-settings': { ControlSettings: Settings },
    './keyboard-settings': { KeyboardSettings: Keys, ControlInputPresentation: Presentation },
    './rules-guide': { RulesGuide: Settings }, './audio': { FlightAudio: Audio },
  };
  runInNewContext(compiledMain, { exports: {}, require: (name: string) => {
    if (name.endsWith('.css')) return {}; assert.ok(modules[name], name); return modules[name];
  }, window: win, document: doc, console, performance: { now: () => now },
    requestAnimationFrame: (fn: () => void) => { rafs.set(++nextId, fn); return nextId; }, cancelAnimationFrame: (id: number) => rafs.delete(id),
    setTimeout: (fn: () => void) => { timers.set(++nextId, fn); return nextId; }, clearTimeout: (id: number) => timers.delete(id),
    location: { reload() {} },
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return { nodes, doc, win, radios, scene: scene!, controls: controls!, audio: audio!, timers, deleted,
    read: () => JSON.parse(JSON.stringify(win.__fantasiaReadState(false))), audit: () => JSON.parse(JSON.stringify(win.__fantasiaReadState('audit'))),
    samples: () => sampleCalls, unlocks: () => unlockInGesture,
    click: (id: string) => { gesture = true; nodes.get(id).fire('click'); gesture = false; },
    mode: (mode: string) => { for (const r of radios) r.checked = r.value === mode; radios.find(r => r.checked)!.fire('change'); },
    frame: (time = now + 16) => { now = time; const queued = [...rafs.values()]; rafs.clear(); for (const fn of queued) fn(); },
    signal: () => { signaled = true; },
    contextLost: () => { lost = true; nodes.get('flight').fire('webglcontextlost'); },
    contextRestored: () => { lost = false; nodes.get('flight').fire('webglcontextrestored'); },
    failWait: () => { waitFailed = true; },
  };
}
async function selectedPending(mode = 'normal') {
  const h = await appHarness(); h.frame(); h.mode(mode); h.click('start');
  h.signal(); h.frame(); h.frame(); return h;
}

test('actual main wiring stays preparing without ticks/sampling until selected frame acknowledgment, then resets clock/input once', async () => {
  const h = await appHarness(); h.frame(); h.mode('normal'); h.click('start'); h.click('start');
  assert.equal(h.read().phase, 'preparing'); assert.equal(h.read().mode, 'normal');
  assert.equal(h.nodes.get('home').hidden, false); assert.equal(h.nodes.get('hud').hidden, false);
  assert.equal(h.nodes.get('hud').inert, true); assert.equal(h.nodes.get('hud').getAttribute('aria-hidden'), 'true');
  assert.equal(h.nodes.get('start-cancel').hidden, false); assert.equal(h.doc.activeElement.id, 'start-cancel'); assert.match(h.nodes.get('start-status').textContent, /ノーマル.*15秒/);
  assert.equal(h.unlocks(), 1); assert.equal(h.controls.active(), false);
  h.frame(2500); assert.equal(h.read().tick, 0); assert.equal(h.samples(), 0); assert.deepEqual(h.audit().entries, []);
  assert.equal(h.scene.submissions.length, 1, 'home does not replenish the draining queue');
  h.signal(); h.frame(); h.frame(); assert.equal(h.scene.submissions.length, 2);
  assert.equal(h.scene.submissions[1].mode, 'normal'); assert.equal(h.scene.submissions[1].tick, 0);
  h.controls.pending = true; h.frame(6000); assert.equal(h.read().phase, 'preparing'); assert.equal(h.samples(), 0);
  h.signal(); h.frame(6016); assert.equal(h.read().phase, 'playing'); assert.equal(h.read().tick, 0);
  assert.equal(h.controls.pending, false); assert.equal(h.samples(), 0); assert.equal(h.read().pauseCount, 0);
  h.frame(9000); assert.equal(h.read().phase, 'playing'); assert.equal(h.read().tick, 0, 'first playing frame has zero dt despite preparation delay');
  h.signal(); h.frame(9017); assert.equal(h.read().tick, 1); assert.equal(h.unlocks(), 1);
  assert.equal(h.audit().entries[0].input.loop, false); assert.equal(h.audit().entries[0].input.bomb, false);
});

for (const action of ['mode', 'start-cancel', 'pause-home', 'home-controls', 'home-rules'] as const) {
  test(`${action} exits preparation and cannot later commit its stale completed frame`, async () => {
    const h = await selectedPending(); const timer = [...h.timers.values()][0];
    if (action === 'mode') h.mode('easy'); else h.click(action);
    assert.equal(h.read().phase, 'ready'); assert.equal(h.read().tick, 0);
    if (action === 'start-cancel') assert.equal(h.doc.activeElement.id, 'start');
    timer?.(); h.signal(); h.frame(); assert.equal(h.read().phase, 'ready'); assert.equal(h.samples(), 0);
    if (action === 'home-controls') assert.equal(h.read().settingsOpen, true);
    if (action === 'home-rules') assert.equal(h.read().rulesOpen, true);
    assert.equal(h.scene.resets, 0);
  });
}

test('timeout gives a bounded visible deliberate retry; neither failed waiting nor retry discards the live fence', async () => {
  const h = await selectedPending(); const submissions = h.scene.submissions.length, deleted = h.deleted.length;
  h.frame(15132); assert.equal(h.read().startPreparation.failure, 'timeout');
  assert.equal(h.nodes.get('start-retry').hidden, false); assert.match(h.nodes.get('start-status').textContent, /15秒以内に完了しませんでした/);
  h.signal(); h.frame(); assert.equal(h.read().phase, 'preparing'); assert.equal(h.scene.submissions.length, submissions);
  assert.equal(h.deleted.length, deleted); h.click('start-retry'); h.frame(); h.frame();
  assert.equal(h.scene.submissions.length, submissions + 1); assert.equal(h.scene.resets, 0);
  h.signal(); h.frame(); assert.equal(h.read().phase, 'playing'); assert.equal(h.read().tick, 0);
});

test('context loss/restoration invalidates Start and requires explicit retry; reset occurs only after restoration', async () => {
  const h = await selectedPending(); h.contextLost();
  assert.equal(h.read().startPreparation.failure, 'context-lost'); assert.equal(h.scene.resets, 0);
  assert.equal(h.nodes.get('start-retry').disabled, true); assert.equal(h.nodes.get('reload').hidden, false);
  h.contextRestored(); h.frame(); assert.equal(h.read().phase, 'preparing'); assert.equal(h.scene.resets, 1);
  assert.equal(h.nodes.get('start-retry').disabled, false); h.click('start-retry'); h.frame(); h.frame(); h.signal(); h.frame();
  assert.equal(h.read().phase, 'playing'); assert.equal(h.read().tick, 0);
});

for (const event of ['blur', 'resize', 'pagehide'] as const) {
  test(`${event} interrupts preparation without starting or consuming input after stale completion`, async () => {
    const h = await selectedPending(); const callbacks = [...h.timers.values()]; h.win.fire(event, { persisted: true });
    assert.equal(h.read().startPreparation.failure, 'interrupted'); h.signal(); h.frame(); callbacks.forEach(fn => fn());
    assert.equal(h.read().phase, 'preparing'); assert.equal(h.read().tick, 0); assert.equal(h.samples(), 0);
  });
}

test('hidden page interrupts preparation and visible return still needs deliberate retry', async () => {
  const h = await selectedPending(); h.doc.hidden = true; h.doc.fire('visibilitychange');
  assert.equal(h.nodes.get('start-retry').disabled, true); h.doc.hidden = false; h.doc.fire('visibilitychange');
  h.signal(); h.frame(); assert.equal(h.read().phase, 'preparing'); assert.equal(h.nodes.get('start-retry').disabled, false);
});

test('nonpersisted pagehide disposes preparation and makes queued callbacks inert', async () => {
  const h = await selectedPending(); const callbacks = [...h.timers.values()]; h.win.fire('pagehide', { persisted: false });
  assert.equal(h.read().startPreparation.phase, 'disposed'); assert.equal(h.scene.disposed, true);
  h.signal(); h.frame(); callbacks.forEach(fn => fn()); h.click('start-retry'); assert.equal(h.read().tick, 0); assert.equal(h.samples(), 0);
});

test('failed selected frame exposes reload rather than unsafe automatic or button retry', async () => {
  const h = await selectedPending(); h.failWait(); h.frame();
  assert.equal(h.read().startPreparation.failure, 'render-failed'); assert.equal(h.nodes.get('reload').hidden, false);
  assert.equal(h.nodes.get('start-retry').hidden, true); const submissions = h.scene.submissions.length;
  h.click('start-retry'); h.frame(); assert.equal(h.scene.submissions.length, submissions); assert.equal(h.read().tick, 0);
});

test('playing retains its 250ms accumulator stop after successful preparation', async () => {
  const h = await selectedPending(); h.signal(); h.frame(); h.frame(); h.signal(); h.frame(1000);
  assert.equal(h.read().phase, 'paused'); assert.deepEqual(h.read().pauseReasons, ['frame']);
  assert.equal(h.read().performanceInterrupted, true);
});

test('playing retains its one-second render guard after successful preparation', async () => {
  const h = await selectedPending(); h.signal(); h.frame(); h.frame(200);
  for (let now = 400; now <= 1400; now += 200) h.frame(now);
  assert.equal(h.read().phase, 'paused'); assert.deepEqual(h.read().pauseReasons, ['render']);
  assert.equal(h.read().renderStatus, 'stalled'); assert.equal(h.read().performanceInterrupted, true);
});

test('home context loss disables Start visibly and restoration does not auto-start', async () => {
  const h = await appHarness(); h.contextLost();
  assert.equal(h.nodes.get('start').disabled, true); assert.equal(h.nodes.get('start-status').hidden, false);
  assert.equal(h.nodes.get('reload').hidden, false); h.contextRestored();
  assert.equal(h.nodes.get('start').disabled, false); assert.equal(h.read().phase, 'ready'); assert.equal(h.read().tick, 0);
});

test('a completion callback failure returns partial playing UI to failed preparation before any tick/input', async () => {
  const h = await selectedPending(); h.audio.failOnActiveSync = true; h.signal(); h.frame();
  assert.equal(h.read().phase, 'preparing'); assert.equal(h.read().startPreparation.failure, 'render-failed');
  assert.equal(h.nodes.get('hud').hidden, false); assert.equal(h.nodes.get('hud').inert, true); assert.equal(h.nodes.get('home').hidden, false);
  assert.equal(h.nodes.get('reload').hidden, false); assert.equal(h.read().tick, 0); assert.equal(h.samples(), 0);
  h.frame(); assert.equal(h.read().tick, 0); assert.equal(h.controls.active(), false);
});


async function playingPending() {
  const h = await selectedPending();
  h.signal(); h.frame(); h.frame(200);
  assert.equal(h.read().phase, 'playing');
  assert.equal(h.read().render.queue.status, 'pending');
  return h;
}

test('frame safety pause does not submit even on the same frame that acknowledges the preceding fence', async () => {
  const h = await playingPending();
  const submitted = h.scene.submissions.length, attempts = h.scene.renderAttempts;
  h.signal(); h.frame(1000);
  assert.equal(h.read().phase, 'paused'); assert.deepEqual(h.read().pauseReasons, ['frame']);
  assert.equal(h.read().renderStatus, 'ready'); assert.equal(h.read().performanceInterrupted, true);
  assert.equal(h.scene.submissions.length, submitted, 'the entering safety-pause frame must not replenish a drained queue');
  assert.equal(h.scene.renderAttempts, attempts, 'paused frame must not enter scene updates or draw code');
  const tick = h.read().tick;
  for (let time = 1016; time < 2500; time += 16) h.frame(time);
  assert.equal(h.scene.submissions.length, submitted); assert.equal(h.scene.renderAttempts, attempts);
  assert.equal(h.read().tick, tick); assert.equal(h.nodes.get('resume').disabled, false);
  assert.equal(h.controls.active(), false); assert.equal(h.audio.active, false);
});

test('render safety pause drains its existing fence and stays ready without auto-resume or stale input', async () => {
  const h = await playingPending(); const submitted = h.scene.submissions.length, resets = h.scene.resets;
  for (let time = 400; time <= 1400; time += 200) h.frame(time);
  assert.deepEqual(h.read().pauseReasons, ['render']); assert.equal(h.nodes.get('resume').disabled, true);
  const tick = h.read().tick, samples = h.samples(), attempts = h.scene.renderAttempts;
  h.click('resume'); assert.equal(h.read().phase, 'paused');
  h.frame(1600); assert.equal(h.scene.renderAttempts, attempts);
  h.signal(); h.frame(1616);
  assert.equal(h.read().renderStatus, 'ready'); assert.equal(h.nodes.get('resume').disabled, false);
  assert.equal(h.scene.submissions.length, submitted); assert.equal(h.scene.resets, resets);
  assert.match(h.nodes.get('pause-reason').textContent, /描画が復帰しました/);
  h.frame(5000); assert.equal(h.read().phase, 'paused'); assert.equal(h.read().tick, tick);
  assert.equal(h.samples(), samples); assert.equal(h.scene.submissions.length, submitted);
  h.controls.pending = true; h.click('resume');
  assert.equal(h.read().phase, 'playing'); assert.deepEqual(h.read().pauseReasons, []);
  assert.equal(h.controls.pending, false); assert.equal(h.read().performanceInterrupted, true);
  h.frame(8000); assert.equal(h.read().tick, tick, 'deliberate resume starts a fresh clock');
  assert.equal(h.scene.submissions.length, submitted + 1);
  h.signal(); h.frame(8017); assert.equal(h.read().tick, tick + 1);
  assert.equal(h.audit().entries.at(-1).input.loop, false); assert.equal(h.audit().entries.at(-1).input.bomb, false);
});

for (const target of ['window', 'visualViewport'] as const) {
  test(`${target} resize pauses and updates dimensions without a paused redraw, then explicit resume draws`, async () => {
    const h = await playingPending(); const submitted = h.scene.submissions.length, resizes = h.scene.resizes;
    const eventTarget = target === 'window' ? h.win : h.win.visualViewport;
    eventTarget.fire('resize'); assert.equal(h.read().phase, 'paused');
    assert.equal(h.scene.resizes, resizes + 1); assert.deepEqual(h.read().pauseReasons, ['resize']);
    h.signal(); h.frame(); h.frame();
    assert.equal(h.scene.submissions.length, submitted); assert.equal(h.nodes.get('resume').disabled, false);
    assert.equal(h.nodes.get('pause-screen').hidden, false);
    h.click('resume'); h.frame(); assert.equal(h.scene.submissions.length, submitted + 1);
  });
}

test('context restoration clears only the lost-context queue and waits for explicit resume before drawing', async () => {
  const h = await playingPending(); const submitted = h.scene.submissions.length, resets = h.scene.resets;
  h.contextLost(); h.frame(); assert.equal(h.read().phase, 'paused'); assert.equal(h.scene.resets, resets);
  assert.equal(h.nodes.get('resume').disabled, true); h.click('resume'); assert.equal(h.read().phase, 'paused');
  h.contextRestored(); h.frame(); h.frame();
  assert.equal(h.scene.resets, resets + 1); assert.equal(h.scene.submissions.length, submitted);
  assert.equal(h.read().renderStatus, 'ready'); assert.equal(h.nodes.get('resume').disabled, false);
  assert.equal(h.nodes.get('pause-screen').hidden, false); assert.equal(h.read().tick, 0);
  h.click('resume'); h.frame(); assert.equal(h.scene.submissions.length, submitted + 1);
});

test('explicit Home leaves drain-only pause and renders the new run without retaining the paused scene', async () => {
  const h = await playingPending(); const previousRun = h.scene.submissions.at(-1)!.runId;
  h.click('pause'); h.signal(); h.frame(); const submitted = h.scene.submissions.length;
  h.click('pause-home'); assert.equal(h.read().phase, 'ready');
  assert.equal(h.nodes.get('pause-screen').hidden, true); assert.equal(h.nodes.get('home').hidden, false);
  h.frame(); assert.equal(h.scene.submissions.length, submitted + 1);
  assert.notEqual(h.scene.submissions.at(-1)!.runId, previousRun); assert.equal(h.scene.submissions.at(-1)!.tick, 0);
  assert.equal(h.scene.resets, 0); assert.equal(h.read().pauseCount, 0);
});

test('explicit Restart from stalled pause drains the old fence before submitting exactly one selected frame', async () => {
  const h = await playingPending(); const previousRun = h.scene.submissions.at(-1)!.runId;
  for (let time = 400; time <= 1400; time += 200) h.frame(time);
  const submitted = h.scene.submissions.length;
  h.click('pause-restart'); assert.equal(h.read().phase, 'preparing');
  h.frame(1600); assert.equal(h.scene.submissions.length, submitted); assert.equal(h.read().tick, 0);
  h.signal(); h.frame(); assert.equal(h.scene.submissions.length, submitted);
  h.frame(); assert.equal(h.scene.submissions.length, submitted + 1);
  assert.notEqual(h.scene.submissions.at(-1)!.runId, previousRun); assert.equal(h.scene.resets, 0);
  h.frame(); assert.equal(h.read().phase, 'preparing');
  h.signal(); h.frame(); assert.equal(h.read().phase, 'playing'); assert.equal(h.read().tick, 0);
});

test('failed live fence leaves reload available and cannot be resumed or resubmitted by paused frames', async () => {
  const h = await playingPending(); const submitted = h.scene.submissions.length, attempts = h.scene.renderAttempts;
  h.failWait(); h.frame(); assert.equal(h.read().phase, 'paused');
  assert.equal(h.read().renderStatus, 'failed'); assert.equal(h.nodes.get('pause-reload').hidden, false);
  assert.equal(h.nodes.get('resume').disabled, true); h.click('resume'); h.frame();
  assert.equal(h.read().phase, 'paused'); assert.equal(h.scene.submissions.length, submitted);
  assert.equal(h.scene.renderAttempts, attempts); assert.equal(h.scene.resets, 0);
});


test('result transition still renders its final scene and can return Home after the paused-render guard', async () => {
  const h = await playingPending(); const submitted = h.scene.submissions.length;
  // Explicit simulation fixture: the real next campaign step finalizes defeat.
  // This reference exists only in the scene double, never in production hooks.
  h.scene.lastState.livesRemaining = 0;
  h.signal(); h.frame(217);
  assert.equal(h.read().phase, 'ended'); assert.equal(h.nodes.get('result').hidden, false);
  assert.equal(h.nodes.get('pause-screen').hidden, true); assert.equal(h.nodes.get('hud').hidden, true);
  assert.equal(h.scene.submissions.length, submitted + 1);
  const tick = h.read().tick;
  h.signal(); h.frame(233); assert.equal(h.scene.submissions.length, submitted + 2);
  assert.equal(h.read().tick, tick, 'result presentation must not advance simulation');
  h.click('result-home'); h.signal(); h.frame(); assert.equal(h.read().phase, 'ready');
  assert.equal(h.nodes.get('result').hidden, true); assert.equal(h.scene.submissions.at(-1)!.tick, 0);
});


for (const mode of ['easy', 'normal']) test(`${mode} selected preparation frame measures the real staged HUD and draws its overlay before any live tick`, async () => {
  const h = await selectedPending(mode); const selected = h.scene.submissions.at(-1)!;
  assert.equal(h.read().phase, 'preparing'); assert.equal(h.read().tick, 0); assert.equal(h.samples(), 0);
  assert.equal(selected.mode, mode); assert.equal(selected.overlay, true); assert.equal(selected.hudHidden, false, 'display:none cannot prepare real geometry');
  assert.equal(selected.hudInert, true); assert.equal(selected.hudAriaHidden, 'true');
  assert.equal(h.controls.active(), false); assert.equal(h.audio.active, false);
  assert.equal(h.nodes.get('home').hidden, false); assert.equal(h.doc.activeElement.id, 'start-cancel');
  assert.equal(selected.announcementAriaHidden, 'true'); assert.match(selected.announcement, /7軍の進軍開始/); assert.equal(selected.hint, '落下地点の予測');
  h.frame(2000); assert.equal(h.read().phase, 'preparing'); assert.equal(h.read().tick, 0);
  h.signal(); h.frame(); assert.equal(h.read().phase, 'playing'); assert.equal(h.read().tick, 0);
  assert.equal(h.nodes.get('hud').hidden, false); assert.equal(h.nodes.get('hud').inert, false);
  assert.equal(h.nodes.get('hud').getAttribute('aria-hidden'), null); assert.equal(h.nodes.get('home').hidden, true);
  assert.equal(h.nodes.get('bomb-hint').textContent, selected.hint);
  assert.equal(h.nodes.get('announcement').textContent, selected.announcement);
  assert.equal(h.nodes.get('announcement').getAttribute('aria-hidden'), null);
});

test('preparing HUD is visually suppressed without display:none or visibility:hidden geometry', () => {
  const css = readFileSync('src/style.css', 'utf8');
  const rule = css.match(/#app\[data-screen="preparing"\] #hud,\s*#app\[data-screen="preparing"\] #markers,\s*#app\[data-screen="preparing"\] #announcement\s*\{([^}]+)\}/);
  assert.ok(rule, 'the DOM HUD, canvas overlay and separate live announcement have a preparation-only staging rule');
  assert.match(rule[1], /opacity:\s*0/); assert.match(rule[1], /pointer-events:\s*none/);
  assert.doesNotMatch(rule[1], /display:|visibility:|font-size:|transform:/);
});

test('missing actual HUD measurement fails preparation rather than certifying a 3D-only receipt', async () => {
  const h = await appHarness(); h.scene.failHud = true;
  h.frame(); h.mode('normal'); h.click('start'); h.signal(); h.frame(); h.frame();
  assert.equal(h.read().phase, 'preparing'); assert.equal(h.read().startPreparation.failure, 'render-failed');
  assert.equal(h.read().tick, 0); assert.equal(h.samples(), 0); assert.equal(h.controls.active(), false);
  assert.equal(h.nodes.get('reload').hidden, false);
  h.signal(); h.frame(); assert.equal(h.read().phase, 'preparing');
});

for (const action of ['start-cancel', 'mode', 'home-controls', 'home-rules'] as const) {
  test(`${action} removes the staged HUD and keeps stale receipts from activating it`, async () => {
    const h = await selectedPending();
    assert.equal(h.nodes.get('hud').hidden, false); assert.equal(h.nodes.get('hud').inert, true);
    if (action === 'mode') h.mode('easy'); else h.click(action);
    assert.equal(h.read().phase, 'ready'); assert.equal(h.nodes.get('hud').hidden, true);
    assert.equal(h.nodes.get('announcement').textContent, '');
    h.signal(); h.frame(); assert.equal(h.nodes.get('hud').hidden, true); assert.equal(h.read().tick, 0);
    assert.equal(h.controls.active(), false);
  });
}
