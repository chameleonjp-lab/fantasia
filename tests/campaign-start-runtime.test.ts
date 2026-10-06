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
      setAttribute() {}, focus() { if (!n.hidden && !n.disabled) doc.activeElement = n; }, querySelectorAll: () => [] });
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
    queue = new RenderQueue(gl); camera = { aspect: 1 }; prepared = false; disposed = false; resets = 0;
    submissions: Array<{ mode: string; tick: number; runId: string }> = [];
    constructor() { scene = this; }
    async prepare() { this.prepared = true; }
    setOverlayVisible() {} resize() {} gunSight() { return { x: 0, y: 0 }; }
    pollRender() { return this.queue.poll(now); }
    resetRenderQueue() { this.resets++; this.queue.reset(); }
    render(state: any, _player: unknown, mode: string) {
      if (!this.prepared) return true;
      if (this.pollRender() !== 'ready') return false;
      this.submissions.push({ mode, tick: state.simTick, runId: state.runId });
      signaled = false; this.queue.submit(now); return true;
    }
    diagnostics() { return { queue: this.queue.diagnostics(now) }; }
    dispose() { this.disposed = true; this.queue.dispose(); }
  }
  class Controls {
    pending = false;
    constructor(_canvas: unknown, _buttons: unknown, readonly active: () => boolean) { controls = this; }
    clear() { this.pending = false; } clearPending() {} setMode() {} dispose() {}
    peek() { return { pending: this.pending }; }
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
    './campaign-records': { CampaignRecords: class { status = 'ready'; best() { return null; } } },
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
async function selectedPending() {
  const h = await appHarness(); h.frame(); h.mode('normal'); h.click('start');
  h.signal(); h.frame(); h.frame(); return h;
}

test('actual main wiring stays preparing without ticks/sampling until selected frame acknowledgment, then resets clock/input once', async () => {
  const h = await appHarness(); h.frame(); h.mode('normal'); h.click('start'); h.click('start');
  assert.equal(h.read().phase, 'preparing'); assert.equal(h.read().mode, 'normal');
  assert.equal(h.nodes.get('home').hidden, false); assert.equal(h.nodes.get('hud').hidden, true);
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
  assert.equal(h.nodes.get('hud').hidden, true); assert.equal(h.nodes.get('home').hidden, false);
  assert.equal(h.nodes.get('reload').hidden, false); assert.equal(h.read().tick, 0); assert.equal(h.samples(), 0);
  h.frame(); assert.equal(h.read().tick, 0); assert.equal(h.controls.active(), false);
});
