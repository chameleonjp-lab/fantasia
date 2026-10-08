import { expect, test, type Page, type TestInfo } from '@playwright/test';

type Timings = { name: string; setupMs: number; tourMs: number; captureMs: number };
const timings: Timings[] = [];

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
        snapshot,
      };
    });
    throw new Error(`UI-only setup timed out: ${JSON.stringify({ state, browserErrors, cause: String(error) })}`);
  }
  return performance.now() - start;
}

async function act(page: Page, method: string, ...args: unknown[]) {
  return page.evaluate(async ({ method, args }) => await (window as any).__fantasiaUiOnlyTest[method](...args), { method, args });
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
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('#app *')].filter(node => !['CANVAS', 'SCRIPT', 'STYLE'].includes(node.tagName));
    const measurements = nodes.map(node => {
      if (!node.dataset.uiOnlyFontBase) node.dataset.uiOnlyFontBase = String(parseFloat(getComputedStyle(node).fontSize) || 16);
      return { node, base: Number(node.dataset.uiOnlyFontBase) };
    });
    for (const { node, base } of measurements) node.style.setProperty('font-size', `${base * 2}px`, 'important');
    return nodes.length;
  });
}

async function checkGeometry(page: Page, selector: string) {
  const result = await page.evaluate(scopeSelector => {
    const scope = document.querySelector<HTMLElement>(scopeSelector);
    if (!scope) throw new Error(`Missing geometry scope ${scopeSelector}`);
    const visible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !element.closest('[hidden]');
    };
    const targets = [...scope.querySelectorAll<HTMLElement>('button:not(.preview-control), input[type="range"], select, summary, [role="slider"], label:has(> input[type="radio"])')].filter(visible);
    const small = targets.filter(element => { const rect = element.getBoundingClientRect(); return rect.width < 44 || rect.height < 44; }).map(element => element.id || element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 32));
    const overlaps: string[] = [];
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i].getBoundingClientRect(), b = targets[j].getBoundingClientRect();
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
    const clipped: string[] = [], outside: string[] = [], overlaps: string[] = [];
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
      }
    }
    return { clipped, outside, overlaps, detailViewport, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
  expect(result.clipped, 'visible warning, site, instrument and HUD panel content must not clip').toEqual([]);
  expect(result.outside, 'visible warning, site, instrument and HUD panels must stay on screen').toEqual([]);
  expect(result.overlaps, 'visible HUD panels must not overlap').toEqual([]);
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

  const canvasLayout = await act(page, 'layout');
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

async function paintedFixture(page: Page, mode: 'easy' | 'normal', alert: string) {
  const before = await act(page, 'canvas');
  const fixture = await act(page, 'hud', mode, alert);
  expect(fixture.canvas.drawCalls, `${mode}/${alert} invokes the product painter exactly once`).toBe(before.drawCalls + 1);
  expect(fixture.canvas.hudLayout.measurements).toBeGreaterThan(0);
  expect(fixture.canvas.hudLayout.status).toBe('placed');
  expect(fixture.canvas.radius).toBeGreaterThan(0);
  return fixture;
}

async function repaintFixedFixture(page: Page) {
  const before = await act(page, 'canvas');
  const painted = await act(page, 'paint');
  expect(painted.drawCalls, 'fixed-state 200% repaint calls the product painter exactly once').toBe(before.drawCalls + 1);
  return painted;
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

test.afterAll(() => {
  const totals = timings.reduce((sum, item) => ({ setupMs: sum.setupMs + item.setupMs, tourMs: sum.tourMs + item.tourMs, captureMs: sum.captureMs + item.captureMs }), { setupMs: 0, tourMs: 0, captureMs: 0 });
  console.log(`[ui-only-total] ${JSON.stringify({ cases: timings.length, ...totals, targetMs: 60000 })}`);
});

test('Home, Rules, touch and keyboard settings save through product dialogs', async ({ page }, info) => {
  const setupMs = await setup(page); let captureMs = 0; const started = performance.now();
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await enlargeText(page)).toBeGreaterThan(20);
  await expect(page.locator('#home')).toBeVisible();
  await checkGeometry(page, '#home');
  await checkBodyPanels(page, '#home');
  captureMs += await capture(page, info, 'home-portrait-text-200.png');
  await page.setViewportSize({ width: 568, height: 320 });
  await checkGeometry(page, '#home'); await checkBodyPanels(page, '#home'); captureMs += await capture(page, info, 'home-landscape-text-200.png');
  await page.reload();
  await page.setViewportSize({ width: 568, height: 320 });
  await page.click('#home-rules'); await expect(page.locator('#rules-guide[open]')).toBeVisible();
  await enlargeText(page);
  await checkGeometry(page, '#rules-guide'); await checkBodyPanels(page, '#rules-guide'); captureMs += await capture(page, info, 'rules-landscape-text-200.png');
  await page.locator('#rules-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await page.locator('#rules-content').evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);
  await page.click('#rules-back');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.click('#home-controls'); await expect(page.locator('#control-settings[open]')).toBeVisible();
  await enlargeText(page);
  await checkGeometry(page, '#control-settings'); await checkBodyPanels(page, '#control-settings');
  captureMs += await capture(page, info, 'settings-touch.png');
  const oldSize = await page.locator('#control-size').inputValue();
  await page.locator('#control-size').focus(); await page.keyboard.press('ArrowRight');
  expect(await page.locator('#control-size').inputValue()).not.toBe(oldSize);
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

test('Easy and Normal HUD, seven sites, aim geometry and alerts fit small portrait and landscape', async ({ page }, info) => {
  const setupMs = await setup(page); let captureMs = 0; const started = performance.now();
  const originalReadState = await page.evaluateHandle(() => (window as any).__fantasiaReadState);
  await page.setViewportSize({ width: 320, height: 568 });
  let fixture = await paintedFixture(page, 'easy', 'outside');
  expect(fixture.screen).toBe('playing');
  await expect(page.locator('#hud')).toBeVisible(); await expect(page.locator('#normal-controls')).toBeHidden();
  await expect(page.locator('#campaign-sites .campaign-site')).toHaveCount(7);
  await expect(page.locator('#warning')).toContainText('作戦圏へ戻って');
  await expect(page.locator('#campaign-threat')).toContainText('砲台の魔法');
  await expect(page.locator('#reload-status')).toContainText('再装填中');
  expect(fixture.layout.status).toBe('placed');
  await enlargeText(page);
  let painted = await repaintFixedFixture(page);
  await checkCanvasPixels(page, 'easy', painted); await checkHudGeometry(page); await checkGeometry(page, '#hud');
  captureMs += await capture(page, info, 'hud-easy-outside-small-portrait-text-200.png');
  const easyAim = await page.evaluate(async () => {
    const { aimRadius } = await import('/src/aim-indicator.ts');
    const flight = document.querySelector('#flight')!.getBoundingClientRect(), markers = document.querySelector('#markers')!.getBoundingClientRect();
    return { radius: aimRadius('easy', innerWidth, innerHeight), sameCanvas: flight.width === markers.width && flight.height === markers.height, pointerEvents: getComputedStyle(document.querySelector('#markers')!).pointerEvents };
  });
  expect(easyAim.radius).toBeCloseTo(320 * .135); expect(easyAim.sameCanvas).toBe(true); expect(easyAim.pointerEvents).toBe('none');

  await act(page, 'reset'); await page.setViewportSize({ width: 568, height: 320 });
  fixture = await paintedFixture(page, 'normal', 'protected');
  await expect(page.locator('#normal-controls')).toBeVisible(); await expect(page.locator('#warning')).toContainText('復活保護');
  await expect(page.locator('#reload-status')).toContainText('再装填中');
  await expect(page.locator('#campaign-sites .campaign-site')).toHaveCount(7); expect(fixture.layout.status).toBe('placed');
  await checkCanvasPixels(page, 'normal', fixture.canvas); await checkHudGeometry(page); await checkGeometry(page, '#hud');
  captureMs += await capture(page, info, 'hud-normal-protected-small-landscape-text-200.png');
  const normalAim = await page.evaluate(async () => {
    const { aimRadius } = await import('/src/aim-indicator.ts');
    const flight = document.querySelector('#flight')!.getBoundingClientRect(), markers = document.querySelector('#markers')!.getBoundingClientRect();
    return { radius: aimRadius('normal', innerWidth, innerHeight), sameCanvas: flight.width === markers.width && flight.height === markers.height, pointerEvents: getComputedStyle(document.querySelector('#markers')!).pointerEvents };
  });
  expect(normalAim.radius).toBeGreaterThanOrEqual(26); expect(normalAim.sameCanvas).toBe(true); expect(normalAim.pointerEvents).toBe('none');

  fixture = await paintedFixture(page, 'normal', 'low'); await expect(page.locator('#warning')).toContainText('低空注意');
  await checkCanvasPixels(page, 'normal', fixture.canvas); await checkHudGeometry(page); await checkGeometry(page, '#hud');
  captureMs += await capture(page, info, 'hud-normal-low-warning-small-landscape-text-200.png');

  // Keep the existing Easy landscape clear case, then add the missing Easy landscape warning.
  fixture = await paintedFixture(page, 'easy', 'clear');
  expect(fixture.layout.status).toBe('placed'); await checkCanvasPixels(page, 'easy', fixture.canvas); await checkHudGeometry(page); await checkGeometry(page, '#hud');
  await expect(page.locator('#campaign-sites .campaign-site')).toHaveCount(7);
  fixture = await paintedFixture(page, 'easy', 'low'); await expect(page.locator('#warning')).toContainText('低空注意');
  await checkCanvasPixels(page, 'easy', fixture.canvas); await checkHudGeometry(page); await checkGeometry(page, '#hud');
  captureMs += await capture(page, info, 'hud-easy-warning-small-landscape-text-200.png');

  await act(page, 'reset'); await page.setViewportSize({ width: 320, height: 568 });
  fixture = await paintedFixture(page, 'normal', 'respawn');
  expect(fixture.status).toBe('respawning'); await expect(page.locator('#respawn-status')).toBeVisible();
  await expect(page.locator('#respawn-status')).toContainText('復活まで 3秒');
  await expect(page.locator('#warning')).toBeHidden(); await expect(page.locator('#reload-status')).toContainText('再装填中');
  await checkCanvasPixels(page, 'normal', fixture.canvas); await checkHudGeometry(page); await checkGeometry(page, '#hud');
  captureMs += await capture(page, info, 'hud-normal-respawn-small-portrait-text-200.png');

  expect(await page.evaluate((readState) => window.__fantasiaReadState === readState, originalReadState)).toBe(true);
  await record('hud-modes-sites-aim-alerts', setupMs, started, captureMs);
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
  await page.setViewportSize({ width: 320, height: 568 });
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
