import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignHudLayout, createCampaignHudLayout, intersects, layoutCampaignHud, placeRectangle, toCanvasRect, type HudMeasurement, type HudRect } from '../src/campaign-hud-layout';
import { DEFAULT_LAYOUT, controlBounds, controlDisplaySize } from '../src/control-settings';

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
    const size = controlDisplaySize(entry.size, width, height);
    const bounds = controlBounds(size, width, height, { top: 0, right: 0, bottom: 0, left: 0 });
    const x = Math.max(bounds.minX, Math.min(bounds.maxX, entry.x)) * width;
    const y = Math.max(bounds.minY, Math.min(bounds.maxY, entry.y)) * height;
    return { id, x: x - size / 2, y: y - size / 2, width: size, height: size };
  });
}
const narrowPanels = [
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
const narrow: HudMeasurement = { ...measurement, obstacles: [...cards320, ...defaultControls(320, 568),
  { id: 'header', x: 98, y: 8, width: 210, height: 98 }], panels: narrowPanels };
function assertCompletePacking(source: HudMeasurement, aim: HudRect) {
  const before = JSON.stringify(source), out = layoutCampaignHud(source, aim);
  assert.equal(out.status, 'placed');
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
test('320 Normal reflow packs all readouts with exact unchanged default-control geometry', () => {
  const controls = defaultControls(320, 568);
  assert.deepEqual(controls.map(item => item.width), [96, 72, 76, 76, 52]);
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
    return { id, className: id, style, hidden: false, textContent: 'notice', box,
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
  announcement.style.setProperty('color', 'plum');
  announcement.style.setProperty('--campaign-hud-x', '5px'); announcement.style.setProperty('--campaign-hud-y', '6px');
  const probe = makeNode('probe', { x: 0, y: 0, width: 0, height: 0 });
  const app = { ...makeNode('app', { x: 40, y: 60, width: 800, height: 600 }), append() {},
    querySelectorAll(selector: string) { return selector.includes('.flight-data > *') ? [announcement, instrument] : []; }, querySelector() { return null; } };
  const win = { getComputedStyle() { return { visibility: 'visible', display: 'block', paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0' }; },
    addEventListener(name: string) { listeners.add(name); }, removeEventListener(name: string) { listeners.delete(name); } };
  const doc = { defaultView: win, documentElement: makeNode('html', app.box), body: makeNode('body', app.box), createElement() { return probe; },
    fonts: { addEventListener(name: string) { listeners.add(name); }, removeEventListener(name: string) { listeners.delete(name); } } };
  const canvas = { ...makeNode('flight', app.box), ownerDocument: doc, closest() { return app; }, parentElement: app };
  globalThis.ResizeObserver = class { observe() {} disconnect() { resizeDisconnected++; } } as unknown as typeof ResizeObserver;
  globalThis.MutationObserver = class { observe() {} disconnect() { mutationDisconnected++; } takeRecords() { return records.splice(0); } } as unknown as typeof MutationObserver;
  try {
    const adapter = createCampaignHudLayout(canvas as unknown as HTMLCanvasElement);
    const aim = { x: 350, y: 250, width: 100, height: 100 };
    adapter.update(aim); assert.equal(adapter.diagnostics().measurements, 1);
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
    assert.equal(resizeDisconnected, 1); assert.equal(mutationDisconnected, 1); assert.equal(removed, 1); assert.equal(listeners.size, 0);
  } finally { globalThis.ResizeObserver = previousResize; globalThis.MutationObserver = previousMutation; }
});
