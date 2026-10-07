import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CampaignHudLayout, layoutCampaignCanvasLabel, intersects, type HudLayout, type HudMeasurement, type HudRect } from '../src/campaign-hud-layout';

// Native CI's actual output rectangles are reused as preferences, exactly as
// the fallback does in production. This is pure geometry replay, not a new
// browser pass or an estimate of original CSS positions.
const capture: { layout: HudLayout; measurement: HudMeasurement; sight: HudRect; label: { id: string; rect: HudRect } } = JSON.parse(
  readFileSync(new URL('./fixtures/campaign-label-ci-37568986417.json', import.meta.url), 'utf8'));

test('captured 320px 200% Normal warning needs joint packing after every fixed instrument already fits', () => {
  assert.equal(layoutCampaignCanvasLabel(capture.layout, capture.label.rect).status, 'blocked');
  const before = JSON.stringify(capture);
  let applied: NonNullable<HudLayout['panels']> = [];
  const adapter = new CampaignHudLayout({ measure: () => capture.measurement, observe: () => () => {}, applyThreat() {},
    applyPanels(panels) { applied = panels; } });
  assert.equal(adapter.update(capture.sight)!.status, 'placed');
  const label = adapter.placeCanvasLabel(capture.label.id, capture.label.rect);
  assert.equal(label.status, 'placed');
  const after = adapter.diagnostics();
  assert.equal(after.status, 'placed'); assert(after.searchChecks! < 120_000);
  assert.equal(label.rect.width, capture.label.rect.width); assert.equal(label.rect.height, capture.label.rect.height);
  assert.equal(after.radar!.radius, 42);
  const boxes = [after.radar!.rect, ...applied.map(item => item.rect), label.rect];
  for (const [i, box] of boxes.entries()) {
    assert(box.x >= capture.measurement.bounds.x && box.y >= capture.measurement.bounds.y);
    assert(box.x + box.width <= 312 && box.y + box.height <= 560);
    for (const other of boxes.slice(i + 1)) assert(!intersects(box, other, 4));
    for (const other of [...capture.measurement.obstacles, capture.sight]) assert(!intersects(box, other, 4));
  }
  for (const original of [...capture.measurement.panels!, ...capture.measurement.movableControls!]) {
    const actual = applied.find(item => item.id === original.id)!.rect;
    assert.equal(actual.width, original.width); assert.equal(actual.height, original.height);
  }
  assert.equal(applied.length, 15); // Eight full instruments/detail viewport, seven controls.
  const appliedOnce = applied;
  assert.equal(adapter.placeCanvasLabel(capture.label.id, capture.label.rect).status, 'placed');
  assert.equal(applied, appliedOnce, 'a stable fit does not repeatedly rewrite the DOM');
  assert.equal(JSON.stringify(capture), before, 'captured evidence stays untouched');
  adapter.dispose();
});

test('canvas warning reservation participates in the moving-sight cache check', () => {
  let applies = 0;
  const measurement: HudMeasurement = { canvas: { x: 0, y: 0, width: 800, height: 600 },
    bounds: { x: 8, y: 8, width: 784, height: 584 }, panels: [], obstacles: [], flightData: null, threat: null };
  const adapter = new CampaignHudLayout({ measure: () => measurement, observe: () => () => {}, applyThreat() {}, applyPanels() { applies++; } });
  adapter.update({ x: 350, y: 250, width: 90, height: 90 });
  const label = adapter.placeCanvasLabel('bomb-guide', { x: 20, y: 400, width: 120, height: 20 });
  assert.equal(label.status, 'placed');
  const count = applies;
  adapter.update(label.rect);
  assert(applies > count, 'moving sight into a canvas warning cannot retain the cached packing');
  const moved = adapter.placeCanvasLabel('bomb-guide', label.rect);
  assert.equal(moved.status, 'placed'); assert(!intersects(moved.rect, label.rect, 4));
  adapter.dispose();
});

test('joint no-fit is explicit and does not apply a partial packing or reduce the warning', () => {
  let applies = 0;
  const source = structuredClone(capture.measurement);
  const adapter = new CampaignHudLayout({ measure: () => source, observe: () => () => {}, applyThreat() {}, applyPanels() { applies++; } });
  adapter.update(capture.sight);
  const before = JSON.stringify(adapter.diagnostics()), count = applies;
  const impossible = { x: 8, y: 150, width: 305, height: 20 };
  const label = adapter.placeCanvasLabel('bomb-guide', impossible);
  assert.equal(label.status, 'blocked'); assert.equal(label.rect.width, 305); assert.equal(label.rect.height, 20);
  assert.equal(applies, count); assert.equal(JSON.stringify(adapter.diagnostics()), before);
  adapter.dispose();
});
