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
async function inspectReadoutContract(change: 'none' | 'fixed-in-details' | 'secondary-outside' | 'clipped-fixed' | 'duplicate-fixed' | 'stale-ammo' | 'stale-reload' | 'stale-time' | 'dormant-reload' | 'false-protection' | 'stale-threat-time' | 'stale-threat-site' | 'stale-threat-generation' | 'hidden-child' | 'collapsed-indentation' | 'preserved-whitespace' | 'unmeasurable-nbsp' | 'unmeasurable-mixed-text' | 'mode-reparent' | 'missing-mode' | 'wrong-mode' | 'duplicate-mode' | 'hidden-mode' | 'actual-protection' | 'protection-stale' | 'protection-no-attack' | 'protection-hidden' = 'none') {
  const source = readFileSync(new URL('../browser-ui-only/ui-only.spec.ts', import.meta.url), 'utf8');
  const registry = source.slice(source.indexOf('const SECONDARY_HUD_READOUTS ='), source.indexOf('async function captureSecondaryHudOriginals'));
  const captureSource = source.slice(source.indexOf('async function captureSecondaryHudOriginals'), source.indexOf('async function setup'));
  const inspector = source.slice(source.indexOf('async function inspectSecondaryHudReachability'), source.indexOf('async function inspectDirectSafetyHud'));
  const rect = { x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100 };
  class Element {
    hidden = false; isConnected = true; parentElement: Element | null = null; dataset: any = {}; className = ''; tagName = 'DIV';
    clientLeft = 0; clientTop = 0; clientWidth = 200; clientHeight = 100; scrollWidth = 200; scrollHeight = 100; scrollTop = 0;
    constructor(public id: string, public textContent: string) {}
    contains(n: Element) { for (let p: Element | null = n; p; p = p.parentElement) if (p === this) return true; return false; }
    getBoundingClientRect() { return rect; }
    closest(selector: string) { if (selector !== '#hud-mode') return null; for(let p: Element | null = this; p; p = p.parentElement) if(p.id === 'mode') return p; return null; }
    getAttribute(k: string) { return k === 'aria-label' ? '残弾数' : k === 'role' ? 'status' : k === 'aria-live' ? 'polite' : null; }
    querySelector(selector: string) { return values[selector] ?? null; }
  }
  const details = new Element('campaign-hud-details', '');
  const values: Record<string, any> = { '#remaining-time': { textContent: '19:56' }, '#mg-ammo': { textContent: '0' }, '#cannon-ammo': { textContent: '0' } };
  const nodes: Record<string, Element> = {};
  const descriptors = [
    ['campaign-threat', '#campaign-threat', '砲台の魔法 · 自機を照準中 · 陣地1 · 1.2秒'], ['reload-status', '#reload-status', '再装填中 あと1.8秒'],
    ['campaign-limit', '.campaign-limit', '期限まで 19:56'], ['ammo', '.ammo', '機銃 0 · 機関砲 0'],
    ['mode', '#hud-mode', 'イージー'], ['timer', '.time-block', '作戦経過 00:04.00'], ['score', '.score-readout', 'スコア 0'], ['wingmen', '.wingmen', '味方兵 168 · 予備 336'],
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
    campaign: { mode: 'easy', activeTicks: 240, simTick: 240, status: 'running', actors: [{ hp: 600, team: 'enemy', class: 'turret', phase: 'telegraph', laneId: 0, fireAtTick: 312, lockedAim: null, targetRef: { id: 1, generation: change === 'stale-threat-generation' ? 0 : 1 } }], player: { id: 1, generation: 1, mg: 0, cannon: 0,
      reloadUntilTick: change === 'dormant-reload' ? null : 348, protectionTicks: 0 } } };
  if (change === 'mode-reparent') { nodes.mode.parentElement = nodes.timer; nodes.timer.textContent += nodes.mode.textContent; }
  if (change === 'wrong-mode') nodes.mode.textContent = 'ノーマル';
  if (change === 'hidden-mode') nodes.mode.hidden = true;
  if (change === 'missing-mode') delete values['#hud-mode'];
  if (change.startsWith('protection-') || change === 'actual-protection') {
    Object.assign(raw.campaign, { selfLosses: 1 });
    raw.campaign.player.generation = 2; raw.campaign.player.protectionTicks = 63;
    nodes['campaign-threat'].textContent = change === 'protection-stale' ? '復活保護 あと2.0秒 · 自機攻撃不可'
      : change === 'protection-no-attack' ? '復活保護 あと1.1秒' : '復活保護 あと1.1秒 · 自機攻撃不可';
    nodes['campaign-threat'].hidden = change === 'protection-hidden';
  }
  const document = { querySelector(s: string) { return s === '#campaign-hud-details' ? details : values[s]; },
    querySelectorAll(s: string) { return values[s] ? (change === 'duplicate-fixed' && s === '.ammo' || change === 'duplicate-mode' && s === '#hud-mode') ? [values[s], values[s]] : [values[s]] : []; },
    createTreeWalker(n: Element) {
      const child = new Element('hidden-child', n.textContent); child.parentElement = n;
      const modeInside = n === nodes.timer && nodes.mode.parentElement === n;
      const list: any[] = [{ textContent: modeInside ? n.textContent.slice(0, -nodes.mode.textContent.length) : n.textContent, parentElement: change === 'hidden-child' ? child : n }];
      if (modeInside) list.push({ textContent: nodes.mode.textContent, parentElement: nodes.mode });
      if (n.id === 'timer' && ['collapsed-indentation', 'preserved-whitespace', 'unmeasurable-nbsp', 'unmeasurable-mixed-text'].includes(change))
        list.unshift({ textContent: change === 'unmeasurable-nbsp' ? '\u00a0' : change === 'unmeasurable-mixed-text' ? 'A ' : '\n            ', parentElement: n });
      return { nextNode() { return list.shift() ?? null; } };
    },
    createRange() { return { startContainer: null as any, startOffset: 0, endOffset: 0, setStart(container: any, offset: number) { this.startContainer = container; this.startOffset = offset; }, setEnd(_container: any, offset: number) { this.endOffset = offset; }, cloneRange() { return { ...this }; }, collapse() {}, getBoundingClientRect() {
      if (/^[\t\n\f\r ]+$/.test(this.startContainer.textContent) || this.startContainer.textContent === '\u00a0' || this.startContainer.textContent === 'A ') return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      return change === 'clipped-fixed' ? { ...rect, left: -5, x: -5 } : { ...rect, width: 2, right: 12, height: 10, bottom: 20 };
    } }; },
  };
  const inspect = runInNewContext(transpileModule(`${registry}\n${captureSource}\n${inspector}\n({ inspect: inspectSecondaryHudReachability, capture: captureSecondaryHudOriginals });`, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  }).outputText, { window: { __fantasiaReadState: () => raw }, document, HTMLElement: Element, NodeFilter: { SHOW_TEXT: 4 }, innerWidth: 568, innerHeight: 320,
    getComputedStyle(n: Element) { return { whiteSpace: change === 'preserved-whitespace' ? 'pre' : 'normal', display: 'block', visibility: 'visible', opacity: n.id === 'hidden-child' ? '0' : '1', contentVisibility: 'visible',
      clipPath: 'none', clip: 'auto', contain: '', overflowX: 'visible', overflowY: n === details ? 'auto' : 'visible' }; } });
  const captured = await inspect.capture({ evaluateHandle(fn: any, input: any) { const saved = fn(input); return { evaluate(cb: any, value: any) { return cb(saved, value); } }; }, evaluate(fn: any, input: any) { return fn(input); } });
  if (change === 'mode-reparent') {
    nodes.timer.textContent = nodes.timer.textContent.slice(0, -nodes.mode.textContent.length); nodes.mode.parentElement = null;
  }
  return inspect.inspect(null, captured.originalNodes, captured.originalText);
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

test('HUD contract accepts collapsed HTML indentation without dropping meaningful glyphs', async () => {
  const result = await inspectReadoutContract('collapsed-indentation'); assert.equal(result.ok, true, JSON.stringify(result.issues));
});
test('HUD contract still rejects unmeasurable preserved whitespace', async () => {
  assert.equal((await inspectReadoutContract('preserved-whitespace')).ok, false);
});

for (const variant of ['unmeasurable-nbsp', 'unmeasurable-mixed-text'] as const)
  test(`HUD contract does not discard ${variant} as HTML indentation`, async () => {
    assert.equal((await inspectReadoutContract(variant)).ok, false);
  });

test('HUD contract retains an original mode moved out of the timer during compact reflow', async () => {
  const result = await inspectReadoutContract('mode-reparent'); assert.equal(result.ok, true, JSON.stringify(result.issues));
});
for (const variant of ['missing-mode', 'wrong-mode', 'duplicate-mode', 'hidden-mode'] as const)
  test(`HUD contract rejects ${variant} independently of timer text`, async () => {
    assert.equal((await inspectReadoutContract(variant)).ok, false);
  });


test('canonical protection inspector accepts correct state and rejects stale, incomplete or hidden projection', async () => {
  assert.equal((await inspectReadoutContract('actual-protection')).ok, true);
  for (const variant of ['protection-stale', 'protection-no-attack', 'protection-hidden'] as const)
    assert.equal((await inspectReadoutContract(variant)).ok, false, variant);
});


test('announcement visibility gate accepts only a fully validated canonical projection', () => {
  const source = readFileSync('browser-ui-only/ui-only.spec.ts', 'utf8');
  const gate = source.slice(source.indexOf("  recordHudAssertion(failures, provenance, name, 'announcement-visible',"), source.indexOf("  recordHudAssertion(failures, provenance, name, 'announcement-text',"));
  const check = (visible: boolean, ok: boolean, route: string) => runInNewContext(gate, {
    failures: [], provenance: 'unit', name: 'unit', expect: browserExpect,
    domEvidence: { announcement: { visible } }, announcementReachability: { ok, route },
    recordHudAssertion: (_a: unknown, _b: unknown, _c: unknown, _d: unknown, assertion: () => void) => assertion(),
  });
  const projection = 'single fixed protection projection; duplicate announcement hidden';
  assert.doesNotThrow(() => check(false, true, projection));
  assert.doesNotThrow(() => check(true, true, 'original announcement'));
  assert.throws(() => check(false, false, projection));
  assert.throws(() => check(false, true, 'original announcement'));
});


// Actual new diagnostic functions are extracted; DOM mock does not certify CSS.
function measuredShapeFunctions() {
  const source=readFileSync(new URL('../browser-ui-only/ui-only.spec.ts',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('function chooseWidths('),source.indexOf('async function captureMeasuredShapeCatalogue('));
  const context:any={intersects:(a:any,b:any,gap=0)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y};
  runInNewContext(transpileModule(body,{compilerOptions:{target:ScriptTarget.ES2022,module:ModuleKind.None}}).outputText,context);
  return context;
}
test('joint shape diagnostic chooses measured alternatives without changing inputs',()=>{
 const x=measuredShapeFunctions(),bounds={x:0,y:0,width:100,height:40},roles=[{id:'a',x:0,y:0,shapes:[{width:60,height:30},{width:40,height:30}]},{id:'b',x:60,y:0,shapes:[{width:50,height:30}]}],before=JSON.stringify(roles);
 const result=x.searchMeasuredShapes(bounds,[],roles);assert.equal(result.status,'placed');assert.equal(result.rects.find((r:any)=>r.id==='a').shapeIndex,1);assert.equal(JSON.stringify(roles),before);assert.equal(JSON.stringify(result),JSON.stringify(x.searchMeasuredShapes(bounds,[],roles)));
 assert.equal(x.searchMeasuredShapes(bounds,[],roles.map(r=>({...r,shapes:r.shapes.slice(0,1)}))).status,'unknown');
});
test('joint shape diagnostic enforces budgets and rejects invalid or duplicate roles',()=>{
 const x=measuredShapeFunctions(),bounds={x:0,y:0,width:100,height:40},roles=[{id:'a',x:0,y:0,shapes:[{width:60,height:30}]}];
 for(const limit of [0,1]){const r=x.searchMeasuredShapes(bounds,[],roles,limit);assert.equal(r.status,'unknown');assert(r.checks<=limit);assert.equal(r.rects.length,0);}
 for(const limit of [-1,6001,NaN,Infinity,.1])assert.equal(x.searchMeasuredShapes(bounds,[],roles,limit).status,'invalid');
 assert.equal(x.searchMeasuredShapes(bounds,[],[roles[0],roles[0]]).status,'invalid');assert.equal(x.searchMeasuredShapes(bounds,[],[{...roles[0],shapes:[{width:NaN,height:4}]}]).status,'invalid');
});
test('width catalogue uses deterministic reservation intervals with no mutation',()=>{
 const x=measuredShapeFunctions(),bounds={x:8,y:8,width:304,height:552},fixed=[{x:106.8,y:230.8,width:106.4,height:106.4}],before=JSON.stringify(fixed);
 assert.equal(JSON.stringify(x.chooseWidths(bounds,fixed,144,240)),JSON.stringify([144,240,94.80000000000001,304]));assert.equal(JSON.stringify(fixed),before);assert.throws(()=>x.chooseWidths(bounds,Array(33).fill(bounds),144,240));
});
test('mixed shapes reject text changes, sibling reflow, missing and duplicate leaves',()=>{
 const x=measuredShapeFunctions(),rows=[{id:'a',width:94,height:50,text:'原文'},{id:'b',width:72,height:26,text:'モード'}];
 assert(x.verifyMixedShapes(rows,rows));assert(!x.verifyMixedShapes(rows,[rows[0],{...rows[1],height:52}]));assert(!x.verifyMixedShapes(rows,[rows[0],{...rows[1],text:'省略'}]));assert(!x.verifyMixedShapes(rows,[rows[0]]));assert(!x.verifyMixedShapes(rows,[rows[0],rows[0]]));
});
function shapeDomHarness(fault: 'none'|'install'|'hidden'|'font'|'empty-range'|'overflow'='none') {
 const context=measuredShapeFunctions();let writes=0;
 function node(id:string,isControl=false){const values=new Map<string,string>();const n:any={id,className:id,isConnected:true,hidden:false,textContent:'原文 '+id,parentNode:{},nextSibling:null,parentElement:null,clientWidth:100,scrollWidth:100,clientHeight:30,scrollHeight:30,
 style:{setProperty(k:string,v:string){values.set(k,v);if(fault==='install'&&++writes===2)throw Error('injected partial installation');}},
 querySelectorAll:()=>[],getClientRects:()=>[{}],getBoundingClientRect:()=>({x:8,y:8,width:Number.parseFloat(values.get('width')??'100')||100,height:30}),
 getAttribute:()=>values.size?JSON.stringify([...values]):null,setAttribute:(_k:string,v:string)=>{values.clear();for(const [k,x]of JSON.parse(v))values.set(k,x);},removeAttribute:()=>values.clear(),matches:()=>isControl};return n;}
 const instrument=node('instrument'),pause=node('pause',true),sites=Array.from({length:7},()=>node('campaign-site')),canvas={getBoundingClientRect:()=>({x:0,y:0,width:320,height:568})};
 const root={querySelector:(s:string)=>s==='canvas'?canvas:null,querySelectorAll:(s:string)=>s.startsWith('#campaign-sites')?sites:[instrument,pause]};
 context.document={querySelector:()=>root,createTreeWalker:(n:any)=>{let done=false;return {nextNode:()=>done?null:(done=true,{textContent:n.textContent,parentElement:n})};},createRange:()=>({selectNodeContents:()=>{},getClientRects:()=>fault==='empty-range'?[]:[{x:8,y:8,width:fault==='overflow'?200:40,height:20}]})};context.NodeFilter={SHOW_TEXT:4};
 context.getComputedStyle=(n:any)=>({display:'block',visibility:fault==='hidden'&&writes?'hidden':'visible',opacity:'1',getPropertyValue:()=>fault==='font'&&writes?'12px':'16px'});
 const probe=context.installMeasuredShapeProbe({items:[{id:'instrument'},{id:'pause'}],variableIds:['instrument']});let error:any;
 try{if(fault==='hidden'||fault==='font')writes=1;probe.measure({instrument:94});}catch(e){error=String(e);}
 const issues=probe.read().shapeIssues;return {error,issues,restored:probe.restore(),inline:instrument.getAttribute('style'),pause:pause.getAttribute('style')};
}
for(const fault of ['none','install','hidden','font'] as const)test(`actual DOM shape probe ${fault} preserves rollback and rejects unsafe mutation`,()=>{
 const result=shapeDomHarness(fault);if(fault==='none')assert.equal(result.error,undefined);else assert.ok(result.error);assert.equal(result.restored,true);assert.equal(result.inline,null);assert.equal(result.pause,null);
});

for(const fault of ['empty-range','overflow'] as const)test(`actual shape catalogue rejects ${fault} text geometry`,()=>{const result=shapeDomHarness(fault);assert(result.issues.length>0);assert.equal(result.restored,true);});

function placementTextHarness(fault: 'none'|'split'|'clip'|'range'|'outside'|'apply'='none', textValue='396km/h') {
  const c=measuredShapeFunctions(),styles=new Map<string,string>();let writes=0;
  const node:any={id:'instrument',className:'instrument',isConnected:true,hidden:false,textContent:textValue,parentNode:{},nextSibling:null,parentElement:null,clientWidth:100,clientHeight:30,clientLeft:0,clientTop:0,scrollWidth:100,scrollHeight:30,
    style:{setProperty(k:string,v:string){styles.set(k,v);if(fault==='apply'&&++writes===3)throw Error('partial place');}},
    getAttribute:()=>styles.size?JSON.stringify([...styles]):null,setAttribute:(_k:string,v:string)=>{styles.clear();for(const [k,x]of JSON.parse(v))styles.set(k,x);},removeAttribute:()=>styles.clear(),
    querySelectorAll:()=>[],getClientRects:()=>[{}],getBoundingClientRect:()=>({x:parseFloat(styles.get('left')??'8'),y:parseFloat(styles.get('top')??'8'),width:100,height:30}),matches:()=>false};
  const parent:any={...node,id:'clip',textContent:'',parentElement:null,clientWidth:20,getBoundingClientRect:()=>({x:8,y:8,width:20,height:30})};if(fault==='clip')node.parentElement=parent;
  const text:any={textContent:textValue,parentElement:node};const canvas={getBoundingClientRect:()=>({x:0,y:0,width:320,height:320})};
  c.innerWidth=320;c.innerHeight=320;c.NodeFilter={SHOW_TEXT:4};
  c.document={querySelector:()=>({querySelector:(s:string)=>s==='canvas'?canvas:null,querySelectorAll:(s:string)=>s.startsWith('#campaign-sites')?[]:[node]}),
    createTreeWalker:()=>{let done=false;return {nextNode:()=>done?null:(done=true,text)};},
    createRange:()=>{let offset=-1;return {selectNodeContents:()=>{offset=-1;},setStart:(_n:any,i:number)=>{offset=i;},setEnd:()=>{},getClientRects:()=>fault==='range'?[]:[{x:fault==='outside'?319:8+Math.max(offset,0)*5,y:fault==='split'&&offset>=3?38:8,width:offset<0?35:5,height:20}]};}};
  c.getComputedStyle=(n:any)=>({display:'block',visibility:'visible',opacity:'1',overflowX:n===parent?'hidden':'visible',overflowY:'visible',getPropertyValue:()=> '16px'});
  const p=c.installMeasuredShapeProbe({items:[{id:'instrument'}],variableIds:['instrument']});let error:any;
  if(fault==='apply'){try{p.place([{id:'instrument',x:10,y:10,width:100,height:30}]);}catch(e){error=String(e);}}
  const result=p.inspectPlacement();return {result,error,restored:p.restore(),inline:node.getAttribute('style')};
}
test('actual placement inspector keeps a numeric unit token on one line',()=>{const r=placementTextHarness();assert.equal(r.result.issues.length,0);assert.equal(r.result.tokens[0].text,'396km/h');assert.equal(r.result.tokens[0].sameLine,true);});
for(const fault of ['split','clip','range','outside'] as const)test(`actual placement inspector rejects ${fault} glyph geometry`,()=>{const r=placementTextHarness(fault);assert(r.result.issues.length>0);assert(r.restored);});
test('actual placement transaction rolls back partial style writes',()=>{const r=placementTextHarness('apply');assert(r.error);assert(r.restored);assert.equal(r.inline,null);});

function canvasPlacementHarness(failPaint=false) {
 const source=readFileSync('scripts/ui-only-adapter.js','utf8');const body=source.slice(source.indexOf('  let uiOnlyPlacementRestore = null;'),source.indexOf('  function uiOnlyReset()'));
 const initial={status:'blocked',radar:{rect:{x:0,y:0,width:100,height:116},center:{x:50,y:50}}};let renders=0;
 const owner:any={layout:initial,update(){return this.layout;},diagnostics(){return this.layout;}};const update=owner.update,diagnostics=owner.diagnostics;
 const ctx:any={scene:{hudLayout:owner},screen:'playing',state:{status:'running'},uiOnlyPaint:()=>{renders++;if(failPaint)throw Error('paint failed');},uiOnlyCanvas:()=>({hudLayout:owner.diagnostics()})};
 runInNewContext(body,ctx);return {ctx,owner,update,diagnostics,renders:()=>renders};
}
test('test-only canvas placement restores exact methods and original blocked status',()=>{const h=canvasPlacementHarness(),r=h.ctx.uiOnlyPlacementBegin({x:200,y:100,width:100,height:116});assert.equal(r.originalStatus,'blocked');assert.equal(r.radar.center.x,250);assert.throws(()=>h.ctx.uiOnlyPlacementBegin({x:200,y:100,width:100,height:116}));assert(h.ctx.uiOnlyPlacementEnd());assert.equal(h.owner.update,h.update);assert.equal(h.owner.diagnostics,h.diagnostics);assert.equal(h.owner.diagnostics().status,'blocked');});
test('test-only canvas placement rolls back painter failure and rejects changed radar size',()=>{const h=canvasPlacementHarness(true);assert.throws(()=>h.ctx.uiOnlyPlacementBegin({x:200,y:100,width:100,height:116}));assert.equal(h.owner.update,h.update);assert.equal(h.owner.diagnostics,h.diagnostics);assert(h.ctx.uiOnlyPlacementEnd());assert.throws(()=>h.ctx.uiOnlyPlacementBegin({x:200,y:100,width:101,height:116}));});

test('placement tokens explicitly include health, site and remaining-aircraft label pairs',()=>{for(const text of ['機体 100%','陣地1','残機3','残り0発','機銃 288','機関砲 96','19:30.00']){const r=placementTextHarness('none',text);assert.equal(r.result.tokens[0].text,text);assert.equal(r.result.tokens[0].sameLine,true);}});

function nativeFixedNeutralChecker() {
 const source=readFileSync(new URL('../browser-ui-only/ui-only.spec.ts',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function fixedDetailNeutralIssues('),source.indexOf('async function captureNativeProductDetails('));
 return runInNewContext(transpileModule(`${body}\nfixedDetailNeutralIssues;`,{compilerOptions:{target:ScriptTarget.ES2022,module:ModuleKind.None}}).outputText);
}
const fixedNeutralRecord=()=>({purpose:'fixed fixture real-control sampling; no campaign tick',
 before:{tick:240,activeTicks:240,input:{turn:0,climb:0,throttle:0,steerPointer:null,heldPointers:{fire:[],loop:[],bomb:[],throttle:[]}}},
 after:{tick:240,activeTicks:240,input:{turn:0,climb:0,throttle:0,steerPointer:null,heldPointers:{fire:[],loop:[],bomb:[],throttle:[]}}},
 sample:{turn:0,climb:0,throttle:0,accelerate:false,brake:false,fire:false,bomb:false,loop:false},pendingLoop:false,pendingBomb:false,focusSame:true});
test('fixed-fixture native proof keeps real sample and excludes only renderer observations',()=>{
 const check=nativeFixedNeutralChecker(),before={tick:240,settings:{size:64},render:{measurements:1}},after={...before,render:{measurements:2}};
 assert.equal(check(before,fixedNeutralRecord(),after).length,0);
 for(const altered of [{...after,tick:241},{...after,settings:{size:63}}])assert.ok(check(before,fixedNeutralRecord(),altered).length);
 for(const key of Object.keys(fixedNeutralRecord().sample)){
  const bad:any=fixedNeutralRecord();bad.sample[key]=typeof bad.sample[key]==='number'?1:true;assert.ok(check(before,bad,after).length,key);
  delete bad.sample[key];assert.ok(check(before,bad,after).length,`missing ${key}`);
 }
});
test('fixed-fixture native proof rejects capture, focus, pending edge and synthetic labels',()=>{
 const check=nativeFixedNeutralChecker(),state={tick:240};
 for(const mutate of [(r:any)=>r.before.input.heldPointers.fire.push(1),(r:any)=>r.after.input.steerPointer=3,
 (r:any)=>r.focusSame=false,(r:any)=>r.pendingBomb=true,(r:any)=>r.pendingLoop=true,(r:any)=>r.after.tick++,
 (r:any)=>r.purpose='fake tick',(r:any)=>delete r.after.input.heldPointers]){
  const bad=fixedNeutralRecord();mutate(bad);assert.ok(check(state,bad,state).length);
 }
 assert.ok(check(state,null,state).length);
});
