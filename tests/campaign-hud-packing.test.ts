import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CampaignHudLayout, layoutCampaignHud, layoutCompactCampaignSites, intersects, type HudMeasurement, type HudRect } from '../src/campaign-hud-layout';

// Raw CI 37566989885 compact measurements. These are regression inputs, not a
// claim that this revision has run in a native browser.
const captures: Array<{ name: string; measurement: HudMeasurement; sight: HudRect }> = JSON.parse(
  readFileSync(new URL('./fixtures/campaign-scroll-ci-37566989885.json', import.meta.url), 'utf8'));
function assertPacked(source: HudMeasurement, sight: HudRect) {
  const out = layoutCampaignHud(source, sight);
  assert.equal(out.status, 'placed');
  const boxes = [out.radar.rect, ...out.panels!.map(item => item.rect), ...out.controls!.map(item => item.rect)];
  for (const [i, box] of boxes.entries()) {
    assert(box.x >= source.bounds.x && box.y >= source.bounds.y);
    assert(box.x + box.width <= source.bounds.x + source.bounds.width);
    assert(box.y + box.height <= source.bounds.y + source.bounds.height);
    for (const other of boxes.slice(i + 1)) assert(!intersects(box, other, 4));
    for (const other of [...source.obstacles, sight]) assert(!intersects(box, other, 4));
  }
  for (const sourceItem of [...source.panels!, ...source.movableControls!]) {
    const actual = [...out.panels!, ...out.controls!].find(item => item.id === sourceItem.id)!.rect;
    assert.equal(actual.width, sourceItem.width); assert.equal(actual.height, sourceItem.height);
  }
  return out;
}
test('captured 320px enlarged Normal retains full throttle travel and every readout within the unchanged search budget', () => {
  const capture: { measurement: HudMeasurement; sight: HudRect; label: { id: string; rect: HudRect } } = JSON.parse(
    readFileSync(new URL('./fixtures/campaign-throttle-ci-37695023486.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(capture);
  const packed = assertPacked(capture.measurement, capture.sight);
  assert(packed.searchChecks! < 120_000);
  const lever = packed.controls!.find(control => control.id === 'throttle')!.rect;
  assert.equal(lever.width, 64); assert.equal(lever.height, 128);
  const adapter = new CampaignHudLayout({ measure: () => capture.measurement, observe: () => () => {}, applyThreat() {}, applyPanels() {} });
  assert.equal(adapter.update(capture.sight)!.status, 'placed');
  const label = adapter.placeCanvasLabel(capture.label.id, capture.label.rect);
  assert.equal(label.status, 'placed');
  assert.equal(label.rect.width, capture.label.rect.width); assert.equal(label.rect.height, capture.label.rect.height);
  const final = adapter.diagnostics();
  assert.equal(final.status, 'placed'); assert(final.searchChecks! < 120_000);
  for (const box of [final.radar!.rect, ...final.panels!.map(panel => panel.rect), ...final.controls!.map(control => control.rect), ...capture.measurement.obstacles, capture.sight]) {
    assert(!intersects(label.rect, box, 4));
  }
  assert.equal(JSON.stringify(capture), before);
  adapter.dispose();
});
test('captured enlarged desktop packs without eagerly spending its collision budget on unused candidates', () => {
  const f = captures.find(item => item.name.includes('desktop'))!;
  const before = JSON.stringify(f);
  const out = assertPacked(f.measurement, f.sight);
  assert(out.searchChecks! < 20_000);
  assert.equal(JSON.stringify(f), before);
});
test('small portrait prediction retains all critical instruments and grown controls with an 80px detail viewport', () => {
  const f = structuredClone(captures.find(item => item.name.includes('small-portrait'))!);
  // CSS-derived prediction: removing only the 4px horizontal padding lets all
  // four 18px Japanese status glyphs fit on one line. Native CI must verify it.
  for (const site of f.measurement.obstacles) { site.height = 62.59375; site.y = site.y === 8 ? 8 : 72.59375; }
  const detail = f.measurement.panels!.find(item => item.id === 'campaign-hud-details')!;
  detail.height = 80;
  for (const control of f.measurement.movableControls!) {
    const size = control.id === 'loop' ? { width: 86.203125, height: 114.59375 }
      : control.id === 'bomb' ? { width: 72.53125, height: 62.6875 } : control;
    // Controls are center-anchored. Intrinsic growth moves both measured edges.
    control.x -= (size.width - control.width) / 2; control.y -= (size.height - control.height) / 2;
    control.width = size.width; control.height = size.height;
  }
  const out = assertPacked(f.measurement, f.sight);
  assert(out.searchChecks! < 60_000);
  for (const id of ['health-label', 'health-track', 'instrument', 'campaign-limit', 'ammo', 'campaign-mode-status', 'target-tally']) {
    assert(out.panels!.some(panel => panel.id === id));
  }
  assert.equal(out.radar.radius, 42);
});
test('compact site cards keep safe natural positions and move only those entering the actual sight', () => {
  const canvas = { x: 0, y: 0, width: 393, height: 852 }, bounds = { x: 8, y: 8, width: 377, height: 836 };
  const cards = Array.from({ length: 7 }, (_, i) => ({ x: 8 + i % 4 * 94.75, y: 8 + Math.floor(i / 4) * 72, width: 92.75, height: 70 }));
  const sight = { x: 104, y: 92, width: 90, height: 90 };
  const before = JSON.stringify(cards), out = layoutCompactCampaignSites(canvas, bounds, cards, sight);
  for (const [i, card] of out.entries()) {
    assert.equal(card.width, cards[i].width); assert.equal(card.height, cards[i].height);
    assert(!intersects(card, sight));
    for (const other of out.slice(i + 1)) assert(!intersects(card, other));
    if (!intersects(cards[i], sight)) assert.deepEqual(card, cards[i]);
  }
  assert.equal(JSON.stringify(cards), before);
});
test('full mode detects enlarged fixed control collisions, requiring responsive reflow', () => {
  const canvas = { x: 0, y: 0, width: 800, height: 600 }, bounds = { x: 8, y: 8, width: 784, height: 584 };
  const out = layoutCampaignHud({ canvas, bounds, flightData: null, threat: null, panels: [], obstacles: [
    { id: 'loop', x: 650, y: 400, width: 86, height: 114 }, { id: 'fire', x: 650, y: 500, width: 96, height: 88 },
  ] }, { x: 350, y: 200, width: 96, height: 96 });
  assert.equal(out.status, 'blocked');
  assert(out.fixedConflicts!.some(pair => pair.first === 'loop' && pair.second === 'fire'));
});
test('a grown full-mode control outside safe bounds cannot return a false fit', () => {
  const out = layoutCampaignHud({ canvas: { x: 0, y: 0, width: 800, height: 600 }, bounds: { x: 8, y: 8, width: 784, height: 584 },
    flightData: null, threat: null, panels: [], obstacles: [{ id: 'bomb', x: 720, y: 540, width: 76, height: 64 }],
  }, { x: 350, y: 200, width: 96, height: 96 });
  assert.equal(out.status, 'blocked');
  assert(out.fixedConflicts!.some(pair => pair.first === 'bomb' && pair.second === 'safe-bounds'));
});

test('full fixed controls cannot cover aim or central flight reserve', () => {
  const canvas={x:0,y:0,width:800,height:600},bounds={x:8,y:8,width:784,height:584};
  for(const [control,sight,reserve] of [
    [{id:'fire',x:600,y:400,width:50,height:50},{x:610,y:410,width:20,height:20},'aim-and-reload-ring'],
    [{id:'fire',x:380,y:280,width:50,height:50},{x:100,y:100,width:20,height:20},'central-flight-lane']
  ] as const) {
    const out=layoutCampaignHud({canvas,bounds,flightData:null,threat:null,panels:[],obstacles:[control]},sight);
    assert.equal(out.status,'blocked');assert(out.fixedConflicts!.some(p=>p.first==='fire'&&p.second===reserve));
  }
});
test('moving aim into full-mode fixed control invalidates cached measurement', () => {
  const measurement:HudMeasurement={canvas:{x:0,y:0,width:800,height:600},bounds:{x:8,y:8,width:784,height:584},flightData:null,threat:null,panels:[],obstacles:[{id:'fire',x:600,y:400,width:50,height:50}]};
  let measured=0;const layout=new CampaignHudLayout({measure:()=>{measured++;return measurement;},observe:()=>()=>{},applyThreat:()=>{},applyPanels:()=>{}});
  assert.equal(layout.update({x:100,y:100,width:20,height:20})!.status,'placed');
  assert.equal(layout.update({x:610,y:410,width:20,height:20})!.status,'blocked');assert.equal(measured,2);
});

// Exact e03359d CI run39153257236 measured dimensions; no invented browser geometry.
const diagnosticCaptures = [{"name":"hud-easy-clear-small-landscape-text-200-priority-0.png","measurement":{"canvas":{"x":0,"y":0,"width":568,"height":320},"bounds":{"x":8,"y":8,"width":552,"height":304},"obstacles":[{"x":8,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":87.140625,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":166.28125,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":245.421875,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":324.5625,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":403.703125,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":482.84375,"y":8,"width":77.15625,"height":55.796875,"id":"campaign-site"}],"panels":[{"x":8,"y":140,"width":122.375,"height":35,"id":"health-label"},{"x":8,"y":180,"width":110,"height":3,"id":"health-track"},{"x":8,"y":190,"width":110,"height":50,"id":"instrument"},{"x":130,"y":140,"width":144,"height":26,"id":"campaign-limit"},{"x":252,"y":188,"width":167.046875,"height":27.03125,"id":"ammo"},{"x":376,"y":150,"width":180,"height":82,"id":"campaign-threat"},{"x":161.875,"y":221.1875,"width":244.25,"height":39.265625,"id":"reload-status"},{"x":8,"y":220,"width":114,"height":96,"id":"campaign-hud-details"},{"x":8,"y":140,"width":72,"height":24,"id":"campaign-mode-status"},{"x":8,"y":140,"width":70.625,"height":57.1875,"id":"target-tally"}],"movableControls":[{"x":356,"y":266,"width":81.296875,"height":44,"id":"game-sound"},{"x":310,"y":266,"width":44,"height":50,"id":"pause"},{"x":185.25,"y":255.046875,"width":72.53125,"height":62.6875,"id":"bomb"},{"x":428.3359375,"y":160.9921875,"width":86.203125,"height":100.390625,"id":"loop"}],"flightData":{"x":252,"y":188,"width":167.046875,"height":27.03125},"threat":{"x":376,"y":150,"width":180,"height":82}},"sight":{"x":230.8,"y":106.8,"width":106.4,"height":106.4,"id":"aim-and-reload-ring"}},{"name":"hud-easy-outside-small-portrait-text-200-priority-0.png","measurement":{"canvas":{"x":0,"y":0,"width":320,"height":568},"bounds":{"x":8,"y":8,"width":304,"height":552},"obstacles":[{"x":8,"y":8,"width":74.5,"height":56.578125,"id":"campaign-site"},{"x":84.5,"y":8,"width":74.5,"height":56.578125,"id":"campaign-site"},{"x":161,"y":8,"width":74.5,"height":56.578125,"id":"campaign-site"},{"x":237.5,"y":8,"width":74.5,"height":56.578125,"id":"campaign-site"},{"x":8,"y":66.578125,"width":74.5,"height":56.578125,"id":"campaign-site"},{"x":84.5,"y":66.578125,"width":74.5,"height":56.578125,"id":"campaign-site"},{"x":161,"y":66.578125,"width":74.5,"height":56.578125,"id":"campaign-site"}],"panels":[{"x":8,"y":238,"width":122.375,"height":35,"id":"health-label"},{"x":8,"y":263,"width":118,"height":3,"id":"health-track"},{"x":8,"y":276,"width":94,"height":50,"id":"instrument"},{"x":97,"y":341.1875,"width":144,"height":26,"id":"campaign-limit"},{"x":97,"y":375.1875,"width":167.046875,"height":27.03125,"id":"ammo"},{"x":12,"y":246.03125,"width":93.796875,"height":146.96875,"id":"campaign-threat"},{"x":37.875,"y":345.1875,"width":244.25,"height":39.265625,"id":"reload-status"},{"x":80,"y":330.625,"width":160,"height":68.375,"id":"warning"},{"x":8,"y":220,"width":114,"height":72,"id":"campaign-hud-details"},{"x":8,"y":140,"width":72,"height":24,"id":"campaign-mode-status"},{"x":8,"y":140,"width":70.625,"height":57.1875,"id":"target-tally"}],"movableControls":[{"x":87,"y":440,"width":81.296875,"height":44,"id":"game-sound"},{"x":270,"y":440,"width":44,"height":50,"id":"pause"},{"x":88.53125,"y":502.5625,"width":72.53125,"height":62.6875,"id":"bomb"},{"x":222.4921875,"y":315.578125,"width":86.203125,"height":118.59375,"id":"loop"}],"flightData":{"x":97,"y":375.1875,"width":167.046875,"height":27.03125},"threat":{"x":12,"y":246.03125,"width":93.796875,"height":146.96875}},"sight":{"x":106.8,"y":230.8,"width":106.4,"height":106.4,"id":"aim-and-reload-ring"}}];
for (const capture of diagnosticCaptures) test(`deterministic free-space packing recovers ${capture.name}`, () => {
  const source = capture.measurement as HudMeasurement, before = JSON.stringify(source);
  const packed = assertPacked(source, capture.sight);
  assert(packed.primarySearchChecks! <= 120_000);
  assert(packed.recoverySearchChecks! > 0 && packed.recoverySearchChecks! <= 6_000);
  assert(packed.searchChecks! <= 126_000);
  assert.equal(packed.searchChecks, packed.primarySearchChecks! + packed.recoverySearchChecks!);
  assert.deepEqual(layoutCampaignHud(source, capture.sight), packed);
  assert.equal(JSON.stringify(source), before);
});

// Independent synthetic counterexample, seed197/n2145; not a browser observation.
const lateSearchRegression = {"measurement":{"canvas":{"x":0,"y":0,"width":568,"height":320},"bounds":{"x":8,"y":8,"width":552,"height":304},"obstacles":[{"x":8,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":87.140625,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":166.28125,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":245.421875,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":324.5625,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":403.703125,"y":8,"width":77.140625,"height":55.796875,"id":"campaign-site"},{"x":482.84375,"y":8,"width":77.15625,"height":55.796875,"id":"campaign-site"}],"panels":[{"x":192.03412248608865,"y":48.073760454731875,"width":98.56218385441463,"height":28.1893886406906,"id":"health-label"},{"x":256.8582162416049,"y":171.54823055598993,"width":88.59522144217046,"height":2.416233312059194,"id":"health-track"},{"x":275.59656412319737,"y":186.9179439256965,"width":88.59522144217046,"height":40.27055520098657,"id":"instrument"},{"x":242.90754348233494,"y":59.97093512015672,"width":115.97919897884131,"height":20.940688704513015,"id":"campaign-limit"},{"x":154.35989568732168,"y":111.92805433824813,"width":134.54140801679605,"height":21.771268905533365,"id":"ammo"},{"x":327.7206124855905,"y":133.7804742477976,"width":144.97399872355166,"height":66.04371052961797,"id":"campaign-threat"},{"x":229.80921618058386,"y":42.00448940519926,"width":196.72166215681938,"height":31.624970381274764,"id":"reload-status"},{"x":309.6405023302979,"y":86.89408443727037,"width":181.2804211469411,"height":25.773155328631404,"id":"warning"},{"x":181.3298569074436,"y":98.76455195154132,"width":144.97399872355166,"height":45.10302182510496,"id":"announcement"},{"x":145.83704719442935,"y":143.2694429264325,"width":91.81686585824937,"height":77.31946598589421,"id":"campaign-hud-details"},{"x":317.5703980254453,"y":212.52759372318977,"width":57.989599489420655,"height":19.329866496473553,"id":"campaign-mode-status"},{"x":142.67978828830533,"y":18.881896978255064,"width":56.88215922139353,"height":46.05944751112839,"id":"target-tally"}],"movableControls":[{"x":296,"y":222,"width":81.296875,"height":44,"id":"game-sound"},{"x":509,"y":60,"width":44,"height":50,"id":"pause"},{"x":475,"y":172,"width":72.53125,"height":62.6875,"id":"bomb"},{"x":330,"y":118,"width":86.203125,"height":100.390625,"id":"loop"},{"x":475,"y":239,"width":62,"height":51.1875,"id":"fire"},{"x":420,"y":172,"width":51.1875,"height":102.390625,"id":"throttle"}],"flightData":{"x":252,"y":188,"width":167.046875,"height":27.03125},"threat":{"x":376,"y":150,"width":180,"height":82}},"sight":{"x":246.79999999999995,"y":79.0089291012429,"width":74.4,"height":74.4,"id":"aim-and-reload-ring"}};
test('late primary search success is preserved before attempting recovery', () => {
  const packed = assertPacked(lateSearchRegression.measurement, lateSearchRegression.sight);
  assert.equal(packed.searchChecks, 108833);
  assert.equal(packed.recoverySearchChecks, 0);
  assert.equal(packed.primarySearchChecks, 108833);
});
