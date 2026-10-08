import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

type Timings = { name: string; setupMs: number; tourMs: number; captureMs: number };
type HudCase = { name: string; width: number; height: number; mode: 'easy' | 'normal'; alert: 'outside' | 'protected' | 'low' | 'clear' | 'respawn'; priority: 0 | 4 };
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
    const resized = page.evaluate(() => new Promise<void>(resolve => {
      window.addEventListener('resize', () => resolve(), { once: true });
    }));
    await page.setViewportSize({ width, height });
    await resized;
  }
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function act(page: Page, method: string, ...args: unknown[]) {
  return page.evaluate(async ({ method, args }) => await (window as any).__fantasiaUiOnlyTest[method](...args), { method, args });
}

async function typographySnapshot(page: Page) {
  return page.evaluate(selectors => {
    const samples = selectors.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)].map((node, index) => {
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
    return { viewport: { width: innerWidth, height: innerHeight }, samples };
  }, TYPOGRAPHY_SELECTORS);
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

function campaignHudAreaEvidence(searchInput: any, sight: any, layout: any): any {
  const bounds = searchInput?.bounds, canvas = searchInput?.canvas;
  if (!bounds || !canvas || !sight || !layout?.radar?.rect || !Array.isArray(searchInput.obstacles)
    || !Array.isArray(searchInput.panels)) return { status: 'unavailable', reason: 'incomplete measured search input' };
  const radius = canvas.width < 360 ? 42 : 49;
  const radar = { id: 'radar', width: layout.radar.rect.width, height: layout.radar.rect.height };
  const items = [...searchInput.panels, ...(searchInput.movableControls ?? []), ...(searchInput.canvasLabels ?? []), radar];
  const fixed = [...searchInput.obstacles,
    { id: 'central-flight-lane', x: canvas.width / 2 - 42, y: canvas.height / 2 - 42, width: 84, height: 84 },
    { ...sight, id: 'aim-and-reload-ring' }];
  if (![...items, ...fixed, bounds].every(rect => [rect.x ?? 0, rect.y ?? 0, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0)) {
    return { status: 'invalid', reason: 'non-finite or non-positive measured rectangle', items, fixed, bounds };
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
    fixedObstacles: fixed,
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
    radarRadius: radius,
  };
}

async function capture(page: Page, info: TestInfo, name: string): Promise<number> {
  const start = performance.now();
  const body = await page.screenshot({ animations: 'disabled' });
  await info.attach(name, { body, contentType: 'image/png' });
  return performance.now() - start;
}

async function record(name: string, setupMs: number, started: number, captureMs: number) {
  const value = { name, setupMs: Math.round(setupMs), tourMs: Math.max(0, Math.round(performance.now() - started - captureMs)), captureMs: Math.round(captureMs) };
  timings.push(value);
  console.log(`[ui-only-time] ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'ui-only-time', description: JSON.stringify(value) });
}

async function enlargeText(page: Page) {
  return page.evaluate(selectors => {
    type SavedFont = { value: string; priority: string };
    const targetWindow = window as Window & { __fantasiaUiOnlyFontOverrides?: Map<HTMLElement, SavedFont> };
    const overrides = targetWindow.__fantasiaUiOnlyFontOverrides ?? new Map<HTMLElement, SavedFont>();
    if (!targetWindow.__fantasiaUiOnlyFontOverrides) Object.defineProperty(targetWindow, '__fantasiaUiOnlyFontOverrides', { value: overrides, configurable: true });
    for (const [node, saved] of overrides) {
      if (saved.value) node.style.setProperty('font-size', saved.value, saved.priority);
      else node.style.removeProperty('font-size');
    }
    overrides.clear();

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
    const fontBaselines = selectors.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)].map((node, index) => {
      const measured = measurements.find(item => item.node === node);
      const site = node.closest<HTMLElement>('[data-site]')?.dataset.site ?? node.closest<HTMLElement>('[data-site-detail]')?.dataset.siteDetail;
      const owner = node.id ? `#${node.id}` : site ? `site-${site}.${[...node.classList].join('.') || node.tagName.toLowerCase()}`
        : `match-${index}.${[...node.classList].join('.') || node.tagName.toLowerCase()}`;
      return {
        key: `${selector}::${owner}`, selector, basePx: measured?.base ?? parseFloat(getComputedStyle(node).fontSize),
        appliedPx: parseFloat(getComputedStyle(node).fontSize), inlineBefore: measured?.saved.value ?? '',
        inlinePriorityBefore: measured?.saved.priority ?? '', text: node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) ?? '',
      };
    }));
    return { nodeCount: nodes.length, fontBaselines, viewport: { width: innerWidth, height: innerHeight } };
  }, TYPOGRAPHY_SELECTORS);
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
    const overlaps: string[] = [];
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      const a = visibleRect(targets[i]), b = visibleRect(targets[j]);
      if (!a || !b) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) overlaps.push(`${targets[i].id || targets[i].textContent?.trim()} × ${targets[j].id || targets[j].textContent?.trim()}`);
    }
    return { small, overlaps, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth };
  }, selector);
  expect(result.small, `${selector} controls below 44px`).toEqual([]);
  expect(result.overlaps, `${selector} interactive overlap`).toEqual([]);
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
    ];
    const nodes = selectors.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)])
      .filter(node => visible(node) && !node.closest('#campaign-hud-details'));
    const clipped: string[] = [], outside: string[] = [], overlaps: string[] = [], overlapDetails: unknown[] = [];
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
      if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) outside.push(name);
      const intentionalEllipsis = node.matches('.campaign-site-force, .campaign-site-wave');
      const scrollable = ['auto', 'scroll'].includes(style.overflowY);
      if (!intentionalEllipsis && !scrollable && (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2)) clipped.push(name);
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
    return { clipped, outside, overlaps, overlapDetails, detailViewport, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
      mode: app?.dataset.mode, campaignHud: app?.dataset.campaignHud, screen: app?.dataset.screen };
  });
  const canvasLayout = await act(page, 'layout');
  expect(result.clipped, 'visible warning, site, instrument and HUD panel content must not clip').toEqual([]);
  expect(result.outside, 'visible warning, site, instrument and HUD panels must stay on screen').toEqual([]);
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

async function inspectAnnouncementReachability(page: Page, priority: number) {
  return page.evaluate(priorityValue => {
    const node = document.querySelector<HTMLElement>('#announcement');
    const details = document.querySelector<HTMLElement>('#campaign-hud-details');
    if (!node) return { ok: false, priority: priorityValue, reason: 'missing original #announcement node', glyphs: [], clipChain: [] };
    const liveCount = document.querySelectorAll('#announcement').length;
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
    const firstNonVisible = clipChain.find(item => item.hidden || item.display === 'none'
      || item.visibility === 'hidden' || item.visibility === 'collapse' || item.opacity === '0' || item.contentVisibility === 'hidden');
    if (liveCount !== 1) issues.push(`expected one live announcement node, found ${liveCount}`);
    if (firstNonVisible) issues.push(`announcement has non-visible ancestor ${firstNonVisible.id || firstNonVisible.className}`);
    if (clipChain.some(item => item.clipPath !== 'none' || item.clip !== 'auto' || item.contain.split(/\s+/).includes('paint')))
      issues.push('announcement has clip-path, legacy clip, or paint containment that this geometry check cannot resolve');
    if (priorityValue < 1) {
      if (!details || !details.contains(node)) issues.push('priority-0 live announcement is outside the permitted secondary detail viewport');
      if (details && !['auto', 'scroll'].includes(getComputedStyle(details).overflowY)) issues.push('priority-0 detail viewport is not vertically scrollable');
    } else if (details?.contains(node)) issues.push('priority-4 announcement depends on the secondary scroll viewport');

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
      if ((rect.width <= 0 || rect.height <= 0) && allowCaret) {
        const caret = range.cloneRange(); caret.collapse(true);
        const caretRect = caret.getBoundingClientRect();
        if (caretRect.height > 0) { rect = caretRect; geometry = 'whitespace caret'; }
      }
      if (rect.width <= 0 || rect.height <= 0) return { rect: null, clips: ['no glyph or whitespace-caret rectangle'], visible: false, geometry };
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
      return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, clips, visible: fullyVisible, geometry };
    };

    for (const record of records) {
      const initial = visibleRectFor(record.range, record.whitespace);
      let testedScrollTop: number | null = null, result = initial;
      if (priorityValue < 1 && details && initial.rect) {
        const box = innerBox(details), maxScroll = Math.max(0, details.scrollHeight - details.clientHeight);
        const startHeight = initial.rect.bottom - initial.rect.top;
        const delta = initial.rect.top - box.top - (details.clientHeight - startHeight) / 2;
        details.scrollTop = Math.max(0, Math.min(maxScroll, details.scrollTop + delta));
        testedScrollTop = details.scrollTop;
        result = visibleRectFor(record.range, record.whitespace);
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
      route: priorityValue < 1 ? 'scroll-only secondary details' : 'direct visible critical announcement',
      text: node.textContent, elementRect: (() => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(),
      visibleBox, viewport: { width: innerWidth, height: innerHeight },
      secondaryDetails: details ? { containsLiveNode: details.contains(node), hidden: details.hidden,
        rect: (() => { const r = details.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(),
        clientWidth: details.clientWidth, clientHeight: details.clientHeight, scrollWidth: details.scrollWidth, scrollHeight: details.scrollHeight,
        overflowX: getComputedStyle(details).overflowX, overflowY: getComputedStyle(details).overflowY } : null,
      clipChain, glyphs, issues };
  }, priority);
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

async function inspectAndCaptureHudCase(page: Page, info: TestInfo, hudCase: HudCase, canvas: any, fixture: any, fontScale: any, freshBaseline: any, provenance: 'fresh-page' | 'rotation-stress', failures: string[]) {
  const { name, mode } = hudCase;
  const screenshotMs = await capture(page, info, name);
  const layoutEvidence = await act(page, 'evidence');
  const announcementReachability = await inspectAnnouncementReachability(page, hudCase.priority);
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
  const areaBound = campaignHudAreaEvidence(layoutEvidence?.searchInput, layoutEvidence?.sight, layout);
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
  if (layout?.status !== 'placed') failures.push(`${name}: Canvas HUD placement status=${layout?.status ?? 'missing'}; blockedReasons=${JSON.stringify(blockedReasons)}; searchChecks=${layout?.searchChecks ?? 'missing'}; fixedConflicts=${JSON.stringify(layout?.fixedConflicts ?? [])}`);
  if (areaBound.status !== 'measured') failures.push(`${name}: necessary-area evidence unavailable or invalid: ${JSON.stringify(areaBound).slice(0, 700)}`);
  else {
    if (areaBound.shortageGap0) failures.push(`${name}: necessary area exceeds free-space upper bound at gap 0: required=${areaBound.requiredArea}; available=${areaBound.availableUpperBoundGap0}; deficit=${areaBound.deficitGap0}`);
    if (areaBound.shortageGap4) failures.push(`${name}: necessary area exceeds free-space upper bound at product gap 4: required=${areaBound.requiredArea}; available=${areaBound.availableUpperBoundGap4}; deficit=${areaBound.deficitGap4}`);
  }
  if (!announcementReachability.ok) failures.push(`${name}: announcement characters are not fully reachable through actual ancestor clipping: ${JSON.stringify(announcementReachability.issues).slice(0, 700)}`);
  const freshSamples = freshBaseline?.baseline?.samples ?? [];
  const fontComparisons = compareTypography({ samples: freshSamples }, { samples: fontScale.fontBaselines ?? [] });
  const announcementTypography = fontComparisons.find(sample => sample.selector === '#announcement');
  const missingFreshProbes = fontComparisons.filter(sample => sample.expectedBasePx === null);
  const actualTypographyKeys = new Set((fontScale.fontBaselines ?? []).map((sample: TypographySample) => sample.key));
  const missingCurrentProbes = freshSamples.filter((sample: TypographySample) => !actualTypographyKeys.has(sample.key));
  const staleFontSamples = fontComparisons.filter(sample => !sample.matchesFreshBaseline || !sample.matchesExpected200);
  const cssAnnouncementBaseline = freshBaseline?.cssBeforeFixture?.samples?.find((sample: TypographySample) => sample.selector === '#announcement');
  const expectedCssAnnouncementBaseline = hudCase.width > hudCase.height && hudCase.height <= 600 ? 10 : 12;
  if (!freshBaseline) failures.push(`${name}: matching fresh-page counterpart is missing`);
  if (cssAnnouncementBaseline && Math.abs(cssAnnouncementBaseline.basePx - expectedCssAnnouncementBaseline) >= 0.1) {
    failures.push(`${name}: fresh CSS announcement baseline was ${cssAnnouncementBaseline.basePx}px, expected ${expectedCssAnnouncementBaseline}px for ${hudCase.width}×${hudCase.height}`);
  }
  if (missingFreshProbes.length) failures.push(`${name}: typography probes are missing from the fresh counterpart: ${JSON.stringify(missingFreshProbes.map(sample => sample.key)).slice(0, 700)}`);
  if (missingCurrentProbes.length) failures.push(`${name}: fresh typography probes are missing from the rotation/stress state: ${JSON.stringify(missingCurrentProbes.map((sample: TypographySample) => sample.key)).slice(0, 700)}`);
  if (staleFontSamples.length) failures.push(`${name}: current base/applied typography differs from the fresh-page values: ${JSON.stringify(staleFontSamples.slice(0, 6)).slice(0, 700)}`);
  if (freshBaseline?.fixtureBaselineDrift?.length) failures.push(`${name}: fresh fixture changed a CSS font baseline during reparenting: ${JSON.stringify(freshBaseline.fixtureBaselineDrift.slice(0, 6)).slice(0, 700)}`);
  const evidence = {
    case: name,
    provenance,
    viewport: domEvidence.viewport,
    mode,
    announcementPriority: fixture.announcementPriority,
    announcement: domEvidence.announcement,
    announcementReachability,
    dom: domEvidence,
    freshBaseline: freshBaseline ? { viewportBeforeSetup: freshBaseline.viewportBeforeSetup,
      cssBeforeFixture: freshBaseline.cssBeforeFixture, baseline: freshBaseline.baseline,
      fixtureBaselineDrift: freshBaseline.fixtureBaselineDrift, fixtureInlineStyleChanges: freshBaseline.fixtureInlineStyleChanges } : null,
    fontBaselines: fontScale.fontBaselines,
    fontComparisons,
    missingFreshProbes: missingFreshProbes.map(sample => sample.key),
    missingCurrentProbes: missingCurrentProbes.map((sample: TypographySample) => sample.key),
    searchInput: layoutEvidence.searchInput,
    sight: layoutEvidence.sight,
    layout,
    areaBound,
    searchBudget: { checks: layout?.searchChecks ?? null, limit: 120000,
      state: layout?.status === 'placed' ? 'completed' : layout?.searchChecks >= 120000 ? 'exhausted' : 'stopped-before-limit',
      classification: areaBound.status === 'measured' && areaBound.shortageGap0 ? 'necessary-area-shortage'
        : layout?.status === 'blocked' && layout?.searchChecks >= 120000 ? 'bounded-search-exhaustion-without-proven-area-shortage'
          : layout?.status === 'placed' ? 'placed' : layout?.status ?? 'missing' },
    blockedReasons,
  };
  await info.attach(`${name}.json`, { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
  console.log(`[ui-only-layout-evidence] ${JSON.stringify({ case: name, provenance, viewport: evidence.viewport, mode, announcementPriority: fixture.announcementPriority,
    layoutStatus: layout?.status ?? 'missing', searchChecks: layout?.searchChecks ?? null, fixedConflicts: layout?.fixedConflicts ?? [],
    safeArea: areaBound.safeArea ?? null, requiredArea: areaBound.requiredArea ?? null,
    availableUpperBoundGap0: areaBound.availableUpperBoundGap0 ?? null, availableUpperBoundGap4: areaBound.availableUpperBoundGap4 ?? null,
    shortageGap0: areaBound.shortageGap0 ?? null, shortageGap4: areaBound.shortageGap4 ?? null,
    announcementReachable: announcementReachability.ok, announcementTypography, typographyMismatchCount: staleFontSamples.length, blockedReasons })}`);
  expect(domEvidence.announcement.visible, `${name} keeps its announcement visible for priority ${fixture.announcementPriority}`).toBe(true);
  expect(domEvidence.announcement.text, `${name} preserves the announcement text`).toContain('砲台の予告');
  expect(domEvidence.announcement.critical, `${name} records the actual priority-derived critical flag` ).toBe(String(fixture.announcementPriority >= 1));
  for (const font of fontScale.fontBaselines ?? []) expect(Math.abs(font.appliedPx - font.basePx * 2), `${name} applies 200% of current ${font.selector} baseline at ${evidence.viewport.width}×${evidence.viewport.height}`).toBeLessThan(0.1);
  for (const [selector, expectedBasePx] of [['#hud', 16], ['.instrument', 10], ['#health', 15]] as const) {
    const sample = fontScale.fontBaselines?.find((font: any) => font.selector === selector);
    expect(sample?.basePx, `${name} reads the product ${selector} baseline fresh at ${evidence.viewport.width}×${evidence.viewport.height}`).toBe(expectedBasePx);
  }
  const runCheck = async (label: string, check: () => Promise<unknown>) => {
    try { await check(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name} / ${label}: ${message.split('\n').slice(0, 3).join(' | ').slice(0, 700)}`);
    }
  };
  await runCheck('Canvas pixels', () => checkCanvasPixels(page, mode, canvas));
  await runCheck('DOM and Canvas HUD geometry', () => checkHudGeometry(page));
  await runCheck('44px HUD controls', () => checkGeometry(page, '#hud'));
  return screenshotMs;
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
  let setupMs = await setup(page); let captureMs = 0; const started = performance.now();
  const hudFailures: string[] = [];
  const freshBaselineByCase = new Map<string, any>();
  const freshBaselineEvidence: unknown[] = [];
  const groups = [...new Set(HUD_CASES.map(hudCase => `${hudCase.width}x${hudCase.height}/${hudCase.mode}`))];
  for (const group of groups) {
    const groupCases = HUD_CASES.filter(hudCase => `${hudCase.width}x${hudCase.height}/${hudCase.mode}` === group);
    const representative = groupCases[0];
    const freshPage = await browser.newPage({ viewport: { width: representative.width, height: representative.height } });
    try {
      const viewportBeforeSetup = freshPage.viewportSize();
      expect(viewportBeforeSetup, `${group} fixes its viewport before setup`).toEqual({ width: representative.width, height: representative.height });
      setupMs += await setup(freshPage);
      const cssBeforeFixture = await typographySnapshot(freshPage);
      for (const hudCase of groupCases) {
        await paintedFixture(freshPage, hudCase.mode, hudCase.alert, hudCase.priority);
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
      }
    } finally {
      await freshPage.close();
    }
  }
  await info.attach('fresh-page-hud-baselines.json', { body: Buffer.from(JSON.stringify(freshBaselineEvidence, null, 2)), contentType: 'application/json' });
  const inspectFixedHud = async (name: string, mode: 'easy' | 'normal', fixture: any) => {
    const hudCase = HUD_CASES.find(candidate => candidate.name === name);
    const freshBaseline = freshBaselineByCase.get(name);
    if (!hudCase || !freshBaseline) throw new Error(`Missing fresh-page HUD counterpart for ${name}`);
    expect(hudCase.mode).toBe(mode);
    const fontScale = await enlargeText(page);
    const painted = await repaintFixedFixture(page);
    captureMs += await inspectAndCaptureHudCase(page, info, hudCase, painted, fixture, fontScale,
      freshBaseline, 'rotation-stress', hudFailures);
  };
  const originalReadState = await page.evaluateHandle(() => (window as any).__fantasiaReadState);
  await setViewportAndWait(page, 320, 568);
  let fixture = await paintedFixture(page, 'easy', 'outside', 0);
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
  await inspectFixedHud('hud-easy-outside-small-portrait-text-200-priority-0.png', 'easy', fixture);
  fixture = await paintedFixture(page, 'easy', 'outside', 4);
  await inspectFixedHud('hud-easy-outside-small-portrait-text-200-priority-4.png', 'easy', fixture);
  const easyAim = await page.evaluate(async () => {
    const { aimRadius } = await import('/src/aim-indicator.ts');
    const flight = document.querySelector('#flight')!.getBoundingClientRect(), markers = document.querySelector('#markers')!.getBoundingClientRect();
    return { radius: aimRadius('easy', innerWidth, innerHeight), sameCanvas: flight.width === markers.width && flight.height === markers.height, pointerEvents: getComputedStyle(document.querySelector('#markers')!).pointerEvents };
  });
  expect(easyAim.radius).toBeCloseTo(320 * .135); expect(easyAim.sameCanvas).toBe(true); expect(easyAim.pointerEvents).toBe('none');

  await act(page, 'reset'); await setViewportAndWait(page, 568, 320);
  fixture = await paintedFixture(page, 'normal', 'protected', 0);
  const normalModeState = await page.evaluate(() => {
    const controls = document.querySelector<HTMLElement>('#normal-controls');
    const app = document.querySelector<HTMLElement>('#app');
    const read = (window as any).__fantasiaReadState?.(false);
    return { appMode: app?.dataset.mode, stateMode: read?.mode, controlsHidden: controls?.hidden, screen: app?.dataset.screen };
  });
  expect(fixture.mode, `fixed Normal fixture ${JSON.stringify(normalModeState)}`).toBe('normal');
  expect(normalModeState.appMode).toBe('normal');
  expect(normalModeState.stateMode).toBe('normal');
  expect(normalModeState.controlsHidden).toBe(false);
  // The wrapper has no height because its flight controls are absolutely positioned.
  // Assert the actual controls that players see and operate instead.
  await expect(page.locator('#fire')).toBeVisible(); await expect(page.locator('#throttle')).toBeVisible();
  await expect(page.locator('#warning')).toContainText('復活保護');
  await expect(page.locator('#reload-status')).toContainText('再装填中');
  await expect(page.locator('#campaign-sites .campaign-site')).toHaveCount(7);
  await inspectFixedHud('hud-normal-protected-small-landscape-text-200-priority-0.png', 'normal', fixture);
  const normalAim = await page.evaluate(async () => {
    const { aimRadius } = await import('/src/aim-indicator.ts');
    const flight = document.querySelector('#flight')!.getBoundingClientRect(), markers = document.querySelector('#markers')!.getBoundingClientRect();
    return { radius: aimRadius('normal', innerWidth, innerHeight), sameCanvas: flight.width === markers.width && flight.height === markers.height, pointerEvents: getComputedStyle(document.querySelector('#markers')!).pointerEvents };
  });
  expect(normalAim.radius).toBeGreaterThanOrEqual(26); expect(normalAim.sameCanvas).toBe(true); expect(normalAim.pointerEvents).toBe('none');

  fixture = await paintedFixture(page, 'normal', 'protected', 4);
  await inspectFixedHud('hud-normal-protected-small-landscape-text-200-priority-4.png', 'normal', fixture);
  fixture = await paintedFixture(page, 'normal', 'low', 4); await expect(page.locator('#warning')).toContainText('低空注意');
  await inspectFixedHud('hud-normal-low-warning-small-landscape-text-200-priority-4.png', 'normal', fixture);

  // Keep the existing Easy landscape clear case, then add the missing Easy landscape warning.
  fixture = await paintedFixture(page, 'easy', 'clear', 0);
  await inspectFixedHud('hud-easy-clear-small-landscape-text-200-priority-0.png', 'easy', fixture);
  fixture = await paintedFixture(page, 'easy', 'clear', 4);
  await inspectFixedHud('hud-easy-clear-small-landscape-text-200-priority-4.png', 'easy', fixture);
  await expect(page.locator('#campaign-sites .campaign-site')).toHaveCount(7);
  fixture = await paintedFixture(page, 'easy', 'low', 4); await expect(page.locator('#warning')).toContainText('低空注意');
  await inspectFixedHud('hud-easy-warning-small-landscape-text-200-priority-4.png', 'easy', fixture);

  await act(page, 'reset'); await setViewportAndWait(page, 320, 568);
  fixture = await paintedFixture(page, 'normal', 'respawn', 0);
  expect(fixture.status).toBe('respawning'); await expect(page.locator('#respawn-status')).toBeVisible();
  await expect(page.locator('#respawn-status')).toContainText('復活まで 3秒');
  await expect(page.locator('#warning')).toBeHidden(); await expect(page.locator('#reload-status')).toContainText('再装填中');
  await inspectFixedHud('hud-normal-respawn-small-portrait-text-200-priority-0.png', 'normal', fixture);
  fixture = await paintedFixture(page, 'normal', 'respawn', 4);
  await inspectFixedHud('hud-normal-respawn-small-portrait-text-200-priority-4.png', 'normal', fixture);

  expect(await page.evaluate((readState) => window.__fantasiaReadState === readState, originalReadState)).toBe(true);
  await record('hud-modes-sites-aim-alerts', setupMs, started, captureMs);
  expect(hudFailures, 'all Easy/Normal portrait/landscape HUD cases, Canvas pixels and 44px geometry').toEqual([]);
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
