import { expect as browserExpect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignHudDetails } from '../src/campaign-hud-details';
import { campaignHudContextStyleChanged, measureCampaignHudMode, type HudMeasurement } from '../src/campaign-hud-layout';

const measurement: HudMeasurement = { canvas: { x: 0, y: 0, width: 800, height: 600 },
  bounds: { x: 8, y: 8, width: 784, height: 584 }, obstacles: [], panels: [], flightData: null, threat: null };
const sight = { x: 350, y: 250, width: 100, height: 100 };

test('stable compact live remeasure never probes full mode, including a newly visible critical warning', () => {
  const calls: boolean[] = [];
  const critical = { ...measurement, movableControls: [], panels: [{ id: 'warning', x: 10, y: 100, width: 200, height: 60 }] };
  const actual = measureCampaignHudMode(true, false, sight, compact => { calls.push(compact); return critical; }, () => { throw Error('must not probe hidden full content'); });
  assert.deepEqual(calls, [true]); assert.equal(actual, critical);
  assert.equal(actual.panels![0].height, 60, 'all live critical dimensions still propagate to packing');
});
test('explicit viewport, mode or typography review can leave compact when full content fits', () => {
  const calls: boolean[] = [];
  const actual = measureCampaignHudMode(true, true, sight, compact => { calls.push(compact); return measurement; }, () => false);
  assert.deepEqual(calls, [false]); assert.equal(actual, measurement);
});
test('a full-mode candidate with clipped text or blocked full-size reservation returns to compact', () => {
  for (const clip of [true, false]) {
    const calls: boolean[] = [];
    const compactMeasurement = { ...measurement, movableControls: [] };
    const full = clip ? measurement : { ...measurement, panels: [{ id: 'warning', x: 8, y: 8, width: 900, height: 50 }] };
    const actual = measureCampaignHudMode(true, true, sight, compact => { calls.push(compact); return compact ? compactMeasurement : full; }, () => clip);
    assert.deepEqual(calls, [false, true]); assert.equal(actual, compactMeasurement);
  }
});
test('ordinary full mode still checks all current content and may enter compact', () => {
  const calls: boolean[] = [];
  measureCampaignHudMode(false, false, sight, compact => { calls.push(compact); return measurement; }, () => true);
  assert.deepEqual(calls, [false, true]);
});
test('font and custom-control context changes differ from live HP, progress and reload geometry', () => {
  for (const [before, after] of [
    ['font-size:9px','font-size:18px!important'], ['line-height:1','line-height:1.3'],
    ['--control-size:44px','--control-size:88px'], ['font-family:serif','font-family:system-ui'],
    ['--safe-top:0px','--safe-top:20px'],
  ]) assert.equal(campaignHudContextStyleChanged(before, after), true);
  for (const [before, after] of [
    ['width:100%','width:99%'], ['left:10px;top:50px','left:11px;top:51px'],
    ['font-size:18px;color:red','color:blue; font-size:18px'],
    ['--campaign-hud-x:1px','--campaign-hud-x:2px'], [null, 'width:42%'],
  ]) assert.equal(campaignHudContextStyleChanged(before, after), false);
});
test('stable compact remeasure never writes scrollTop or refocuses, preserving native scrolling ownership', () => {
  const details = Object.create(CampaignHudDetails.prototype) as any;
  let scrollWrites = 0, focuses = 0;
  const active = { focus() { focuses++; } };
  details.compact = true; details.reparentRevision = 4;
  details.viewport = { set scrollTop(_value: number) { scrollWrites++; }, contains: () => true, focus() { focuses++; } };
  for (let i = 0; i < 20; i++) details.restoreReading(4, 120, active);
  assert.equal(scrollWrites, 0); assert.equal(focuses, 0);
  details.reparentRevision++;
  details.restoreReading(4, 120, active);
  assert.equal(scrollWrites, 1); assert.equal(focuses, 1, 'actual structural change repairs the former owner');
});
test('an actual return to full mode transfers reading focus to pause without injecting scroll', () => {
  const details = Object.create(CampaignHudDetails.prototype) as any;
  let scrollWrites = 0, pauseFocus = 0;
  details.compact = false; details.reparentRevision = 5;
  details.viewport = { set scrollTop(_value: number) { scrollWrites++; } };
  details.app = { querySelector(selector: string) { assert.equal(selector, '#pause'); return { focus() { pauseFocus++; } }; } };
  details.restoreReading(4, 120, {});
  assert.equal(scrollWrites, 0); assert.equal(pauseFocus, 1);
});

test('same-mode sync does not toggle visibility and restoring an already-anchored node does not reparent it', () => {
  const details = Object.create(CampaignHudDetails.prototype) as any;
  let visibilityWrites = 0, reparents = 0;
  details.compact = true; details.reparentRevision = 3;
  details.app = { dataset: { campaignHud: 'compact' }, querySelector: () => null, querySelectorAll: () => [] };
  details.viewport = details.mode = { set hidden(_value: boolean) { visibilityWrites++; } };
  details.lives = null; details.entries = new Map(); details.typography = new Map();
  details.sync(true); details.sync(true);
  assert.equal(visibilityWrites, 0); assert.equal(details.layoutRevision, 3);
  const node = {}, anchor = { parentNode: {}, nextSibling: node, after() { reparents++; } };
  details.anchors = new Map([[node, anchor]]); details.attributes = new Map();
  details.restore(node);
  assert.equal(reparents, 0); assert.equal(details.layoutRevision, 3);
});

// Run the real browser inspector against deterministic DOM geometry. This is
// a contract regression, not a replacement for browser/layout acceptance.
async function inspectReadoutContract(change: 'none' | 'fixed-in-details' | 'secondary-outside' | 'clipped-fixed' | 'duplicate-fixed' | 'stale-ammo' | 'stale-reload' | 'stale-time' | 'dormant-reload' | 'false-protection' | 'stale-threat-time' | 'stale-threat-site' | 'stale-threat-generation' | 'hidden-child' = 'none') {
  const source = readFileSync(new URL('../browser-ui-only/ui-only.spec.ts', import.meta.url), 'utf8');
  const registry = source.slice(source.indexOf('const SECONDARY_HUD_READOUTS ='), source.indexOf('async function captureSecondaryHudOriginals'));
  const inspector = source.slice(source.indexOf('async function inspectSecondaryHudReachability'), source.indexOf('async function inspectDirectSafetyHud'));
  const rect = { x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100 };
  class Element {
    hidden = false; isConnected = true; parentElement: Element | null = null; dataset: any = {}; className = ''; tagName = 'DIV';
    clientLeft = 0; clientTop = 0; clientWidth = 200; clientHeight = 100; scrollWidth = 200; scrollHeight = 100; scrollTop = 0;
    constructor(public id: string, public textContent: string) {}
    contains(n: Element) { for (let p: Element | null = n; p; p = p.parentElement) if (p === this) return true; return false; }
    getBoundingClientRect() { return rect; }
    closest() { return null; }
    getAttribute(k: string) { return k === 'aria-label' ? '残弾数' : k === 'role' ? 'status' : k === 'aria-live' ? 'polite' : null; }
    querySelector(selector: string) { return values[selector] ?? null; }
  }
  const details = new Element('campaign-hud-details', '');
  const values: Record<string, any> = { '#remaining-time': { textContent: '19:56' }, '#mg-ammo': { textContent: '0' }, '#cannon-ammo': { textContent: '0' } };
  const nodes: Record<string, Element> = {};
  const descriptors = [
    ['campaign-threat', '#campaign-threat', '砲台の魔法 · 自機を照準中 · 陣地1 · 1.2秒'], ['reload-status', '#reload-status', '再装填中 あと1.8秒'],
    ['campaign-limit', '.campaign-limit', '期限まで 19:56'], ['ammo', '.ammo', '機銃 0 · 機関砲 0'],
    ['timer', '.time-block', '作戦経過 00:04.00'], ['score', '.score-readout', 'スコア 0'], ['wingmen', '.wingmen', '味方兵 168 · 予備 336'],
  ];
  for (const [key, selector, text] of descriptors) {
    const n = nodes[key] = new Element(key, text); values[selector] = n;
    if (['timer', 'score', 'wingmen'].includes(key) || change === 'fixed-in-details') { n.parentElement = details; n.dataset.campaignDetail = key; }
  }
  if (change === 'secondary-outside') nodes.timer.parentElement = null;
  if (change === 'stale-ammo') values['#mg-ammo'].textContent = '288';
  if (change === 'stale-time') values['#remaining-time'].textContent = '20:00';
  if (change === 'stale-reload') nodes['reload-status'].textContent = '再装填中 あと9.9秒';
  if (change === 'dormant-reload') { nodes['reload-status'].textContent = ''; nodes['reload-status'].hidden = true; }
  if (change === 'false-protection') nodes['campaign-threat'].textContent = '復活保護 · 発砲できません · 9.9秒';
  if (change === 'stale-threat-time') nodes['campaign-threat'].textContent = '砲台の魔法 · 自機を照準中 · 陣地1 · 9.9秒';
  if (change === 'stale-threat-site') nodes['campaign-threat'].textContent = '砲台の魔法 · 自機を照準中 · 陣地4 · 1.2秒';
  const raw = { screen: 'playing', phase: 'playing', player: { reloadTicksRemaining: change === 'dormant-reload' ? 0 : 108 },
    campaign: { activeTicks: 240, simTick: 240, status: 'running', actors: [{ hp: 600, team: 'enemy', class: 'turret', phase: 'telegraph', laneId: 0, fireAtTick: 312, lockedAim: null, targetRef: { id: 1, generation: change === 'stale-threat-generation' ? 0 : 1 } }], player: { id: 1, generation: 1, mg: 0, cannon: 0,
      reloadUntilTick: change === 'dormant-reload' ? null : 348, protectionTicks: 0 } } };
  const document = { querySelector(s: string) { return s === '#campaign-hud-details' ? details : values[s]; },
    querySelectorAll(s: string) { return values[s] ? change === 'duplicate-fixed' && s === '.ammo' ? [values[s], values[s]] : [values[s]] : []; },
    createTreeWalker(n: Element) { let used = false; return { nextNode() { if (used) return null; used = true; const child = new Element('hidden-child', n.textContent); child.parentElement = n; return { textContent: n.textContent, parentElement: change === 'hidden-child' ? child : n }; } }; },
    createRange() { return { startContainer: null as any, setStart(container: any) { this.startContainer = container; }, setEnd() {}, getBoundingClientRect() {
      return change === 'clipped-fixed' ? { ...rect, left: -5, x: -5 } : { ...rect, width: 2, right: 12, height: 10, bottom: 20 };
    } }; },
  };
  const inspect = runInNewContext(transpileModule(`${registry}\n${inspector}\ninspectSecondaryHudReachability;`, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  }).outputText, { window: { __fantasiaReadState: () => raw }, document, HTMLElement: Element, NodeFilter: { SHOW_TEXT: 4 }, innerWidth: 568, innerHeight: 320,
    getComputedStyle(n: Element) { return { display: 'block', visibility: 'visible', opacity: n.id === 'hidden-child' ? '0' : '1', contentVisibility: 'visible',
      clipPath: 'none', clip: 'auto', contain: '', overflowX: 'visible', overflowY: n === details ? 'auto' : 'visible' }; } });
  return inspect(null, { evaluate(fn: any, input: any) { return fn(nodes, input); } }, Object.fromEntries(Object.entries(nodes).map(([k, n]) => [k, n.textContent])));
}
test('HUD contract accepts original fixed critical nodes and genuinely secondary scrolling nodes', async () => {
  const result = await inspectReadoutContract(); assert.equal(result.ok, true, JSON.stringify(result.issues));
});
for (const variant of ['fixed-in-details', 'secondary-outside', 'clipped-fixed', 'duplicate-fixed', 'stale-ammo', 'stale-reload', 'stale-time', 'false-protection', 'stale-threat-time', 'stale-threat-site', 'stale-threat-generation', 'hidden-child'] as const)
  test(`HUD contract rejects ${variant} without relaxing full-text or identity checks`, async () => {
    assert.equal((await inspectReadoutContract(variant)).ok, false);
  });

test('HUD contract accepts an empty hidden reload only when the authoritative reload is inactive', async () => {
  const result = await inspectReadoutContract('dormant-reload'); assert.equal(result.ok, true, JSON.stringify(result.issues));
});

async function inspectReloadPixels(active: boolean, pixels: number, threatActive = false, threatPoint: object | null = null) {
  const source = readFileSync(new URL('../browser-ui-only/ui-only.spec.ts', import.meta.url), 'utf8');
  const check = source.slice(source.indexOf('async function checkCanvasPixels'), source.indexOf('function recordHudFailure'));
  const run = runInNewContext(transpileModule(`${check}\ncheckCanvasPixels;`, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  }).outputText, { expect: browserExpect });
  return run({ evaluate() { return { alphaPixels: 1000, ring: 100, reloadRing: pixels, reloadActive: active,
    centerDot: 4, radarPixels: 300, warningPixels: 10, threatActive, crosshair: [1, 1, 1, 1] }; } }, 'normal', { threatPoint });
}
test('HUD pixels do not require a dormant reload arc after genuine respawn', async () => {
  await inspectReloadPixels(false, 0);
});
test('HUD pixels still reject a missing active reload arc', async () => {
  await assert.rejects(inspectReloadPixels(true, 0));
});

test('HUD pixels reject a missing projected point for an active authoritative threat', async () => {
  await assert.rejects(inspectReloadPixels(false, 0, true, null));
});
