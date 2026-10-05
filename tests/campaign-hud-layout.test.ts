import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignHudLayout, intersects, layoutCampaignHud, placeRectangle, toCanvasRect, type HudMeasurement, type HudRect } from '../src/campaign-hud-layout';

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
