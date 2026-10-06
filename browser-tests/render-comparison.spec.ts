import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, freemem, loadavg, release } from 'node:os';

// Diagnosis only. No product state writes, watchdog changes, auto-resume, or
// acceptance skips. A completed experiment can contain paused/failed flights.
// The diagnostic owns per-cell trace retention. Collection categories match
// Verify; manual traces do not reproduce every runner expect/test-step event.
test.use({ trace: 'off' });

const REFS = {
  main: { sha: '36b0e3b8130acb7149a646845b46f72294a3798a', origin: 'http://127.0.0.1:4176' },
  pr5: { sha: 'e7d69dfc075b6908c162009828253fd9a312be37', origin: 'http://127.0.0.1:4177' },
} as const;
const SCENARIOS = [
  { name: 'easy-393x852', mode: 'easy', width: 393, height: 852, isMobile: true, hasTouch: true },
  { name: 'normal-1280x800', mode: 'normal', width: 1280, height: 800, isMobile: false, hasTouch: false },
] as const;
const PROFILES = ['light', 'full-object', 'dom-screenshot'] as const;
const WARMUP_MS = 500, WINDOW_MS = 3000, SAMPLE_MS = 500;
const OUTPUT = 'render-comparison-results';
type Profile = typeof PROFILES[number];

function experimentSchedule() {
  return SCENARIOS.flatMap(scenario => [
    ...PROFILES.flatMap(profile => (['main', 'pr5'] as const).map(ref => ({ scenario, profile, ref }))),
    ...[...PROFILES].reverse().flatMap(profile => (['pr5', 'main'] as const).map(ref => ({ scenario, profile, ref }))),
  ]);
}

function traceFactorSchedule() {
  return [true, false, false, true].map((traceEnabled, ordinal) => ({
    scenario: SCENARIOS[1], profile: 'light' as const, ref: 'main' as const,
    ordinal, traceEnabled, phase: 'trace-factor' as const,
  }));
}

function samplerFactorSchedule() {
  return [true, false, false, true].map((periodicSample, ordinal) => ({
    scenario: SCENARIOS[1], profile: 'light' as const, ref: 'main' as const,
    ordinal, periodicSample, phase: 'sampler-factor' as const, traceEnabled: false,
  }));
}

function allowedOrigin(url: string, origin: string) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

function installProbe(intervalMs: number) {
  const w = window as any;
  const samples: any[] = [], frames: any[] = [], longTasks: any[] = [];
  let previousFrame: number | null = null, raf = 0, stopped = false, stage = 'navigation';
  const project = (s: any) => s ? ({
    phase: s.phase, screen: s.screen, mode: s.mode, tick: s.tick, activeTicks: s.activeTicks,
    graphicsReady: s.graphicsReady, pauseReasons: s.pauseReasons, fatalLogicError: s.fatalLogicError,
    lastFrameGap: s.lastFrameGap, renderStatus: s.renderStatus,
    performanceInterrupted: s.performanceInterrupted, lastInterruption: s.lastInterruption,
    render: s.render,
  }) : null;
  const take = (label: string) => {
    const begin = performance.now();
    const state = typeof w.__fantasiaReadState === 'function' ? w.__fantasiaReadState(false) : null;
    const afterRead = performance.now();
    const sample = { atMs: begin, epochMs: performance.timeOrigin + begin, label, stage,
      readMs: afterRead - begin, state: project(state) };
    if (samples.length < 240) samples.push(sample);
    return sample;
  };
  const frame = () => {
    const now = performance.now();
    if (frames.length < 8000) frames.push({ atMs: now, stage, gapMs: previousFrame === null ? null : now - previousFrame });
    previousFrame = now;
    if (!stopped) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const timer = intervalMs > 0 ? setInterval(() => take('periodic'), intervalMs) : undefined;
  let observer: PerformanceObserver | undefined;
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (longTasks.length < 1000)
        longTasks.push({ atMs: entry.startTime, durationMs: entry.duration });
    });
    observer.observe({ type: 'longtask', buffered: true });
  }
  w.__renderComparisonProbe = {
    take, project,
    stage(value: string) { stage = value; },
    finish() {
      take('final'); stopped = true; if (timer !== undefined) clearInterval(timer); cancelAnimationFrame(raf); observer?.disconnect();
      return { timeOrigin: performance.timeOrigin, samples, frames, longTasks,
        limitsReached: { samples: samples.length >= 240, frames: frames.length >= 8000, longTasks: longTasks.length >= 1000 } };
    },
  };
}

async function compact(page: Page, label: string) {
  const start = performance.now();
  const encoded = await page.evaluate(label => JSON.stringify((window as any).__renderComparisonProbe.take(label)), label);
  return { runnerStartMs: start, wallMs: performance.now() - start, result: JSON.parse(encoded) };
}

async function fullObject(page: Page) {
  const start = performance.now();
  // Matches the original spec's object return path. readMs includes the hook's
  // own full-state JSON clone; wallMs additionally includes queue/transport and
  // Playwright object serialization. Their difference is NOT pure CPU time.
  const result = await page.evaluate(() => {
    const begin = performance.now();
    const state = (window as any).__fantasiaReadState(false);
    return { atMs: begin, readMs: performance.now() - begin, state };
  });
  const wallMs = performance.now() - start;
  const encodeStart = performance.now();
  const payloadBytes = Buffer.byteLength(JSON.stringify(result));
  return { runnerStartMs: start, wallMs, atMs: result.atMs, readMs: result.readMs, payloadBytes,
    runnerEncodeMs: performance.now() - encodeStart,
    phase: result.state.phase, tick: result.state.tick, pauseReasons: result.state.pauseReasons,
    renderStatus: result.state.renderStatus, queue: result.state.render?.queue };
}

function safetyProblems(s: any) {
  if (!s) return ['missing observation'];
  const problems: string[] = [];
  if (s.phase !== 'playing') problems.push(`phase:${s.phase}`);
  if (!Array.isArray(s.pauseReasons) || s.pauseReasons.length) problems.push('pause reasons');
  if (s.fatalLogicError !== null) problems.push('logic safety');
  if (!['ready', 'pending'].includes(s.renderStatus)) problems.push(`render:${s.renderStatus}`);
  if (!['ready', 'pending'].includes(s.render?.queue?.status)) problems.push(`queue:${s.render?.queue?.status}`);
  return problems;
}

async function runCell(browser: Browser, scenario: typeof SCENARIOS[number], profile: Profile,
  ref: keyof typeof REFS, ordinal: number,
  options: { phase: 'trace-factor' | 'sampler-factor'; traceEnabled: boolean; periodicSample?: boolean } | undefined = undefined) {
  const phase = options?.phase ?? 'source-load-comparison';
  const traceEnabled = options?.traceEnabled ?? true;
  const periodicSample = options?.periodicSample ?? true;
  const id = options ? `${scenario.name}-${phase}-${profile}-${ordinal}-${ref}-trace-${traceEnabled ? 'on' : 'off'}${phase === 'sampler-factor' ? `-sample-${periodicSample ? 'on' : 'off'}` : ''}`
    : `${scenario.name}-${profile}-${ordinal}-${ref}`;
  const origin = REFS[ref].origin, websocketOrigin = origin.replace('http:', 'ws:');
  const blocked: string[] = [], errors: string[] = [], actions: any[] = [];
  const report: any = { id, phase, ref: REFS[ref], order: ordinal, scenario, profile,
    gameAcceptance: 'NOT EVALUATED: diagnostic collection is not a game acceptance pass',
    hostBefore: { epochMs: Date.now(), loadavg: loadavg(), freeMemory: freemem() },
    requestedWarmupMs: WARMUP_MS, requestedWindowMs: WINDOW_MS, commonSampleMs: periodicSample ? SAMPLE_MS : null,
    textScale: '100%; this is not the existing 200% reachability test', actions, blocked, errors };
  const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height },
    isMobile: scenario.isMobile, hasTouch: scenario.hasTouch, deviceScaleFactor: 1, serviceWorkers: 'block' });
  // Route before navigation. Never permit ranking, production, or third-party
  // requests. WebSockets need their own route; normal request routing omits them.
  await context.route('**/*', async route => {
    if (allowedOrigin(route.request().url(), origin)) await route.continue();
    else { blocked.push(route.request().url()); await route.abort('blockedbyclient'); }
  });
  await context.routeWebSocket('**/*', route => {
    if (allowedOrigin(route.url(), websocketOrigin)) route.connectToServer();
    else { blocked.push(route.url()); route.close(); }
  });
  // Match the original config's trace collection work; retain all traces as
  // diagnosis evidence rather than deleting successful-cell traces.
  if (traceEnabled) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  report.trace = { enabled: traceEnabled, screenshots: traceEnabled, snapshots: traceEnabled, sources: traceEnabled,
    retained: traceEnabled ? 'every enabled diagnostic cell' : 'intentionally not collected; no trace start or stop call' };
  await context.addInitScript(installProbe, periodicSample ? SAMPLE_MS : 0);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(String(error)));
  try {
    const navigate = performance.now();
    await page.goto(origin, { waitUntil: 'load', timeout: 25000 });
    report.navigationMs = performance.now() - navigate;
    const prepare = performance.now();
    await expect(page.locator('#start')).toBeEnabled({ timeout: 25000 });
    report.preparationMs = performance.now() - prepare;
    report.environment = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#flight');
      const gl = canvas?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { timeOrigin: performance.timeOrigin, userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio, visibility: document.visibilityState,
        renderer: gl && debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        vendor: gl && debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        savedSettings: Object.fromEntries(['fantasia-controls-v1', 'fantasia-controls-easy-v1', 'fantasia-keyboard-v1']
          .map(key => [key, localStorage.getItem(key)])) };
    });
    await page.evaluate(() => (window as any).__renderComparisonProbe.stage('home-warmup'));
    const warmup = performance.now(); await page.waitForTimeout(WARMUP_MS);
    report.actualWarmupMs = performance.now() - warmup;
    const mode = page.locator(`input[name="game-mode"][value="${scenario.mode}"]`);
    if (!(await mode.isChecked())) await mode.check();
    await page.evaluate(() => (window as any).__renderComparisonProbe.stage('start'));
    const start = performance.now(); await page.locator('#start').click();
    actions.push({ name: 'start-click', startMs: start, endMs: performance.now() });
    report.seed = await page.evaluate(() => {
      const audit = (window as any).__fantasiaReadState('audit');
      return { seed: audit.seed, mode: audit.mode, rulesVersion: audit.rulesVersion,
        mapVersion: audit.mapVersion, startHeading: audit.startHeading };
    });
    report.before = await compact(page, 'before-profile');
    await page.evaluate(profile => (window as any).__renderComparisonProbe.stage(profile), profile);
    const begin = performance.now();
    if (profile === 'full-object') {
      // Bounded original-style polling, never concurrent and never catch-up.
      for (let n = 0; n < 12 && performance.now() - begin < WINDOW_MS; n++) {
        actions.push({ name: 'full-object-read', ...await fullObject(page) });
        await page.waitForTimeout(100);
      }
    } else if (profile === 'dom-screenshot') {
      report.beforeDom = await compact(page, 'before-dom');
      const domStart = performance.now();
      const geometry = await page.evaluate(() => {
        const start = performance.now();
        (window as any).__renderComparisonProbe.stage('dom-measure');
        const box = (e: Element) => { const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const sites = Array.from(document.querySelectorAll('#campaign-sites .campaign-site[data-site]')).map(e => ({
          id: (e as HTMLElement).dataset.site, box: box(e),
          owner: e.querySelector('.campaign-site-owner')?.textContent,
          force: e.querySelector('.campaign-site-force')?.textContent,
          wave: e.querySelector('.campaign-site-wave')?.textContent,
        }));
        const geometry = { sites, header: box(document.querySelector('#hud .hud-top')!),
          strip: box(document.querySelector('#campaign-sites')!), width: innerWidth,
          documentWidth: document.documentElement.scrollWidth };
        return { startMs: start, endMs: performance.now(), ...geometry };
      });
      actions.push({ name: 'dom-measure', runnerStartMs: domStart, wallMs: performance.now() - domStart, geometry });
      report.afterDom = await compact(page, 'after-dom');
      await page.evaluate(() => (window as any).__renderComparisonProbe.stage('screenshot'));
      report.beforeScreenshot = await compact(page, 'before-screenshot');
      const shotStart = performance.now();
      try { await page.screenshot({ path: `${OUTPUT}/${id}.png`, timeout: 10000 }); }
      catch (error) { report.experimentError = `screenshot: ${String(error)}`; }
      finally { actions.push({ name: 'screenshot', runnerStartMs: shotStart, endMs: performance.now() }); }
      report.afterScreenshot = await compact(page, 'after-screenshot');
      await page.evaluate(() => (window as any).__renderComparisonProbe.stage('post-screenshot-full-read'));
      actions.push({ name: 'original-post-screenshot-full-read', ...await fullObject(page) });
    }
    await page.evaluate(profile => (window as any).__renderComparisonProbe.stage(`${profile}-tail`), profile);
    const remaining = WINDOW_MS - (performance.now() - begin);
    if (remaining > 0) await page.waitForTimeout(remaining);
    report.actualWindowMs = performance.now() - begin;
    report.after = await compact(page, 'after-profile');
  } catch (error) { report.experimentError = String(error); }
  finally {
    try {
      report.timeline = JSON.parse(await page.evaluate(() => JSON.stringify((window as any).__renderComparisonProbe.finish())));
      const flightSamples = report.timeline.samples.filter((s: any) => s.stage !== 'navigation' && s.stage !== 'home-warmup' && s.stage !== 'start');
      const final = report.timeline.samples.at(-1)?.state;
      report.finalSafetyProblems = safetyProblems(final);
      report.flightSafety = { startedLive: safetyProblems(report.before?.result?.state).length === 0,
        allObservedLive: flightSamples.length > 0 && flightSamples.every((s: any) => safetyProblems(s.state).length === 0),
        observedSampleCount: flightSamples.length, playingSampleCount: flightSamples.filter((s: any) => s.state?.phase === 'playing').length,
        pausedSampleCount: flightSamples.filter((s: any) => s.state?.phase === 'paused').length, finalLive: safetyProblems(final).length === 0,
        firstUnsafe: flightSamples.find((s: any) => safetyProblems(s.state).length > 0) ?? null };
    } catch (error) { report.finalObservationError = String(error); }
    report.hostAfter = { epochMs: Date.now(), loadavg: loadavg(), freeMemory: freemem() };
    if (traceEnabled) {
      try { await context.tracing.stop({ path: `${OUTPUT}/${id}-trace.zip` }); }
      catch (error) { report.traceError = String(error); }
    }
    await writeFile(`${OUTPUT}/${id}.json`, JSON.stringify(report, null, 2));
    await context.close();
  }
  return { id, phase, periodicSample, periodicSampleCount: report.timeline?.samples.filter((sample: any) => sample.label === 'periodic').length ?? null, traceEnabled, traceExpected: traceEnabled, ref, profile, scenario: scenario.name, experimentError: report.experimentError ?? null,
    finalObservationError: report.finalObservationError ?? null, traceError: report.traceError ?? null, blockedRequests: blocked.length,
    safety: report.flightSafety ?? null, seed: report.seed ?? null };
}

test('PR5 matched rendering diagnosis only, not game acceptance', async ({ browser }, testInfo) => {
  test.setTimeout(15 * 60 * 1000);
  await mkdir(OUTPUT, { recursive: true });
  const environment = { browserVersion: browser.version(), node: process.version, platform: process.platform,
    runnerTimeOrigin: performance.timeOrigin, osRelease: release(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))], cpuCount: cpus().length,
    project: testInfo.project.name, launchOptions: testInfo.project.use.launchOptions,
    workerIndex: testInfo.workerIndex, startedAt: new Date().toISOString() };
  const cells: any[] = [];
  for (const [i, { scenario, profile, ref }] of experimentSchedule().entries()) {
    cells.push(await runCell(browser, scenario, profile, ref, i));
    // Incremental durable results survive a later harness timeout.
    await writeFile(`${OUTPUT}/summary.json`, JSON.stringify({ environment, cells,
      gameAcceptance: 'NOT EVALUATED', expectedCells: 24,
      interpretation: [
        'Product, original tests, lock and Verify workflow must be identical before execution.',
        'Each profile uses a fresh flight and AB/BA order; no manual or automatic resume.',
        'A stopped start cannot identify a later observation effect; compare only equally live profile starts.',
        'All profiles use the same manual screenshot/snapshot/source trace collection categories as Verify.',
        'Trace ownership/retention and runner expect/test-step events differ from original Verify.',
        'The common 500ms sampler itself clones full state; light is not a zero-observation control.',
        'Fence times are CPU-observed completion latency, not GPU timer queries.',
        'Full-object wall minus read time includes browser queue, transport and serialization, not only CPU work.',
        'A profile/order effect is a hypothesis from two observations per ref, not causal or device-wide proof.',
        'Paused flights are diagnostic findings. A green diagnostic job is not game acceptance or a release gate.',
      ] }, null, 2));
  }
  // Only completeness/security gates. Runtime safety is reported without
  // changing the original acceptance spec or treating an interruption as pass.
  expect(cells).toHaveLength(24);
  expect(cells.filter(cell => cell.experimentError || cell.finalObservationError || cell.traceError || cell.blockedRequests)).toEqual([]);
});


// Second phase: a single changed factor on one fixed executable revision.
// Keep the original 24-cell definition above reproducible; CI explicitly greps
// this separate test so it cannot accidentally execute both experiments.
test('PR5 trace factor diagnosis only, four flights, not game acceptance', async ({ browser }, testInfo) => {
  test.setTimeout(5 * 60 * 1000);
  await mkdir(OUTPUT, { recursive: true });
  const environment = { browserVersion: browser.version(), node: process.version, platform: process.platform,
    runnerTimeOrigin: performance.timeOrigin, osRelease: release(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))], cpuCount: cpus().length,
    project: testInfo.project.name, launchOptions: testInfo.project.use.launchOptions,
    workerIndex: testInfo.workerIndex, startedAt: new Date().toISOString() };
  const cells: any[] = [];
  for (const cell of traceFactorSchedule()) {
    cells.push(await runCell(browser, cell.scenario, cell.profile, cell.ref, cell.ordinal,
      { phase: cell.phase, traceEnabled: cell.traceEnabled }));
    await writeFile(`${OUTPUT}/summary-trace-factor.json`, JSON.stringify({
      phase: 'trace-factor', environment, cells, expectedCells: 4, gameAcceptance: 'NOT EVALUATED',
      fixedSource: REFS.main, onlyChangedFactor: 'manual trace enabled', order: ['on', 'off', 'off', 'on'],
      fixedInputs: { viewport: SCENARIOS[1], textScale: '100%', profile: 'light',
        commonSampleMs: SAMPLE_MS, requestedWarmupMs: WARMUP_MS, requestedWindowMs: WINDOW_MS },
      interpretation: [
        'Only main at the already verified shared runtime is tested; PR6 is not included.',
        'Each cell has a fresh context/flight, the same seed and no resume or retry.',
        'Trace-off means no trace start/stop calls and no trace artifact is expected for those cells.',
        'Trace-on uses the same manual screenshots/snapshots/sources categories as the prior phase.',
        'The common full-clone sampler and other diagnostic reads are unchanged; this does not isolate their overhead.',
        'Both off cells surviving while both on cells stop supports a trace contribution in this scene/runner only.',
        'Both groups stopping leaves shared observer, renderer and environment unresolved; mixed results are inconclusive.',
        'All metrics include the final observation. Collection success is not game acceptance or release approval.',
      ],
    }, null, 2));
  }
  expect(cells).toHaveLength(4);
  expect(cells.map(cell => cell.traceEnabled)).toEqual([true, false, false, true]);
  expect(cells.filter(cell => cell.experimentError || cell.finalObservationError || cell.traceError || cell.blockedRequests)).toEqual([]);
});


// Third phase: remove only recurring full-state clones. Initial, final and
// boundary reads remain identical, as do passive rAF and long-task observation.
test('PR5 sampler factor diagnosis only, four flights, not game acceptance', async ({ browser }, testInfo) => {
  test.setTimeout(5 * 60 * 1000);
  await mkdir(OUTPUT, { recursive: true });
  const environment = { browserVersion: browser.version(), node: process.version, platform: process.platform,
    runnerTimeOrigin: performance.timeOrigin, osRelease: release(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))], cpuCount: cpus().length,
    project: testInfo.project.name, launchOptions: testInfo.project.use.launchOptions,
    workerIndex: testInfo.workerIndex, startedAt: new Date().toISOString() };
  const cells: any[] = [];
  for (const cell of samplerFactorSchedule()) {
    cells.push(await runCell(browser, cell.scenario, cell.profile, cell.ref, cell.ordinal,
      { phase: cell.phase, traceEnabled: false, periodicSample: cell.periodicSample }));
    await writeFile(`${OUTPUT}/summary-sampler-factor.json`, JSON.stringify({
      phase: 'sampler-factor', environment, cells, expectedCells: 4, gameAcceptance: 'NOT EVALUATED',
      fixedSource: REFS.main, onlyChangedFactor: 'recurring full-state sampler enabled', order: ['on', 'off', 'off', 'on'],
      fixedInputs: { viewport: SCENARIOS[1], textScale: '100%', profile: 'light', traceEnabled: false,
        requestedWarmupMs: WARMUP_MS, requestedWindowMs: WINDOW_MS },
      interpretation: [
        'Trace is disabled in every cell; periodic sampling alone changes, including preparation.',
        'Each cell uses the same source, seed and fresh context without resume or retry.',
        'Sampler-off still has identical initial, boundary and final state reads and passive rAF/longtask observation.',
        'Sampler-off has fewer state samples; its allObservedLive does not prove continuous safety.',
        'Final phase, retained interruption, pause reasons and frame/fence timing are primary outcomes.',
        'If both sampler-off cells stop, recurring full-state clones are not necessary for those stops.',
        'Both off cells surviving with both on cells stopping supports sampler contribution in this runner/scene only; mixed results are inconclusive.',
        'Collection success is not game acceptance or release approval.',
      ],
    }, null, 2));
  }
  expect(cells).toHaveLength(4);
  expect(cells.map(cell => cell.periodicSample)).toEqual([true, false, false, true]);
  expect(cells.every(cell => cell.traceEnabled === false)).toBe(true);
  expect(cells.every(cell => cell.periodicSample ? cell.periodicSampleCount > 0 : cell.periodicSampleCount === 0)).toBe(true);
  expect(cells.every(cell => JSON.stringify(cell.seed) === JSON.stringify(cells[0].seed))).toBe(true);
  expect(cells[0].seed?.seed).toBe(20261005);
  expect(cells.filter(cell => cell.experimentError || cell.finalObservationError || cell.traceError || cell.blockedRequests)).toEqual([]);
});
