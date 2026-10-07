import type { Page } from '@playwright/test';
import { createOwnedFence, pollOwnedFence, releaseOwnedFence } from './native-fence';
import { RunBudget } from './run-budget';

export interface Observed {
  phase: string; screen: string; mode: string; tick: number; activeTicks: number;
  runId: string; graphicsReady: boolean; bombs: number; status: string; startupError: string | null;
  pauseReasons: string[]; performanceInterrupted: boolean; fatalLogicError: string | null; renderStatus: string;
  preparation: { phase: string; failure: string | null };
  queue: { status: string; failure: string | null; submittedCount: number; completedCount: number };
  render: { calls: number; triangles: number; hudLayout: { status?: string; measurements: number } };
}

export class RealRendererDriver {
  readonly budget = new RunBudget();
  readonly evidence: Array<Record<string, unknown>> = [];
  readonly pageErrors: string[] = [];
  createdFences = 0;
  releasedFences = 0;
  constructor(readonly page: Page) { page.on('pageerror', error => this.pageErrors.push(error.message)); }

  async call<T>(label: string, work: () => Promise<T>, cap = 5000): Promise<T> {
    const ms = Math.min(cap, this.budget.remaining(label));
    let timer: ReturnType<typeof setTimeout>;
    try { return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Driver operation timed out: ${label}`)), ms); })]); }
    finally { clearTimeout(timer!); }
  }
  async read(): Promise<Observed | null> {
    return this.call('read existing observation', () => this.page.evaluate(() => {
      const read = (window as any).__fantasiaReadState;
      if (typeof read !== 'function') return null;
      const value = read(false);
      return { phase: value.phase, screen: value.screen, mode: value.mode, tick: value.tick,
        activeTicks: value.activeTicks, runId: value.campaign.runId, graphicsReady: value.graphicsReady,
        bombs: value.campaignPlayer.bombs, status: value.status, pauseReasons: value.pauseReasons, performanceInterrupted: value.performanceInterrupted,
        startupError: document.querySelector<HTMLElement>('#startup-error')?.hidden === false
          ? document.querySelector('#startup-error')!.textContent : null,
        fatalLogicError: value.fatalLogicError, renderStatus: value.renderStatus,
        preparation: value.startPreparation, queue: value.render?.queue,
        render: { calls: value.render?.calls, triangles: value.render?.triangles, hudLayout: value.render?.hudLayout } };
    }));
  }
  async requireState(label: string): Promise<Observed> {
    const value = await this.read();
    if (!value) throw new Error(`${label}: observation unavailable`);
    if (value.startupError || value.fatalLogicError || value.queue?.failure || this.pageErrors.length) throw new Error(`${label}: application/native renderer error`);
    this.evidence.push({ label, ...value }); return value;
  }
  async boot(): Promise<void> {
    // Pause before loading the app. Native GPU work is never replaced by the clock.
    await this.call('install test clock', () => this.page.clock.install({ time: '2026-01-01T00:00:00Z' }));
    await this.call('pause test clock', () => this.page.clock.pauseAt('2026-01-01T00:00:01Z'));
    await this.call('load real app', () => this.page.goto('/', { waitUntil: 'load', timeout: 10000 }), 10000);
    for (let frame = 0; frame < 80; frame++) {
      const state = await this.read();
      if (state) this.evidence.push({ label: 'boot-observation', ...state });
      if (state?.startupError || state?.fatalLogicError || state?.queue?.failure || this.pageErrors.length) throw new Error('Real application/renderer failed during boot');
      if (state?.graphicsReady) {
        if (state.phase !== 'ready' || state.tick !== 0) throw new Error('Boot advanced gameplay before Start');
        await this.requireState('home-ready'); return;
      }
      await this.step();
    }
    throw new Error('Renderer preparation did not complete within the bounded proof');
  }
  async drainNativeGpu(): Promise<void> {
    const owned = await this.call('create test fence', () => this.page.evaluateHandle(createOwnedFence));
    this.createdFences++;
    let originalError: unknown, failed = false;
    try {
      const deadline = Math.min(Date.now() + 15000, this.budget.deadline);
      while (Date.now() < deadline) {
        const status = await this.call('poll test fence', () => owned.evaluate(pollOwnedFence));
        if (status === 'ready') return;
        // Runner timer, not page time. No busy/blocking GL wait or app queue reset.
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Real GPU did not complete within the wall-clock deadline');
    } catch (error) { failed = true; originalError = error; throw error; }
    finally {
      try {
        // Cleanup still gets a bounded attempt after the driver budget expires.
        let timer: ReturnType<typeof setTimeout>;
        try {
          await Promise.race([owned.evaluate(releaseOwnedFence), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Test fence cleanup timed out')), 1000); })]);
          this.releasedFences++;
        } finally { clearTimeout(timer!); }
      } catch (error) {
        this.evidence.push({ cleanupError: String(error), contextTeardownRequired: true });
        if (!failed) throw error;
      } finally {
        // Playwright closes the test context on failure, reclaiming native resources.
        void owned.dispose().catch(() => {});
        if (failed) this.evidence.push({ operationError: String(originalError) });
      }
    }
  }
  async step(): Promise<void> {
    this.budget.step(); await this.drainNativeGpu();
    await this.call('advance one controlled animation step', () => this.page.clock.runFor(16));
  }
  async reachPlaying(): Promise<Observed> {
    for (let frame = 0; frame < 40; frame++) {
      const state = await this.requireState('preparation-observation');
      if (state.phase === 'playing') {
        if (state.tick !== 0 || state.activeTicks !== 0) throw new Error('Selected start did not commit at tick zero');
        return state;
      }
      if (state.phase !== 'preparing' || state.preparation.failure) throw new Error('Unexpected state while waiting for selected preparation');
      await this.step();
    }
    throw new Error('Selected preparation exceeded the bounded proof');
  }
  async nextTick(): Promise<Observed> {
    const initial = await this.requireState('before-input-tick');
    if (initial.phase !== 'playing') throw new Error('Input check requires actual playing state');
    for (let frame = 0; frame < 4; frame++) {
      await this.step(); const state = await this.requireState('input-tick');
      if (state.phase !== 'playing') throw new Error('Unexpected stop in controlled-clock functional proof');
      if (state.tick > initial.tick) {
        if (state.tick !== initial.tick + 1) throw new Error('Driver did not isolate exactly one simulation tick');
        return state;
      }
    }
    throw new Error('Real simulation did not consume the bounded input tick');
  }
  async point(selector: string): Promise<{ x: number; y: number }> {
    return await this.call('verify visible hit target', () => this.page.locator(selector).evaluate(element => {
      const node = element as HTMLElement;
      node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      if (node.closest('[hidden], [inert]') || (node as HTMLButtonElement).disabled) throw new Error('Target is hidden/inert/disabled');
      let parent: HTMLElement | null = node;
      while (parent) { const s = getComputedStyle(parent); if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) throw new Error('Target is visually hidden'); parent = parent.parentElement; }
      const r = node.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (r.width <= 0 || r.height <= 0 || r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) throw new Error('Target outside viewport');
      const hit = document.elementFromPoint(x, y);
      if (!hit || !node.contains(hit)) throw new Error('Target is occluded');
      return { x, y };
    }));
  }
  async click(selector: string): Promise<void> {
    const point = await this.point(selector);
    await this.call('native mouse click', () => this.page.mouse.click(point.x, point.y));
  }
  async tap(selector: string): Promise<void> {
    const point = await this.point(selector);
    await this.call('native touch tap', () => this.page.touchscreen.tap(point.x, point.y));
  }
  async start(mode: 'normal' | 'easy'): Promise<Observed> {
    await this.click(`label:has(input[name="game-mode"][value="${mode}"])`);
    await this.click('#start'); return this.reachPlaying();
  }
  async ticks(count: number): Promise<Observed> {
    let state = await this.requireState('before-bounded-ticks');
    for (let n = 0; n < count; n++) state = await this.nextTick();
    return state;
  }
  async home(): Promise<void> {
    const state = await this.requireState('before-home');
    if (state.phase === 'playing') await this.click('#pause');
    await this.click('#pause-home');
    if ((await this.requireState('home')).phase !== 'ready') throw new Error('Home transition failed');
  }
  async full(): Promise<any> {
    return this.call('read full existing observation', () => this.page.evaluate(() => (window as any).__fantasiaReadState(false)));
  }
  async audit(): Promise<any> {
    return this.call('read existing input audit', () => this.page.evaluate(() => (window as any).__fantasiaReadState('audit')));
  }
  async waitState(label: string, predicate: (value: Observed) => boolean, maxFrames = 8): Promise<Observed> {
    for (let n = 0; n < maxFrames; n++) {
      const state = await this.requireState(label); if (predicate(state)) return state; await this.step();
    }
    throw new Error(`Bounded state condition not reached: ${label}`);
  }
  async key(key: string): Promise<void> { await this.call('native keyboard input', () => this.page.keyboard.press(key)); }
  async backend(): Promise<Record<string, unknown>> {
    return this.call('native renderer identity', () => this.page.evaluate(() => {
      const gl = document.querySelector<HTMLCanvasElement>('#flight')!.getContext('webgl2');
      if (!gl) throw new Error('No actual WebGL2 renderer');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { webgl2: true, version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER),
        unmaskedRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable', browserDpr: devicePixelRatio };
    }));
  }
}
