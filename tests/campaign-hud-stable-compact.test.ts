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
