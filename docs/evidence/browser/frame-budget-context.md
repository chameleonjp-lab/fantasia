# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: fantasia.spec.ts >> the first touch loop release after keyboard-default input reaches exactly one live tick
- Location: browser-tests/fantasia.spec.ts:275:3

# Error details

```
TimeoutError: locator.tap: Timeout 2500ms exceeded.
Call log:
  - waiting for locator('#loop')
    - locator resolved to <button id="loop" class="loop-button" aria-pressed="false" data-flight-control="true">…</button>
  - attempting tap action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="panel">…</div> from <section role="dialog" id="pause-screen" aria-modal="true" class="screen modal-screen" aria-labelledby="pause-title">…</section> subtree intercepts pointer events
    - retrying tap action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="panel">…</div> from <section role="dialog" id="pause-screen" aria-modal="true" class="screen modal-screen" aria-labelledby="pause-title">…</section> subtree intercepts pointer events
    - retrying tap action
      - waiting 100ms
    3 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="panel">…</div> from <section role="dialog" id="pause-screen" aria-modal="true" class="screen modal-screen" aria-labelledby="pause-title">…</section> subtree intercepts pointer events
    - retrying tap action
      - waiting 500ms

```

# Page snapshot

```yaml
- main [ref=e2]:
  - generic "7方面の地上軍を支援する航空戦闘画面" [ref=e3]
  - region "飛行中の情報":
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]: 作戦経過 · イージー
        - strong [ref=e7]: 00:00.31
      - generic "陣地占領数と残機" [ref=e8]:
        - generic [ref=e9]:
          - generic [ref=e10]: 味方の旗
          - generic [ref=e11]: "0"
          - generic [ref=e12]: / 7陣地
        - generic [ref=e13]:
          - button "音をオンにする" [ref=e14] [cursor=pointer]: 音 OFF
          - button "一時停止" [ref=e15] [cursor=pointer]: Ⅱ
        - generic [ref=e16]:
          - generic [ref=e17]: 残機
          - generic [ref=e18]: "3"
          - generic [ref=e19]: 現在機を含む
    - list "7陣地の戦況":
      - listitem "陣地1、敵所有、砲台あり、占領進捗0%、味方地上兵24、敵地上兵24、予備兵48、砲台HP600、味方次の補充周期まで30秒、敵次の補充周期まで45秒":
        - generic:
          - generic: "1"
          - generic: 敵
        - generic: 友24 / 予48
        - generic: 砲台あり · 補30s
      - listitem "陣地2、敵所有、砲台あり、占領進捗0%、味方地上兵24、敵地上兵24、予備兵48、砲台HP600、味方次の補充周期まで30秒、敵次の補充周期まで45秒":
        - generic:
          - generic: "2"
          - generic: 敵
        - generic: 友24 / 予48
        - generic: 砲台あり · 補30s
      - listitem "陣地3、敵所有、砲台あり、占領進捗0%、味方地上兵24、敵地上兵24、予備兵48、砲台HP600、味方次の補充周期まで30秒、敵次の補充周期まで45秒":
        - generic:
          - generic: "3"
          - generic: 敵
        - generic: 友24 / 予48
        - generic: 砲台あり · 補30s
      - listitem "陣地4、敵所有、砲台あり、占領進捗0%、味方地上兵24、敵地上兵24、予備兵48、砲台HP600、味方次の補充周期まで30秒、敵次の補充周期まで45秒":
        - generic:
          - generic: "4"
          - generic: 敵
        - generic: 友24 / 予48
        - generic: 砲台あり · 補30s
      - listitem "陣地5、敵所有、砲台あり、占領進捗0%、味方地上兵24、敵地上兵24、予備兵48、砲台HP600、味方次の補充周期まで30秒、敵次の補充周期まで45秒":
        - generic:
          - generic: "5"
          - generic: 敵
        - generic: 友24 / 予48
        - generic: 砲台あり · 補30s
      - listitem "陣地6、敵所有、砲台あり、占領進捗0%、味方地上兵24、敵地上兵24、予備兵48、砲台HP600、味方次の補充周期まで30秒、敵次の補充周期まで45秒":
        - generic:
          - generic: "6"
          - generic: 敵
        - generic: 友24 / 予48
        - generic: 砲台あり · 補30s
      - listitem "陣地7、敵所有、砲台あり、占領進捗0%、味方地上兵24、敵地上兵24、予備兵48、砲台HP600、味方次の補充周期まで30秒、敵次の補充周期まで45秒":
        - generic:
          - generic: "7"
          - generic: 敵
        - generic: 友24 / 予48
        - generic: 砲台あり · 補30s
    - generic [ref=e20]:
      - generic [ref=e21]:
        - text: 機体
        - generic [ref=e22]: "100"
        - generic [ref=e23]: "%"
      - generic [ref=e26]:
        - generic [ref=e27]: 299m
        - generic [ref=e28]: 396km/h
      - generic [ref=e29]: 味方兵 168 · 予備 336
      - generic [ref=e30]: 期限まで 19:59
      - generic [ref=e31]: スコア 0
      - generic "残弾数" [ref=e32]: 機銃 280 · 機関砲 92
    - paragraph
    - button "爆弾を投下・2発・投下待機（予測）" [ref=e33] [cursor=pointer]:
      - generic [ref=e34]: 爆弾
      - generic [ref=e35]: 残り2発
      - generic [ref=e36]: 投下待機
    - paragraph: キーで操縦
    - button "宙返り すぐ使える" [ref=e37] [cursor=pointer]:
      - generic [ref=e38]: ↻
      - generic [ref=e39]: 宙返り
      - generic [ref=e40]: すぐ使える
  - dialog "一時停止" [ref=e41]:
    - generic [ref=e42]:
      - paragraph [ref=e43]: PAUSED
      - heading "一時停止" [level=2] [ref=e44]
      - paragraph [ref=e45]: 更新の遅れが0.25秒を超えました。この出撃は最速記録に保存しません
      - group [ref=e46]:
        - generic "7方面の戦況を見る" [ref=e47] [cursor=pointer]
      - button "飛行を再開" [active] [ref=e48] [cursor=pointer]
      - button "はじめから出撃" [ref=e49] [cursor=pointer]
      - button "ホームへ戻る" [ref=e50] [cursor=pointer]
      - button "ルールと操作方法" [ref=e51] [cursor=pointer]
      - button "操作設定" [ref=e52] [cursor=pointer]
  - status: 7軍の進軍開始 · 砲台と竜を排除し、旗をそろえよう
```

# Test source

```ts
  1   | import { test, expect, type Page } from '@playwright/test';
  2   | import { mkdir, writeFile } from 'node:fs/promises';
  3   | 
  4   | type ReadState = {
  5   |   phase?: string;
  6   |   screen?: string;
  7   |   mode?: string;
  8   |   selectedMode?: string;
  9   |   tick?: number;
  10  |   campaignPlayer?: { bombs?: number };
  11  |   pauseReasons?: string[];
  12  |   fatalLogicError?: string | null;
  13  |   renderStatus?: string;
  14  |   [key: string]: unknown;
  15  | };
  16  | 
  17  | const state = (page: Page) => page.evaluate(() => {
  18  |   const read = (window as any).__fantasiaReadState;
  19  |   return typeof read === 'function' ? read(false) as ReadState : null;
  20  | });
  21  | 
  22  | const audit = (page: Page) => page.evaluate(() => {
  23  |   const read = (window as any).__fantasiaReadState;
  24  |   return typeof read === 'function' ? read('audit') as { entries: Array<{ tick: number; input: Record<string, unknown> }> } : null;
  25  | });
  26  | 
  27  | async function ready(page: Page, viewport?: { width: number; height: number }) {
  28  |   if (viewport) await page.setViewportSize(viewport);
  29  |   await page.goto('/');
  30  |   await expect(page.locator('#start')).toBeEnabled({ timeout: 60000 });
  31  |   await expect.poll(async () => page.evaluate(() => typeof (window as any).__fantasiaReadState)).toBe('function');
  32  | }
  33  | 
  34  | async function start(page: Page, mode: 'easy' | 'normal') {
  35  |   const option = page.locator(`input[name="game-mode"][value="${mode}"]`);
  36  |   if (!(await option.isChecked())) await option.check();
  37  |   await page.locator('#start').click();
  38  |   await expect.poll(async () => (await state(page))?.phase).toMatch(/^(playing|paused)$/);
  39  |   const afterStart = await state(page);
  40  |   if (afterStart?.phase === 'paused') {
  41  |     // The renderer may report a temporary stall on SwiftShader and recover.
  42  |     // Honor its safe stop and require an explicit player resume; frame-gap,
  43  |     // hidden-page, and logic-error pauses remain test failures.
  44  |     expect(afterStart.pauseReasons).toEqual(['render']);
  45  |     expect(afterStart.fatalLogicError).toBeFalsy();
  46  |     await expect(page.locator('#pause-reason')).toHaveText('描画が復帰しました。操作して再開できます');
  47  |     if (afterStart.renderStatus === 'stalled' && await page.locator('#resume').isDisabled()) {
  48  |       test.skip(true, 'Headless Chromium renderer remained stalled; the app correctly withheld flight resume.');
  49  |     }
  50  |     await expect(page.locator('#resume')).toBeEnabled();
  51  |     await page.locator('#resume').click();
  52  |     await expect.poll(async () => {
  53  |       const live = await state(page);
  54  |       return live?.phase === 'playing' || (live?.phase === 'paused' && live.renderStatus === 'stalled');
  55  |     }).toBe(true);
  56  |     const afterResume = await state(page);
  57  |     if (afterResume?.phase === 'paused' && afterResume.pauseReasons?.includes('render')
  58  |       && afterResume.renderStatus === 'stalled' && await page.locator('#resume').isDisabled()) {
  59  |       test.skip(true, 'Headless Chromium renderer stalled again; the app correctly withheld flight resume.');
  60  |     }
  61  |   }
  62  |   await expect.poll(async () => (await state(page))?.phase).toBe('playing');
  63  |   // The HUD shell is a zero-height section because all HUD children are
  64  |   // absolutely positioned. Assert its active state and visible controls.
  65  |   await expect(page.locator('#hud')).not.toHaveAttribute('hidden');
  66  |   await expect(page.locator('#pause')).toBeVisible();
  67  |   await expect(page.locator('#hud-mode')).toHaveText(mode === 'easy' ? 'イージー' : 'ノーマル');
  68  |   expect((await state(page))?.mode).toBe(mode);
  69  | }
  70  | 
  71  | async function tapLiveControl(page: Page, selector: string) {
  72  |   try {
> 73  |     await page.locator(selector).tap({ timeout: 2500 });
      |                                  ^ TimeoutError: locator.tap: Timeout 2500ms exceeded.
  74  |   } catch (error) {
  75  |     const current = await state(page);
  76  |     if (current?.phase === 'paused' && current.pauseReasons?.includes('render')
  77  |       && current.renderStatus === 'stalled' && await page.locator('#resume').isDisabled()) {
  78  |       test.skip(true, 'Headless Chromium renderer stalled before the flight control could receive a real touch.');
  79  |     }
  80  |     throw error;
  81  |   }
  82  | }
  83  | 
  84  | async function saveEvidence(page: Page, name: string, note: string) {
  85  |   await mkdir('test-results/evidence', { recursive: true });
  86  |   await page.screenshot({ path: `test-results/evidence/${name}.png` });
  87  |   await writeFile(`test-results/evidence/${name}.json`, JSON.stringify({
  88  |     environment: 'Playwright Chromium viewport emulation; not physical-device coverage',
  89  |     note,
  90  |     viewport: page.viewportSize(),
  91  |     state: await state(page),
  92  |   }, null, 2));
  93  | }
  94  | 
  95  | async function siteLayout(page: Page) {
  96  |   return page.locator('#campaign-sites .campaign-site[data-site]').evaluateAll(items => {
  97  |     const box = (element: Element) => {
  98  |       const r = element.getBoundingClientRect();
  99  |       return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  100 |     };
  101 |     return items.map(item => ({
  102 |       id: (item as HTMLElement).dataset.site ?? '',
  103 |       box: box(item),
  104 |       owner: item.querySelector('.campaign-site-owner')?.textContent?.trim() ?? '',
  105 |       force: item.querySelector('.campaign-site-force')?.textContent?.trim() ?? '',
  106 |       wave: item.querySelector('.campaign-site-wave')?.textContent?.trim() ?? '',
  107 |       progress: Boolean(item.querySelector('.campaign-site-progress > i')),
  108 |     }));
  109 |   });
  110 | }
  111 | 
  112 | async function expectSevenSiteLayout(page: Page, viewport: { width: number; height: number }) {
  113 |   const strip = page.locator('#campaign-sites');
  114 |   await expect(strip).toBeVisible();
  115 |   const sites = await siteLayout(page);
  116 |   expect(sites).toHaveLength(7);
  117 |   expect(new Set(sites.map(site => site.id)).size).toBe(7);
  118 |   for (const site of sites) {
  119 |     expect(site.id).not.toBe('');
  120 |     expect(site.owner).not.toBe('');
  121 |     expect(site.force).not.toBe('');
  122 |     expect(site.wave).not.toBe('');
  123 |     expect(site.progress).toBe(true);
  124 |     expect(site.box.x).toBeGreaterThanOrEqual(-0.5);
  125 |     expect(site.box.right).toBeLessThanOrEqual(viewport.width + 0.5);
  126 |     expect(site.box.y).toBeGreaterThanOrEqual(-0.5);
  127 |     expect(site.box.bottom).toBeLessThanOrEqual(viewport.height + 0.5);
  128 |   }
  129 | 
  130 |   // The aiming area remains open on all aspect ratios. The strip can use two
  131 |   // rows on narrow screens, but no site card may cover the screen center.
  132 |   const center = { left: viewport.width / 2 - 42, right: viewport.width / 2 + 42,
  133 |     top: viewport.height / 2 - 42, bottom: viewport.height / 2 + 42 };
  134 |   for (const site of sites) {
  135 |     const intersects = site.box.x < center.right && site.box.right > center.left
  136 |       && site.box.y < center.bottom && site.box.bottom > center.top;
  137 |     expect(intersects, `site ${site.id} does not cover the central aiming area`).toBe(false);
  138 |   }
  139 | 
  140 |   const metrics = await page.evaluate(() => ({
  141 |     width: innerWidth,
  142 |     documentWidth: document.documentElement.scrollWidth,
  143 |     strip: (() => { const r = document.querySelector('#campaign-sites')!.getBoundingClientRect(); return { x: r.x, right: r.right }; })(),
  144 |     tops: Array.from(document.querySelectorAll<HTMLElement>('#campaign-sites .campaign-site[data-site]'))
  145 |       .map(node => Math.round(node.getBoundingClientRect().top)),
  146 |   }));
  147 |   expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.width);
  148 |   expect(metrics.strip.x).toBeGreaterThanOrEqual(-0.5);
  149 |   expect(metrics.strip.right).toBeLessThanOrEqual(viewport.width + 0.5);
  150 | 
  151 |   if (viewport.width <= 393) {
  152 |     const rows = new Map<number, number>();
  153 |     for (const y of metrics.tops) rows.set(y, (rows.get(y) ?? 0) + 1);
  154 |     expect([...rows.values()].sort((a, b) => b - a)).toEqual([4, 3]);
  155 |   }
  156 | }
  157 | 
  158 | test('home starts both modes, pauses the live campaign, restarts it, and returns home', async ({ page }) => {
  159 |   await ready(page);
  160 |   await expect(page.locator('#home')).toBeVisible();
  161 |   await expect(page.locator('#home-controls')).toBeVisible();
  162 |   await expect(page.locator('#home-rules')).toBeVisible();
  163 | 
  164 |   for (const mode of ['normal', 'easy'] as const) {
  165 |     await start(page, mode);
  166 |     if (mode === 'normal') await expect(page.locator('#fire')).toBeVisible();
  167 |     else await expect(page.locator('#fire')).toBeHidden();
  168 | 
  169 |     await page.locator('#pause').click();
  170 |     await expect.poll(async () => (await state(page))?.phase).toBe('paused');
  171 |     const frozen = await state(page);
  172 |     await page.waitForTimeout(250);
  173 |     expect((await state(page))?.tick).toBe(frozen?.tick);
```