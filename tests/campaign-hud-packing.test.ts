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
