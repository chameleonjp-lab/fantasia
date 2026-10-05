import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

type ReadState = {
  phase?: string;
  screen?: string;
  mode?: string;
  selectedMode?: string;
  tick?: number;
  [key: string]: unknown;
};

const state = (page: Page) => page.evaluate(() => {
  const read = (window as any).__fantasiaReadState;
  return typeof read === 'function' ? read(false) as ReadState : null;
});

async function ready(page: Page, viewport?: { width: number; height: number }) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled({ timeout: 60000 });
  await expect.poll(async () => page.evaluate(() => typeof (window as any).__fantasiaReadState)).toBe('function');
}

async function start(page: Page, mode: 'easy' | 'normal') {
  const option = page.locator(`input[name="game-mode"][value="${mode}"]`);
  if (!(await option.isChecked())) await option.check();
  await page.locator('#start').click();
  await expect.poll(async () => (await state(page))?.phase).toBe('playing');
  // The HUD shell is a zero-height section because all HUD children are
  // absolutely positioned. Assert its active state and visible controls.
  await expect(page.locator('#hud')).not.toHaveAttribute('hidden');
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#hud-mode')).toHaveText(mode === 'easy' ? 'イージー' : 'ノーマル');
  expect((await state(page))?.mode).toBe(mode);
}

async function saveEvidence(page: Page, name: string, note: string) {
  await mkdir('test-results/evidence', { recursive: true });
  await page.screenshot({ path: `test-results/evidence/${name}.png` });
  await writeFile(`test-results/evidence/${name}.json`, JSON.stringify({
    environment: 'Playwright Chromium viewport emulation; not physical-device coverage',
    note,
    viewport: page.viewportSize(),
    state: await state(page),
  }, null, 2));
}

async function siteLayout(page: Page) {
  return page.locator('#campaign-sites .campaign-site[data-site]').evaluateAll(items => {
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return items.map(item => ({
      id: (item as HTMLElement).dataset.site ?? '',
      box: box(item),
      owner: item.querySelector('.campaign-site-owner')?.textContent?.trim() ?? '',
      force: item.querySelector('.campaign-site-force')?.textContent?.trim() ?? '',
      wave: item.querySelector('.campaign-site-wave')?.textContent?.trim() ?? '',
      progress: Boolean(item.querySelector('.campaign-site-progress > i')),
    }));
  });
}

async function expectSevenSiteLayout(page: Page, viewport: { width: number; height: number }) {
  const strip = page.locator('#campaign-sites');
  await expect(strip).toBeVisible();
  const sites = await siteLayout(page);
  expect(sites).toHaveLength(7);
  expect(new Set(sites.map(site => site.id)).size).toBe(7);
  for (const site of sites) {
    expect(site.id).not.toBe('');
    expect(site.owner).not.toBe('');
    expect(site.force).not.toBe('');
    expect(site.wave).not.toBe('');
    expect(site.progress).toBe(true);
    expect(site.box.x).toBeGreaterThanOrEqual(-0.5);
    expect(site.box.right).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(site.box.y).toBeGreaterThanOrEqual(-0.5);
    expect(site.box.bottom).toBeLessThanOrEqual(viewport.height + 0.5);
  }

  // The aiming area remains open on all aspect ratios. The strip can use two
  // rows on narrow screens, but no site card may cover the screen center.
  const center = { left: viewport.width / 2 - 42, right: viewport.width / 2 + 42,
    top: viewport.height / 2 - 42, bottom: viewport.height / 2 + 42 };
  for (const site of sites) {
    const intersects = site.box.x < center.right && site.box.right > center.left
      && site.box.y < center.bottom && site.box.bottom > center.top;
    expect(intersects, `site ${site.id} does not cover the central aiming area`).toBe(false);
  }

  const metrics = await page.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    strip: (() => { const r = document.querySelector('#campaign-sites')!.getBoundingClientRect(); return { x: r.x, right: r.right }; })(),
    tops: Array.from(document.querySelectorAll<HTMLElement>('#campaign-sites .campaign-site[data-site]'))
      .map(node => Math.round(node.getBoundingClientRect().top)),
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.width);
  expect(metrics.strip.x).toBeGreaterThanOrEqual(-0.5);
  expect(metrics.strip.right).toBeLessThanOrEqual(viewport.width + 0.5);

  if (viewport.width <= 393) {
    const rows = new Map<number, number>();
    for (const y of metrics.tops) rows.set(y, (rows.get(y) ?? 0) + 1);
    expect([...rows.values()].sort((a, b) => b - a)).toEqual([4, 3]);
  }
}

test('home starts both modes, pauses the live campaign, restarts it, and returns home', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#home-controls')).toBeVisible();
  await expect(page.locator('#home-rules')).toBeVisible();

  for (const mode of ['normal', 'easy'] as const) {
    await start(page, mode);
    if (mode === 'normal') await expect(page.locator('#fire')).toBeVisible();
    else await expect(page.locator('#fire')).toBeHidden();

    await page.locator('#pause').click();
    await expect.poll(async () => (await state(page))?.phase).toBe('paused');
    const frozen = await state(page);
    await page.waitForTimeout(250);
    expect((await state(page))?.tick).toBe(frozen?.tick);
    await expect(page.locator('#pause-screen')).toBeVisible();

    await page.locator('#pause-restart').click();
    await expect.poll(async () => (await state(page))?.phase).toBe('playing');
    await expect(page.locator('#hud-mode')).toHaveText(mode === 'easy' ? 'イージー' : 'ノーマル');
    await page.locator('#pause').click();
    await page.locator('#pause-home').click();
    await expect(page.locator('#home')).toBeVisible();
    await expect(page.locator(`input[name="game-mode"][value="${mode}"]`)).toBeChecked();
  }
});

test('settings tabs save committed changes, discard drafts, and reject duplicate keys', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    for (const key of ['fantasia-controls-v1', 'fantasia-controls-easy-v1', 'fantasia-keyboard-v1']) localStorage.removeItem(key);
  });
  await page.locator('#home-controls').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await page.locator('#control-mode').selectOption('normal');
  await page.locator('#control-target').selectOption('fire');

  const beforeX = Number(await page.locator('#control-x').inputValue());
  await page.locator('#control-x').focus();
  await page.keyboard.press('ArrowRight');
  const savedX = Number(await page.locator('#control-x').inputValue());
  expect(savedX).not.toBe(beforeX);
  await page.locator('#control-save').click();
  await expect(page.locator('#control-settings')).toBeHidden();
  const savedLayout = await page.evaluate(() => JSON.parse(localStorage.getItem('fantasia-controls-v1')!).controls.fire.x);
  expect(savedLayout).toBe(savedX / 100);

  await page.locator('#home-controls').click();
  await page.locator('#control-mode').selectOption('normal');
  await page.locator('#control-target').selectOption('fire');
  await expect(page.locator('#control-x')).toHaveValue(String(savedX));
  await page.locator('#control-x').focus();
  await page.keyboard.press('ArrowLeft');
  expect(Number(await page.locator('#control-x').inputValue())).not.toBe(savedX);
  await page.locator('#control-cancel').click();
  expect(await page.evaluate(() => localStorage.getItem('fantasia-controls-v1')))
    .toContain(`"x":${savedX / 100}`);

  await page.locator('#home-controls').click();
  await page.locator('#control-editor-keyboard').click();
  await expect(page.locator('#control-keyboard-editor')).toBeVisible();
  await page.locator('[data-key-action="fire"]').click();
  await page.keyboard.press('f');
  await expect(page.locator('[data-key-action="fire"]')).toHaveText('F');

  await page.locator('[data-key-action="left"]').click();
  await page.keyboard.press('f');
  await expect(page.locator('#keyboard-capture-note')).toContainText('射撃');
  await expect(page.locator('[data-key-action="left"]')).toHaveText('←');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-key-action="left"]')).toHaveText('←');
  await page.locator('#control-save').click();
  const savedKeys = await page.evaluate(() => JSON.parse(localStorage.getItem('fantasia-keyboard-v1')!).bindings);
  expect(savedKeys.fire).toBe('KeyF');
  expect(savedKeys.left).toBe('ArrowLeft');

  await page.locator('input[name="game-mode"][value="normal"]').check();
  await page.locator('#start').click();
  await expect.poll(async () => (await state(page))?.phase).toBe('playing');
  await expect(page.locator('#keyboard-guide')).toContainText('F 射撃');
});

test('a hidden game stays paused until the player returns and restarts deliberately', async ({ page, context }) => {
  await ready(page);
  await start(page, 'easy');
  await page.evaluate(() => {
    (window as any).__fantasiaLifecycle = [];
    window.addEventListener('blur', () => (window as any).__fantasiaLifecycle.push('blur'));
    document.addEventListener('visibilitychange', () =>
      (window as any).__fantasiaLifecycle.push(document.visibilityState));
  });

  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await expect.poll(async () => page.evaluate(() => document.visibilityState)).toBe('hidden');
  await expect.poll(async () => (await state(page))?.phase).toBe('paused');
  const frozen = await state(page);
  await page.waitForTimeout(250);
  expect((await state(page))?.tick).toBe(frozen?.tick);
  const lifecycle = await page.evaluate(() => (window as any).__fantasiaLifecycle as string[]);
  expect(lifecycle).toContain('hidden');
  expect(lifecycle).toContain('blur');

  await other.close();
  await page.bringToFront();
  await expect(page.locator('#pause-screen')).toBeVisible();
  await expect.poll(async () => (await state(page))?.phase).toBe('paused');
  await page.locator('#pause-restart').click();
  await expect.poll(async () => (await state(page))?.phase).toBe('playing');
  await expect(page.locator('#hud')).not.toHaveAttribute('hidden');
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#hud-mode')).toHaveText('イージー');
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 393, height: 852 },
  { width: 852, height: 393 },
]) {
  test(`all seven campaign sites fit around the aiming area at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await ready(page, viewport);
    await start(page, 'easy');
    await expectSevenSiteLayout(page, viewport);
    await saveEvidence(page, `fantasia-sites-${viewport.width}x${viewport.height}`,
      'Live Easy campaign, all seven site indicators visible; captured at the CSS viewport shown above.');
  });
}

test.describe('desktop enlarged-text reachability', () => {
  test.use({ isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } });

  test('settings and all seven site indicators remain usable with actual text rendered at 200%', async ({ page }) => {
    await ready(page);

    // Increase each visible text run in CSS before measuring. This changes
    // font layout in the document; it does not scale a screenshot or canvas.
    const scaleVisibleText = async () => page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const textParents = new Set<HTMLElement>();
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent?.trim()) continue;
        const parent = walker.currentNode.parentElement;
        if (!parent || !parent.getClientRects().length || parent.closest('[hidden]')) continue;
        textParents.add(parent as HTMLElement);
      }
      for (const element of textParents) {
        if (element.dataset.fantasiaTextZoom === '200') continue;
        const size = Number.parseFloat(getComputedStyle(element).fontSize);
        if (!Number.isFinite(size) || size <= 0) continue;
        element.style.setProperty('font-size', `${size * 2}px`, 'important');
        element.dataset.fantasiaTextZoom = '200';
      }
      document.documentElement.dataset.fantasiaTextZoom = '200';
    });

    const homeTextSize = await page.locator('#home-controls').evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    await scaleVisibleText();
    const enlargedHomeTextSize = await page.locator('#home-controls').evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(enlargedHomeTextSize).toBeGreaterThanOrEqual(homeTextSize * 1.95);
    await page.locator('#home-controls').click();
    await expect(page.locator('#control-settings')).toBeVisible();
    await scaleVisibleText();

    for (const id of ['control-x', 'control-y', 'control-size', 'control-opacity']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }
    await expect(page.locator('#control-save')).toBeInViewport();
    await expect(page.locator('#control-cancel')).toBeInViewport();
    await page.locator('#control-editor-keyboard').click();
    await scaleVisibleText();
    await page.locator('[data-key-action="pause"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-key-action="pause"]')).toBeInViewport();
    await expect(page.locator('#control-save')).toBeInViewport();
    await page.locator('#control-cancel').click();

    await start(page, 'normal');
    await scaleVisibleText();
    await expectSevenSiteLayout(page, { width: 1280, height: 800 });
    const siteFontSize = await page.locator('#campaign-sites .campaign-site-owner').first()
      .evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(siteFontSize).toBeGreaterThanOrEqual(14);
    await saveEvidence(page, 'fantasia-sites-desktop-text-200',
      'Desktop CSS text runs were doubled to 200% before layout checks; text and controls remained in the live page.');
  });
});
