import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignHudLayout, createCampaignHudLayout, campaignSiteStripTop, layoutCampaignSites, layoutCampaignCanvasLabel, intersects, layoutCampaignHud, placeRectangle, toCanvasRect, type HudMeasurement, type HudRect } from '../src/campaign-hud-layout';
import { DEFAULT_LAYOUT, controlBounds, controlDisplaySize, controlDimensions, rectangularBounds, safeThrottlePlacement } from '../src/control-settings';
import { projectGunSight } from '../src/gun-sight';
import { aimRadius } from '../src/aim-indicator';
import { createGame } from '../src/simulation';

const cards320 = Array.from({ length: 7 }, (_, i) => ({ id: `site-${i + 1}`, x: 12 + i % 4 * 75, y: 116 + Math.floor(i / 4) * 60.96875, width: 71, height: 56.96875 }));
const bounds = { x: 8, y: 8, width: 304, height: 552 };
const original = { x: 218, y: 138, width: 84, height: 100 };
const input = { bounds, size: original, preferred: original, obstacles: cards320, gap: 4 };
const sight = { x: 106.8, y: 230.8, width: 106.4, height: 106.4 };
const measurement: HudMeasurement = {
  canvas: { x: 0, y: 0, width: 320, height: 568 }, bounds, obstacles: cards320,
  flightData: null, threat: null,
};

test('source-derived 320 fixture exposes the original radar overlap (not a live DOM measurement)', () => {
  assert(intersects(original, cards320[3])); assert(intersects(original, cards320[6]));
  const before = JSON.stringify(input), result = placeRectangle(input);
  assert.equal(result.status, 'placed');
  if (result.status === 'placed') { assert.equal(result.rect.width, 84); assert.equal(result.rect.height, 100); assert(cards320.every(c => !intersects(result.rect, c, 4))); }
  assert.equal(JSON.stringify(input), before);
});
test('actual CI site dimensions at 393/568/852 remain distinct from the derived 320 fixture', () => {
  // Extracted before-change trace geometry: 393 two rows; 568/852 one row.
  for (const [width, height, left, top, cardWidth, cardHeight, gap, columns] of [
    [393, 852, 18, 82, 86.25, 56.96875, 4, 4], [568, 320, 12, 70, 76, 41.875, 2, 7], [852, 393, 46, 70, 106.85, 41.875, 2, 7],
  ]) {
    const cards = Array.from({ length: 7 }, (_, i) => ({ x: left + i % columns * (cardWidth + gap), y: top + Math.floor(i / columns) * (cardHeight + gap), width: cardWidth, height: cardHeight }));
    const old = { x: width - 116, y: Math.min(height * .33, 180) - 49, width: 98, height: 114 };
    assert(cards.some(card => intersects(old, card)));
    const out = placeRectangle({ bounds: { x: 8, y: 8, width: width - 16, height: height - 16 }, size: old, preferred: old, obstacles: cards });
    assert.equal(out.status, 'placed');
  }
});
test('canvas origin conversion does not multiply CSS pixels by DPR', () => {
  assert.deepEqual(toCanvasRect({ x: 140, y: 270, width: 84, height: 100 }, { x: 40, y: 70, width: 320, height: 568 }), { x: 100, y: 200, width: 84, height: 100 });
});
test('caption and stroke fringe are reserved with the unchanged radius', () => {
  const out = layoutCampaignHud(measurement, sight);
  assert.equal(out.status, 'placed'); assert.equal(out.radar.radius, 42);
  assert.equal(out.radar.rect.width, 86); assert.equal(out.radar.rect.height, 102);
  assert(out.obstacles.every(o => !intersects(out.radar.rect, o, 4)));
  const blocked = placeRectangle({ bounds: { x: 0, y: 0, width: 100, height: 100 }, size: original, preferred: { x: 0, y: 0 }, obstacles: [{ x: 0, y: 85, width: 100, height: 15 }], gap: 0 });
  assert.equal(blocked.status, 'blocked');
});
test('safe bounds are respected and invalid inputs never become a fit', () => {
  assert.equal(placeRectangle({ ...input, gap: NaN }).status, 'invalid');
  assert.equal(placeRectangle({ ...input, preferred: { x: NaN, y: 0 } }).status, 'invalid');
  assert.equal(placeRectangle({ ...input, size: { width: 0, height: 10 } }).status, 'invalid');
  assert.equal(placeRectangle({ ...input, obstacles: [{ x: Infinity, y: 0, width: 1, height: 1 }] }).status, 'invalid');
  const safe = { x: 20, y: 44, width: 280, height: 490 }, out = placeRectangle({ ...input, bounds: safe });
  assert.equal(out.status, 'placed');
  if (out.status === 'placed') { assert(out.rect.x >= 20); assert(out.rect.y >= 44); assert(out.rect.x + out.rect.width <= 300); assert(out.rect.y + out.rect.height <= 534); }
});
test('notification is stacked below measured instruments and ammo without changing size or inputs', () => {
  const data = { x: 18, y: 233, width: 118, height: 155 };
  const source: HudMeasurement = { ...measurement, obstacles: [...cards320, { ...data, id: 'flight-data' }], flightData: data, threat: { x: 12, y: 354, width: 175, height: 28 } };
  const before = JSON.stringify(source), out = layoutCampaignHud(source, sight);
  assert.equal(out.status, 'placed'); assert.equal(out.threat!.rect.y, 396); assert.equal(out.threat!.rect.x, 18);
  assert.equal(out.threat!.rect.width, 175); assert.equal(out.threat!.rect.height, 28);
  assert(!intersects(out.radar.rect, out.threat!.rect, 4)); assert.equal(JSON.stringify(source), before);
});
test('long notifications reserve their full height rather than clipping or shrinking', () => {
  const out = layoutCampaignHud({ ...measurement, threat: { x: 18, y: 360, width: 190, height: 120 } }, sight);
  assert.equal(out.threat!.rect.width, 190); assert.equal(out.threat!.rect.height, 120);
  if (out.status === 'placed') assert(out.obstacles.every(o => !intersects(out.threat!.rect, o, 4)));
});
test('no-space keeps the full radar and notification visible with an explicit blocked result', () => {
  const out = layoutCampaignHud({ ...measurement, obstacles: [{ ...bounds, id: 'custom-controls' }], threat: { x: 12, y: 354, width: 175, height: 28 } }, sight);
  assert.equal(out.status, 'blocked'); assert.equal(out.radar.status, 'blocked'); assert.equal(out.threat!.status, 'blocked');
  assert.equal(out.radar.radius, 42); assert.equal(out.radar.rect.height, 102); assert.equal(out.threat!.rect.height, 28);
});
test('320 Easy derived full HUD fixture avoids visible custom controls and notification regions', () => {
  const data = { x: 18, y: 233, width: 118, height: 155 };
  const out = layoutCampaignHud({ ...measurement, flightData: data, threat: { x: 12, y: 354, width: 175, height: 28 }, obstacles: [...cards320,
    { ...data, id: 'flight-data' }, { id: 'header', x: 12, y: 16, width: 296, height: 98 },
    { id: 'loop', x: 229.6, y: 338.88, width: 72, height: 72 }, { id: 'bomb', x: 98.8, y: 507.92, width: 52, height: 52 },
    { id: 'announcement', x: 18, y: 425, width: 284, height: 25 }, { id: 'flight-tip', x: 20, y: 459, width: 155, height: 20 },
  ] }, sight);
  assert.equal(out.status, 'placed');
  assert(out.obstacles.every(o => !intersects(out.radar.rect, o, 4)));
  assert(out.obstacles.every(o => !intersects(out.threat!.rect, o, 4)));
});
test('cached adapter coalesces changes, follows resize and sight, and disposes observers exactly once', () => {
  let invalidate = () => {}, measures = 0, disposed = 0, applies = 0, current = measurement;
  const adapter = new CampaignHudLayout({ measure: () => { measures++; return current; },
    observe: callback => { invalidate = callback; return () => { disposed++; }; }, applyThreat: () => { applies++; } });
  const first = adapter.update(sight);
  for (let i = 0; i < 50; i++) { assert.equal(adapter.update(sight), first); adapter.diagnostics(); }
  adapter.update({ ...sight, x: sight.x + 1e-12 });
  assert.equal(measures, 1); assert.equal(applies, 1);
  adapter.update({ ...sight, x: sight.x + 1 }); assert.equal(measures, 1); assert.equal(applies, 2);
  for (let i = 0; i < 20; i++) {
    current = { ...measurement, canvas: { ...measurement.canvas, width: i % 2 ? 320 : 393 }, bounds: { ...bounds, width: i % 2 ? 304 : 377 } };
    invalidate(); invalidate(); adapter.update(sight);
  }
  assert.equal(measures, 21);
  adapter.dispose(); adapter.dispose(); invalidate(); adapter.update(sight);
  assert.equal(disposed, 1); assert.equal(measures, 21); assert.equal(adapter.diagnostics().disposed, true);
});
test('observer flush sees same-frame visibility changes before rendering', () => {
  let dirty = () => {}, flush = false, calls = 0;
  const adapter = new CampaignHudLayout({ measure: () => { calls++; return measurement; }, observe: callback => { dirty = callback; return () => {}; },
    flush: () => { if (flush) { dirty(); flush = false; } }, applyThreat: () => {} });
  adapter.update(sight); flush = true; adapter.update(sight); assert.equal(calls, 2); adapter.dispose();
});

test('blocked notification after rotation keeps its full size inside the new bounds when possible', () => {
  const landscape = { x: 8, y: 8, width: 552, height: 304 };
  const out = layoutCampaignHud({ canvas: { x: 0, y: 0, width: 568, height: 320 }, bounds: landscape,
    flightData: null, threat: { x: 200, y: 650, width: 180, height: 40 }, obstacles: [{ ...landscape, id: 'custom-controls' }] }, sight);
  assert.equal(out.status, 'blocked'); assert.equal(out.threat!.status, 'blocked');
  assert.equal(out.threat!.rect.width, 180); assert.equal(out.threat!.rect.height, 40);
  assert.equal(out.threat!.rect.y, 272); assert.equal(out.threat!.rect.y + out.threat!.rect.height, 312);
});

// Exact production default-control math, with source-derived text dimensions.
// These fixtures are packing tests, not replacements for live DOM/CI evidence.
function defaultControls(width: number, height: number) {
  return Object.entries(DEFAULT_LAYOUT).map(([id, entry]) => {
    const insets = { top: 0, right: 0, bottom: 0, left: 0 };
    if (id === 'throttle') entry = safeThrottlePlacement(DEFAULT_LAYOUT, width, height, insets);
    const dimensions = controlDimensions(id as keyof typeof DEFAULT_LAYOUT, entry.size, width, height);
    const bounds = rectangularBounds(dimensions, width, height, insets);
    const x = Math.max(bounds.minX, Math.min(bounds.maxX, entry.x)) * width;
    const y = Math.max(bounds.minY, Math.min(bounds.maxY, entry.y)) * height;
    return { id, x: x - dimensions.width / 2, y: y - dimensions.height / 2, ...dimensions };
  });
}
const narrowPanels = [
  { id: 'time-block', x: 198, y: 168, width: 110, height: 50 },
  { id: 'health-label', x: 8, y: 238, width: 94, height: 18 },
  { id: 'health-track', x: 8, y: 263, width: 118, height: 3 },
  { id: 'instrument', x: 8, y: 276, width: 94, height: 12 },
  { id: 'wingmen', x: 237, y: 177, width: 71, height: 51 },
  { id: 'campaign-limit', x: 97, y: 341.2, width: 114, height: 12 },
  { id: 'score-readout', x: 97, y: 357.2, width: 114, height: 14 },
  { id: 'ammo', x: 97, y: 375.2, width: 114, height: 26 },
  { id: 'campaign-threat', x: 12, y: 354, width: 114, height: 46.3 },
  { id: 'announcement', x: 97, y: 455.2, width: 114, height: 43 },
  { id: 'flight-tip', x: 218, y: 238, width: 94, height: 42 },
];
const narrow: HudMeasurement = { ...measurement, obstacles: [...cards320.map((card, i) => ({ ...card, y: 54 + Math.floor(i / 4) * 56.96875 })), ...defaultControls(320, 568),
  { id: 'header', x: 12, y: 8, width: 296, height: 46 }], panels: narrowPanels };
function assertCompletePacking(source: HudMeasurement, aim: HudRect, label = '') {
  const before = JSON.stringify(source), out = layoutCampaignHud(source, aim);
  assert.equal(out.status, 'placed', `${label} fixed=${JSON.stringify(out.fixedConflicts)} work=${out.searchChecks}`);
  assert.equal(JSON.stringify(source), before);
  const boxes = [{ id: 'radar', rect: out.radar.rect }, ...out.panels!];
  for (const [i, item] of boxes.entries()) {
    assert(item.rect.x >= source.bounds.x && item.rect.y >= source.bounds.y, item.id);
    assert(item.rect.x + item.rect.width <= source.bounds.x + source.bounds.width, item.id);
    assert(item.rect.y + item.rect.height <= source.bounds.y + source.bounds.height, item.id);
    assert(out.obstacles.every(obstacle => !intersects(item.rect, obstacle, 4)), `${item.id} avoids fixed HUD, controls and sight`);
    assert(boxes.slice(i + 1).every(other => !intersects(item.rect, other.rect, 4)), `${item.id} avoids every readout`);
  }
  for (const panel of source.panels!) {
    const actual = out.panels!.find(item => item.id === panel.id)!;
    assert.equal(actual.rect.width, panel.width); assert.equal(actual.rect.height, panel.height);
  }
  return out;
}
test('320 Normal reflow packs all readouts with approved four-control rectangular lever geometry', () => {
  const controls = defaultControls(320, 568);
  assert.deepEqual(controls.map(item => item.width), [96, 72, 64, 52]);
  assertCompletePacking(narrow, sight);
});
test('full-size readout packing keeps a blocked custom-control layout honest', () => {
  const out = layoutCampaignHud({ ...narrow, obstacles: [{ ...bounds, id: 'custom-control-obstruction' }] }, sight);
  assert.equal(out.status, 'blocked'); assert.equal(out.panels!.length, narrowPanels.length);
  for (const panel of out.panels!) {
    const original = narrowPanels.find(item => item.id === panel.id)!;
    assert.equal(panel.rect.width, original.width); assert.equal(panel.rect.height, original.height);
  }
});
test('unchanged visible readouts remain stable while a nearby sight moves without contact', () => {
  let measures = 0, applies = 0;
  const adapter = new CampaignHudLayout({ measure: () => { measures++; return narrow; }, observe: () => () => {},
    applyThreat: () => { throw new Error('panel layout uses its own adapter'); }, applyPanels: () => { applies++; } });
  const first = adapter.update(sight)!;
  for (let i = 0; i < 100; i++) adapter.update({ ...sight, x: sight.x + (i % 2) * .1 });
  assert.equal(measures, 1); assert.equal(applies, 1); assert.deepEqual(adapter.diagnostics().panels, first.panels);
  adapter.dispose();
});

test('landscape readouts pack away from exact default buttons without shortening gauges', () => {
  const width = 568, height = 320;
  const source: HudMeasurement = { canvas: { x: 0, y: 0, width, height },
    bounds: { x: 8, y: 8, width: 552, height: 304 }, flightData: null, threat: null,
    obstacles: [{ id: 'header', x: 12, y: 8, width: 544, height: 54 }, ...defaultControls(width, height),
      ...Array.from({ length: 7 }, (_, i) => ({ id: `site-${i}`, x: 12 + i * 78, y: 70, width: 76, height: 41.875 }))],
    panels: [
      { id: 'health-label', x: 18, y: 123, width: 118, height: 18 },
      { id: 'health-track', x: 18, y: 147, width: 118, height: 3 },
      { id: 'instrument', x: 18, y: 158, width: 118, height: 12 },
      { id: 'wingmen', x: 18, y: 179, width: 118, height: 34 },
      { id: 'campaign-limit', x: 18, y: 218, width: 118, height: 12 },
      { id: 'score-readout', x: 18, y: 235, width: 118, height: 14 },
      { id: 'ammo', x: 18, y: 256, width: 118, height: 24 },
      { id: 'campaign-threat', x: 376, y: 150, width: 180, height: 28 },
      { id: 'announcement', x: 376, y: 118, width: 180, height: 24 },
    ] };
  assertCompletePacking(source, { x: 246.8, y: 122.8, width: 74.4, height: 74.4 });
});
test('packing rejects invalid measurements and bounds no-fit work without accepting a partial result', () => {
  assert.equal(layoutCampaignHud({ ...narrow, panels: [{ ...narrowPanels[0], width: NaN }] }, sight).status, 'invalid');
  const crowded = { ...narrow, panels: Array.from({ length: 18 }, (_, i) => ({ id: `notice-${i}`, x: 97, y: 350, width: 114, height: 30 })) };
  const out = layoutCampaignHud(crowded, sight);
  assert.equal(out.status, 'blocked'); assert.equal(out.panels!.length, 18);
  assert(out.searchChecks! <= 120_000);
  assert(out.panels!.every(panel => panel.status === 'blocked' && panel.rect.width === 114 && panel.rect.height === 30));
});

test('DOM adapter catches wrapped text before draw, caches repeated writes and restores its own styles on disposal', () => {
  const previousResize = globalThis.ResizeObserver, previousMutation = globalThis.MutationObserver;
  const records: MutationRecord[] = [];
  let resizeDisconnected = 0, mutationDisconnected = 0, removed = 0;
  const listeners = new Set<string>();
  class Styles {
    values = new Map<string, string>(); cssText = '';
    getPropertyValue(name: string) { return this.values.get(name) ?? ''; }
    getPropertyPriority() { return ''; }
    setProperty(name: string, value: string) { this.values.set(name, value); }
    removeProperty(name: string) { this.values.delete(name); }
  }
  const makeNode = (id: string, box: HudRect) => {
    const style = new Styles();
    return { id, className: id, style, hidden: false, textContent: 'notice', box, dataset: {} as Record<string, string>,
      ownerDocument: null as any, parentElement: null as any, append() {}, before() {}, after() {}, querySelector() { return null; }, querySelectorAll() { return []; }, removeAttribute() {},
      getAttribute(name: string) { return name === 'style' ? [...style.values].map(([key, value]) => `${key}:${value}`).join(';') || null : this.hidden && name === 'hidden' ? '' : null; },
      setAttribute() {}, closest() { return this.hidden ? this : null; }, contains(other: unknown) { return other === this; },
      getClientRects() { return this.hidden ? [] : [this.box]; },
      getBoundingClientRect() { return { ...this.box, x: this.box.x + (parseFloat(style.getPropertyValue('--campaign-hud-x')) || 0),
        y: this.box.y + (parseFloat(style.getPropertyValue('--campaign-hud-y')) || 0) }; },
      remove() { removed++; },
    };
  };
  const announcement = makeNode('announcement', { x: 350, y: 300, width: 180, height: 18 });
  const instrument = makeNode('instrument', { x: 60, y: 150, width: 118, height: 12 });
  const elapsed = makeNode('time-block', { x: 60, y: 80, width: 130, height: 30 });
  announcement.style.setProperty('color', 'plum');
  announcement.style.setProperty('--campaign-hud-x', '5px'); announcement.style.setProperty('--campaign-hud-y', '6px');
  const probe = makeNode('probe', { x: 0, y: 0, width: 0, height: 0 });
  const app = { ...makeNode('app', { x: 40, y: 60, width: 800, height: 600 }), append() {},
    querySelectorAll(selector: string) { return selector.includes('.flight-data > *') ? [announcement, instrument, elapsed] : []; },
    querySelector(selector: string) { return selector === '#hud' ? app : selector === '.hud-top .time-block' ? elapsed : null; } };
  const win = { getComputedStyle() { return { visibility: 'visible', display: 'block', paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0' }; },
    addEventListener(name: string) { listeners.add(name); }, removeEventListener(name: string) { listeners.delete(name); } };
  const doc = { defaultView: win, documentElement: makeNode('html', app.box), body: makeNode('body', app.box), createElement() { const node = makeNode('created', { x: 0, y: 0, width: 0, height: 0 }); node.ownerDocument = doc; return node; }, createComment() { return { parentNode: app, after() {}, remove() {} }; },
    fonts: { addEventListener(name: string) { listeners.add(name); }, removeEventListener(name: string) { listeners.delete(name); } } };
  for (const node of [app, announcement, instrument, elapsed]) node.ownerDocument = doc;
  const canvas = { ...makeNode('flight', app.box), ownerDocument: doc, closest() { return app; }, parentElement: app };
  globalThis.ResizeObserver = class { observe() {} disconnect() { resizeDisconnected++; } } as unknown as typeof ResizeObserver;
  globalThis.MutationObserver = class { observe() {} disconnect() { mutationDisconnected++; } takeRecords() { return records.splice(0); } } as unknown as typeof MutationObserver;
  try {
    const adapter = createCampaignHudLayout(canvas as unknown as HTMLCanvasElement);
    const aim = { x: 350, y: 250, width: 100, height: 100 };
    adapter.update(aim); assert.equal(adapter.diagnostics().measurements, 1);
    elapsed.textContent = '00:00.01';
    records.push({ type: 'childList', target: elapsed } as unknown as MutationRecord);
    adapter.update(aim); assert.equal(adapter.diagnostics().measurements, 1, 'a wide-viewport header clock is not a movable panel');
    assert(!adapter.diagnostics().panels!.some(panel => panel.id === 'time-block'));
    records.push({ type: 'childList', target: announcement } as unknown as MutationRecord);
    adapter.update(aim); assert.equal(adapter.diagnostics().measurements, 1, 'same text must not remeasure');
    announcement.textContent = 'same size notice'; instrument.textContent = '400km/h';
    records.push(...[announcement, instrument].map(target => ({ type: 'childList', target }) as unknown as MutationRecord));
    adapter.update(aim); assert.equal(adapter.diagnostics().measurements, 1, 'changed same-size text must not repack');
    announcement.textContent = 'longer notice wraps onto a second line'; announcement.box.height = 36;
    instrument.textContent = '401km/h';
    records.push(...[announcement, instrument].map(target => ({ type: 'childList', target }) as unknown as MutationRecord));
    adapter.update(aim); assert.equal(adapter.diagnostics().measurements, 2);
    assert.equal(adapter.diagnostics().panels!.find(panel => panel.id === 'announcement')!.rect.height, 36);
    records.push(...[announcement, instrument].map(target => ({ type: 'childList', target }) as unknown as MutationRecord));
    adapter.update(aim); assert.equal(adapter.diagnostics().measurements, 2, 'all signatures were consumed in the prior batch');
    announcement.style.setProperty('outline', '2px solid gold');
    adapter.dispose(); adapter.dispose();
    assert.equal(announcement.style.getPropertyValue('--campaign-hud-x'), '5px');
    assert.equal(announcement.style.getPropertyValue('--campaign-hud-y'), '6px');
    assert.equal(announcement.style.getPropertyValue('color'), 'plum');
    assert.equal(announcement.style.getPropertyValue('outline'), '2px solid gold');
    assert.equal(resizeDisconnected, 1); assert.equal(mutationDisconnected, 1); assert.equal(removed, 3); assert.equal(listeners.size, 0);
  } finally { globalThis.ResizeObserver = previousResize; globalThis.MutationObserver = previousMutation; }
});

// Exact head 3c2f3b6, run37390794157 evidence/*-hud.json. These are replay
// measurements; altered header bounds below are a design prediction until CI.
const capturedCi: Array<{ name: string; measurement: HudMeasurement; sight: HudRect }> = [
  {"name": "fantasia-normal-320x568", "measurement": {"canvas": {"x": 0, "y": 0, "width": 320, "height": 568}, "bounds": {"x": 8, "y": 8, "width": 304, "height": 552}, "flightData": null, "threat": null, "obstacles": [{"x": 98, "y": 8, "width": 210, "height": 97, "id": "hud-top"}, {"x": 157, "y": 51, "width": 44, "height": 44, "id": "game-sound"}, {"x": 205, "y": 51, "width": 44, "height": 44, "id": "pause"}, {"x": 12, "y": 116, "width": 71, "height": 56.96875, "id": "campaign-site"}, {"x": 87, "y": 116, "width": 71, "height": 56.96875, "id": "campaign-site"}, {"x": 162, "y": 116, "width": 71, "height": 56.96875, "id": "campaign-site"}, {"x": 237, "y": 116, "width": 71, "height": 56.96875, "id": "campaign-site"}, {"x": 12, "y": 176.96875, "width": 71, "height": 56.96875, "id": "campaign-site"}, {"x": 87, "y": 176.96875, "width": 71, "height": 56.96875, "id": "campaign-site"}, {"x": 162, "y": 176.96875, "width": 71, "height": 56.96875, "id": "campaign-site"}, {"x": 98.796875, "y": 507.90625, "width": 52, "height": 52, "id": "bomb"}, {"x": 229.59375, "y": 338.875, "width": 72, "height": 72, "id": "loop"}, {"x": 216, "y": 429.109375, "width": 96, "height": 96, "id": "fire"}, {"x": 16.390625, "y": 439.109375, "width": 76, "height": 76, "id": "accelerate"}, {"x": 16.390625, "y": 336.875, "width": 76, "height": 76, "id": "brake"}], "panels": [{"x": 8, "y": 238, "width": 94, "height": 18, "id": "health-label"}, {"x": 8, "y": 263, "width": 118, "height": 3, "id": "health-track"}, {"x": 8, "y": 276, "width": 94, "height": 11, "id": "instrument"}, {"x": 237, "y": 177, "width": 71, "height": 34, "id": "wingmen"}, {"x": 97, "y": 339.1875, "width": 114, "height": 14, "id": "campaign-limit"}, {"x": 97, "y": 357.1875, "width": 114, "height": 15, "id": "score-readout"}, {"x": 97, "y": 376.1875, "width": 114, "height": 14, "id": "ammo"}, {"x": 218, "y": 238, "width": 94, "height": 18.6875, "id": "flight-tip"}, {"x": 97, "y": 452.90625, "width": 114, "height": 51, "id": "announcement"}]}, "sight": {"x": 122.79999999999994, "y": 169.07084915470614, "width": 74.4, "height": 74.4}},
  { name: "fantasia-easy-320x568", measurement: {
    canvas: {"x": 0, "y": 0, "width": 320, "height": 568}, bounds: {"x": 8, "y": 8, "width": 304, "height": 552},
    flightData: null, threat: null,
    obstacles: [
      {"x": 98, "y": 8, "width": 210, "height": 97, "id": "hud-top"},
      {"x": 157, "y": 51, "width": 44, "height": 44, "id": "game-sound"},
      {"x": 205, "y": 51, "width": 44, "height": 44, "id": "pause"},
      {"x": 12, "y": 116, "width": 71, "height": 56.96875, "id": "campaign-site"},
      {"x": 87, "y": 116, "width": 71, "height": 56.96875, "id": "campaign-site"},
      {"x": 162, "y": 116, "width": 71, "height": 56.96875, "id": "campaign-site"},
      {"x": 237, "y": 116, "width": 71, "height": 56.96875, "id": "campaign-site"},
      {"x": 12, "y": 176.96875, "width": 71, "height": 56.96875, "id": "campaign-site"},
      {"x": 87, "y": 176.96875, "width": 71, "height": 56.96875, "id": "campaign-site"},
      {"x": 162, "y": 176.96875, "width": 71, "height": 56.96875, "id": "campaign-site"},
      {"x": 98.796875, "y": 507.90625, "width": 52, "height": 52, "id": "bomb"},
      {"x": 229.59375, "y": 338.875, "width": 72, "height": 72, "id": "loop"},
    ], panels: [
      {"x": 8, "y": 238, "width": 94, "height": 18, "id": "health-label"},
      {"x": 8, "y": 341.20000000000005, "width": 118, "height": 3, "id": "health-track"},
      {"x": 8, "y": 276, "width": 94, "height": 11, "id": "instrument"},
      {"x": 237, "y": 177, "width": 71, "height": 34, "id": "wingmen"},
      {"x": 97, "y": 394.1875, "width": 114, "height": 14, "id": "campaign-limit"},
      {"x": 97, "y": 357.1875, "width": 114, "height": 15, "id": "score-readout"},
      {"x": 97, "y": 376.1875, "width": 114, "height": 14, "id": "ammo"},
      {"x": 218, "y": 238, "width": 94, "height": 18.6875, "id": "flight-tip"},
      {"x": 97, "y": 452.90625, "width": 114, "height": 51, "id": "announcement"},
    ],
  }, sight: {"x": 106.8, "y": 230.8, "width": 106.4, "height": 106.4} },
  { name: "fantasia-easy-568x320", measurement: {
    canvas: {"x": 0, "y": 0, "width": 568, "height": 320}, bounds: {"x": 8, "y": 8, "width": 552, "height": 304},
    flightData: null, threat: null,
    obstacles: [
      {"x": 12, "y": 12, "width": 544, "height": 64, "id": "hud-top"},
      {"x": 395, "y": 22, "width": 44, "height": 44, "id": "game-sound"},
      {"x": 443, "y": 22, "width": 44, "height": 44, "id": "pause"},
      {"x": 12, "y": 70, "width": 76, "height": 41.875, "id": "campaign-site"},
      {"x": 90, "y": 70, "width": 76, "height": 41.875, "id": "campaign-site"},
      {"x": 168, "y": 70, "width": 76, "height": 41.875, "id": "campaign-site"},
      {"x": 246, "y": 70, "width": 76, "height": 41.875, "id": "campaign-site"},
      {"x": 324, "y": 70, "width": 76, "height": 41.875, "id": "campaign-site"},
      {"x": 402, "y": 70, "width": 76, "height": 41.875, "id": "campaign-site"},
      {"x": 480, "y": 70, "width": 76, "height": 41.875, "id": "campaign-site"},
      {"x": 195.921875, "y": 260.796875, "width": 51.1875, "height": 51.1875, "id": "bomb"},
      {"x": 445.84375, "y": 185.59375, "width": 51.1875, "height": 51.1875, "id": "loop"},
    ], panels: [
      {"x": 18, "y": 123, "width": 118, "height": 18, "id": "health-label"},
      {"x": 18, "y": 147, "width": 118, "height": 3, "id": "health-track"},
      {"x": 18, "y": 158, "width": 118, "height": 11, "id": "instrument"},
      {"x": 18, "y": 178, "width": 118, "height": 33, "id": "wingmen"},
      {"x": 18, "y": 216, "width": 118, "height": 14, "id": "campaign-limit"},
      {"x": 18, "y": 235, "width": 118, "height": 15, "id": "score-readout"},
      {"x": 18, "y": 257, "width": 118, "height": 14, "id": "ammo"},
      {"x": 90, "y": 275, "width": 55, "height": 18.6875, "id": "flight-tip"},
      {"x": 376, "y": 240.78125, "width": 180, "height": 28, "id": "announcement"},
    ],
  }, sight: {"x": 230.8, "y": 106.8, "width": 106.4, "height": 106.4} },
  { name: "fantasia-normal-852x393", measurement: {
    canvas: {"x": 0, "y": 0, "width": 852, "height": 393}, bounds: {"x": 8, "y": 8, "width": 836, "height": 377},
    flightData: null, threat: null,
    obstacles: [
      {"x": 12, "y": 12, "width": 828, "height": 64, "id": "hud-top"},
      {"x": 679, "y": 22, "width": 44, "height": 44, "id": "game-sound"},
      {"x": 727, "y": 22, "width": 44, "height": 44, "id": "pause"},
      {"x": 46, "y": 70, "width": 106.84375, "height": 41.875, "id": "campaign-site"},
      {"x": 154.84375, "y": 70, "width": 106.859375, "height": 41.875, "id": "campaign-site"},
      {"x": 263.703125, "y": 70, "width": 106.859375, "height": 41.875, "id": "campaign-site"},
      {"x": 372.5625, "y": 70, "width": 106.859375, "height": 41.875, "id": "campaign-site"},
      {"x": 481.421875, "y": 70, "width": 106.859375, "height": 41.875, "id": "campaign-site"},
      {"x": 590.28125, "y": 70, "width": 106.859375, "height": 41.875, "id": "campaign-site"},
      {"x": 699.140625, "y": 70, "width": 106.84375, "height": 41.875, "id": "campaign-site"},
      {"x": 306.265625, "y": 333, "width": 52, "height": 52, "id": "bomb"},
      {"x": 675.71875, "y": 227.9375, "width": 62.875, "height": 62.875, "id": "loop"},
      {"x": 675.71875, "y": 298.671875, "width": 62.875, "height": 62.875, "id": "fire"},
      {"x": 113.390625, "y": 298.671875, "width": 62.875, "height": 62.875, "id": "accelerate"},
      {"x": 113.390625, "y": 227.9375, "width": 62.875, "height": 62.875, "id": "brake"},
    ], panels: [
      {"x": 30, "y": 123, "width": 118, "height": 18, "id": "health-label"},
      {"x": 30, "y": 147, "width": 118, "height": 3, "id": "health-track"},
      {"x": 152, "y": 158, "width": 118, "height": 11, "id": "instrument"},
      {"x": 30, "y": 178, "width": 118, "height": 33, "id": "wingmen"},
      {"x": 152, "y": 209.9375, "width": 118, "height": 14, "id": "campaign-limit"},
      {"x": 30, "y": 159, "width": 118, "height": 15, "id": "score-readout"},
      {"x": 30, "y": 365.546875, "width": 118, "height": 14, "id": "ammo"},
      {"x": 180.265625, "y": 298.3125, "width": 55, "height": 18.6875, "id": "flight-tip"},
      {"x": 558.59375, "y": 118, "width": 180, "height": 28, "id": "announcement"},
    ],
  }, sight: {"x": 382.5949999999999, "y": 99.31409105246394, "width": 86.81, "height": 86.81} },
  { name: "fantasia-normal-1440x900", measurement: {
    canvas: {"x": 0, "y": 0, "width": 1440, "height": 900}, bounds: {"x": 8, "y": 8, "width": 1424, "height": 884},
    flightData: null, threat: null,
    obstacles: [
      {"x": 12, "y": 24, "width": 1416, "height": 64, "id": "hud-top"},
      {"x": 1267, "y": 34, "width": 44, "height": 44, "id": "game-sound"},
      {"x": 1315, "y": 34, "width": 44, "height": 44, "id": "pause"},
      {"x": 340, "y": 82, "width": 105.140625, "height": 56.96875, "id": "campaign-site"},
      {"x": 449.140625, "y": 82, "width": 105.140625, "height": 56.96875, "id": "campaign-site"},
      {"x": 558.28125, "y": 82, "width": 105.140625, "height": 56.96875, "id": "campaign-site"},
      {"x": 667.421875, "y": 82, "width": 105.140625, "height": 56.96875, "id": "campaign-site"},
      {"x": 776.5625, "y": 82, "width": 105.140625, "height": 56.96875, "id": "campaign-site"},
      {"x": 885.703125, "y": 82, "width": 105.140625, "height": 56.96875, "id": "campaign-site"},
      {"x": 994.84375, "y": 82, "width": 105.15625, "height": 56.96875, "id": "campaign-site"},
      {"x": 535.59375, "y": 820, "width": 52, "height": 52, "id": "bomb"},
      {"x": 1159.1875, "y": 558, "width": 72, "height": 72, "id": "loop"},
      {"x": 1147.1875, "y": 708, "width": 96, "height": 96, "id": "fire"},
      {"x": 206.796875, "y": 718, "width": 76, "height": 76, "id": "accelerate"},
      {"x": 206.796875, "y": 556, "width": 76, "height": 76, "id": "brake"},
    ], panels: [
      {"x": 30, "y": 150, "width": 118, "height": 18, "id": "health-label"},
      {"x": 30, "y": 174, "width": 118, "height": 3, "id": "health-track"},
      {"x": 30, "y": 185, "width": 118, "height": 11, "id": "instrument"},
      {"x": 30, "y": 205, "width": 118, "height": 33, "id": "wingmen"},
      {"x": 30, "y": 243, "width": 118, "height": 14, "id": "campaign-limit"},
      {"x": 30, "y": 262, "width": 118, "height": 15, "id": "score-readout"},
      {"x": 30, "y": 284, "width": 118, "height": 14, "id": "ammo"},
      {"x": 104, "y": 791.3125, "width": 55, "height": 18.6875, "id": "flight-tip"},
      {"x": 578.4609375, "y": 8, "width": 283.078125, "height": 17, "id": "announcement"},
    ],
  }, sight: {"x": 671.9999999999999, "y": 278.83761309724565, "width": 96, "height": 96} },
];

test('exact first-PR CI rectangles expose fixed header/site and sight conflicts instead of a false placement pass', () => {
  for (const item of capturedCi) {
    const out = layoutCampaignHud(item.measurement, item.sight);
    assert.equal(out.status, 'blocked', item.name);
    assert(out.fixedConflicts!.length > 0, item.name);
  }
});
test('measured header anchoring and planned landscape reflow pack captured full-size HUD and protect the whole sight', () => {
  for (const item of capturedCi) {
    const source = structuredClone(item.measurement), header = source.obstacles.find(rect => rect.id === 'hud-top')!;
    const landscape = source.canvas.width > source.canvas.height && source.canvas.height <= 600;
    const compactPortrait = source.canvas.width <= 360 && source.canvas.height > source.canvas.width;
    if (landscape || compactPortrait) {
      // Reflow prediction: existing 44px utility buttons + two 1px borders. Text is beside counts, never font-scaled.
      header.y = 8; header.height = 46;
      if (compactPortrait) {
        header.x = 12; header.width = source.canvas.width - 24;
        source.panels!.push({ id: 'time-block', x: source.canvas.width - 122, y: 168, width: 110, height: 50 });
      }
      for (const control of source.obstacles.filter(rect => rect.id === 'pause' || rect.id === 'game-sound')) control.y = 9;
    }
    const sites = source.obstacles.filter(rect => rect.id === 'campaign-site');
    const originalTop = Math.min(...sites.map(rect => rect.y));
    if (source.canvas.width <= 360) for (const site of sites) if (site.y > originalTop) site.y -= 4;
    const controls = source.obstacles.filter(rect => !rect.id.includes('campaign-site') && rect.id !== 'hud-top');
    const positions = layoutCampaignSites(source.canvas, source.bounds, header, sites, item.sight, controls);
    sites.forEach((site, index) => Object.assign(site, positions[index]));
    const out = assertCompletePacking(source, item.sight, item.name);
    assert.equal(out.fixedConflicts!.length, 0, item.name);
    assert(out.searchChecks! < 120_000, item.name);
    if (source.canvas.width === 1440) assert(out.searchChecks! < 50_000, 'ordinary desktop placement must not exhaust the search budget');
  }
});
test('site anchoring follows enlarged measured headers and a moving sight cannot reuse conflicting site reservations', () => {
  assert.equal(campaignSiteStripTop({ x: 0, y: 0, width: 1280, height: 800 }, { x: 8, y: 8, width: 1264, height: 784 },
    { x: 12, y: 24, width: 1256, height: 108 }), 134);
  const adapter = new CampaignHudLayout({ measure: () => narrow, observe: () => () => {}, applyThreat: () => {}, applyPanels: () => {} });
  assert.equal(adapter.update(sight)!.status, 'placed');
  const conflict = adapter.update({ x: 12, y: 56, width: 5, height: 5 })!;
  assert.equal(conflict.status, 'blocked');
  assert(conflict.fixedConflicts!.some(pair => pair.second === 'aim-and-reload-ring'));
  adapter.dispose();
});


test('Normal568 measured DOM cards reflow around the production projected sight and unchanged center reserve', () => {
  // This CI snapshot preceded its first HUD measurement. DOM sizes are captured;
  // the missing sight is explicitly source-derived, not claimed as live evidence.
  const source: HudMeasurement = {
  "canvas": {
    "x": 0,
    "y": 0,
    "width": 568,
    "height": 320
  },
  "bounds": {
    "x": 8,
    "y": 8,
    "width": 552,
    "height": 304
  },
  "flightData": null,
  "threat": null,
  "obstacles": [
    {
      "id": "hud-top",
      "x": 12,
      "y": 12,
      "width": 544,
      "height": 64
    },
    {
      "id": "game-sound",
      "x": 395,
      "y": 22,
      "width": 44,
      "height": 44
    },
    {
      "id": "pause",
      "x": 443,
      "y": 22,
      "width": 44,
      "height": 44
    },
    {
      "id": "campaign-site",
      "x": 12,
      "y": 70,
      "width": 76,
      "height": 41.875
    },
    {
      "id": "campaign-site",
      "x": 90,
      "y": 70,
      "width": 76,
      "height": 41.875
    },
    {
      "id": "campaign-site",
      "x": 168,
      "y": 70,
      "width": 76,
      "height": 41.875
    },
    {
      "id": "campaign-site",
      "x": 246,
      "y": 70,
      "width": 76,
      "height": 41.875
    },
    {
      "id": "campaign-site",
      "x": 324,
      "y": 70,
      "width": 76,
      "height": 41.875
    },
    {
      "id": "campaign-site",
      "x": 402,
      "y": 70,
      "width": 76,
      "height": 41.875
    },
    {
      "id": "campaign-site",
      "x": 480,
      "y": 70,
      "width": 76,
      "height": 41.875
    },
    {
      "id": "bomb",
      "x": 195.921875,
      "y": 260.796875,
      "width": 51.1875,
      "height": 51.1875
    },
    {
      "id": "loop",
      "x": 445.84375,
      "y": 185.59375,
      "width": 51.1875,
      "height": 51.1875
    },
    {
      "id": "fire",
      "x": 445.84375,
      "y": 243.203125,
      "width": 51.1875,
      "height": 51.1875
    },
    {
      "id": "accelerate",
      "x": 70.953125,
      "y": 243.203125,
      "width": 51.1875,
      "height": 51.1875
    },
    {
      "id": "brake",
      "x": 70.953125,
      "y": 185.59375,
      "width": 51.1875,
      "height": 51.1875
    }
  ],
  "panels": [
    {
      "id": "health-label",
      "x": 18,
      "y": 123,
      "width": 118,
      "height": 18
    },
    {
      "id": "health-track",
      "x": 18,
      "y": 147,
      "width": 118,
      "height": 3
    },
    {
      "id": "instrument",
      "x": 18,
      "y": 158,
      "width": 118,
      "height": 11
    },
    {
      "id": "wingmen",
      "x": 18,
      "y": 178,
      "width": 118,
      "height": 33
    },
    {
      "id": "campaign-limit",
      "x": 18,
      "y": 216,
      "width": 118,
      "height": 14
    },
    {
      "id": "score-readout",
      "x": 18,
      "y": 235,
      "width": 118,
      "height": 15
    },
    {
      "id": "ammo",
      "x": 18,
      "y": 257,
      "width": 118,
      "height": 14
    },
    {
      "id": "flight-tip",
      "x": 165,
      "y": 225.3125,
      "width": 55,
      "height": 18.6875
    },
    {
      "id": "announcement",
      "x": 376,
      "y": 118,
      "width": 180,
      "height": 28
    }
  ]
};
  const projected = projectGunSight(createGame(20261005, 'normal').player, [], 568, 320);
  const radius = aimRadius('normal', 568, 320) + 10;
  const aim = { x: projected.x - radius, y: projected.y - radius, width: radius * 2, height: radius * 2 };
  const header = source.obstacles.find(item => item.id === 'hud-top')!;
  header.y = 8; header.height = 46; // Planned unchanged 44px controls and 1px borders.
  for (const control of source.obstacles.filter(item => item.id === 'pause' || item.id === 'game-sound')) control.y = 9;
  const sites = source.obstacles.filter(item => item.id === 'campaign-site');
  const controls = source.obstacles.filter(item => item.id !== 'campaign-site' && item.id !== 'hud-top');
  const positions = layoutCampaignSites(source.canvas, source.bounds, header, sites, aim, controls);
  sites.forEach((site, index) => Object.assign(site, positions[index]));
  const out = assertCompletePacking(source, aim, 'Normal568 source-derived sight');
  assert.equal(out.fixedConflicts!.length, 0);
});

test('canvas bomb labels retain full size while avoiding radar, fixed controls, both sight lanes and DOM readouts', () => {
  // Label boxes below are pixel-estimated regression inputs. Radar/control boxes
  // are exact run37395455425 JSON; the browser gate checks future drawn boxes.
  for (const fixture of [
    { canvas: { x: 0, y: 0, width: 568, height: 320 }, preferred: { x: 318, y: 162, width: 120, height: 20 },
      radar: { x: 341.84375, y: 101.875, width: 100, height: 116 },
      control: { id: 'loop', x: 445.84375, y: 185.59375, width: 51.1875, height: 51.1875 } },
    { canvas: { x: 0, y: 0, width: 393, height: 852 }, preferred: { x: 228, y: 583, width: 120, height: 20 },
      radar: { x: 276, y: 203.9375, width: 100, height: 116 },
      control: { id: 'loop', x: 290.1875, y: 526.3125, width: 72, height: 72 } },
  ]) {
    const { canvas, preferred, radar, control } = fixture;
    const layout = { status: 'placed' as const, canvas, bounds: { x: 8, y: 8, width: canvas.width - 16, height: canvas.height - 16 },
      radar: { status: 'placed' as const, rect: radar, radius: 49, center: { x: radar.x + 50, y: radar.y + 50 } }, threat: null,
      obstacles: [control, { id: 'aim-and-reload-ring', x: canvas.width / 2 - 54, y: canvas.height / 2 - 54, width: 108, height: 108 },
        { id: 'central-flight-lane', x: canvas.width / 2 - 42, y: canvas.height / 2 - 42, width: 84, height: 84 }],
      panels: [{ id: 'ammo', status: 'placed' as const, rect: { x: 18, y: 120, width: 118, height: 14 } }] };
    assert(intersects(preferred, radar) || intersects(preferred, control), 'fixture exposes the old canvas overlap');
    const before = JSON.stringify(layout), out = layoutCampaignCanvasLabel(layout, preferred);
    assert.equal(out.status, 'placed'); assert.equal(out.rect.width, 120); assert.equal(out.rect.height, 20);
    for (const obstacle of [radar, ...layout.obstacles, ...layout.panels.map(panel => panel.rect)]) assert(!intersects(out.rect, obstacle, 4));
    assert.equal(JSON.stringify(layout), before);
  }
});
test('blocked canvas labels remain full-size and explicit, including absence of a ready HUD layout', () => {
  const preferred = { x: 280, y: 540, width: 120, height: 20 };
  const layout = layoutCampaignHud({ ...narrow, obstacles: [{ ...bounds, id: 'custom-obstruction' }] }, sight);
  const out = layoutCampaignCanvasLabel(layout, preferred);
  assert.equal(out.status, 'blocked'); assert.equal(out.rect.width, 120); assert.equal(out.rect.height, 20);
  assert.equal(out.rect.x + out.rect.width, bounds.x + bounds.width);
  assert.deepEqual(layoutCampaignCanvasLabel(null, preferred), { status: 'blocked', rect: preferred });
  assert.equal(layoutCampaignCanvasLabel({ ...layout, obstacles: [{ ...bounds, x: NaN, id: 'invalid-control' }] }, preferred).status, 'invalid');
  assert.equal(layoutCampaignCanvasLabel({ ...layout, bounds: { ...bounds, width: Infinity } }, preferred).status, 'invalid');
});

test('compact packing reserves the complete detail viewport and preserves movable control dimensions', () => {
  const source: HudMeasurement = {
    canvas: { x: 0, y: 0, width: 800, height: 600 }, bounds: { x: 8, y: 8, width: 784, height: 584 },
    obstacles: [], flightData: null, threat: null,
    panels: [{ id: 'campaign-hud-details', x: 8, y: 150, width: 114, height: 96 },
      { id: 'campaign-mode-status', x: 8, y: 120, width: 70, height: 18 }],
    movableControls: [{ id: 'fire', x: 8, y: 450, width: 88, height: 88 },
      { id: 'pause', x: 100, y: 450, width: 44, height: 44 }],
  };
  const out = layoutCampaignHud(source, { x: 350, y: 250, width: 100, height: 100 });
  assert.equal(out.status, 'placed'); assert.equal(out.compact, true);
  const rectangles = [out.radar.rect, ...out.panels!.map(item => item.rect), ...out.controls!.map(item => item.rect)];
  for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) assert(!intersects(rectangles[i], rectangles[j], 4));
  for (const item of source.movableControls!) {
    const actual = out.controls!.find(control => control.id === item.id)!;
    assert.equal(actual.rect.width, item.width); assert.equal(actual.rect.height, item.height);
    assert(out.obstacles.some(obstacle => obstacle.id === item.id && obstacle.x === actual.rect.x));
  }
  assert.equal(out.panels!.find(item => item.id === 'campaign-hud-details')!.rect.height, 96);
});

test('compact no-fit retains every viewport and control instead of shrinking or dropping content', () => {
  const out = layoutCampaignHud({ canvas: { x: 0, y: 0, width: 320, height: 568 }, bounds,
    obstacles: [], flightData: null, threat: null,
    panels: [{ id: 'campaign-hud-details', x: 8, y: 8, width: 310, height: 96 }],
    movableControls: [{ id: 'pause', x: 8, y: 450, width: 44, height: 44 }],
  }, sight);
  assert.equal(out.status, 'blocked'); assert.equal(out.panels![0].rect.width, 310);
  assert.equal(out.controls![0].rect.width, 44); assert(out.searchChecks! <= 120_000);
});

test('moving sight rechecks movable controls instead of accepting the stale cached location', () => {
  const source: HudMeasurement = { canvas: { x: 0, y: 0, width: 800, height: 600 }, bounds: { x: 8, y: 8, width: 784, height: 584 },
    obstacles: [], flightData: null, threat: null, panels: [],
    movableControls: [{ id: 'fire', x: 30, y: 450, width: 88, height: 88 }] };
  const adapter = new CampaignHudLayout({ measure: () => source, observe: () => () => {}, applyThreat() {}, applyPanels() {} });
  const first = adapter.update({ x: 350, y: 250, width: 100, height: 100 })!;
  const oldControl = first.controls![0].rect;
  const next = adapter.update({ ...oldControl })!;
  assert.equal(next.status, 'placed'); assert(!intersects(next.controls![0].rect, oldControl, 4));
  adapter.dispose();
});
