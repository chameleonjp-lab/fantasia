import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

type Timings = { name: string; setupMs: number; tourMs: number; captureMs: number };
type HudCase = { name: string; width: number; height: number; mode: 'easy' | 'normal'; alert: 'outside' | 'protected' | 'low' | 'clear' | 'respawn'; priority: 0 | 4 };
type HudProvenance = 'fresh-page' | 'rotation-stress';
type HudFailureRecord = { case: string; provenance: HudProvenance | 'aggregate'; stage: string; message: string; stack?: string };
type HudCaseCoverage = { case: string; attempted: boolean; evidenceCompleted: boolean; imageSaved: boolean; jsonSaved: boolean; exceptionMessage?: string; notRunReason?: string };
type TypographySample = { key: string; selector: string; basePx: number; inlineValue?: string; inlinePriority?: string; inlineBefore?: string; text: string; parent?: string; appliedPx?: number };
const timings: Timings[] = [];

const HUD_CASES: HudCase[] = [
  { name: 'hud-easy-outside-small-portrait-text-200-priority-0.png', width: 320, height: 568, mode: 'easy', alert: 'outside', priority: 0 },
  { name: 'hud-easy-outside-small-portrait-text-200-priority-4.png', width: 320, height: 568, mode: 'easy', alert: 'outside', priority: 4 },
  { name: 'hud-normal-protected-small-landscape-text-200-priority-0.png', width: 568, height: 320, mode: 'normal', alert: 'protected', priority: 0 },
  { name: 'hud-normal-protected-small-landscape-text-200-priority-4.png', width: 568, height: 320, mode: 'normal', alert: 'protected', priority: 4 },
  { name: 'hud-normal-low-warning-small-landscape-text-200-priority-4.png', width: 568, height: 320, mode: 'normal', alert: 'low', priority: 4 },
  { name: 'hud-easy-clear-small-landscape-text-200-priority-0.png', width: 568, height: 320, mode: 'easy', alert: 'clear', priority: 0 },
  { name: 'hud-easy-clear-small-landscape-text-200-priority-4.png', width: 568, height: 320, mode: 'easy', alert: 'clear', priority: 4 },
  { name: 'hud-easy-warning-small-landscape-text-200-priority-4.png', width: 568, height: 320, mode: 'easy', alert: 'low', priority: 4 },
  { name: 'hud-normal-respawn-small-portrait-text-200-priority-0.png', width: 320, height: 568, mode: 'normal', alert: 'respawn', priority: 0 },
  { name: 'hud-normal-respawn-small-portrait-text-200-priority-4.png', width: 320, height: 568, mode: 'normal', alert: 'respawn', priority: 4 },
];

const TYPOGRAPHY_SELECTORS = [
  '#hud', '#announcement', '#hud-mode', '.campaign-site[data-site]', '.campaign-site-number', '.campaign-site-owner',
  '.campaign-site-state', '.campaign-site-force', '.campaign-site-wave', '.target-tally', '.target-tally > span',
  '.target-tally > b', '.target-tally > small', '.time-block', '.health-label', '#health', '.health-track',
  '.instrument', '#altitude', '#speed', '.wingmen', '#allies-count', '#reserves-count', '.campaign-limit',
  '#remaining-time', '.score-readout', '#score', '.ammo', '#mg-ammo', '#cannon-ammo', '#campaign-threat',
  '#warning', '#reload-status', '#respawn-status', '#flight-tip', '#loop-status', '#bomb-hint', '#fire', '#throttle',
];

const SECONDARY_HUD_READOUTS = [
  { key: 'campaign-threat', selector: '#campaign-threat', detailKey: 'campaign-threat' },
  { key: 'reload-status', selector: '#reload-status', detailKey: 'reload-status' },
  { key: 'campaign-limit', selector: '.campaign-limit', detailKey: 'campaign-limit' },
  { key: 'ammo', selector: '.ammo', detailKey: 'ammo' },
] as const;

async function captureSecondaryHudOriginals(page: Page) {
  const originalNodes = await page.evaluateHandle(readouts => Object.fromEntries(
    readouts.map(readout => [readout.key, document.querySelector<HTMLElement>(readout.selector)])), SECONDARY_HUD_READOUTS);
  const originalText = await page.evaluate(readouts => Object.fromEntries(
    readouts.map(readout => [readout.key, document.querySelector<HTMLElement>(readout.selector)?.textContent ?? null])), SECONDARY_HUD_READOUTS);
  return { originalNodes, originalText };
}

async function setup(page: Page): Promise<number> {
  const start = performance.now();
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(`pageerror: ${error.stack ?? error.message}`));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => browserErrors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  await page.goto('/__ui-only');
  try {
    await page.waitForFunction(() => {
      const win = window as any;
      const read = Object.getOwnPropertyDescriptor(window, '__fantasiaReadState');
      const start = document.getElementById('start') as HTMLButtonElement | null;
      return typeof win.__fantasiaUiOnlyTest?.hud === 'function' && typeof read?.value === 'function' && read.writable === false && start !== null && !start.disabled;
    }, undefined, { timeout: 5000 });
  } catch (error) {
    const state = await page.evaluate(() => {
      const win = window as any;
      const read = Object.getOwnPropertyDescriptor(window, '__fantasiaReadState');
      const start = document.getElementById('start') as HTMLButtonElement | null;
      let snapshot: unknown = null;
      try { snapshot = typeof read?.value === 'function' ? read.value(false) : null; } catch (snapshotError) { snapshot = String(snapshotError); }
      return {
        url: location.href,
        title: document.title,
        uiOnlyTest: typeof win.__fantasiaUiOnlyTest?.hud === 'function',
        readOnlyState: typeof read?.value === 'function' && read.writable === false,
        start: start ? { disabled: start.disabled, text: start.textContent } : null,
        startupError: document.getElementById('startup-error')?.textContent,
        body: document.body.innerText.slice(0, 1200),
        snapshot: snapshot && typeof snapshot === 'object' ? {
          phase: snapshot.phase, screen: snapshot.screen, graphicsReady: snapshot.graphicsReady,
          renderStatus: snapshot.renderStatus, status: snapshot.status, mode: snapshot.mode,
          render: snapshot.render ? { queue: snapshot.render.queue, drawCalls: snapshot.render.drawCalls,
            width: snapshot.render.width, height: snapshot.render.height } : null,
        } : snapshot,
      };
    });
    throw new Error(`UI-only setup timed out: ${JSON.stringify({ state, browserErrors, cause: String(error) })}`);
  }
  return performance.now() - start;
}

async function setViewportAndWait(page: Page, width: number, height: number) {
  const current = page.viewportSize();
  if (current?.width !== width || current.height !== height) {
    await page.setViewportSize({ width, height });
  }
  await page.evaluate(({ expectedWidth, expectedHeight }) => new Promise<void>((resolve, reject) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (innerWidth !== expectedWidth || innerHeight !== expectedHeight)
        reject(new Error(`viewport resize did not settle: expected ${expectedWidth}x${expectedHeight}, got ${innerWidth}x${innerHeight}`));
      else resolve();
    }));
  }), { expectedWidth: width, expectedHeight: height });
}

async function act(page: Page, method: string, ...args: unknown[]) {
  return page.evaluate(async ({ method, args }) => await (window as any).__fantasiaUiOnlyTest[method](...args), { method, args });
}

async function typographySnapshot(page: Page) {
  return page.evaluate(selectors => {
    const samples = selectors.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)]
      .filter(node => !(selector === '.target-tally > small' && node.textContent?.trim() === '現在機を含む'))
      .map((node, index) => {
      const style = getComputedStyle(node), site = node.closest<HTMLElement>('[data-site]')?.dataset.site
        ?? node.closest<HTMLElement>('[data-site-detail]')?.dataset.siteDetail;
      const owner = node.id ? `#${node.id}` : site ? `site-${site}.${[...node.classList].join('.') || node.tagName.toLowerCase()}`
        : `match-${index}.${[...node.classList].join('.') || node.tagName.toLowerCase()}`;
      let parent = node.parentElement, parentPath = '';
      while (parent && parentPath.split(' > ').length < 5) {
        const name = parent.id ? `#${parent.id}` : parent.dataset.site ? `.campaign-site[data-site="${parent.dataset.site}"]`
          : parent.dataset.campaignDetail ? `[data-campaign-detail="${parent.dataset.campaignDetail}"]`
            : parent.classList[0] ? `.${parent.classList[0]}` : parent.tagName.toLowerCase();
        parentPath = parentPath ? `${name} > ${parentPath}` : name;
        parent = parent.parentElement;
      }
      return {
        key: `${selector}::${owner}`, selector, basePx: parseFloat(style.fontSize) || 16,
        inlineValue: node.style.getPropertyValue('font-size'), inlinePriority: node.style.getPropertyPriority('font-size'),
        text: node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) ?? '', parent: parentPath,
      };
    }));
    const parentPathFor = (node: HTMLElement) => {
      let parent = node.parentElement, parentPath = '';
      while (parent && parentPath.split(' > ').length < 5) {
        const name = parent.id ? `#${parent.id}` : parent.dataset.site ? `.campaign-site[data-site="${parent.dataset.site}"]`
          : parent.dataset.campaignDetail ? `[data-campaign-detail="${parent.dataset.campaignDetail}"]`
            : parent.classList[0] ? `.${parent.classList[0]}` : parent.tagName.toLowerCase();
        parentPath = parentPath ? `${name} > ${parentPath}` : name;
        parent = parent.parentElement;
      }
      return parentPath;
    };
    const liveNotes = [...document.querySelectorAll<HTMLElement>('#app small')]
      .filter(node => node.textContent?.trim() === '現在機を含む');
    const semanticSamples = liveNotes.map(node => {
      const style = getComputedStyle(node);
      return { key: 'semantic::target-lives-note', selector: 'semantic::target-lives-note', basePx: parseFloat(style.fontSize) || 16,
        inlineValue: node.style.getPropertyValue('font-size'), inlinePriority: node.style.getPropertyPriority('font-size'),
        text: node.textContent?.trim() ?? '', parent: parentPathFor(node) };
    });
    samples.push(...semanticSamples);
    const semanticNodes = { targetLivesNote: { count: liveNotes.length, nodes: liveNotes.map(node => ({
      text: node.textContent?.trim() ?? '', parent: parentPathFor(node), connected: node.isConnected,
      inTargetTally: Boolean(node.closest('.target-tally')),
      inSecondaryDetails: Boolean(node.closest('#campaign-hud-details')),
      campaignDetail: node.dataset.campaignDetail ?? null,
    })) } };
    return { viewport: { width: innerWidth, height: innerHeight }, samples, semanticNodes };
  }, TYPOGRAPHY_SELECTORS);
}

async function semanticTypographyIdentity(page: Page, originalNode: any) {
  return page.evaluate(original => {
    const parentPathFor = (node: HTMLElement) => {
      let parent = node.parentElement, path = '';
      while (parent && path.split(' > ').length < 5) {
        const name = parent.id ? `#${parent.id}` : parent.dataset.site ? `.campaign-site[data-site="${parent.dataset.site}"]`
          : parent.dataset.campaignDetail ? `[data-campaign-detail="${parent.dataset.campaignDetail}"]`
            : parent.classList[0] ? `.${parent.classList[0]}` : parent.tagName.toLowerCase();
        path = path ? `${name} > ${path}` : name;
        parent = parent.parentElement;
      }
      return path;
    };
    const nodes = [...document.querySelectorAll<HTMLElement>('#app small')]
      .filter(node => node.textContent?.trim() === '現在機を含む');
    const originalElement = original instanceof HTMLElement ? original : null;
    return { count: nodes.length, sameOriginalNodeFound: Boolean(originalElement && nodes.includes(originalElement)),
      sameOriginalNodeConnected: Boolean(originalElement?.isConnected), nodes: nodes.map(node => ({ text: node.textContent?.trim() ?? '', parent: parentPathFor(node),
      connected: node.isConnected, inTargetTally: Boolean(node.closest('.target-tally')),
      inSecondaryDetails: Boolean(node.closest('#campaign-hud-details')), campaignDetail: node.dataset.campaignDetail ?? null,
      fontSize: parseFloat(getComputedStyle(node).fontSize) || 16,
      inlineValue: node.style.getPropertyValue('font-size'), inlinePriority: node.style.getPropertyPriority('font-size') })) };
  }, originalNode);
}

function compareTypography(expected: { samples: TypographySample[] }, actual: { samples: TypographySample[] }) {
  const baseline = new Map(expected.samples.map(sample => [sample.key, sample]));
  return actual.samples.map(sample => {
    const reference = baseline.get(sample.key);
    const appliedPx = (sample as TypographySample & { appliedPx?: number }).appliedPx;
    return {
      key: sample.key, selector: sample.selector, text: sample.text,
      expectedBasePx: reference?.basePx ?? null, actualBasePx: sample.basePx,
      freshInlineValue: reference?.inlineValue ?? null, actualInlineValue: sample.inlineValue ?? sample.inlineBefore ?? '',
      actualInlineBeforeOverride: sample.inlineBefore ?? '', actualInlinePriorityBeforeOverride: sample.inlinePriorityBefore ?? '',
      appliedInlineValue: sample.appliedInlineValue ?? null, appliedInlinePriority: sample.appliedInlinePriority ?? null,
      matchesFreshBaseline: Boolean(reference && Math.abs(sample.basePx - reference.basePx) < 0.1),
      expectedAppliedPx: reference ? reference.basePx * 2 : null, actualAppliedPx: appliedPx ?? null,
      matchesExpected200: appliedPx === undefined || Boolean(reference && Math.abs(appliedPx - reference.basePx * 2) < 0.1),
      referenceParent: reference?.parent ?? null, actualParent: sample.parent ?? null,
    };
  });
}

type AreaRect = { id?: string; x: number; y: number; width: number; height: number };

function clippedArea(rect: AreaRect, bounds: AreaRect) {
  const left = Math.max(rect.x, bounds.x), top = Math.max(rect.y, bounds.y);
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width), bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  return right > left && bottom > top ? { left, right, top, bottom } : null;
}

/** Exact rectangle-union area, so overlapping fixed reservations are counted once. */
function rectangleUnionArea(rectangles: AreaRect[], bounds: AreaRect, gap = 0) {
  const clipped = rectangles.flatMap(rect => {
    const expanded = { x: rect.x - gap, y: rect.y - gap, width: rect.width + gap * 2, height: rect.height + gap * 2 };
    const value = clippedArea(expanded, bounds);
    return value ? [value] : [];
  });
  const xs = [...new Set(clipped.flatMap(rect => [rect.left, rect.right]))].sort((a, b) => a - b);
  let total = 0;
  for (let index = 0; index + 1 < xs.length; index++) {
    const left = xs[index], right = xs[index + 1];
    if (right <= left) continue;
    const intervals = clipped.filter(rect => rect.left < right && rect.right > left)
      .map(rect => [rect.top, rect.bottom] as const).sort((a, b) => a[0] - b[0]);
    let covered = 0, start = Number.NaN, end = Number.NaN;
    for (const [top, bottom] of intervals) {
      if (Number.isNaN(start)) { start = top; end = bottom; }
      else if (top <= end) end = Math.max(end, bottom);
      else { covered += end - start; start = top; end = bottom; }
    }
    if (!Number.isNaN(start)) covered += end - start;
    total += (right - left) * covered;
  }
  return total;
}

function campaignHudAreaEvidence(searchInput: any, sight: any, layout: any, mode: 'easy' | 'normal'): any {
  const bounds = searchInput?.bounds, canvas = searchInput?.canvas;
  const layoutObstacles = layout?.obstacles;
  const movableControls = Array.isArray(searchInput?.movableControls) ? searchInput.movableControls : [];
  const ringCandidates = Array.isArray(layoutObstacles) ? layoutObstacles.filter((rect: any) => rect.id === 'aim-and-reload-ring') : [];
  const measuredRing = ringCandidates.length === 1 ? ringCandidates[0] : null;
  const movableControlIds = movableControls.map((rect: any) => rect.id);
  const movableControlIdSet = new Set(movableControlIds);
  const duplicateMovableControlIds = movableControlIds.filter((id: string, index: number) => movableControlIds.indexOf(id) !== index);
  const movableControlPlacements = Array.isArray(layoutObstacles) ? movableControlIds.map((id: string) => ({
    id, matches: layoutObstacles.filter((rect: any) => rect.id === id).length,
  })) : [];
  const unplacedMovableControls = movableControlPlacements.filter((item: { matches: number }) => item.matches !== 1);
  const inputEvidence = { bounds, canvas, sight, mode, searchObstacles: searchInput?.obstacles,
    panels: searchInput?.panels, movableControls: searchInput?.movableControls, canvasLabels: searchInput?.canvasLabels,
    radarRect: layout?.radar?.rect, layoutObstacles, ringCandidates, movableControlIds,
    movableControlPlacements, unplacedMovableControls, duplicateMovableControlIds };
  if (!bounds || !canvas || !sight || !layout?.radar?.rect || !Array.isArray(searchInput.obstacles)
    || !Array.isArray(searchInput.panels) || (searchInput.movableControls !== undefined && !Array.isArray(searchInput.movableControls))
    || !Array.isArray(layoutObstacles) || ringCandidates.length !== 1 || duplicateMovableControlIds.length > 0
    || unplacedMovableControls.length > 0 || movableControlIdSet.has('aim-and-reload-ring')) {
    return { status: 'invalid', reason: 'incomplete measured search input or product aim-and-reload-ring rectangle', inputEvidence };
  }
  const sightRadius = mode === 'normal' ? Math.max(26, Math.min(38, Math.min(canvas.width, canvas.height) * .085))
    : Math.min(canvas.width, canvas.height) * .135;
  const sightExtent = sightRadius + 10;
  const inferredRing = { id: 'aim-and-reload-ring-inferred', x: sight.x - sightExtent, y: sight.y - sightExtent,
    width: sightExtent * 2, height: sightExtent * 2 };
  const inferenceComparison = {
    source: 'test-only radius derivation compared with the product measured layout.obstacles rectangle',
    matches: ['x', 'y', 'width', 'height'].every(key => Math.abs(measuredRing[key] - inferredRing[key]) < 0.01),
    toleranceCssPx: 0.01, measuredProductRect: measuredRing, inferredRect: inferredRing,
  };
  const radar = { ...layout.radar.rect, id: 'radar' };
  const items = [...searchInput.panels, ...(searchInput.movableControls ?? []), ...(searchInput.canvasLabels ?? []), radar];
  // The product layout is authoritative: it includes the exact measured site/control,
  // central-lane and aim/reload reservations used by the placement algorithm.
  // layout.obstacles also reports the already-placed compact controls. They are
  // packing items, not fixed blockers; subtracting them here would count them twice.
  const fixed = layoutObstacles.filter((rect: any) => !movableControlIdSet.has(rect.id));
  if (![...items, ...fixed, bounds].every(rect => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0)) {
    return { status: 'invalid', reason: 'non-finite or non-positive measured rectangle', inputEvidence, items, fixed, bounds, inferenceComparison };
  }
  const safeArea = bounds.width * bounds.height;
  const requiredArea = items.reduce((sum, item) => sum + item.width * item.height, 0);
  const fixedUnionAreaGap0 = rectangleUnionArea(fixed, bounds);
  const fixedUnionAreaGap4 = rectangleUnionArea(fixed, bounds, 4);
  const fixedNaiveAreaGap0 = fixed.reduce((sum, item) => {
    const clipped = clippedArea(item, bounds); return sum + (clipped ? (clipped.right - clipped.left) * (clipped.bottom - clipped.top) : 0);
  }, 0);
  const fixedNaiveAreaGap4 = fixed.reduce((sum, item) => {
    const clipped = clippedArea({ x: item.x - 4, y: item.y - 4, width: item.width + 8, height: item.height + 8 }, bounds);
    return sum + (clipped ? (clipped.right - clipped.left) * (clipped.bottom - clipped.top) : 0);
  }, 0);
  const availableUpperBoundGap0 = safeArea - fixedUnionAreaGap0;
  const availableUpperBoundGap4 = safeArea - fixedUnionAreaGap4;
  return {
    status: 'measured', bounds, safeArea, items, requiredArea,
    necessaryPackingBound: {
      status: requiredArea > availableUpperBoundGap0 + 0.5 ? 'impossible-even-at-zero-gap'
        : requiredArea > availableUpperBoundGap4 + 0.5 ? 'impossible-at-product-gap-4' : 'area-alone-does-not-prove-impossibility',
      note: 'required area is the sum of full-size mobile rectangles; available area subtracts the union of fixed blockers. Passing this necessary bound does not prove a valid packing.',
    },
    inputEvidence, fixedObstacles: fixed,
    placedMovableControlObstacles: layoutObstacles.filter((rect: any) => movableControlIdSet.has(rect.id)),
    excludedMovableControlIds: movableControlIds, measuredRing, inferredRing, inferenceComparison,
    fixedNaiveAreaGap0, fixedNaiveAreaGap4,
    fixedUnionAreaGap0, fixedUnionAreaGap4,
    overlapAreaDedupedGap0: fixedNaiveAreaGap0 - fixedUnionAreaGap0,
    overlapAreaDedupedGap4: fixedNaiveAreaGap4 - fixedUnionAreaGap4,
    availableUpperBoundGap0, availableUpperBoundGap4,
    deficitGap0: Math.max(0, requiredArea - availableUpperBoundGap0),
    deficitGap4: Math.max(0, requiredArea - availableUpperBoundGap4),
    shortageGap0: requiredArea > availableUpperBoundGap0 + 0.5,
    shortageGap4: requiredArea > availableUpperBoundGap4 + 0.5,
    gap4Method: 'fixed-obstacle rectangles expanded by the product 4 CSS px clearance, clipped to bounds, then unioned; mobile item area is a lower bound',
    sightRadius, sightExtent,
  };
}

const HISTORICAL_AREA_REGRESSION_SOURCE = {
  runId: 37821453451, artifactId: 11569571799,
  archiveSha256: '8f43013ca9cd01b5eb5ebbf8039314727c51594f081ebbfe8b03ab5a9a0746d0',
};
const HISTORICAL_AREA_REGRESSION_EXPECTED = { states: 10, measured: 10, gap0Shortages: 8, gap4Shortages: 9, gap4OnlyShortages: 1 };
type HistoricalAreaRectRow = [string | null, number, number, number, number];
type HistoricalAreaFixture = {
  case: string; mode: 'easy' | 'normal'; bounds: [number, number, number, number]; canvas: [number, number, number, number];
  sight: [number, number]; searchObstacles: HistoricalAreaRectRow[]; panels: HistoricalAreaRectRow[];
  movableControls: HistoricalAreaRectRow[]; layoutObstacles: HistoricalAreaRectRow[]; radarRect: HistoricalAreaRectRow;
};
// Exact area-calculator inputs from the ten original rotation JSON attachments. Tuple order is [id,x,y,width,height].
// Historical counts apply only to this regression fixture; fresh-page results never use them as thresholds.
const HISTORICAL_AREA_REGRESSION_FIXTURE: HistoricalAreaFixture[] = [
  {"case":"hud-easy-outside-small-portrait-text-200-priority-0.png","mode":"easy","bounds":[8,8,304,552],"canvas":[0,0,320,568],"sight":[160,284],"searchObstacles":[["campaign-site",8,8,74.5,62.59375],["campaign-site",84.5,8,74.5,62.59375],["campaign-site",161,8,74.5,62.59375],["campaign-site",237.5,8,74.5,62.59375],["campaign-site",8,72.59375,74.5,87.984375],["campaign-site",84.5,72.59375,74.5,87.984375],["campaign-site",161,72.59375,74.5,87.984375]],"panels":[["health-label",8,140,122.375,35],["health-track",8,140,110,3],["instrument",8,140,110,50],["campaign-limit",8,140,110,51],["ammo",8,140,110,56],["campaign-threat",12,201.515625,114,191.484375],["reload-status",29.875,345.1875,260.25,57.5],["warning",80,262.609375,160,136.390625],["campaign-hud-details",8,220,114,80],["campaign-mode-status",8,140,72,24],["target-tally",8,140,70.625,44]],"movableControls":[["game-sound",0,0,81.296875,44],["pause",0,0,44,50],["bomb",88.53125,502.5625,72.53125,62.6875],["loop",222.4921875,315.578125,86.203125,118.59375]],"layoutObstacles":[["campaign-site",8,8,74.5,62.59375],["campaign-site",84.5,8,74.5,62.59375],["campaign-site",161,8,74.5,62.59375],["campaign-site",237.5,8,74.5,62.59375],["campaign-site",8,72.59375,74.5,87.984375],["campaign-site",84.5,72.59375,74.5,87.984375],["campaign-site",161,72.59375,74.5,87.984375],["central-flight-lane",118,242,84,84],["aim-and-reload-ring",106.8,230.8,106.4,106.4],["game-sound",8,8,81.296875,44],["pause",8,8,44,50],["bomb",88.53125,497.3125,72.53125,62.6875],["loop",222.4921875,315.578125,86.203125,118.59375]],"radarRect":["radar",8,8,86,102]},
  {"case":"hud-easy-outside-small-portrait-text-200-priority-4.png","mode":"easy","bounds":[8,8,304,552],"canvas":[0,0,320,568],"sight":[160,284],"searchObstacles":[["campaign-site",8,8,74.5,62.59375],["campaign-site",84.5,8,74.5,62.59375],["campaign-site",161,8,74.5,62.59375],["campaign-site",237.5,8,74.5,62.59375],["campaign-site",8,72.59375,74.5,87.984375],["campaign-site",84.5,72.59375,74.5,87.984375],["campaign-site",161,72.59375,74.5,87.984375]],"panels":[["health-label",8,140,122.375,35],["health-track",8,140,110,3],["instrument",8,140,110,50],["campaign-limit",8,140,110,51],["ammo",8,140,110,56],["campaign-threat",12,201.515625,114,191.484375],["reload-status",29.875,345.1875,260.25,57.5],["warning",80,262.609375,160,136.390625],["announcement",97,455.1875,114,96],["campaign-hud-details",8,220,114,80],["campaign-mode-status",8,140,72,24],["target-tally",8,140,70.625,44]],"movableControls":[["game-sound",0,0,81.296875,44],["pause",0,0,44,50],["bomb",88.53125,502.5625,72.53125,62.6875],["loop",222.4921875,315.578125,86.203125,118.59375]],"layoutObstacles":[["campaign-site",8,8,74.5,62.59375],["campaign-site",84.5,8,74.5,62.59375],["campaign-site",161,8,74.5,62.59375],["campaign-site",237.5,8,74.5,62.59375],["campaign-site",8,72.59375,74.5,87.984375],["campaign-site",84.5,72.59375,74.5,87.984375],["campaign-site",161,72.59375,74.5,87.984375],["central-flight-lane",118,242,84,84],["aim-and-reload-ring",106.8,230.8,106.4,106.4],["game-sound",8,8,81.296875,44],["pause",8,8,44,50],["bomb",88.53125,497.3125,72.53125,62.6875],["loop",222.4921875,315.578125,86.203125,118.59375]],"radarRect":["radar",8,8,86,102]},
  {"case":"hud-normal-protected-small-landscape-text-200-priority-0.png","mode":"normal","bounds":[8,8,552,304],"canvas":[0,0,568,320],"sight":[283.99999999999994,116.2089291012429],"searchObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",162.859375,86.40625,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625]],"panels":[["health-label",8,140,122.375,35],["health-track",8,140,110,3],["instrument",8,140,110,50],["campaign-limit",8,140,110,51],["ammo",8,140,110,56],["campaign-threat",376,150,180,76],["reload-status",153.875,168.203125,260.25,57.5],["warning",142,130,284,82],["campaign-hud-details",8,220,114,96],["campaign-mode-status",8,140,72,24],["target-tally",8,140,70.625,44],["bomb-hint",8,140,110,18.40625]],"movableControls":[["game-sound",0,0,81.296875,44],["pause",0,0,44,50],["bomb",185.25,255.046875,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625],["fire",440.4375,243.203125,62,51.1875],["throttle",70.953125,188.8046875,51.1875,102.390625]],"layoutObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",162.859375,86.40625,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625],["central-flight-lane",242,118,84,84],["aim-and-reload-ring",246.79999999999995,79.0089291012429,74.4,74.4],["game-sound",8,8,81.296875,44],["pause",8,8,44,50],["bomb",185.25,249.3125,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625],["fire",440.4375,243.203125,62,51.1875],["throttle",70.953125,188.8046875,51.1875,102.390625]],"radarRect":["radar",451,55.60000000000001,100,116]},
  {"case":"hud-normal-protected-small-landscape-text-200-priority-4.png","mode":"normal","bounds":[8,8,552,304],"canvas":[0,0,568,320],"sight":[283.99999999999994,116.2089291012429],"searchObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",162.859375,86.40625,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625]],"panels":[["health-label",8,140,122.375,35],["health-track",8,140,110,3],["instrument",8,140,110,50],["campaign-limit",8,140,110,51],["ammo",8,140,110,56],["campaign-threat",376,150,180,76],["reload-status",153.875,168.203125,260.25,57.5],["warning",142,130,284,82],["announcement",376,118,180,64],["campaign-hud-details",8,220,114,96],["campaign-mode-status",8,140,72,24],["target-tally",8,140,70.625,44],["bomb-hint",8,140,110,18.40625]],"movableControls":[["game-sound",0,0,81.296875,44],["pause",0,0,44,50],["bomb",185.25,255.046875,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625],["fire",440.4375,243.203125,62,51.1875],["throttle",70.953125,188.8046875,51.1875,102.390625]],"layoutObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",162.859375,86.40625,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625],["central-flight-lane",242,118,84,84],["aim-and-reload-ring",246.79999999999995,79.0089291012429,74.4,74.4],["game-sound",8,8,81.296875,44],["pause",8,8,44,50],["bomb",185.25,249.3125,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625],["fire",440.4375,243.203125,62,51.1875],["throttle",70.953125,188.8046875,51.1875,102.390625]],"radarRect":["radar",451,55.60000000000001,100,116]},
  {"case":"hud-normal-low-warning-small-landscape-text-200-priority-4.png","mode":"normal","bounds":[8,8,552,304],"canvas":[0,0,568,320],"sight":[283.99999999999994,116.2089291012429],"searchObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",162.859375,86.40625,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625]],"panels":[["health-label",8,140,122.375,35],["health-track",8,140,110,3],["instrument",8,140,110,50],["campaign-limit",8,140,110,51],["ammo",8,140,110,56],["campaign-threat",376,150,180,109],["reload-status",153.875,168.203125,260.25,57.5],["warning",160.4609375,164,247.078125,48],["announcement",376,118,180,64],["campaign-hud-details",8,220,114,96],["campaign-mode-status",8,140,72,24],["target-tally",8,140,70.625,44]],"movableControls":[["game-sound",0,0,81.296875,44],["pause",0,0,44,50],["bomb",185.25,255.046875,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625],["fire",440.4375,243.203125,62,51.1875],["throttle",70.953125,188.8046875,51.1875,102.390625]],"layoutObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",162.859375,86.40625,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625],["central-flight-lane",242,118,84,84],["aim-and-reload-ring",246.79999999999995,79.0089291012429,74.4,74.4],["game-sound",8,8,81.296875,44],["pause",8,8,44,50],["bomb",185.25,249.3125,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625],["fire",440.4375,243.203125,62,51.1875],["throttle",70.953125,188.8046875,51.1875,102.390625]],"radarRect":["radar",451,55.60000000000001,100,116]},
  {"case":"hud-easy-clear-small-landscape-text-200-priority-0.png","mode":"easy","bounds":[8,8,552,304],"canvas":[0,0,568,320],"sight":[284,160],"searchObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",245.421875,8,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625]],"panels":[["health-label",8,140,122.375,35],["health-track",8,140,110,3],["instrument",8,140,110,50],["campaign-limit",8,140,110,51],["ammo",8,140,110,56],["campaign-threat",376,150,180,109],["reload-status",153.875,221.1875,260.25,57.5],["campaign-hud-details",8,220,114,96],["campaign-mode-status",8,140,72,24],["target-tally",8,140,70.625,44]],"movableControls":[["game-sound",0,0,81.296875,44],["pause",0,0,44,50],["bomb",185.25,255.046875,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625]],"layoutObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",245.421875,8,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625],["central-flight-lane",242,118,84,84],["aim-and-reload-ring",230.8,106.8,106.4,106.4],["game-sound",8,8,81.296875,44],["pause",8,8,44,50],["bomb",185.25,249.3125,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625]],"radarRect":["radar",451,55.60000000000001,100,116]},
  {"case":"hud-easy-clear-small-landscape-text-200-priority-4.png","mode":"easy","bounds":[8,8,552,304],"canvas":[0,0,568,320],"sight":[284,160],"searchObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",245.421875,8,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625]],"panels":[["health-label",8,140,122.375,35],["health-track",8,140,110,3],["instrument",8,140,110,50],["campaign-limit",8,140,110,51],["ammo",8,140,110,56],["campaign-threat",376,150,180,109],["reload-status",153.875,221.1875,260.25,57.5],["announcement",376,118,180,64],["campaign-hud-details",8,220,114,96],["campaign-mode-status",8,140,72,24],["target-tally",8,140,70.625,44]],"movableControls":[["game-sound",0,0,81.296875,44],["pause",0,0,44,50],["bomb",185.25,255.046875,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625]],"layoutObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",245.421875,8,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625],["central-flight-lane",242,118,84,84],["aim-and-reload-ring",230.8,106.8,106.4,106.4],["game-sound",8,8,81.296875,44],["pause",8,8,44,50],["bomb",185.25,249.3125,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625]],"radarRect":["radar",451,55.60000000000001,100,116]},
  {"case":"hud-easy-warning-small-landscape-text-200-priority-4.png","mode":"easy","bounds":[8,8,552,304],"canvas":[0,0,568,320],"sight":[284,160],"searchObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",245.421875,8,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625]],"panels":[["health-label",8,140,122.375,35],["health-track",8,140,110,3],["instrument",8,140,110,50],["campaign-limit",8,140,110,51],["ammo",8,140,110,56],["campaign-threat",376,150,180,109],["reload-status",153.875,221.1875,260.25,57.5],["warning",160.4609375,164,247.078125,48],["announcement",376,118,180,64],["campaign-hud-details",8,220,114,96],["campaign-mode-status",8,140,72,24],["target-tally",8,140,70.625,44]],"movableControls":[["game-sound",0,0,81.296875,44],["pause",0,0,44,50],["bomb",185.25,255.046875,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625]],"layoutObstacles":[["campaign-site",8,8,77.140625,76.40625],["campaign-site",87.140625,8,77.140625,76.40625],["campaign-site",166.28125,8,77.140625,76.40625],["campaign-site",245.421875,8,77.140625,76.40625],["campaign-site",324.5625,8,77.140625,76.40625],["campaign-site",403.703125,8,77.140625,76.40625],["campaign-site",482.84375,8,77.15625,76.40625],["central-flight-lane",242,118,84,84],["aim-and-reload-ring",230.8,106.8,106.4,106.4],["game-sound",8,8,81.296875,44],["pause",8,8,44,50],["bomb",185.25,249.3125,72.53125,62.6875],["loop",428.3359375,160.9921875,86.203125,100.390625]],"radarRect":["radar",451,55.60000000000001,100,116]},
  {"case":"hud-normal-respawn-small-portrait-text-200-priority-0.png","mode":"normal","bounds":[8,8,304,552],"canvas":[0,0,320,568],"sight":[159.99999999999994,206.27084915470616],"searchObstacles":[["campaign-site",8,8,74.5,62.59375],["campaign-site",84.5,8,74.5,62.59375],["campaign-site",161,8,74.5,62.59375],["campaign-site",237.5,8,74.5,62.59375],["campaign-site",8,72.59375,74.5,87.984375],["campaign-site",84.5,72.59375,74.5,87.984375],["campaign-site",161,72.59375,74.5,87.984375]],"panels":[["health-label",8,140,122.375,35],["health-track",8,140,110,3],["instrument",8,140,110,50],["campaign-limit",8,140,110,51],["ammo",8,140,110,56],["campaign-threat",12,237.8125,114,155.1875],["reload-status",29.875,258.265625,260.25,57.5],["respawn-status",15,329.4375,290,96],["campaign-hud-details",8,220,114,80],["campaign-mode-status",8,140,72,24],["target-tally",8,140,70.625,44]],"movableControls":[["game-sound",0,0,81.296875,44],["pause",0,0,44,50],["bomb",88.53125,502.5625,72.53125,62.6875],["loop",222.4921875,315.578125,86.203125,118.59375],["fire",216,429.109375,96,96],["throttle",22.390625,362,64,128]],"layoutObstacles":[["campaign-site",8,8,74.5,62.59375],["campaign-site",84.5,8,74.5,62.59375],["campaign-site",161,8,74.5,62.59375],["campaign-site",237.5,8,74.5,62.59375],["campaign-site",8,72.59375,74.5,87.984375],["campaign-site",84.5,72.59375,74.5,87.984375],["campaign-site",161,72.59375,74.5,87.984375],["central-flight-lane",118,242,84,84],["aim-and-reload-ring",122.79999999999994,169.07084915470614,74.4,74.4],["game-sound",8,8,81.296875,44],["pause",8,8,44,50],["bomb",88.53125,497.3125,72.53125,62.6875],["loop",222.4921875,315.578125,86.203125,118.59375],["fire",216,429.109375,96,96],["throttle",22.390625,362,64,128]],"radarRect":["radar",8,8,86,102]},
  {"case":"hud-normal-respawn-small-portrait-text-200-priority-4.png","mode":"normal","bounds":[8,8,304,552],"canvas":[0,0,320,568],"sight":[159.99999999999994,206.27084915470616],"searchObstacles":[["campaign-site",8,8,74.5,62.59375],["campaign-site",84.5,8,74.5,62.59375],["campaign-site",161,8,74.5,62.59375],["campaign-site",237.5,8,74.5,62.59375],["campaign-site",8,72.59375,74.5,87.984375],["campaign-site",84.5,72.59375,74.5,87.984375],["campaign-site",161,72.59375,74.5,87.984375]],"panels":[["health-label",8,140,122.375,35],["health-track",8,140,110,3],["instrument",8,140,110,50],["campaign-limit",8,140,110,51],["ammo",8,140,110,56],["campaign-threat",12,237.8125,114,155.1875],["reload-status",29.875,258.265625,260.25,57.5],["respawn-status",15,329.4375,290,96],["announcement",97,455.1875,114,96],["campaign-hud-details",8,220,114,80],["campaign-mode-status",8,140,72,24],["target-tally",8,140,70.625,44]],"movableControls":[["game-sound",0,0,81.296875,44],["pause",0,0,44,50],["bomb",88.53125,502.5625,72.53125,62.6875],["loop",222.4921875,315.578125,86.203125,118.59375],["fire",216,429.109375,96,96],["throttle",22.390625,362,64,128]],"layoutObstacles":[["campaign-site",8,8,74.5,62.59375],["campaign-site",84.5,8,74.5,62.59375],["campaign-site",161,8,74.5,62.59375],["campaign-site",237.5,8,74.5,62.59375],["campaign-site",8,72.59375,74.5,87.984375],["campaign-site",84.5,72.59375,74.5,87.984375],["campaign-site",161,72.59375,74.5,87.984375],["central-flight-lane",118,242,84,84],["aim-and-reload-ring",122.79999999999994,169.07084915470614,74.4,74.4],["game-sound",8,8,81.296875,44],["pause",8,8,44,50],["bomb",88.53125,497.3125,72.53125,62.6875],["loop",222.4921875,315.578125,86.203125,118.59375],["fire",216,429.109375,96,96],["throttle",22.390625,362,64,128]],"radarRect":["radar",8,8,86,102]}
];

function expandHistoricalAreaFixture(fixture: HistoricalAreaFixture) {
  const rowRect = ([id, x, y, width, height]: HistoricalAreaRectRow) => ({ ...(id ? { id } : {}), x, y, width, height });
  const [boundsX, boundsY, boundsWidth, boundsHeight] = fixture.bounds;
  const [canvasX, canvasY, canvasWidth, canvasHeight] = fixture.canvas;
  const [sightX, sightY] = fixture.sight;
  return {
    searchInput: {
      bounds: { x: boundsX, y: boundsY, width: boundsWidth, height: boundsHeight },
      canvas: { x: canvasX, y: canvasY, width: canvasWidth, height: canvasHeight },
      obstacles: fixture.searchObstacles.map(rowRect), panels: fixture.panels.map(rowRect),
      movableControls: fixture.movableControls.map(rowRect),
    },
    sight: { x: sightX, y: sightY },
    layout: { obstacles: fixture.layoutObstacles.map(rowRect), radar: { rect: rowRect(fixture.radarRect) } },
  };
}

test('historical PR #10 area replay remains an isolated regression fixture', async ({}, info) => {
  const replay = HISTORICAL_AREA_REGRESSION_FIXTURE.map(fixture => {
    const input = expandHistoricalAreaFixture(fixture);
    return { case: fixture.case, mode: fixture.mode,
      areaBound: campaignHudAreaEvidence(input.searchInput, input.sight, input.layout, fixture.mode) };
  });
  const counts = {
    states: replay.length,
    measured: replay.filter(item => item.areaBound.status === 'measured').length,
    gap0Shortages: replay.filter(item => item.areaBound.shortageGap0 === true).length,
    gap4Shortages: replay.filter(item => item.areaBound.shortageGap4 === true).length,
    gap4OnlyShortages: replay.filter(item => item.areaBound.shortageGap4 === true && item.areaBound.shortageGap0 !== true).length,
  };
  await info.attach('historical-area-regression-fixture-replay.json', {
    body: Buffer.from(JSON.stringify({ source: HISTORICAL_AREA_REGRESSION_SOURCE, expected: HISTORICAL_AREA_REGRESSION_EXPECTED, counts, replay }, null, 2)),
    contentType: 'application/json',
  });
  expect(replay.map(item => item.case)).toEqual(HUD_CASES.map(item => item.name));
  expect(replay.filter(item => item.areaBound.status !== 'measured').map(item => ({ case: item.case, evidence: item.areaBound }))).toEqual([]);
  expect(counts).toEqual(HISTORICAL_AREA_REGRESSION_EXPECTED);
});

async function capture(page: Page, info: TestInfo, name: string, coverage?: HudCaseCoverage): Promise<number> {
  const start = performance.now();
  const body = await page.screenshot({ animations: 'disabled' });
  await info.attach(name, { body, contentType: 'image/png' });
  if (coverage) coverage.imageSaved = true;
  return performance.now() - start;
}

async function record(name: string, setupMs: number, started: number, captureMs: number) {
  const value = { name, setupMs: Math.round(setupMs), tourMs: Math.max(0, Math.round(performance.now() - started - captureMs)), captureMs: Math.round(captureMs) };
  timings.push(value);
  console.log(`[ui-only-time] ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'ui-only-time', description: JSON.stringify(value) });
}

async function enlargeText(page: Page, refreshResponsiveHud = false) {
  return page.evaluate(async ({ selectors, refreshResponsiveHud }) => {
    type SavedFont = { value: string; priority: string };
    const targetWindow = window as Window & { __fantasiaUiOnlyFontOverrides?: Map<HTMLElement, SavedFont> };
    const overrides = targetWindow.__fantasiaUiOnlyFontOverrides ?? new Map<HTMLElement, SavedFont>();
    if (!targetWindow.__fantasiaUiOnlyFontOverrides) Object.defineProperty(targetWindow, '__fantasiaUiOnlyFontOverrides', { value: overrides, configurable: true });
    for (const [node, saved] of overrides) {
      if (saved.value) node.style.setProperty('font-size', saved.value, saved.priority);
      else node.style.removeProperty('font-size');
    }
    overrides.clear();
    // On rotation, give the product layout one normal-size render after old
    // test overrides are removed. Its responsive live-node font snapshots
    // must settle before this case measures and reapplies 200% text.
    if (refreshResponsiveHud) await (window as any).__fantasiaUiOnlyTest.paint();

    const nodes = [...document.querySelectorAll<HTMLElement>('#app *')].filter(node => !['CANVAS', 'SCRIPT', 'STYLE'].includes(node.tagName));
    const measurements = nodes.map(node => ({
      node,
      base: parseFloat(getComputedStyle(node).fontSize) || 16,
      saved: { value: node.style.getPropertyValue('font-size'), priority: node.style.getPropertyPriority('font-size') },
    }));
    for (const { node, base, saved } of measurements) {
      overrides.set(node, saved);
      node.style.setProperty('font-size', `${base * 2}px`, 'important');
    }
    const parentPathFor = (node: HTMLElement) => {
      let parent = node.parentElement, path = '';
      while (parent && path.split(' > ').length < 5) {
        const name = parent.id ? `#${parent.id}` : parent.dataset.site ? `.campaign-site[data-site="${parent.dataset.site}"]`
          : parent.dataset.campaignDetail ? `[data-campaign-detail="${parent.dataset.campaignDetail}"]`
            : parent.classList[0] ? `.${parent.classList[0]}` : parent.tagName.toLowerCase();
        path = path ? `${name} > ${path}` : name;
        parent = parent.parentElement;
      }
      return path;
    };
    const fontBaselines = selectors.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)]
      .filter(node => !(selector === '.target-tally > small' && node.textContent?.trim() === '現在機を含む'))
      .map((node, index) => {
      const measured = measurements.find(item => item.node === node);
      const site = node.closest<HTMLElement>('[data-site]')?.dataset.site ?? node.closest<HTMLElement>('[data-site-detail]')?.dataset.siteDetail;
      const owner = node.id ? `#${node.id}` : site ? `site-${site}.${[...node.classList].join('.') || node.tagName.toLowerCase()}`
        : `match-${index}.${[...node.classList].join('.') || node.tagName.toLowerCase()}`;
      return {
        key: `${selector}::${owner}`, selector, basePx: measured?.base ?? parseFloat(getComputedStyle(node).fontSize),
        appliedPx: parseFloat(getComputedStyle(node).fontSize), inlineBefore: measured?.saved.value ?? '',
        inlinePriorityBefore: measured?.saved.priority ?? '', appliedInlineValue: node.style.getPropertyValue('font-size'),
        appliedInlinePriority: node.style.getPropertyPriority('font-size'), parent: parentPathFor(node),
        text: node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) ?? '',
      };
    }));
    const liveNotes = [...document.querySelectorAll<HTMLElement>('#app small')]
      .filter(node => node.textContent?.trim() === '現在機を含む');
    for (const node of liveNotes) {
      const measured = measurements.find(item => item.node === node);
      fontBaselines.push({ key: 'semantic::target-lives-note', selector: 'semantic::target-lives-note',
        basePx: measured?.base ?? parseFloat(getComputedStyle(node).fontSize),
        appliedPx: parseFloat(getComputedStyle(node).fontSize), inlineBefore: measured?.saved.value ?? '',
        inlinePriorityBefore: measured?.saved.priority ?? '', appliedInlineValue: node.style.getPropertyValue('font-size'),
        appliedInlinePriority: node.style.getPropertyPriority('font-size'), parent: parentPathFor(node),
        text: node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) ?? '' });
    }
    return { nodeCount: nodes.length, fontBaselines, viewport: { width: innerWidth, height: innerHeight } };
  }, { selectors: TYPOGRAPHY_SELECTORS, refreshResponsiveHud });
}

async function checkGeometry(page: Page, selector: string) {
  const result = await page.evaluate(scopeSelector => {
    const scope = document.querySelector<HTMLElement>(scopeSelector);
    if (!scope) throw new Error(`Missing geometry scope ${scopeSelector}`);
    const visibleRect = (element: HTMLElement) => {
      const own = element.getBoundingClientRect();
      const rect = { left: own.left, top: own.top, right: own.right, bottom: own.bottom };
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
        const left = box.left + parent.clientLeft, top = box.top + parent.clientTop;
        const right = left + parent.clientWidth, bottom = top + parent.clientHeight;
        if (style.overflowX !== 'visible') { rect.left = Math.max(rect.left, left); rect.right = Math.min(rect.right, right); }
        if (style.overflowY !== 'visible') { rect.top = Math.max(rect.top, top); rect.bottom = Math.min(rect.bottom, bottom); }
      }
      rect.left = Math.max(0, rect.left); rect.top = Math.max(0, rect.top);
      rect.right = Math.min(innerWidth, rect.right); rect.bottom = Math.min(innerHeight, rect.bottom);
      return rect.right - rect.left > 1 && rect.bottom - rect.top > 1 ? rect : null;
    };
    const visible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !element.closest('[hidden]') && visibleRect(element) !== null;
    };
    const targets = [...scope.querySelectorAll<HTMLElement>('button:not(.preview-control), input[type="range"], select, summary, [role="slider"], label:has(> input[type="radio"])')].filter(visible);
    const small = targets.filter(element => { const rect = element.getBoundingClientRect(); return rect.width < 44 || rect.height < 44; }).map(element => element.id || element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 32));
    const overlaps: string[] = [], overlapDetails: unknown[] = [];
    const describe = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect(), clipped = visibleRect(element), style = getComputedStyle(element);
      return { id: element.id || null, className: typeof element.className === 'string' ? element.className : '',
        text: element.getAttribute('aria-label') || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 48),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        visibleRect: clipped, position: style.position, left: style.left, top: style.top, right: style.right, bottom: style.bottom,
        transform: style.transform, translate: style.translate, fontSize: style.fontSize,
        parent: element.parentElement?.id || element.parentElement?.className || element.parentElement?.tagName };
    };
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      const a = visibleRect(targets[i]), b = visibleRect(targets[j]);
      if (!a || !b) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) {
        overlaps.push(`${targets[i].id || targets[i].textContent?.trim()} × ${targets[j].id || targets[j].textContent?.trim()}`);
        if (overlapDetails.length < 20) overlapDetails.push({ overlap: { width: w, height: h }, a: describe(targets[i]), b: describe(targets[j]) });
      }
    }
    return { small, overlaps, overlapDetails, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth };
  }, selector);
  expect(result.small, `${selector} controls below 44px`).toEqual([]);
  expect(result.overlaps, `${selector} interactive overlap: ${JSON.stringify(result.overlapDetails)}`).toEqual([]);
  expect(result.documentWidth, `${selector} horizontal overflow`).toBeLessThanOrEqual(result.viewportWidth + 1);
}

async function checkBodyPanels(page: Page, selector: string) {
  const result = await page.evaluate(scopeSelector => {
    const scope = document.querySelector<HTMLElement>(scopeSelector);
    if (!scope) throw new Error(`Missing body panel scope ${scopeSelector}`);
    const visible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !element.closest('[hidden]');
    };
    const panels = [scope, ...scope.querySelectorAll<HTMLElement>('.panel, .result-panel, .settings-main, #rules-content')].filter(visible);
    const clipped: string[] = [], outside: string[] = [], overlaps: string[] = [];
    for (const panel of panels) {
      const rect = panel.getBoundingClientRect(), style = getComputedStyle(panel), name = panel.id || panel.className || panel.tagName;
      if (rect.left < -1 || rect.right > innerWidth + 1) outside.push(name);
      if (!['auto', 'scroll'].includes(style.overflowX) && panel.scrollWidth > panel.clientWidth + 2) clipped.push(`${name}: horizontal`);
      if (!['auto', 'scroll'].includes(style.overflowY) && panel.scrollHeight > panel.clientHeight + 2) clipped.push(`${name}: vertical`);
    }
    for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
      if (panels[i].contains(panels[j]) || panels[j].contains(panels[i])) continue;
      const a = panels[i].getBoundingClientRect(), b = panels[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push(`${panels[i].id || panels[i].className} × ${panels[j].id || panels[j].className}`);
    }
    return { clipped, outside, overlaps };
  }, selector);
  expect(result.clipped, `${selector} body-panel content clipping`).toEqual([]);
  expect(result.outside, `${selector} body panels outside viewport`).toEqual([]);
  expect(result.overlaps, `${selector} body-panel overlap`).toEqual([]);
}

async function checkHudGeometry(page: Page) {
  const result = await page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !element.closest('[hidden]');
    };
    const selectors = [
      '.hud-top', '#campaign-sites .campaign-site[data-site]', '.flight-data > *', '#campaign-threat',
      '#payload-status', '#reload-status', '#warning', '#announcement', '#respawn-status', '#flight-tip', '#throttle-layout-note',
      '#campaign-hud-details', '#hud button:not(.preview-control)', '#hud [role="slider"]',
    ];
    const nodes = selectors.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)])
      .filter(visible);
    const clipped: string[] = [], outside: string[] = [], overlaps: string[] = [], overlapDetails: unknown[] = [];
    const clippedDetails: unknown[] = [], outsideDetails: unknown[] = [];
    const app = document.querySelector<HTMLElement>('#app');
    const describe = (node: HTMLElement) => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return {
        name: `${node.id || node.className}${node.dataset.site ? `[data-site=${node.dataset.site}]` : ''}`,
        text: node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 48),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        position: style.position, translate: style.translate, transform: style.transform, fontSize: style.fontSize,
      };
    };
    const details = document.querySelector<HTMLElement>('#campaign-hud-details');
    const detailsRect = details?.getBoundingClientRect();
    const detailViewport = details && visible(details) && detailsRect ? {
      outside: detailsRect.left < -1 || detailsRect.top < -1 || detailsRect.right > innerWidth + 1 || detailsRect.bottom > innerHeight + 1,
      horizontalOverflow: details.scrollWidth > details.clientWidth + 2,
      scrollable: getComputedStyle(details).overflowY === 'auto' || getComputedStyle(details).overflowY === 'scroll',
    } : null;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node), name = node.id || node.className || node.tagName;
      if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) {
        outside.push(name); if (outsideDetails.length < 20) outsideDetails.push(describe(node));
      }
      const intentionalEllipsis = node.matches('.campaign-site-force, .campaign-site-wave');
      const scrollable = ['auto', 'scroll'].includes(style.overflowY);
      if (!intentionalEllipsis && !scrollable && (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2)) {
        clipped.push(name); if (clippedDetails.length < 20) clippedDetails.push({ ...describe(node), scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight });
      }
    }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const aNode = nodes[i], bNode = nodes[j];
      if (aNode.contains(bNode) || bNode.contains(aNode)) continue;
      const a = aNode.getBoundingClientRect(), b = bNode.getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
        overlaps.push(`${aNode.id || aNode.className} × ${bNode.id || bNode.className}`);
        if (overlapDetails.length < 12) overlapDetails.push({ a: describe(aNode), b: describe(bNode) });
      }
    }
    return { clipped, clippedDetails, outside, outsideDetails, overlaps, overlapDetails, detailViewport,
      documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
      mode: app?.dataset.mode, campaignHud: app?.dataset.campaignHud, screen: app?.dataset.screen };
  });
  const canvasLayout = await act(page, 'layout');
  expect(result.clipped, `visible warning, site, instrument, control and HUD panel content must not clip: ${JSON.stringify(result.clippedDetails)}`).toEqual([]);
  expect(result.outside, `visible warning, site, instrument, control and HUD panels must stay on screen: ${JSON.stringify(result.outsideDetails)}`).toEqual([]);
  expect(result.overlaps, `visible HUD panels must not overlap (${result.mode}/${result.campaignHud}/${result.screen}, ${result.viewportWidth}px; Canvas layout=${canvasLayout.status}, conflicts=${JSON.stringify(canvasLayout.fixedConflicts ?? [])}): ${JSON.stringify(result.overlapDetails)}`).toEqual([]);
  expect(result.documentWidth, 'HUD must not create horizontal page overflow').toBeLessThanOrEqual(result.viewportWidth + 1);
  if (result.detailViewport) {
    expect(result.detailViewport.outside, 'bounded campaign detail viewport stays on screen').toBe(false);
    expect(result.detailViewport.horizontalOverflow, 'bounded campaign detail viewport does not clip horizontally').toBe(false);
    expect(result.detailViewport.scrollable, 'secondary campaign detail content uses an explicit scroll viewport').toBe(true);
    const bottom = await page.locator('#campaign-hud-details').evaluate(element => {
      const node = element as HTMLElement, old = node.scrollTop;
      node.scrollTop = node.scrollHeight;
      const reached = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      node.scrollTop = old;
      return reached;
    });
    expect(bottom, 'bounded campaign detail viewport can reach its final content').toBe(true);
  }

  expect(canvasLayout.status).toBe('placed');
  expect(canvasLayout.fixedConflicts ?? [], 'fixed sites, controls and flight lane').toEqual([]);
  const geometry = [canvasLayout.radar, ...(canvasLayout.panels ?? []), ...(canvasLayout.controls ?? []), ...(canvasLayout.canvasLabels ?? [])];
  for (const item of geometry) {
    const rect = item.rect, bounds = canvasLayout.bounds;
    expect(item.status ?? 'placed', `${item.id ?? 'canvas HUD'} placement`).toBe('placed');
    expect(rect.x, `${item.id ?? 'canvas HUD'} left clipping`).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(rect.y, `${item.id ?? 'canvas HUD'} top clipping`).toBeGreaterThanOrEqual(bounds.y - 1);
    expect(rect.x + rect.width, `${item.id ?? 'canvas HUD'} right clipping`).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    expect(rect.y + rect.height, `${item.id ?? 'canvas HUD'} bottom clipping`).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  }
}

async function paintedFixture(page: Page, mode: 'easy' | 'normal', alert: string, announcementPriority = 0) {
  const before = await act(page, 'canvas');
  const fixture = await act(page, 'hud', mode, alert, announcementPriority);
  expect(fixture.canvas.drawCalls, `${mode}/${alert} invokes the product painter exactly once`).toBe(before.drawCalls + 1);
  expect(fixture.canvas.hudLayout.measurements).toBeGreaterThan(0);
  expect(fixture.canvas.radius).toBeGreaterThan(0);
  expect(fixture.announcementPriority).toBe(announcementPriority);
  return fixture;
}

async function repaintFixedFixture(page: Page) {
  const before = await act(page, 'canvas');
  const painted = await act(page, 'paint');
  expect(painted.drawCalls, 'fixed-state 200% repaint calls the product painter exactly once').toBe(before.drawCalls + 1);
  return painted;
}

async function inspectAnnouncementReachability(page: Page, priority: number, originalAnnouncementHandle: any) {
  return page.evaluate(({ priorityValue, originalAnnouncement }) => {
    const node = document.querySelector<HTMLElement>('#announcement');
    const details = document.querySelector<HTMLElement>('#campaign-hud-details');
    if (!node) return { ok: false, priority: priorityValue, reason: 'missing original #announcement node', glyphs: [], clipChain: [] };
    const originalNode = originalAnnouncement instanceof HTMLElement ? originalAnnouncement : null;
    const originalNodeConnected = Boolean(originalNode?.isConnected);
    const sameOriginalNode = Boolean(originalNode && originalNode === node);
    const liveCount = document.querySelectorAll('#announcement').length;
    const app = document.querySelector<HTMLElement>('#app');
    const compactMode = app?.dataset.campaignHud === 'compact';
    const oldScrollTop = details?.scrollTop ?? 0;
    const issues: string[] = [];
    const innerBox = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect(), left = rect.left + element.clientLeft, top = rect.top + element.clientTop;
      return { left, top, right: left + element.clientWidth, bottom: top + element.clientHeight };
    };
    const clipChain = [];
    for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor), rect = ancestor.getBoundingClientRect();
      clipChain.push({ id: ancestor.id || null, className: typeof ancestor.className === 'string' ? ancestor.className : '',
        hidden: ancestor.hidden, display: style.display, visibility: style.visibility, opacity: style.opacity,
        contentVisibility: style.contentVisibility, overflowX: style.overflowX, overflowY: style.overflowY,
        clip: style.clip, clipPath: style.clipPath, contain: style.contain,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        contentBox: { left: rect.left + ancestor.clientLeft, top: rect.top + ancestor.clientTop,
          right: rect.left + ancestor.clientLeft + ancestor.clientWidth, bottom: rect.top + ancestor.clientTop + ancestor.clientHeight } });
    }
    const nodeVisibility = getComputedStyle(node).visibility;
    const firstNonVisible = clipChain.find(item => item.hidden || item.display === 'none'
      || item.opacity === '0' || item.contentVisibility === 'hidden');
    if (liveCount !== 1) issues.push(`expected one live announcement node, found ${liveCount}`);
    if (!originalNodeConnected || !sameOriginalNode) issues.push('original live announcement node was removed or replaced');
    if (firstNonVisible) issues.push(`announcement has non-visible ancestor ${firstNonVisible.id || firstNonVisible.className}`);
    if (nodeVisibility === 'hidden' || nodeVisibility === 'collapse') issues.push(`announcement computed visibility is ${nodeVisibility}`);
    if (clipChain.some(item => item.clipPath !== 'none' || item.clip !== 'auto' || item.contain.split(/\s+/).includes('paint')))
      issues.push('announcement has clip-path, legacy clip, or paint containment that this geometry check cannot resolve');
    const compactPriorityZero = priorityValue < 1 && compactMode;
    if (compactPriorityZero) {
      if (!details || !details.contains(node)) issues.push('compact priority-0 live announcement is outside the permitted secondary detail viewport');
      if (details && !['auto', 'scroll'].includes(getComputedStyle(details).overflowY)) issues.push('compact priority-0 detail viewport is not vertically scrollable');
    } else if (details && priorityValue >= 1 && details.contains(node)) {
      issues.push('priority-4 announcement depends on the secondary scroll viewport');
    }
    if (!compactPriorityZero && details) details.scrollTop = 0;

    const glyphs: Array<{ index: number; character: string; whitespace: boolean; initialRect: any; testedScrollTop: number | null; visibleRect: any; visible: boolean; clips: string[] }> = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let textNode: Node | null, characterIndex = 0;
    const records: Array<{ index: number; character: string; whitespace: boolean; range: Range }> = [];
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent ?? '';
      let offset = 0;
      for (const character of Array.from(text)) {
        const range = document.createRange(); range.setStart(textNode, offset); range.setEnd(textNode, offset + character.length);
        records.push({ index: characterIndex++, character, whitespace: /^\s+$/u.test(character), range });
        offset += character.length;
      }
    }
    const visibleRectFor = (range: Range, allowCaret = false) => {
      let rect = range.getBoundingClientRect(), geometry = 'glyph';
      if (allowCaret && rect.width === 0 && rect.height > 0) geometry = 'zero-width whitespace line position';
      if ((rect.width <= 0 || rect.height <= 0) && allowCaret) {
        const candidates = [range.cloneRange(), range.cloneRange()];
        candidates[0].collapse(true); candidates[1].collapse(false);
        const caretRect = candidates.map(caret => caret.getBoundingClientRect()).find(candidate => candidate.height > 0);
        if (caretRect) { rect = caretRect; geometry = caretRect.width === 0 ? 'zero-width whitespace caret' : 'whitespace caret'; }
      }
      const zeroWidthWhitespacePosition = allowCaret && geometry.startsWith('zero-width whitespace') && rect.width === 0 && rect.height > 0;
      if ((!zeroWidthWhitespacePosition && rect.width <= 0) || rect.height <= 0)
        return { rect: null, clips: ['no glyph or whitespace-caret line-position rectangle'], visible: false, geometry };
      let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
      const clips: string[] = [];
      for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), box = innerBox(ancestor);
        const name = ancestor.id || ancestor.className || ancestor.tagName.toLowerCase();
        if (style.overflowX !== 'visible') {
          if (left < box.left - 0.5 || right > box.right + 0.5) clips.push(`${name}:x`);
          left = Math.max(left, box.left); right = Math.min(right, box.right);
        }
        if (style.overflowY !== 'visible') {
          if (top < box.top - 0.5 || bottom > box.bottom + 0.5) clips.push(`${name}:y`);
          top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);
        }
      }
      if (left < -0.5 || right > innerWidth + 0.5) clips.push('browser-viewport:x');
      if (top < -0.5 || bottom > innerHeight + 0.5) clips.push('browser-viewport:y');
      left = Math.max(0, left); top = Math.max(0, top); right = Math.min(innerWidth, right); bottom = Math.min(innerHeight, bottom);
      const fullyVisible = clips.length === 0 && left <= rect.left + 0.5 && top <= rect.top + 0.5 && right >= rect.right - 0.5 && bottom >= rect.bottom - 0.5;
      return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }, clips, visible: fullyVisible, geometry };
    };
    const characterRectFor = (record: { whitespace: boolean; range: Range }) => {
      const direct = visibleRectFor(record.range, record.whitespace);
      if (direct.rect || !record.whitespace) return direct;
      const container = record.range.startContainer, text = container.textContent ?? '';
      const context = document.createRange();
      context.setStart(container, Math.max(0, record.range.startOffset - 1));
      context.setEnd(container, Math.min(text.length, record.range.endOffset + 1));
      const measured = visibleRectFor(context);
      return { ...measured, geometry: measured.rect ? 'whitespace context' : measured.geometry };
    };

    for (const record of records) {
      const initial = characterRectFor(record);
      let testedScrollTop: number | null = null, result = initial;
      if (compactPriorityZero && details && initial.rect) {
        const box = innerBox(details), maxScroll = Math.max(0, details.scrollHeight - details.clientHeight);
        const startHeight = initial.rect.bottom - initial.rect.top;
        const delta = initial.rect.top - box.top - (details.clientHeight - startHeight) / 2;
        details.scrollTop = Math.max(0, Math.min(maxScroll, details.scrollTop + delta));
        testedScrollTop = details.scrollTop;
        result = characterRectFor(record);
      }
      const visible = result.visible;
      if (!visible) issues.push(`character ${record.index} ${JSON.stringify(record.character)} is never fully visible${result.clips.length ? ` (${result.clips.join(',')})` : ''}`);
      glyphs.push({ index: record.index, character: record.character, whitespace: record.whitespace,
        initialRect: initial.rect, initialGeometry: initial.geometry, testedScrollTop, visibleRect: result.rect,
        visibleGeometry: result.geometry, visible, clips: result.clips });
    }
    if (details) details.scrollTop = oldScrollTop;
    const allGlyphsVisible = glyphs.length > 0 && glyphs.every(glyph => glyph.visible);
    if (!glyphs.length) issues.push('announcement contains no measurable characters');
    const visibleBox = visibleRectFor((() => { const range = document.createRange(); range.selectNodeContents(node); return range; })());
    return { ok: issues.length === 0 && allGlyphsVisible, priority: priorityValue, liveCount,
      route: compactPriorityZero ? 'compact secondary details with per-character scroll reachability' : 'direct visible announcement',
      campaignHudMode: compactMode ? 'compact' : 'full', sameOriginalNode, originalNodeConnected,
      text: node.textContent, elementRect: (() => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(),
      visibleBox, viewport: { width: innerWidth, height: innerHeight },
      secondaryDetails: details ? { containsLiveNode: details.contains(node), hidden: details.hidden,
        rect: (() => { const r = details.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(),
        clientWidth: details.clientWidth, clientHeight: details.clientHeight, scrollWidth: details.scrollWidth, scrollHeight: details.scrollHeight,
        overflowX: getComputedStyle(details).overflowX, overflowY: getComputedStyle(details).overflowY } : null,
      clipChain, glyphs, issues };
  }, { priorityValue: priority, originalAnnouncement: originalAnnouncementHandle });
}

async function inspectSecondaryHudReachability(page: Page, originalNodesHandle: any, originalText: Record<string, string | null>) {
  return originalNodesHandle.evaluate((originalNodes, input) => {
    const { readouts, expectedText } = input;
    const details = document.querySelector<HTMLElement>('#campaign-hud-details');
    const issues: string[] = [];
    if (!details) return { ok: false, issues: ['missing #campaign-hud-details'], viewport: null, readouts: [] };
    const innerBox = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect(), left = rect.left + element.clientLeft, top = rect.top + element.clientTop;
      return { left, top, right: left + element.clientWidth, bottom: top + element.clientHeight };
    };
    const viewportStyle = getComputedStyle(details), viewportRect = details.getBoundingClientRect();
    const viewport = { hidden: details.hidden, display: viewportStyle.display, visibility: viewportStyle.visibility,
      rect: { left: viewportRect.left, top: viewportRect.top, right: viewportRect.right, bottom: viewportRect.bottom,
        width: viewportRect.width, height: viewportRect.height }, scrollTop: details.scrollTop,
      scrollHeight: details.scrollHeight, clientHeight: details.clientHeight, scrollWidth: details.scrollWidth,
      clientWidth: details.clientWidth, overflowX: viewportStyle.overflowX, overflowY: viewportStyle.overflowY };
    if (details.hidden || viewportStyle.display === 'none' || viewportStyle.visibility === 'hidden'
      || viewportRect.width <= 0 || viewportRect.height <= 0 || !['auto', 'scroll'].includes(viewportStyle.overflowY))
      issues.push('secondary detail viewport is not visibly scrollable');
    if (viewport.scrollWidth > viewport.clientWidth + 2) issues.push(`secondary detail viewport has horizontal overflow ${viewport.scrollWidth}/${viewport.clientWidth}`);
    const oldScrollTop = details.scrollTop;
    const readoutEvidence: any[] = [];
    for (const readout of readouts) {
      const matches = [...document.querySelectorAll<HTMLElement>(readout.selector)];
      const node = matches[0] ?? null;
      const original = originalNodes?.[readout.key] instanceof HTMLElement ? originalNodes[readout.key] as HTMLElement : null;
      const expected = expectedText[readout.key];
      const nodeIssues: string[] = [];
      const text = node?.textContent ?? null;
      const nodeStyle = node ? getComputedStyle(node) : null;
      const nodeRect = node?.getBoundingClientRect();
      const inDetails = Boolean(node && details.contains(node));
      const sameOriginalNode = Boolean(node && original && node === original && original.isConnected);
      if (matches.length !== 1) nodeIssues.push(`expected one ${readout.selector}, found ${matches.length}`);
      if (!node || !sameOriginalNode) nodeIssues.push('original live node was removed or replaced');
      if (!node || !inDetails || node.dataset.campaignDetail !== readout.detailKey)
        nodeIssues.push(`original live node is outside detail slot ${readout.detailKey}`);
      if (!node || node.hidden || !nodeStyle || nodeStyle.display === 'none' || nodeStyle.visibility === 'hidden'
        || nodeStyle.opacity === '0' || !nodeRect || nodeRect.width <= 0 || nodeRect.height <= 0 || node.closest('[hidden], [aria-hidden="true"], [inert]'))
        nodeIssues.push('original live node is hidden or has no rendered box');
      if (typeof expected !== 'string' || !expected.trim() || text !== expected)
        nodeIssues.push(`original live text changed or was empty: expected ${JSON.stringify(expected)}, received ${JSON.stringify(text)}`);
      if (node && readout.key === 'reload-status' && !text?.includes('再装填中')) nodeIssues.push('reload status text does not identify active reloading');
      if (node && readout.key === 'campaign-threat' && (!text?.trim() || node.getAttribute('role') !== 'status'
        || node.getAttribute('aria-live') !== 'polite')) nodeIssues.push('threat readout text or live status semantics are missing');
      if (node && readout.key === 'campaign-limit') {
        const timer = node.querySelector<HTMLElement>('#remaining-time');
        if (!text?.includes('期限まで') || !timer?.textContent?.trim() || !/^\d+:\d{2}$/u.test(timer.textContent.trim()))
          nodeIssues.push('remaining mission time label or live value is missing');
      }
      if (node && readout.key === 'ammo') {
        const machineGun = node.querySelector<HTMLElement>('#mg-ammo'), cannon = node.querySelector<HTMLElement>('#cannon-ammo');
        if (node.getAttribute('aria-label') !== '残弾数' || !text?.includes('機銃') || !text.includes('機関砲')
          || !machineGun?.textContent?.trim() || !cannon?.textContent?.trim()) nodeIssues.push('live machine-gun or cannon ammunition readout is missing');
      }
      const glyphs: any[] = [];
      if (node) {
        details.scrollTop = 0;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let textNode: Node | null, index = 0;
        const records: Array<{ index: number; character: string; whitespace: boolean; range: Range }> = [];
        while ((textNode = walker.nextNode())) {
          const value = textNode.textContent ?? '';
          let offset = 0;
          for (const character of Array.from(value)) {
            const range = document.createRange(); range.setStart(textNode, offset); range.setEnd(textNode, offset + character.length);
            records.push({ index: index++, character, whitespace: /^\s+$/u.test(character), range });
            offset += character.length;
          }
        }
        if (!records.length) nodeIssues.push('detail readout contains no measurable text characters');
        const visibleRectFor = (range: Range, allowCaret: boolean) => {
          let rect = range.getBoundingClientRect(), geometry = 'glyph';
          if (allowCaret && rect.width === 0 && rect.height > 0) geometry = 'zero-width whitespace line position';
          if ((rect.width <= 0 || rect.height <= 0) && allowCaret) {
            const candidates = [range.cloneRange(), range.cloneRange()];
            candidates[0].collapse(true); candidates[1].collapse(false);
            const caret = candidates.map(candidate => candidate.getBoundingClientRect()).find(candidate => candidate.height > 0);
            if (caret) { rect = caret; geometry = caret.width === 0 ? 'zero-width whitespace caret' : 'whitespace caret'; }
          }
          if ((rect.width <= 0 || rect.height <= 0) && allowCaret) {
            const container = range.startContainer, value = container.textContent ?? '';
            const context = document.createRange();
            context.setStart(container, Math.max(0, range.startOffset - 1));
            context.setEnd(container, Math.min(value.length, range.endOffset + 1));
            const contextRect = context.getBoundingClientRect();
            if (contextRect.width > 0 && contextRect.height > 0) { rect = contextRect; geometry = 'whitespace line context'; }
          }
          const zeroWidthWhitespace = allowCaret && geometry.startsWith('zero-width whitespace') && rect.width === 0 && rect.height > 0;
          if ((!zeroWidthWhitespace && rect.width <= 0) || rect.height <= 0)
            return { rect: null, clips: ['no glyph or whitespace-caret line-position rectangle'], visible: false, geometry };
          let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
          const clips: string[] = [];
          for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor), box = innerBox(ancestor);
            const label = ancestor.id || (typeof ancestor.className === 'string' ? ancestor.className : '') || ancestor.tagName.toLowerCase();
            if (ancestor.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
              || style.opacity === '0' || style.contentVisibility === 'hidden') clips.push(`${label}:not-visible`);
            if (style.clipPath !== 'none' || style.clip !== 'auto' || style.contain.split(/\s+/u).includes('paint')) clips.push(`${label}:unsupported-clip`);
            if (style.overflowX !== 'visible') {
              if (left < box.left - 0.5 || right > box.right + 0.5) clips.push(`${label}:x`);
              left = Math.max(left, box.left); right = Math.min(right, box.right);
            }
            if (style.overflowY !== 'visible') {
              if (top < box.top - 0.5 || bottom > box.bottom + 0.5) clips.push(`${label}:y`);
              top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);
            }
          }
          if (left < -0.5 || right > innerWidth + 0.5) clips.push('browser-viewport:x');
          if (top < -0.5 || bottom > innerHeight + 0.5) clips.push('browser-viewport:y');
          const fullyVisible = clips.length === 0 && left <= rect.left + 0.5 && top <= rect.top + 0.5
            && right >= rect.right - 0.5 && bottom >= rect.bottom - 0.5;
          return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
            width: rect.width, height: rect.height }, clips, visible: fullyVisible, geometry };
        };
        for (const record of records) {
          let initial = visibleRectFor(record.range, record.whitespace);
          if (!initial.rect && record.whitespace) {
            const container = record.range.startContainer, value = container.textContent ?? '', context = document.createRange();
            context.setStart(container, Math.max(0, record.range.startOffset - 1));
            context.setEnd(container, Math.min(value.length, record.range.endOffset + 1));
            const measured = visibleRectFor(context, false);
            if (measured.rect) initial = { ...measured, geometry: 'whitespace line context' };
          }
          let testedScrollTop: number | null = null;
          if (initial.rect) {
            const box = innerBox(details), rect = initial.rect;
            if (rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5) {
              const maxScroll = Math.max(0, details.scrollHeight - details.clientHeight);
              const delta = rect.top - box.top - (details.clientHeight - rect.height) / 2;
              details.scrollTop = Math.max(0, Math.min(maxScroll, details.scrollTop + delta));
              testedScrollTop = details.scrollTop;
            } else testedScrollTop = details.scrollTop;
          }
          let result = visibleRectFor(record.range, record.whitespace);
          if (!result.rect && record.whitespace) {
            const container = record.range.startContainer, value = container.textContent ?? '', context = document.createRange();
            context.setStart(container, Math.max(0, record.range.startOffset - 1));
            context.setEnd(container, Math.min(value.length, record.range.endOffset + 1));
            const measured = visibleRectFor(context, false);
            if (measured.rect) result = { ...measured, geometry: 'whitespace line context' };
          }
          const visible = result.visible;
          if (!visible) nodeIssues.push(`character ${record.index} ${JSON.stringify(record.character)} is not scroll-reachable${result.clips.length ? ` (${result.clips.join(',')})` : ''}`);
          glyphs.push({ index: record.index, character: record.character, whitespace: record.whitespace,
            initialRect: initial.rect, initialGeometry: initial.geometry, testedScrollTop, visibleRect: result.rect,
            visibleGeometry: result.geometry, visible, clips: result.clips });
        }
      }
      const evidence = { key: readout.key, selector: readout.selector, expectedDetailKey: readout.detailKey,
        count: matches.length, connected: Boolean(node?.isConnected), sameOriginalNode, inDetails,
        campaignDetail: node?.dataset.campaignDetail ?? null, tabindex: node?.getAttribute('tabindex') ?? null,
        text, expectedText: expected, rect: nodeRect ? { x: nodeRect.x, y: nodeRect.y, width: nodeRect.width, height: nodeRect.height } : null,
        scroll: details ? { scrollTop: details.scrollTop, scrollHeight: details.scrollHeight, clientHeight: details.clientHeight,
          scrollWidth: details.scrollWidth, clientWidth: details.clientWidth } : null,
        characters: glyphs, characterCount: glyphs.length, reachableCharacterCount: glyphs.filter(glyph => glyph.visible).length,
        issues: nodeIssues };
      if (nodeIssues.length) issues.push(`${readout.key}: ${nodeIssues.join('; ')}`);
      readoutEvidence.push(evidence);
    }
    details.scrollTop = oldScrollTop;
    return { ok: issues.length === 0 && readoutEvidence.length === readouts.length
        && readoutEvidence.every(item => item.characterCount > 0 && item.characterCount === item.reachableCharacterCount && item.issues.length === 0),
      issues, viewport, readouts: readoutEvidence };
  }, { readouts: SECONDARY_HUD_READOUTS, expectedText: originalText });
}

async function inspectDirectSafetyHud(page: Page, alert: HudCase['alert']) {
  return page.evaluate(alertValue => {
    const details = document.querySelector<HTMLElement>('#campaign-hud-details');
    const warning = document.querySelector<HTMLElement>('#warning');
    const canvas = document.querySelector<HTMLCanvasElement>('#markers');
    const fullyVisibleThroughAncestors = (element: HTMLElement, rect: DOMRect) => {
      let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
      const clips: string[] = [];
      for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect();
        const box = { left: bounds.left + ancestor.clientLeft, top: bounds.top + ancestor.clientTop,
          right: bounds.left + ancestor.clientLeft + ancestor.clientWidth,
          bottom: bounds.top + ancestor.clientTop + ancestor.clientHeight };
        const name = ancestor.id || (typeof ancestor.className === 'string' ? ancestor.className : '') || ancestor.tagName.toLowerCase();
        if (ancestor.hidden || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.contentVisibility === 'hidden') clips.push(`${name}:not-visible`);
        if (style.clipPath !== 'none' || style.clip !== 'auto' || style.contain.split(/\s+/u).includes('paint')) clips.push(`${name}:unsupported-clip`);
        if (style.overflowX !== 'visible') {
          if (left < box.left - 0.5 || right > box.right + 0.5) clips.push(`${name}:x`);
          left = Math.max(left, box.left); right = Math.min(right, box.right);
        }
        if (style.overflowY !== 'visible') {
          if (top < box.top - 0.5 || bottom > box.bottom + 0.5) clips.push(`${name}:y`);
          top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);
        }
      }
      if (left < -0.5 || right > innerWidth + 0.5) clips.push('browser-viewport:x');
      if (top < -0.5 || bottom > innerHeight + 0.5) clips.push('browser-viewport:y');
      return { visible: clips.length === 0 && left <= rect.left + 0.5 && top <= rect.top + 0.5
        && right >= rect.right - 0.5 && bottom >= rect.bottom - 0.5, clips };
    };
    const activeWarning = ['outside', 'protected', 'low'].includes(alertValue);
    const warningStyle = warning ? getComputedStyle(warning) : null, warningRect = warning?.getBoundingClientRect();
    const warningClip = warning && warningRect ? fullyVisibleThroughAncestors(warning, warningRect) : { visible: false, clips: ['missing warning rect'] };
    const warningVisible = Boolean(warning && warningStyle && warningRect && !warning.hidden && !warning.closest('[hidden]')
      && warningStyle.display !== 'none' && warningStyle.visibility !== 'hidden' && warningStyle.opacity !== '0'
      && warningRect.width > 0 && warningRect.height > 0 && !details?.contains(warning) && warningClip.visible);
    const canvasStyle = canvas ? getComputedStyle(canvas) : null, canvasRect = canvas?.getBoundingClientRect();
    const canvasClip = canvas && canvasRect ? fullyVisibleThroughAncestors(canvas, canvasRect) : { visible: false, clips: ['missing canvas rect'] };
    const canvasVisible = Boolean(canvas && canvasStyle && canvasRect && !canvas.hidden && !canvas.closest('[hidden]')
      && canvasStyle.display !== 'none' && canvasStyle.visibility !== 'hidden' && canvasStyle.opacity !== '0'
      && canvasRect.width >= innerWidth - 1 && canvasRect.height >= innerHeight - 1 && !details?.contains(canvas)
      && canvasClip.visible);
    const expectedWarningText = alertValue === 'outside' ? '作戦圏へ戻って'
      : alertValue === 'protected' ? '復活保護' : alertValue === 'low' ? '低空注意' : null;
    const warningIssue = activeWarning
      ? !warning ? 'missing #warning' : !warningVisible ? '#warning is not directly visible on-screen outside secondary details'
        : expectedWarningText && !warning.textContent?.includes(expectedWarningText) ? `#warning text is missing ${expectedWarningText}` : null
      : !warning ? 'missing #warning' : !warning.hidden && warningStyle?.display !== 'none' ? 'unexpected DOM warning is visible in clear/respawn state' : null;
    const canvasIssue = canvasVisible ? null : '#markers Canvas overlay is hidden, clipped or outside the viewport';
    return { ok: !warningIssue && !canvasIssue,
      warning: { expectedDirectVisibility: activeWarning, visible: warningVisible, hidden: warning?.hidden ?? null,
        text: warning?.textContent ?? null, rect: warningRect ? { x: warningRect.x, y: warningRect.y, width: warningRect.width, height: warningRect.height } : null,
        clipChain: warningClip.clips, inSecondaryDetails: Boolean(warning && details?.contains(warning)), issue: warningIssue },
      canvasOverlay: { visible: canvasVisible, width: canvasRect?.width ?? null, height: canvasRect?.height ?? null,
        clipChain: canvasClip.clips, viewport: { width: innerWidth, height: innerHeight },
        inSecondaryDetails: Boolean(canvas && details?.contains(canvas)), issue: canvasIssue } };
  }, alert);
}

async function checkCanvasPixels(page: Page, mode: 'easy' | 'normal', canvas: any) {
  const pixels = await page.evaluate(({ mode, canvas }) => {
    const element = document.querySelector<HTMLCanvasElement>('#markers');
    const context = element?.getContext('2d');
    if (!element || !context || !canvas.sight || !canvas.radius) throw new Error('Product Canvas2D overlay is unavailable');
    const image = context.getImageData(0, 0, element.width, element.height), scaleX = element.width / canvas.width, scaleY = element.height / canvas.height;
    const at = (x: number, y: number) => {
      const px = Math.round(x * scaleX), py = Math.round(y * scaleY);
      if (px < 0 || py < 0 || px >= element.width || py >= element.height) return [0, 0, 0, 0];
      const i = (py * element.width + px) * 4; return [...image.data.slice(i, i + 4)];
    };
    const count = (rect: { x: number; y: number; width: number; height: number }, predicate: (rgba: number[]) => boolean) => {
      let total = 0;
      const left = Math.max(0, Math.floor(rect.x * scaleX)), top = Math.max(0, Math.floor(rect.y * scaleY));
      const right = Math.min(element.width, Math.ceil((rect.x + rect.width) * scaleX)), bottom = Math.min(element.height, Math.ceil((rect.y + rect.height) * scaleY));
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const i = (y * element.width + x) * 4; if (predicate([...image.data.slice(i, i + 4)])) total++;
      }
      return total;
    };
    const annulus = (cx: number, cy: number, radius: number, tolerance: number, predicate: (rgba: number[]) => boolean) => {
      const left = Math.max(0, Math.floor((cx - radius - tolerance) * scaleX)), right = Math.min(element.width, Math.ceil((cx + radius + tolerance) * scaleX));
      const top = Math.max(0, Math.floor((cy - radius - tolerance) * scaleY)), bottom = Math.min(element.height, Math.ceil((cy + radius + tolerance) * scaleY));
      let total = 0;
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const dx = x / scaleX - cx, dy = y / scaleY - cy, distance = Math.hypot(dx, dy);
        if (Math.abs(distance - radius) > tolerance) continue;
        const i = (y * element.width + x) * 4; if (predicate([...image.data.slice(i, i + 4)])) total++;
      }
      return total;
    };
    const { x, y } = canvas.sight, radius = canvas.radius;
    const ring = annulus(x, y, radius, 2.5, rgba => rgba[3] > 80);
    const reloadRing = annulus(x, y, radius + 7, 2.4, rgba => rgba[0] > 190 && rgba[1] > 135 && rgba[1] < 235 && rgba[2] > 65 && rgba[2] < 180 && rgba[3] > 100);
    const centerDot = count({ x: x - 2, y: y - 2, width: 4, height: 4 }, rgba => rgba[3] > 80);
    const crosshair = mode === 'normal' ? [
      [x - radius - 3, y], [x + radius + 3, y], [x, y - radius - 3], [x, y + radius + 3],
    ].map(([px, py]) => count({ x: px - 2, y: py - 2, width: 4, height: 4 }, rgba => rgba[3] > 40)) : [];
    const radar = canvas.hudLayout.radar?.rect;
    const radarPixels = radar ? count(radar, rgba => rgba[3] > 80) : 0;
    const threat = canvas.threatPoint;
    const warningPixels = threat ? annulus(threat.x, threat.y, 13, 2.5, rgba => rgba[0] > 180 && rgba[1] > 90 && rgba[1] < 205 && rgba[2] < 160 && rgba[3] > 70) : 0;
    const alphaPixels = count({ x: 0, y: 0, width: canvas.width, height: canvas.height }, rgba => rgba[3] > 0);
    return { alphaPixels, ring, reloadRing, centerDot, crosshair, radarPixels, warningPixels };
  }, { mode, canvas });
  expect(pixels.alphaPixels, 'Canvas2D product painter produced visible pixels').toBeGreaterThan(500);
  expect(pixels.ring, 'aim circle pixels exist at the product-projected sight').toBeGreaterThan(50);
  expect(pixels.reloadRing, 'fixed reload arc pixels exist around the aim circle').toBeGreaterThan(20);
  expect(pixels.centerDot, 'aim center pixels exist').toBeGreaterThan(0);
  expect(pixels.radarPixels, 'product radar pixels exist in its measured region').toBeGreaterThan(200);
  expect(pixels.warningPixels, 'product telegraph pixels exist at its projected warning point').toBeGreaterThan(5);
  if (mode === 'normal') for (const [index, count] of pixels.crosshair.entries()) expect(count, `normal crosshair arm ${index}`).toBeGreaterThan(0);
}

function recordHudFailure(failures: HudFailureRecord[], provenance: HudProvenance | 'aggregate', caseName: string, stage: string, message: string, stack?: string) {
  failures.push({ case: caseName, provenance, stage, message, ...(stack ? { stack } : {}) });
}

function recordHudError(failures: HudFailureRecord[], provenance: HudProvenance | 'aggregate', caseName: string, stage: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  recordHudFailure(failures, provenance, caseName, stage, message, stack);
}

function recordHudAssertion(failures: HudFailureRecord[], provenance: HudProvenance, caseName: string, stage: string, assertion: () => void) {
  try { assertion(); } catch (error) { recordHudError(failures, provenance, caseName, stage, error); }
}

async function recordHudAsyncAssertion(failures: HudFailureRecord[], provenance: HudProvenance, caseName: string, stage: string, assertion: () => Promise<unknown>) {
  try { await assertion(); } catch (error) { recordHudError(failures, provenance, caseName, stage, error); }
}

async function captureHudFailureEvidence(page: Page | undefined, info: TestInfo, coverage: HudCaseCoverage,
  failures: HudFailureRecord[], provenance: HudProvenance, caseName: string, stage: string, error: unknown, extra: unknown = null): Promise<number> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  recordHudFailure(failures, provenance, caseName, stage, message, stack);
  coverage.exceptionMessage = message;
  let screenshotMs = 0;
  const safeName = caseName.replace(/\.png$/i, '').replace(/[^a-z0-9-]/gi, '-');
  if (page) {
    try {
      const started = performance.now();
      const body = await page.screenshot({ animations: 'disabled' });
      await info.attach(`${provenance}-failure-${safeName}.png`, { body, contentType: 'image/png' });
      coverage.imageSaved = true;
      screenshotMs = performance.now() - started;
    } catch (captureError) {
      recordHudError(failures, provenance, caseName, 'failure-png-capture', captureError);
    }
  }
  let pageSnapshot: unknown = page ? null : { available: false, reason: 'page was not created or is unavailable' };
  if (page) {
    try {
      pageSnapshot = await page.evaluate(() => {
        const app = document.querySelector<HTMLElement>('#app');
        const read = (window as any).__fantasiaReadState;
        let state: unknown = null;
        try { state = typeof read === 'function' ? read(false) : null; } catch (error) { state = { readError: error instanceof Error ? error.message : String(error) }; }
        return { url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight },
          app: app ? { mode: app.dataset.mode ?? null, screen: app.dataset.screen ?? null, campaignHud: app.dataset.campaignHud ?? null } : null,
          text: document.body?.innerText?.slice(0, 12000) ?? '', announcement: document.querySelector('#announcement')?.textContent ?? null,
          state, canvases: [...document.querySelectorAll<HTMLCanvasElement>('canvas')].map(canvas => ({ id: canvas.id, width: canvas.width, height: canvas.height })) };
      });
    } catch (snapshotError) {
      pageSnapshot = { unavailable: true, exactError: snapshotError instanceof Error ? snapshotError.message : String(snapshotError) };
      recordHudError(failures, provenance, caseName, 'failure-json-page-snapshot', snapshotError);
    }
  }
  const failure = { case: caseName, provenance, stage, message, ...(stack ? { stack } : {}) };
  try {
    await info.attach(`${provenance}-failure-${safeName}.json`, {
      body: Buffer.from(JSON.stringify({ failure, pageAvailable: Boolean(page), pageSnapshot, coverage, extra }, null, 2)),
      contentType: 'application/json',
    });
    coverage.jsonSaved = true;
  } catch (attachError) {
    recordHudError(failures, provenance, caseName, 'failure-json-attach', attachError);
  }
  return screenshotMs;
}

async function inspectAndCaptureHudCase(page: Page, info: TestInfo, hudCase: HudCase, canvas: any, fixture: any, fontScale: any, freshBaseline: any, originalLivesNoteHandle: any, originalAnnouncementHandle: any, originalSecondaryNodesHandle: any, originalSecondaryText: Record<string, string | null>, provenance: HudProvenance, failures: HudFailureRecord[], coverage: HudCaseCoverage) {
  const { name, mode } = hudCase;
  const evidenceName = provenance === 'fresh-page' ? `fresh-page-${name}` : name;
  const screenshotMs = await capture(page, info, evidenceName, coverage);
  const layoutEvidence = await act(page, 'evidence');
  const announcementReachability = await inspectAnnouncementReachability(page, hudCase.priority, originalAnnouncementHandle);
  let secondaryHudReachability: any;
  try { secondaryHudReachability = await inspectSecondaryHudReachability(page, originalSecondaryNodesHandle, originalSecondaryText); }
  catch (error) {
    secondaryHudReachability = { ok: false, issues: [error instanceof Error ? error.message : String(error)], readouts: [],
      inspectionErrorStack: error instanceof Error ? error.stack : undefined };
  }
  let directSafetyHud: any;
  try { directSafetyHud = await inspectDirectSafetyHud(page, hudCase.alert); }
  catch (error) {
    directSafetyHud = { ok: false, warning: { expectedDirectVisibility: ['outside', 'protected', 'low'].includes(hudCase.alert), issue: null },
      canvasOverlay: { issue: null }, inspectionError: error instanceof Error ? error.message : String(error),
      inspectionErrorStack: error instanceof Error ? error.stack : undefined };
  }
  const domEvidence = await page.evaluate(() => {
    const selectors = [
      '.hud-top', '.hud-top .time-block', '#campaign-sites .campaign-site[data-site]', '.flight-data > *',
      '#campaign-threat', '#payload-status', '#reload-status', '#warning', '#announcement', '#respawn-status',
      '#flight-tip', '#throttle-layout-note', '#campaign-hud-details', '#normal-controls', '#fire', '#throttle',
    ];
    const nodes = selectors.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)]).map(node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return {
        selector: node.id ? `#${node.id}` : node.dataset.site ? `${node.className}[data-site=${node.dataset.site}]` : node.className || node.tagName,
        visible: !node.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !node.closest('[hidden]'),
        text: node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 160),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        scroll: { width: node.scrollWidth, height: node.scrollHeight, clientWidth: node.clientWidth, clientHeight: node.clientHeight },
        style: { position: style.position, fontSize: style.fontSize, overflowX: style.overflowX, overflowY: style.overflowY, visibility: style.visibility, display: style.display },
      };
    });
    const announcement = document.querySelector<HTMLElement>('#announcement');
    const app = document.querySelector<HTMLElement>('#app');
    return { viewport: { width: innerWidth, height: innerHeight }, mode: app?.dataset.mode, screen: app?.dataset.screen,
      campaignHud: app?.dataset.campaignHud, announcement: { visible: Boolean(announcement && !announcement.hidden && getComputedStyle(announcement).display !== 'none' && getComputedStyle(announcement).visibility !== 'hidden'),
        text: announcement?.textContent, critical: announcement?.dataset.campaignCritical }, nodes };
  });
  const layout = layoutEvidence?.layout;
  const areaBound = campaignHudAreaEvidence(layoutEvidence?.searchInput, layoutEvidence?.sight, layout, mode);
  const productRing = layout?.obstacles?.find((rect: any) => rect.id === 'aim-and-reload-ring');
  const pointOnlyLayout = layout?.obstacles ? { ...layout, obstacles: layout.obstacles.map((rect: any) => rect.id === 'aim-and-reload-ring'
    ? { id: rect.id, x: layoutEvidence?.sight?.x, y: layoutEvidence?.sight?.y } : rect) } : layout;
  const missingRingLayout = layout?.obstacles ? { ...layout, obstacles: layout.obstacles.filter((rect: any) => rect.id !== 'aim-and-reload-ring') } : layout;
  const duplicateRingLayout = layout?.obstacles && productRing ? { ...layout, obstacles: [...layout.obstacles, { ...productRing }] } : layout;
  const malformedRingLayout = layout?.obstacles ? { ...layout, obstacles: layout.obstacles.map((rect: any) => rect.id === 'aim-and-reload-ring'
    ? { ...rect, width: 0 } : rect) } : layout;
  const pointOnlyAreaEvidence = campaignHudAreaEvidence(layoutEvidence?.searchInput, layoutEvidence?.sight, pointOnlyLayout, mode);
  const missingRingAreaEvidence = campaignHudAreaEvidence(layoutEvidence?.searchInput, layoutEvidence?.sight, missingRingLayout, mode);
  const duplicateRingAreaEvidence = campaignHudAreaEvidence(layoutEvidence?.searchInput, layoutEvidence?.sight, duplicateRingLayout, mode);
  const malformedRingAreaEvidence = campaignHudAreaEvidence(layoutEvidence?.searchInput, layoutEvidence?.sight, malformedRingLayout, mode);
  const overlapFixtureRects = [
    { x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 0, width: 10, height: 10 },
  ];
  const overlapFixtureBounds = { x: 0, y: 0, width: 20, height: 10 };
  const overlappingAreaFixture = rectangleUnionArea(overlapFixtureRects, overlapFixtureBounds);
  recordHudAssertion(failures, provenance, name, 'fixed-rectangle-union-regression', () => expect(overlappingAreaFixture).toBe(150));
  recordHudAssertion(failures, provenance, name, 'point-only-aim-reload-reservation-rejection', () => expect(pointOnlyAreaEvidence.status).toBe('invalid'));
  recordHudAssertion(failures, provenance, name, 'missing-aim-reload-reservation-rejection', () => expect(missingRingAreaEvidence.status).toBe('invalid'));
  recordHudAssertion(failures, provenance, name, 'duplicate-aim-reload-reservation-rejection', () => expect(duplicateRingAreaEvidence.status).toBe('invalid'));
  recordHudAssertion(failures, provenance, name, 'malformed-aim-reload-reservation-rejection', () => expect(malformedRingAreaEvidence.status).toBe('invalid'));
  const blockedReasons = layout?.status === 'blocked'
    ? [
      ...(layout.fixedConflicts?.length ? [{ kind: 'fixed-conflicts', pairs: layout.fixedConflicts }] : []),
      ...(layout.searchChecks >= 120000 ? [{ kind: 'bounded-search-exhausted', checks: layout.searchChecks, limit: 120000 }] : []),
      ...(!layout.fixedConflicts?.length && layout.searchChecks < 120000 ? [{ kind: 'no-complete-full-size-packing', searchChecks: layout.searchChecks }] : []),
      ...(areaBound.status === 'measured' && areaBound.shortageGap0 ? [{ kind: 'necessary-area-shortage', gap: 0, required: areaBound.requiredArea, availableUpperBound: areaBound.availableUpperBoundGap0, deficit: areaBound.deficitGap0 }] : []),
      ...(areaBound.status === 'measured' && areaBound.shortageGap4 ? [{ kind: 'necessary-area-shortage', gap: 4, required: areaBound.requiredArea, availableUpperBound: areaBound.availableUpperBoundGap4, deficit: areaBound.deficitGap4 }] : []),
    ]
    : layout?.status === 'invalid' ? [{ kind: 'invalid-search-geometry', searchInput: layoutEvidence.searchInput, sight: layoutEvidence.sight }]
      : [];
  if (layout?.status !== 'placed') recordHudFailure(failures, provenance, name, 'canvas-hud-placement', `${name}: Canvas HUD placement status=${layout?.status ?? 'missing'}; blockedReasons=${JSON.stringify(blockedReasons)}; searchChecks=${layout?.searchChecks ?? 'missing'}; fixedConflicts=${JSON.stringify(layout?.fixedConflicts ?? [])}`);
  if (areaBound.status !== 'measured') recordHudFailure(failures, provenance, name, 'necessary-area-evidence', `${name}: necessary-area evidence unavailable or invalid: ${JSON.stringify(areaBound)}`);
  else {
    if (!areaBound.inferenceComparison?.matches) recordHudFailure(failures, provenance, name, 'product-measured-ring-comparison', `${name}: radius-derived aim/reload rectangle disagrees with the product measured layout.obstacles rectangle: ${JSON.stringify(areaBound.inferenceComparison)}`);
    if (areaBound.shortageGap0) recordHudFailure(failures, provenance, name, 'necessary-area-shortage-gap-0', `${name}: necessary area exceeds free-space upper bound at gap 0: required=${areaBound.requiredArea}; available=${areaBound.availableUpperBoundGap0}; deficit=${areaBound.deficitGap0}`);
    if (areaBound.shortageGap4) recordHudFailure(failures, provenance, name, 'necessary-area-shortage-product-gap-4', `${name}: necessary area exceeds free-space upper bound at product gap 4: required=${areaBound.requiredArea}; available=${areaBound.availableUpperBoundGap4}; deficit=${areaBound.deficitGap4}`);
  }
  if (!announcementReachability.ok) recordHudFailure(failures, provenance, name, 'announcement-character-reachability', `${name}: announcement characters are not fully reachable through actual ancestor clipping: ${JSON.stringify(announcementReachability.issues)}`);
  if (!secondaryHudReachability.ok) recordHudFailure(failures, provenance, name,
    'secondary-live-readout-reachability', `${name}: one or more original live HUD details are not scroll-reachable: ${JSON.stringify(secondaryHudReachability.issues)}`,
    secondaryHudReachability.inspectionErrorStack);
  if (directSafetyHud.inspectionError) recordHudFailure(failures, provenance, name, 'direct-warning-canvas-inspection', `${name}: ${directSafetyHud.inspectionError}`, directSafetyHud.inspectionErrorStack);
  else if (directSafetyHud.warning.issue)
    recordHudFailure(failures, provenance, name, 'direct-warning-visibility', `${name}: ${directSafetyHud.warning.issue}`);
  if (directSafetyHud.canvasOverlay.issue) recordHudFailure(failures, provenance, name, 'direct-canvas-overlay-visibility', `${name}: ${directSafetyHud.canvasOverlay.issue}`);
  const semanticLiveNote = await semanticTypographyIdentity(page, originalLivesNoteHandle);
  const expectedLiveNote = freshBaseline?.baseline?.semanticNodes?.targetLivesNote;
  const semanticLiveNoteIssues: string[] = [];
  if (!expectedLiveNote || expectedLiveNote.count !== 1) semanticLiveNoteIssues.push(`fresh baseline expected exactly one lives-note, got ${expectedLiveNote?.count ?? 'missing'}`);
  if (semanticLiveNote.count !== 1) semanticLiveNoteIssues.push(`current DOM expected exactly one lives-note, got ${semanticLiveNote.count}`);
  if (!semanticLiveNote.sameOriginalNodeConnected || !semanticLiveNote.sameOriginalNodeFound) semanticLiveNoteIssues.push('original lives-note DOM node was removed or replaced');
  let semanticLiveNoteValid = false;
  if (semanticLiveNote.count === 1) {
    const actual = semanticLiveNote.nodes[0], original = expectedLiveNote?.nodes?.[0];
    if (!actual.connected) semanticLiveNoteIssues.push('lives-note node is disconnected');
    if (actual.text !== original?.text) semanticLiveNoteIssues.push(`lives-note text changed from ${JSON.stringify(original?.text)} to ${JSON.stringify(actual.text)}`);
    const allowedLocation = actual.inTargetTally || (actual.inSecondaryDetails && actual.campaignDetail === 'lives-note');
    if (!allowedLocation) semanticLiveNoteIssues.push(`lives-note is outside its target tally and permitted secondary detail slot: ${JSON.stringify(actual)}`);
    semanticLiveNoteValid = Boolean(actual.connected && semanticLiveNote.sameOriginalNodeConnected && semanticLiveNote.sameOriginalNodeFound
      && actual.text === original?.text && allowedLocation);
  }
  if (semanticLiveNoteIssues.length) recordHudFailure(failures, provenance, name, 'semantic-lives-note-identity', `${name}: semantic lives-note identity/reparenting failed: ${JSON.stringify(semanticLiveNoteIssues)}`);
  const freshSamples = freshBaseline?.baseline?.samples ?? [];
  const fontComparisons = compareTypography({ samples: freshSamples }, { samples: fontScale.fontBaselines ?? [] });
  const announcementTypography = fontComparisons.find(sample => sample.selector === '#announcement');
  const isValidSemanticTallyReparentProbe = (sample: any) => semanticLiveNoteValid
    && sample.selector === '.target-tally > small' && sample.text === '現在機を含む';
  const unexpectedCurrentProbes = fontComparisons.filter(sample => sample.expectedBasePx === null && !isValidSemanticTallyReparentProbe(sample));
  const actualTypographyKeys = new Set((fontScale.fontBaselines ?? []).map((sample: TypographySample) => sample.key));
  const livesNoteTallyProbeKeys = new Set(freshSamples.filter((sample: TypographySample) =>
    sample.selector === '.target-tally > small' && sample.text === '現在機を含む').map((sample: TypographySample) => sample.key));
  const missingCurrentProbes = freshSamples.filter((sample: TypographySample) => !actualTypographyKeys.has(sample.key)
    && !(semanticLiveNoteValid && livesNoteTallyProbeKeys.has(sample.key)));
  const staleFontSamples = fontComparisons.filter(sample => (!sample.matchesFreshBaseline || !sample.matchesExpected200)
    && !isValidSemanticTallyReparentProbe(sample));
  const cssAnnouncementBaseline = freshBaseline?.cssBeforeFixture?.samples?.find((sample: TypographySample) => sample.selector === '#announcement');
  const expectedCssAnnouncementBaseline = hudCase.width > hudCase.height && hudCase.height <= 600 ? 10 : 12;
  if (!freshBaseline) recordHudFailure(failures, provenance, name, 'matching-fresh-baseline', `${name}: matching fresh-page counterpart is missing`);
  if (cssAnnouncementBaseline && Math.abs(cssAnnouncementBaseline.basePx - expectedCssAnnouncementBaseline) >= 0.1) {
    recordHudFailure(failures, provenance, name, 'fresh-css-announcement-baseline', `${name}: fresh CSS announcement baseline was ${cssAnnouncementBaseline.basePx}px, expected ${expectedCssAnnouncementBaseline}px for ${hudCase.width}×${hudCase.height}`);
  }
  if (unexpectedCurrentProbes.length) recordHudFailure(failures, provenance, name, 'unexpected-typography-probes', `${name}: current typography probes lack a matching fresh-page entry: ${JSON.stringify(unexpectedCurrentProbes.map(sample => sample.key))}`);
  if (missingCurrentProbes.length) recordHudFailure(failures, provenance, name, 'missing-typography-probes', `${name}: fresh typography probes are missing from the rotation/stress state: ${JSON.stringify(missingCurrentProbes.map((sample: TypographySample) => sample.key))}`);
  if (staleFontSamples.length) recordHudFailure(failures, provenance, name, 'fresh-typography-comparison', `${name}: current base/applied typography differs from the fresh-page values: ${JSON.stringify(staleFontSamples)}`);
  if (freshBaseline?.fixtureBaselineDrift?.length) recordHudFailure(failures, provenance, name, 'fixture-font-baseline-drift', `${name}: fresh fixture changed a CSS font baseline during reparenting: ${JSON.stringify(freshBaseline.fixtureBaselineDrift)}`);
  const evidence = {
    case: name,
    provenance,
    viewport: domEvidence.viewport,
    mode,
    announcementPriority: fixture.announcementPriority,
    announcement: domEvidence.announcement,
    announcementReachability,
    secondaryHudReachability,
    secondaryHudOriginalText: originalSecondaryText,
    directSafetyHud,
    semanticLiveNote,
    semanticLiveNoteIssues,
    dom: domEvidence,
    freshBaseline: freshBaseline ? { viewportBeforeSetup: freshBaseline.viewportBeforeSetup,
      cssBeforeFixture: freshBaseline.cssBeforeFixture, baseline: freshBaseline.baseline,
      fixtureBaselineDrift: freshBaseline.fixtureBaselineDrift, fixtureInlineStyleChanges: freshBaseline.fixtureInlineStyleChanges } : null,
    fontBaselines: fontScale.fontBaselines,
    fontComparisons,
    unexpectedCurrentProbes: unexpectedCurrentProbes.map(sample => sample.key),
    missingCurrentProbes: missingCurrentProbes.map((sample: TypographySample) => sample.key),
    searchInput: layoutEvidence.searchInput,
    sight: layoutEvidence.sight,
    layout,
    areaBound,
    areaDiagnosticRegression: {
      pointOnlyRingInput: { input: { id: 'aim-and-reload-ring', x: layoutEvidence?.sight?.x, y: layoutEvidence?.sight?.y }, expectedStatus: 'invalid', actualStatus: pointOnlyAreaEvidence.status },
      missingRing: { expectedStatus: 'invalid', actualStatus: missingRingAreaEvidence.status },
      duplicateRing: { expectedStatus: 'invalid', candidateCount: 2, actualStatus: duplicateRingAreaEvidence.status },
      malformedRing: { expectedStatus: 'invalid', input: { ...productRing, width: 0 }, actualStatus: malformedRingAreaEvidence.status },
      overlappingFixedRectangles: { rectangles: overlapFixtureRects, bounds: overlapFixtureBounds,
        naiveArea: overlapFixtureRects.reduce((sum, rect) => sum + rect.width * rect.height, 0),
        unionArea: overlappingAreaFixture, deduplicatedArea: 50 },
    },
    searchBudget: { checks: layout?.searchChecks ?? null, limit: 120000,
      state: layout?.status === 'placed' ? 'completed' : layout?.searchChecks >= 120000 ? 'exhausted' : 'stopped-before-limit',
      areaClassification: areaBound.status !== 'measured' ? 'invalid-area-evidence'
        : areaBound.shortageGap0 ? 'necessary-area-shortage-even-at-zero-gap'
          : areaBound.shortageGap4 ? 'necessary-area-shortage-at-product-gap-4'
            : 'area-alone-does-not-prove-impossibility',
      searchClassification: layout?.status === 'blocked' && layout?.searchChecks >= 120000 ? 'bounded-search-exhaustion'
        : layout?.status === 'blocked' ? 'blocked-before-search-limit'
          : layout?.status ?? 'missing' },
    blockedReasons,
  };
  await info.attach(`${evidenceName}.json`, { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
  coverage.jsonSaved = true;
  console.log(`[ui-only-layout-evidence] ${JSON.stringify({ case: name, provenance, viewport: evidence.viewport, mode, announcementPriority: fixture.announcementPriority,
    layoutStatus: layout?.status ?? 'missing', searchChecks: layout?.searchChecks ?? null, fixedConflicts: layout?.fixedConflicts ?? [],
    safeArea: areaBound.safeArea ?? null, requiredArea: areaBound.requiredArea ?? null,
    availableUpperBoundGap0: areaBound.availableUpperBoundGap0 ?? null, availableUpperBoundGap4: areaBound.availableUpperBoundGap4 ?? null,
    shortageGap0: areaBound.shortageGap0 ?? null, shortageGap4: areaBound.shortageGap4 ?? null,
    announcementReachable: announcementReachability.ok, secondaryReadoutsReachable: secondaryHudReachability.ok,
    secondaryReadoutCharacterCounts: secondaryHudReachability.readouts.map((readout: any) => ({ key: readout.key,
      total: readout.characterCount, reachable: readout.reachableCharacterCount, sameOriginalNode: readout.sameOriginalNode,
      detailKey: readout.campaignDetail })), directSafetyHud, announcementTypography, typographyMismatchCount: staleFontSamples.length, blockedReasons })}`);
  recordHudAssertion(failures, provenance, name, 'announcement-visible',
    () => expect(domEvidence.announcement.visible).toBe(true));
  recordHudAssertion(failures, provenance, name, 'announcement-text',
    () => expect(domEvidence.announcement.text).toContain('砲台の予告'));
  recordHudAssertion(failures, provenance, name, 'announcement-priority-flag',
    () => expect(domEvidence.announcement.critical).toBe(String(fixture.announcementPriority >= 1)));
  for (const font of fontScale.fontBaselines ?? []) recordHudAssertion(failures,
    provenance, name, `200-percent-font-size-${font.selector}`,
    () => expect(Math.abs(font.appliedPx - font.basePx * 2)).toBeLessThan(0.1));
  for (const [selector, expectedBasePx] of [['#hud', 16], ['.instrument', 10], ['#health', 15]] as const) {
    const sample = fontScale.fontBaselines?.find((font: any) => font.selector === selector);
    recordHudAssertion(failures, provenance, name, `fresh-product-font-baseline-${selector}`,
      () => expect(sample?.basePx).toBe(expectedBasePx));
  }
  const runCheck = async (label: string, check: () => Promise<unknown>) => {
    try { await check(); } catch (error) { recordHudError(failures, provenance, name, label, error); }
  };
  await runCheck('Canvas pixels', () => checkCanvasPixels(page, mode, canvas));
  await runCheck('DOM and Canvas HUD geometry', () => checkHudGeometry(page));
  await runCheck('44px HUD controls', () => checkGeometry(page, '#hud'));
  return { screenshotMs, areaBound, areaClassification: evidence.searchBudget.areaClassification,
    layoutStatus: layout?.status ?? 'missing', searchChecks: layout?.searchChecks ?? null, blockedReasons };
}

test.afterAll(() => {
  const totals = timings.reduce((sum, item) => ({ setupMs: sum.setupMs + item.setupMs, tourMs: sum.tourMs + item.tourMs, captureMs: sum.captureMs + item.captureMs }), { setupMs: 0, tourMs: 0, captureMs: 0 });
  console.log(`[ui-only-total] ${JSON.stringify({ cases: timings.length, ...totals, targetMs: 60000 })}`);
});

test('Home, Rules, touch and keyboard settings save through product dialogs', async ({ page }, info) => {
  const setupMs = await setup(page); let captureMs = 0; const started = performance.now();
  await setViewportAndWait(page, 320, 568);
  expect((await enlargeText(page)).nodeCount).toBeGreaterThan(20);
  await expect(page.locator('#home')).toBeVisible();
  await checkGeometry(page, '#home');
  await checkBodyPanels(page, '#home');
  captureMs += await capture(page, info, 'home-portrait-text-200.png');
  await setViewportAndWait(page, 568, 320);
  await enlargeText(page);
  await checkGeometry(page, '#home'); await checkBodyPanels(page, '#home'); captureMs += await capture(page, info, 'home-landscape-text-200.png');
  await page.reload();
  await setViewportAndWait(page, 568, 320);
  await page.click('#home-rules'); await expect(page.locator('#rules-guide[open]')).toBeVisible();
  await enlargeText(page);
  await checkGeometry(page, '#rules-guide'); await checkBodyPanels(page, '#rules-guide'); captureMs += await capture(page, info, 'rules-landscape-text-200.png');
  await page.locator('#rules-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await page.locator('#rules-content').evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);
  await page.click('#rules-back');
  await setViewportAndWait(page, 393, 852);
  await page.click('#home-controls'); await expect(page.locator('#control-settings[open]')).toBeVisible();
  await page.click('#control-editor-touch'); await expect(page.locator('#control-editor-touch')).toHaveAttribute('aria-pressed', 'true');
  await enlargeText(page);
  await checkGeometry(page, '#control-settings'); await checkBodyPanels(page, '#control-settings');
  captureMs += await capture(page, info, 'settings-touch.png');
  const sizeInput = page.locator('#control-size');
  await sizeInput.scrollIntoViewIfNeeded();
  const oldSize = await sizeInput.inputValue();
  const sliderBox = await sizeInput.boundingBox();
  const sliderState = await sizeInput.evaluate(element => ({ min: Number((element as HTMLInputElement).min), max: Number((element as HTMLInputElement).max), step: Number((element as HTMLInputElement).step), disabled: (element as HTMLInputElement).disabled }));
  expect(sliderBox, 'touch settings slider has a visible hit target').not.toBeNull();
  await page.touchscreen.tap(sliderBox!.x + sliderBox!.width * 0.8, sliderBox!.y + sliderBox!.height / 2);
  const newSize = await sizeInput.inputValue();
  expect(newSize, `touch settings slider changed (${JSON.stringify({ oldSize, newSize, sliderState, sliderBox })})`).not.toBe(oldSize);
  await page.click('#control-editor-keyboard'); await page.click('[data-key-action="bomb"]'); await page.keyboard.press('x');
  await expect(page.locator('[data-key-action="bomb"]')).toHaveText('X');
  captureMs += await capture(page, info, 'settings-keyboard.png');
  await page.click('#control-save'); await expect(page.locator('#control-settings')).toBeHidden();
  const stored = await page.evaluate(() => ({ layout: localStorage.getItem('fantasia-controls-easy-v2'), keys: localStorage.getItem('fantasia-keyboard-v1') }));
  expect(stored.layout).toContain('"version":2'); expect(stored.keys).toContain('"bomb":"KeyX"');
  const readOnly = await page.evaluate(() => { const descriptor = Object.getOwnPropertyDescriptor(window, '__fantasiaReadState'); return { valueType: typeof descriptor?.value, writable: descriptor?.writable, configurable: descriptor?.configurable }; });
  expect(readOnly).toEqual({ valueType: 'function', writable: false, configurable: true });
  await record('home-rules-settings-save', setupMs, started, captureMs);
});

test('Settings cancel discards touch and key drafts without storage writes', async ({ page }, info) => {
  const setupMs = await setup(page); let captureMs = 0; const started = performance.now();
  await page.click('#home-controls');
  const before = await page.evaluate(() => ['fantasia-controls-v2', 'fantasia-controls-easy-v2', 'fantasia-keyboard-v1'].map(key => localStorage.getItem(key)));
  await page.locator('#control-size').focus(); await page.keyboard.press('ArrowRight');
  await page.click('#control-editor-keyboard'); await page.click('[data-key-action="bomb"]'); await page.keyboard.press('x');
  await page.click('#control-cancel'); await expect(page.locator('#control-settings')).toBeHidden();
  expect(await page.evaluate(() => ['fantasia-controls-v2', 'fantasia-controls-easy-v2', 'fantasia-keyboard-v1'].map(key => localStorage.getItem(key)))).toEqual(before);
  await page.click('#home-controls'); await page.click('#control-editor-keyboard');
  await expect(page.locator('[data-key-action="bomb"]')).toHaveText('Z');
  await checkGeometry(page, '#control-settings'); await checkBodyPanels(page, '#control-settings'); captureMs += await capture(page, info, 'settings-cancel-restored.png');
  await record('settings-cancel', setupMs, started, captureMs);
});

test('Storage failure offers session-only settings and expires after reload', async ({ page }, info) => {
  const setupMs = await setup(page); let captureMs = 0; const started = performance.now();
  await page.click('#home-controls'); await page.click('#control-editor-keyboard');
  await page.click('[data-key-action="bomb"]'); await page.keyboard.press('x');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, '__restoreUiOnlyStorage', { value: () => { Storage.prototype.setItem = original; }, configurable: true });
    Storage.prototype.setItem = function () { throw new DOMException('UI-only storage fault', 'QuotaExceededError'); };
  });
  await page.click('#control-save');
  await expect(page.locator('#control-storage-note')).toContainText('設定を保存できませんでした');
  await expect(page.locator('#control-save')).toHaveText('今回だけ使う');
  captureMs += await capture(page, info, 'settings-storage-failure.png');
  await page.click('#control-save'); await expect(page.locator('#control-settings')).toBeHidden();
  await page.evaluate(() => (window as any).__restoreUiOnlyStorage());
  expect(await page.evaluate(() => localStorage.getItem('fantasia-keyboard-v1'))).toBeNull();
  await page.click('#home-controls'); await page.click('#control-editor-keyboard');
  await expect(page.locator('[data-key-action="bomb"]')).toHaveText('X');
  await page.reload(); await page.waitForFunction(() => typeof (window as any).__fantasiaUiOnlyTest?.hud === 'function');
  await page.click('#home-controls'); await page.click('#control-editor-keyboard');
  await expect(page.locator('[data-key-action="bomb"]')).toHaveText('Z');
  await checkGeometry(page, '#control-settings'); await checkBodyPanels(page, '#control-settings');
  await record('storage-failure-session-only', setupMs, started, captureMs);
});

test('Easy and Normal HUD, seven sites, aim geometry and alerts fit small portrait and landscape', async ({ page, browser }, info) => {
  let setupMs = 0; let captureMs = 0; const started = performance.now();
  const hudFailures: HudFailureRecord[] = [];
  const freshBaselineByCase = new Map<string, any>();
  const freshBaselineEvidence: unknown[] = [];
  const freshAreaEvidence: Array<Record<string, any>> = [];
  const rotationAreaEvidence: Array<Record<string, any>> = [];
  const freshCoverage: HudCaseCoverage[] = HUD_CASES.map(hudCase => ({ case: hudCase.name, attempted: false, evidenceCompleted: false, imageSaved: false, jsonSaved: false }));
  const rotationCoverage: HudCaseCoverage[] = HUD_CASES.map(hudCase => ({ case: hudCase.name, attempted: false, evidenceCompleted: false, imageSaved: false, jsonSaved: false }));
  const freshCoverageByCase = new Map(freshCoverage.map(coverage => [coverage.case, coverage]));
  const rotationCoverageByCase = new Map(rotationCoverage.map(coverage => [coverage.case, coverage]));
  let rotationReady = false;
  let originalReadState: any = null;
  let originalLivesNoteHandle: any = null;
  let originalAnnouncementHandle: any = null;

  try {
    setupMs += await setup(page);
    originalReadState = await page.evaluateHandle(() => (window as any).__fantasiaReadState);
    originalLivesNoteHandle = await page.evaluateHandle(() => [...document.querySelectorAll<HTMLElement>('#app small')]
      .find(node => node.textContent?.trim() === '現在機を含む') ?? null);
    originalAnnouncementHandle = await page.evaluateHandle(() => document.querySelector<HTMLElement>('#announcement'));
    rotationReady = true;
  } catch (error) {
    const setupCoverage: HudCaseCoverage = { case: 'rotation-stress-setup', attempted: true, evidenceCompleted: false, imageSaved: false, jsonSaved: false };
    captureMs += await captureHudFailureEvidence(page, info, setupCoverage, hudFailures, 'rotation-stress', 'rotation-stress-setup', 'shared-page-setup', error);
    for (const coverage of rotationCoverage) coverage.notRunReason = `shared rotation page setup failed: ${setupCoverage.exceptionMessage ?? String(error)}`;
  }

  for (const hudCase of HUD_CASES) {
    // Every fixed state gets its own document with its viewport set before UI setup.
    // This prevents a previous mode/priority/rotation from becoming its baseline.
    const coverage = freshCoverageByCase.get(hudCase.name)!;
    coverage.attempted = true;
    let freshPage: Page | undefined;
    let originalSecondaryNodesHandle: any = null;
    let originalSecondaryText: Record<string, string | null> = {};
    let measuredArea: any = null;
    try {
      freshPage = await browser.newPage({ viewport: { width: hudCase.width, height: hudCase.height } });
      const viewportBeforeSetup = freshPage.viewportSize();
      if (viewportBeforeSetup?.width !== hudCase.width || viewportBeforeSetup.height !== hudCase.height)
        recordHudFailure(hudFailures, 'fresh-page', hudCase.name, 'viewport-before-setup', `${hudCase.name}: fresh-page viewport before setup was ${JSON.stringify(viewportBeforeSetup)}`);
      setupMs += await setup(freshPage);
      const cssBeforeFixture = await typographySnapshot(freshPage);
      const originalLivesNoteHandle = await freshPage.evaluateHandle(() => [...document.querySelectorAll<HTMLElement>('#app small')]
        .find(node => node.textContent?.trim() === '現在機を含む') ?? null);
      const originalAnnouncementHandle = await freshPage.evaluateHandle(() => document.querySelector<HTMLElement>('#announcement'));
      const fixture = await paintedFixture(freshPage, hudCase.mode, hudCase.alert, hudCase.priority);
      const secondaryOriginals = await captureSecondaryHudOriginals(freshPage);
      originalSecondaryNodesHandle = secondaryOriginals.originalNodes;
      originalSecondaryText = secondaryOriginals.originalText;
      const baseline = await typographySnapshot(freshPage);
      const layoutEvidence = await act(freshPage, 'evidence');
      const beforeMap = new Map(cssBeforeFixture.samples.map((sample: TypographySample) => [sample.key, sample]));
      const fixtureBaselineDrift = baseline.samples.flatMap((sample: TypographySample) => {
        const original = beforeMap.get(sample.key);
        return original && Math.abs(original.basePx - sample.basePx) >= 0.1
          ? [{ key: sample.key, selector: sample.selector, originalBasePx: original.basePx, afterFixtureBasePx: sample.basePx,
            originalInlineValue: original.inlineValue, afterFixtureInlineValue: sample.inlineValue, originalParent: original.parent, afterFixtureParent: sample.parent }]
          : [];
      });
      const fixtureInlineStyleChanges = baseline.samples.flatMap((sample: TypographySample) => {
        const original = beforeMap.get(sample.key);
        return original && (original.inlineValue !== sample.inlineValue || original.inlinePriority !== sample.inlinePriority)
          ? [{ key: sample.key, selector: sample.selector, originalBasePx: original.basePx, afterFixtureBasePx: sample.basePx,
            originalInlineValue: original.inlineValue, originalInlinePriority: original.inlinePriority,
            afterFixtureInlineValue: sample.inlineValue, afterFixtureInlinePriority: sample.inlinePriority,
            originalParent: original.parent, afterFixtureParent: sample.parent }]
          : [];
      });
      const freshBaseline = { case: hudCase.name, mode: hudCase.mode, alert: hudCase.alert, priority: hudCase.priority,
        viewportBeforeSetup, cssBeforeFixture, baseline, fixtureBaselineDrift, fixtureInlineStyleChanges,
        searchInput: layoutEvidence.searchInput, sight: layoutEvidence.sight, layout: layoutEvidence.layout };
      freshBaselineByCase.set(hudCase.name, freshBaseline);
      freshBaselineEvidence.push(freshBaseline);
      const fontScale = await enlargeText(freshPage);
      const painted = await repaintFixedFixture(freshPage);
      const inspection = await inspectAndCaptureHudCase(freshPage, info, hudCase, painted, fixture, fontScale,
        freshBaseline, originalLivesNoteHandle, originalAnnouncementHandle, originalSecondaryNodesHandle, originalSecondaryText,
        'fresh-page', hudFailures, coverage);
      captureMs += inspection.screenshotMs;
      measuredArea = { status: inspection.areaBound.status, areaBound: inspection.areaBound, areaClassification: inspection.areaClassification,
        layoutStatus: inspection.layoutStatus, searchChecks: inspection.searchChecks, blockedReasons: inspection.blockedReasons };
      coverage.evidenceCompleted = coverage.imageSaved && coverage.jsonSaved;
    } catch (error) {
      captureMs += await captureHudFailureEvidence(freshPage, info, coverage, hudFailures, 'fresh-page', hudCase.name, 'case-exception', error,
        { viewport: { width: hudCase.width, height: hudCase.height }, mode: hudCase.mode, alert: hudCase.alert, priority: hudCase.priority, measuredArea });
    } finally {
      if (originalSecondaryNodesHandle) {
        try { await originalSecondaryNodesHandle.dispose(); }
        catch (error) { recordHudError(hudFailures, 'fresh-page', hudCase.name, 'original-secondary-handle-dispose', error); }
      }
      if (freshPage) {
        try { await freshPage.close(); }
        catch (error) { recordHudError(hudFailures, 'fresh-page', hudCase.name, 'page-close', error); }
      }
      freshAreaEvidence.push({ case: hudCase.name, ...(measuredArea ?? { status: 'not-measured', areaBound: null,
        areaClassification: 'not-run-or-interrupted-before-area-inspection', layoutStatus: 'not-measured', searchChecks: null, blockedReasons: [] }) });
    }
  }

  const inspectFixedHud = async (hudCase: HudCase, mode: 'easy' | 'normal', fixture: any, coverage: HudCaseCoverage) => {
    const name = hudCase.name;
    const secondaryOriginals = await captureSecondaryHudOriginals(page);
    try {
      const freshBaseline = freshBaselineByCase.get(name) ?? null;
      if (!freshBaseline) recordHudFailure(hudFailures, 'rotation-stress', name, 'matching-fresh-baseline', `${name}: matching fresh-page counterpart is missing before rotation capture`);
      recordHudAssertion(hudFailures, 'rotation-stress', name, 'rotation-mode-matches-hud-case', () => expect(hudCase.mode).toBe(mode));
      const fontScale = await enlargeText(page, true);
      const painted = await repaintFixedFixture(page);
      const inspection = await inspectAndCaptureHudCase(page, info, hudCase, painted, fixture, fontScale,
        freshBaseline, originalLivesNoteHandle, originalAnnouncementHandle, secondaryOriginals.originalNodes, secondaryOriginals.originalText,
        'rotation-stress', hudFailures, coverage);
      captureMs += inspection.screenshotMs;
      coverage.evidenceCompleted = coverage.imageSaved && coverage.jsonSaved;
      rotationAreaEvidence.push({ case: hudCase.name, status: inspection.areaBound.status,
        areaBound: inspection.areaBound, areaClassification: inspection.areaClassification,
        layoutStatus: inspection.layoutStatus, searchChecks: inspection.searchChecks, blockedReasons: inspection.blockedReasons });
    } finally {
      await secondaryOriginals.originalNodes.dispose();
    }
  };

  const runRotationCase = async (name: string, operation: (coverage: HudCaseCoverage) => Promise<void>) => {
    const coverage = rotationCoverageByCase.get(name);
    if (!coverage) {
      recordHudFailure(hudFailures, 'rotation-stress', name, 'coverage-definition', `Missing HUD case coverage definition for rotation state ${name}`);
      return;
    }
    if (!rotationReady) return;
    coverage.attempted = true;
    const failuresBefore = hudFailures.length;
    try { await operation(coverage); }
    catch (error) {
      captureMs += await captureHudFailureEvidence(page, info, coverage, hudFailures, 'rotation-stress', name, 'case-exception', error);
    }
    if (!coverage.evidenceCompleted && !coverage.exceptionMessage)
      recordHudFailure(hudFailures, 'rotation-stress', name, 'incomplete-evidence', `${name}: rotation-stress case returned without complete PNG and JSON evidence`);
    if (hudFailures.length > failuresBefore && !coverage.exceptionMessage) {
      coverage.exceptionMessage = hudFailures.slice(failuresBefore).map(failure => failure.message).join('\n');
    }
  };

  const easyOutside0 = HUD_CASES[0], easyOutside4 = HUD_CASES[1], normalProtected0 = HUD_CASES[2], normalProtected4 = HUD_CASES[3];
  const normalLow4 = HUD_CASES[4], easyClear0 = HUD_CASES[5], easyClear4 = HUD_CASES[6], easyWarning4 = HUD_CASES[7];
  const normalRespawn0 = HUD_CASES[8], normalRespawn4 = HUD_CASES[9];
  const inspect = (hudCase: HudCase, mode: 'easy' | 'normal', fixture: any, coverage: HudCaseCoverage) => inspectFixedHud(hudCase, mode, fixture, coverage);

  await runRotationCase(easyOutside0.name, async coverage => {
    await setViewportAndWait(page, 320, 568);
    const fixture = await paintedFixture(page, 'easy', 'outside', 0);
    expect(fixture.screen).toBe('playing');
    const hudState = await page.evaluate(() => {
      const hud = document.querySelector<HTMLElement>('#hud'), app = document.querySelector<HTMLElement>('#app');
      const read = (window as any).__fantasiaReadState?.(false);
      return { hidden: hud?.hidden, screen: app?.dataset.screen, engineScreen: read?.screen,
        graphicsReady: read?.graphicsReady, renderStatus: read?.renderStatus, drawCalls: read?.render?.drawCalls };
    });
    expect(hudState.hidden, `fixed HUD screen state ${JSON.stringify(hudState)}`).toBe(false);
    await expect(page.locator('#normal-controls')).toBeHidden();
    await expect(page.locator('#campaign-sites .campaign-site')).toHaveCount(7);
    await expect(page.locator('#warning')).toContainText('作戦圏へ戻って');
    await expect(page.locator('#campaign-threat')).toContainText('砲台の魔法');
    await expect(page.locator('#reload-status')).toContainText('再装填中');
    await inspect(easyOutside0, 'easy', fixture, coverage);
  });
  await runRotationCase(easyOutside4.name, async coverage => {
    const fixture = await paintedFixture(page, 'easy', 'outside', 4);
    await inspect(easyOutside4, 'easy', fixture, coverage);
    const easyAim = await page.evaluate(async () => {
      const { aimRadius } = await import('/src/aim-indicator.ts');
      const flight = document.querySelector('#flight')!.getBoundingClientRect(), markers = document.querySelector('#markers')!.getBoundingClientRect();
      return { radius: aimRadius('easy', innerWidth, innerHeight), sameCanvas: flight.width === markers.width && flight.height === markers.height, pointerEvents: getComputedStyle(document.querySelector('#markers')!).pointerEvents };
    });
    expect(easyAim.radius).toBeCloseTo(320 * .135); expect(easyAim.sameCanvas).toBe(true); expect(easyAim.pointerEvents).toBe('none');
  });
  await runRotationCase(normalProtected0.name, async coverage => {
    await act(page, 'reset'); await setViewportAndWait(page, 568, 320);
    const fixture = await paintedFixture(page, 'normal', 'protected', 0);
    const normalModeState = await page.evaluate(() => {
      const controls = document.querySelector<HTMLElement>('#normal-controls');
      const app = document.querySelector<HTMLElement>('#app');
      const read = (window as any).__fantasiaReadState?.(false);
      return { appMode: app?.dataset.mode, stateMode: read?.mode, controlsHidden: controls?.hidden, screen: app?.dataset.screen };
    });
    expect(fixture.mode, `fixed Normal fixture ${JSON.stringify(normalModeState)}`).toBe('normal');
    expect(normalModeState.appMode).toBe('normal'); expect(normalModeState.stateMode).toBe('normal'); expect(normalModeState.controlsHidden).toBe(false);
    await expect(page.locator('#fire')).toBeVisible(); await expect(page.locator('#throttle')).toBeVisible();
    await expect(page.locator('#warning')).toContainText('復活保護'); await expect(page.locator('#reload-status')).toContainText('再装填中');
    await expect(page.locator('#campaign-sites .campaign-site')).toHaveCount(7);
    await inspect(normalProtected0, 'normal', fixture, coverage);
    const normalAim = await page.evaluate(async () => {
      const { aimRadius } = await import('/src/aim-indicator.ts');
      const flight = document.querySelector('#flight')!.getBoundingClientRect(), markers = document.querySelector('#markers')!.getBoundingClientRect();
      return { radius: aimRadius('normal', innerWidth, innerHeight), sameCanvas: flight.width === markers.width && flight.height === markers.height, pointerEvents: getComputedStyle(document.querySelector('#markers')!).pointerEvents };
    });
    expect(normalAim.radius).toBeGreaterThanOrEqual(26); expect(normalAim.sameCanvas).toBe(true); expect(normalAim.pointerEvents).toBe('none');
  });
  await runRotationCase(normalProtected4.name, async coverage => {
    await setViewportAndWait(page, 568, 320);
    const fixture = await paintedFixture(page, 'normal', 'protected', 4);
    await inspect(normalProtected4, 'normal', fixture, coverage);
  });
  await runRotationCase(normalLow4.name, async coverage => {
    await setViewportAndWait(page, 568, 320);
    const fixture = await paintedFixture(page, 'normal', 'low', 4); await expect(page.locator('#warning')).toContainText('低空注意');
    await inspect(normalLow4, 'normal', fixture, coverage);
  });
  await runRotationCase(easyClear0.name, async coverage => {
    // Retain the original mode/rotation sequence: this state follows the Normal landscape cases.
    await setViewportAndWait(page, 568, 320);
    const fixture = await paintedFixture(page, 'easy', 'clear', 0);
    await inspect(easyClear0, 'easy', fixture, coverage);
  });
  await runRotationCase(easyClear4.name, async coverage => {
    await setViewportAndWait(page, 568, 320);
    const fixture = await paintedFixture(page, 'easy', 'clear', 4);
    await inspect(easyClear4, 'easy', fixture, coverage);
    await expect(page.locator('#campaign-sites .campaign-site')).toHaveCount(7);
  });
  await runRotationCase(easyWarning4.name, async coverage => {
    await setViewportAndWait(page, 568, 320);
    const fixture = await paintedFixture(page, 'easy', 'low', 4); await expect(page.locator('#warning')).toContainText('低空注意');
    await inspect(easyWarning4, 'easy', fixture, coverage);
  });
  await runRotationCase(normalRespawn0.name, async coverage => {
    await act(page, 'reset'); await setViewportAndWait(page, 320, 568);
    const fixture = await paintedFixture(page, 'normal', 'respawn', 0);
    expect(fixture.status).toBe('respawning'); await expect(page.locator('#respawn-status')).toBeVisible();
    await expect(page.locator('#respawn-status')).toContainText('復活まで 3秒');
    await expect(page.locator('#warning')).toBeHidden(); await expect(page.locator('#reload-status')).toContainText('再装填中');
    await inspect(normalRespawn0, 'normal', fixture, coverage);
  });
  await runRotationCase(normalRespawn4.name, async coverage => {
    await setViewportAndWait(page, 320, 568);
    const fixture = await paintedFixture(page, 'normal', 'respawn', 4);
    await inspect(normalRespawn4, 'normal', fixture, coverage);
  });
  if (rotationReady) {
    await recordHudAsyncAssertion(hudFailures, 'rotation-stress', 'rotation-stress-read-only-state-identity', 'read-only-state-function-identity', () =>
      expect(page.evaluate((readState) => window.__fantasiaReadState === readState, originalReadState)).resolves.toBe(true));
  }

  await record('hud-modes-sites-aim-alerts', setupMs, started, captureMs);
  const summarizeAreaEvidence = (provenance: 'fresh-page-200%' | 'rotation-stress-200%', cases: Array<Record<string, any>>) => ({
    provenance,
    statesCaptured: cases.length,
    counts: {
      measured: cases.filter(item => item.status === 'measured').length,
      invalidOrMissing: cases.filter(item => item.status !== 'measured').length,
      gap0Shortages: cases.filter(item => item.areaBound?.shortageGap0 === true).length,
      gap4Shortages: cases.filter(item => item.areaBound?.shortageGap4 === true).length,
      gap4OnlyShortages: cases.filter(item => item.areaBound?.shortageGap4 === true && item.areaBound?.shortageGap0 !== true).length,
      searchExhausted: cases.filter(item => item.layoutStatus === 'blocked' && item.searchChecks >= 120000).length,
      blockedBeforeSearchLimit: cases.filter(item => item.layoutStatus === 'blocked' && item.searchChecks < 120000).length,
    },
    cases,
  });
  for (const coverage of rotationCoverage) {
    if (!rotationReady) continue;
    const caseEvidence = rotationAreaEvidence.find(item => item.case === coverage.case);
    if (!caseEvidence) rotationAreaEvidence.push({ case: coverage.case, status: 'not-measured', areaBound: null,
      areaClassification: 'case-failed-before-area-inspection', layoutStatus: 'not-measured', searchChecks: null, blockedReasons: [] });
  }
  const buildCoverageSummary = (provenance: HudProvenance, coverages: HudCaseCoverage[]) => {
    const cases = coverages.map(coverage => {
      let caseFailures = hudFailures.filter(failure => failure.provenance === provenance && failure.case === coverage.case);
      if (coverage.attempted && !coverage.evidenceCompleted && !caseFailures.length) {
        recordHudFailure(hudFailures, provenance, coverage.case, 'incomplete-evidence', `${coverage.case}: attempted case did not complete JSON/PNG evidence capture`);
        caseFailures = hudFailures.filter(failure => failure.provenance === provenance && failure.case === coverage.case);
      }
      const status = !coverage.attempted ? 'not-run' : caseFailures.length || !coverage.evidenceCompleted ? 'failed' : 'completed';
      return { ...coverage, status, failureRecords: caseFailures };
    });
    const counts = { attempted: cases.filter(item => item.attempted).length, completed: cases.filter(item => item.status === 'completed').length,
      failed: cases.filter(item => item.status === 'failed').length, notRun: cases.filter(item => item.status === 'not-run').length };
    return { provenance, counts, cases };
  };
  const freshAreaSummary = summarizeAreaEvidence('fresh-page-200%', freshAreaEvidence);
  const rotationAreaSummary = summarizeAreaEvidence('rotation-stress-200%', rotationAreaEvidence);
  const freshCoverageSummary = buildCoverageSummary('fresh-page', freshCoverage);
  const rotationCoverageSummary = buildCoverageSummary('rotation-stress', rotationCoverage);
  const attachSummary = async (name: string, body: unknown, provenance: HudProvenance | 'aggregate', stage: string) => {
    try { await info.attach(name, { body: Buffer.from(JSON.stringify(body, null, 2)), contentType: 'application/json' }); }
    catch (error) { recordHudError(hudFailures, provenance, `summary:${name}`, stage, error); }
  };
  await attachSummary('fresh-page-hud-baselines.json', freshBaselineEvidence, 'fresh-page', 'baseline-summary-attach');
  await attachSummary('fresh-page-hud-area-summary.json', freshAreaSummary, 'fresh-page', 'area-summary-attach');
  await attachSummary('rotation-stress-hud-area-summary.json', rotationAreaSummary, 'rotation-stress', 'area-summary-attach');
  await attachSummary('fresh-page-hud-coverage.json', freshCoverageSummary, 'fresh-page', 'coverage-summary-attach');
  await attachSummary('rotation-stress-hud-coverage.json', rotationCoverageSummary, 'rotation-stress', 'coverage-summary-attach');
  const commonAggregate = { freshPage: { coverage: freshCoverageSummary, area: freshAreaSummary },
    rotationStress: { coverage: rotationCoverageSummary, area: rotationAreaSummary }, collectedFailures: hudFailures };
  await attachSummary('hud-fixed-state-common-aggregate.json', commonAggregate, 'aggregate', 'common-aggregate-attach');
  console.log(`[ui-only-hud-common-aggregate] ${JSON.stringify({ freshPage: freshCoverageSummary.counts,
    rotationStress: rotationCoverageSummary.counts, area: { freshPage: freshAreaSummary.counts, rotationStress: rotationAreaSummary.counts },
    failureCount: hudFailures.length, failureCases: hudFailures.map(failure => ({ provenance: failure.provenance, case: failure.case, stage: failure.stage })) })}`);
  expect(hudFailures, 'fresh-page and original rotation-stress cases completed independently; full HUD geometry, Canvas pixels, text and 44px checks pass').toEqual([]);
});

test('Pause screen details, Rules and settings remain usable without advancing a run', async ({ page }, info) => {
  const setupMs = await setup(page); let captureMs = 0; const started = performance.now();
  await act(page, 'hud', 'normal', 'clear');
  await page.click('#pause'); await expect(page.locator('#pause-screen')).toBeVisible();
  await page.locator('.campaign-detail summary').click();
  await expect(page.locator('#pause-site-details .campaign-site-detail')).toHaveCount(7);
  await page.click('#pause-rules'); await expect(page.locator('#rules-guide[open]')).toBeVisible();
  await enlargeText(page);
  await checkGeometry(page, '#rules-guide'); await checkBodyPanels(page, '#rules-guide'); captureMs += await capture(page, info, 'pause-rules.png');
  await page.click('#rules-back'); await checkGeometry(page, '#pause-screen'); await checkBodyPanels(page, '#pause-screen');
  captureMs += await capture(page, info, 'pause-details-text-200.png');
  await page.click('#pause-controls');
  await expect(page.locator('#control-settings[open]')).toBeVisible(); await checkGeometry(page, '#control-settings'); await checkBodyPanels(page, '#control-settings');
  await page.click('#control-cancel'); await page.click('#pause-home'); await expect(page.locator('#home')).toBeVisible();
  await record('pause-rules-settings-home', setupMs, started, captureMs);
});

test('Every victory and defeat result reason displays details and reaches the final controls', async ({ page }, info) => {
  const setupMs = await setup(page); let captureMs = 0; const started = performance.now();
  const cases = [
    ['victory', '味方地上軍が7つの旗を同時にそろえました', '全陣地を占領'], ['地形に接触', '地形への衝突で最後の機体を失いました', '作戦終了'],
    ['撃墜', '最後の機体が撃墜されました', '作戦終了'], ['作戦圏外', '作戦圏外で最後の機体を失いました', '作戦終了'],
    ['残機なし', 'すべての機体を失いました', '作戦終了'], ['全軍の再建不能', '味方地上軍の生存兵と予備兵が尽き、再建できません', '作戦終了'],
    ['作戦期限20分', '20分の作戦期限に達しました', '作戦終了'],
  ] as const;
  await setViewportAndWait(page, 320, 568);
  for (const [reason, message, title] of cases) {
    const result = await act(page, 'result', reason);
    expect(result.screen).toBe('result');
    await expect(page.locator('#result-title')).toHaveText(title);
    await expect(page.locator('#result-reason')).toHaveText(message);
    for (const id of ['result-score-captures', 'result-score-turrets', 'result-score-clear', 'result-score-speed', 'result-score-friendlyDamagePenalty', 'result-score-friendlyKillPenalty', 'result-score-selfLossPenalty', 'result-sites', 'result-forces', 'result-lives', 'result-kills', 'result-pauses']) await expect(page.locator(`#${id}`)).not.toBeEmpty();
    await enlargeText(page); await checkGeometry(page, '#result'); await checkBodyPanels(page, '#result');
    captureMs += await capture(page, info, `result-${reason}-top.png`);
    await page.locator('#result').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.locator('#retry')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#result-home')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#result-controls')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#record-status')).toBeVisible();
    await expect(page.locator('#result .result-panel > p.result-note:last-of-type')).toBeInViewport({ ratio: 1 });
    const end = await page.locator('#result').evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1);
    expect(end, `${reason} result bottom reachable`).toBe(true);
    if (reason === '作戦期限20分') captureMs += await capture(page, info, 'result-final-controls-bottom.png');
  }
  await record('all-result-reasons-and-bottom', setupMs, started, captureMs);
});

test('Startup error is the real preparation failure UI', async ({ page }, info) => {
  const setupMs = await setup(page); let captureMs = 0; const started = performance.now();
  const fixture = await act(page, 'startupError');
  expect(fixture.graphicsReady).toBe(false);
  await expect(page.locator('#startup-error')).toBeVisible();
  await expect(page.locator('#reload')).toBeVisible(); await expect(page.locator('#start')).toBeDisabled();
  await checkGeometry(page, '#home'); await checkBodyPanels(page, '#home'); captureMs += await capture(page, info, 'startup-error.png');
  await record('startup-error', setupMs, started, captureMs);
});
