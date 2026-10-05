import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';

// Run only after other browser validation has released Chromium. Uses real UI
// actions and read-only observation; it never injects campaign or aircraft state.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runFile = promisify(execFile);
const require = createRequire(import.meta.url);
const playwrightVersion = require('@playwright/test/package.json').version;
const VIEWPORT = { width: 1440, height: 900 };
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const FONT_SELECTORS = ['html', 'body', '#title', '#timer', '#pause-title', '#control-settings-title', '#control-editor-touch', '#control-editor-keyboard'];
const digest = data => createHash('sha256').update(data).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function options(argv) {
  const result = { capture: false, url: 'http://127.0.0.1:4176', baselineUrl: 'http://127.0.0.1:4177',
    out: path.join(ROOT, 'docs/evidence/candidate'), baseline: path.join(ROOT, 'docs/evidence/baseline'),
    baselineRepo: path.resolve(ROOT, '../kaisen'), executable: process.env.FANTASIA_CHROMIUM_EXECUTABLE || chromium.executablePath() };
  const names = { '--url': 'url', '--baseline-url': 'baselineUrl', '--out': 'out', '--baseline': 'baseline', '--baseline-repo': 'baselineRepo', '--executable': 'executable' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--capture') { result.capture = true; continue; }
    if (argv[i] === '--help') { result.help = true; continue; }
    const name = names[argv[i]]; if (!name || !argv[i + 1]) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    result[name] = argv[++i];
  }
  for (const name of ['out', 'baseline', 'baselineRepo', 'executable']) result[name] = path.resolve(ROOT, result[name]);
  for (const name of ['url', 'baselineUrl']) {
    const url = new URL(result[name]);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error(`${name} must be a local development server`);
  }
  return result;
}

async function exists(filename) { try { await access(filename); return true; } catch { return false; } }
async function json(filename, data) { await writeFile(filename, `${JSON.stringify(data, null, 2)}\n`); }
async function git(directory, args) { return (await runFile('git', ['-C', directory, ...args])).stdout.replace(/\r?\n$/, ''); }
async function sourceIdentity(directory) {
  const files = (await git(directory, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
    .split('\0').filter(name => name && (name.startsWith('src/') || /^(index\.html|package(?:-lock)?\.json|tsconfig\.json|vite\.config\.[cm]?[jt]s)$/.test(name))).sort();
  const fileHashes = {};
  for (const name of files) fileHashes[name] = digest(await readFile(path.join(directory, name)));
  return { commit: await git(directory, ['rev-parse', 'HEAD']), fileHashes,
    sourceTreeSha256: digest(JSON.stringify(fileHashes)),
    runtimeDirtyFiles: (await git(directory, ['status', '--porcelain'])).split('\n')
      .filter(line => line && (line.slice(3).startsWith('src/') || /^(index\.html|package(?:-lock)?\.json|tsconfig\.json|vite\.config\.[cm]?[jt]s)$/.test(line.slice(3)))) };
}
async function osDescription() {
  try { const release = await readFile('/etc/os-release', 'utf8'); const name = (release.match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] ?? os.platform()).replace(/\s*\([^)]*\)/g, ''); return `${name} ${os.arch() === 'x64' ? 'x86_64' : os.arch()}`; }
  catch { return `${os.platform()} ${os.release()} ${os.arch()}`; }
}

async function observation(page, hook) {
  return page.evaluate(name => {
    const read = window[name]; if (typeof read !== 'function') return null;
    const state = read(false), campaign = state.campaign;
    const actors = state.actors ?? [];
    const counts = {};
    for (const actor of actors) if (actor.hp > 0) { const key = `${actor.team}:${actor.class}`; counts[key] = (counts[key] ?? 0) + 1; }
    return { phase: state.phase, screen: state.screen, mode: state.mode, selectedMode: state.selectedMode,
      status: state.status, graphicsReady: state.graphicsReady, tick: state.tick, elapsed: state.elapsed,
      activeTicks: state.activeTicks, pauseReasons: state.pauseReasons, fatalLogicError: state.fatalLogicError,
      performanceInterrupted: state.performanceInterrupted, lastInterruption: state.lastInterruption,
      renderStatus: state.renderStatus, render: state.render, settingsOpen: state.settingsOpen,
      rulesOpen: state.rulesOpen, player: state.player, campaignPlayer: state.campaignPlayer,
      actorCounts: counts, sites: state.sites, armies: state.armies,
      campaign: campaign ? { runId: campaign.runId, rulesVersion: campaign.rulesVersion, mapVersion: campaign.mapVersion,
        seed: campaign.seed, startHeading: campaign.startHeading, livesRemaining: campaign.livesRemaining,
        result: campaign.resultSnapshot } : undefined,
      inputPresentation: document.getElementById('app')?.dataset.input,
      controlsInput: state.controlsInput,
      settings: { editor: document.getElementById('control-editor-touch')?.getAttribute('aria-pressed') === 'true' ? 'touch' : 'keyboard',
        mode: document.getElementById('control-mode')?.value, target: document.getElementById('control-target')?.value,
        keys: [...document.querySelectorAll('[data-key-action]')].map(element => ({ action: element.dataset.keyAction, key: element.textContent?.trim() })) },
      storage: Object.fromEntries(['fantasia-controls-v1', 'fantasia-controls-easy-v1', 'fantasia-keyboard-v1',
        'kaisen-controls-v1', 'kaisen-controls-easy-v1', 'kaisen-keyboard-v1'].map(key => {
        try { return [key, localStorage.getItem(key)]; } catch { return [key, 'unavailable']; }
      })) };
  }, hook);
}

async function fontEvidence(page) {
  await page.evaluate(() => document.fonts.ready);
  const computed = await page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
    const element = document.querySelector(selector); if (!element) return [selector, null];
    const style = getComputedStyle(element);
    return [selector, { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight,
      lineHeight: style.lineHeight, visible: element.getClientRects().length > 0 }];
  })), FONT_SELECTORS);
  let session;
  try {
    session = await page.context().newCDPSession(page); await session.send('DOM.enable'); await session.send('CSS.enable');
    const document = await session.send('DOM.getDocument', { depth: 0 }); const platform = {};
    for (const selector of FONT_SELECTORS) {
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: document.root.nodeId, selector });
      platform[selector] = nodeId ? (await session.send('CSS.getPlatformFontsForNode', { nodeId })).fonts : [];
    }
    return { computed, platform, method: 'CDP CSS.getPlatformFontsForNode; familyName and glyphCount describe fonts actually used' };
  } catch (error) { return { computed, platform: null, error: error.message }; }
  finally { await session?.detach(); }
}
async function displayEvidence(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('flight'), gl = canvas?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return { viewport: { width: innerWidth, height: innerHeight }, browserDpr: devicePixelRatio,
      textScale: 1, rootFontSize: getComputedStyle(document.documentElement).fontSize,
      visualViewportScale: visualViewport?.scale ?? null, userAgent: navigator.userAgent,
      renderer: gl ? { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null } : null };
  });
}

async function ready(page, url, hook) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#start').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(name => typeof window[name] === 'function' && !document.getElementById('start').disabled, hook, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
}
async function recoverRenderPause(page, hook, log) {
  const state = await observation(page, hook);
  if (state?.screen !== 'paused') return false;
  assert.deepEqual(state.pauseReasons, ['render'], 'Only a recoverable GPU render pause may be resumed by this capture script');
  assert.ok(!state.fatalLogicError, 'Logic failures cannot be recovered by a capture script');
  await page.waitForFunction(name => {
    const s = window[name](false), button = document.getElementById('resume');
    return s.renderStatus === 'ready' && !button.disabled;
  }, hook, { timeout: 30000 });
  log.push({ action: 'resume-recovered-render-pause', at: new Date().toISOString(), state: await observation(page, hook) });
  await page.locator('#resume').click(); return true;
}
async function startNormal(page, hook, log) {
  await page.locator('input[name="game-mode"][value="normal"]').check();
  log.push({ action: 'select-normal-radio', state: await observation(page, hook) });
  await page.locator('#start').click(); log.push({ action: 'start-normal', at: new Date().toISOString() });
  const deadline = Date.now() + 30000; let recoveries = 0;
  while (Date.now() < deadline) {
    const state = await observation(page, hook);
    if (state?.screen === 'paused') { assert.ok(recoveries++ < 3, 'Repeated GPU stalls prevented a valid Normal capture'); await recoverRenderPause(page, hook, log); }
    else if (state?.screen === 'playing' && state.mode === 'normal' && state.tick >= 15) return;
    else if (state?.screen === 'result' || state?.fatalLogicError) throw new Error('Campaign ended or failed before Normal could be captured');
    await wait(100);
  }
  throw new Error('Normal did not reach 15 legal simulation ticks');
}
async function capture(page, directory, name, hook, expectedScreen, log, editor) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let before = await observation(page, hook);
    if (expectedScreen === 'playing' && before?.screen === 'paused') { await recoverRenderPause(page, hook, log); before = await observation(page, hook); }
    assert.equal(before?.screen, expectedScreen);
    if (editor) assert.equal(before.settings.editor, editor);
    const file = `${name}-attempt-${attempt}.png`, filename = path.join(directory, file);
    await page.screenshot({ path: filename, fullPage: false, animations: 'allow' });
    const after = await observation(page, hook);
    const detail = { file, before, after, capturedAt: new Date().toISOString(), sha256: digest(await readFile(filename)) };
    log.push({ action: 'capture-attempt', name, attempt, ...detail });
    if (after?.screen === expectedScreen && (!editor || after.settings.editor === editor)) {
      const accepted = `${name}.png`;
      await writeFile(path.join(directory, accepted), await readFile(filename), { flag: 'wx' });
      return { ...detail, file: accepted, fonts: await fontEvidence(page), display: await displayEvidence(page) };
    }
    assert.equal(expectedScreen, 'playing', 'A frozen screen changed during capture');
    await recoverRenderPause(page, hook, log);
  }
  throw new Error(`Unable to capture ${name} without a render interruption`);
}

async function correctBaselineTouch(browser, config, metadata) {
  const archived = path.join(config.baseline, 'keyboard-from-touch-entry.png');
  const touch = path.join(config.baseline, 'touch-settings.png');
  const baselineMetaPath = path.join(config.baseline, 'metadata.json');
  const original = JSON.parse(await readFile(baselineMetaPath, 'utf8'));
  if (original.recaptures?.['touch-settings']) {
    metadata.baselineTouchCorrection = { existing: true, recapture: original.recaptures['touch-settings'] }; return;
  }
  assert.ok(!await exists(archived), 'An archived touch-entry screenshot already exists without a completed correction; use its metadata to continue explicitly');
  const archivedHash = digest(await readFile(touch)); await rename(touch, archived);
  original.screens = original.screens.filter(screen => screen !== 'touch-settings');
  original.missingScreens = [...new Set([...original.missingScreens, 'touch-settings'])];
  original.screenFileCorrections = [...(original.screenFileCorrections ?? []), {
    from: 'touch-settings.png', to: 'keyboard-from-touch-entry.png', sha256: archivedHash,
    reason: 'Visual inspection found keyboard editor selected, with title キーボードの設定; the original file was mislabeled.',
  }];
  await json(baselineMetaPath, original);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, isMobile: false, hasTouch: false,
    locale: 'ja-JP', timezoneId: 'UTC', reducedMotion: 'no-preference' });
  const page = await context.newPage(), actions = [];
  try {
    await ready(page, config.baselineUrl, '__kaisenReadState');
    try { await startNormal(page, '__kaisenReadState', actions); }
    catch (error) {
      const stopped = await observation(page, '__kaisenReadState');
      if (stopped?.screen !== 'paused') throw error;
      actions.push({ action: 'retain-actual-safe-stop', failure: error.message, state: stopped });
    }
    if ((await observation(page, '__kaisenReadState'))?.screen === 'playing') await page.locator('#pause').click();
    await page.locator('#pause-controls').click();
    await page.locator('#control-editor-touch').click(); actions.push({ action: 'select-real-touch-editor' });
    const image = await capture(page, config.baseline, 'touch-settings', '__kaisenReadState', 'paused', actions, 'touch');
    const source = await sourceIdentity(config.baselineRepo);
    original.screens = [...new Set([...original.screens, 'touch-settings'])];
    original.missingScreens = original.missingScreens.filter(screen => screen !== 'touch-settings');
    original.recaptures = { ...original.recaptures, 'touch-settings': { ...image, source, actions,
      browser: metadata.browser, os: metadata.os, viewport: VIEWPORT, browserDpr: 1, textScale: 1 } };
    original.notes.push('Mislabeled touch entry archived as keyboard-from-touch-entry.png; true touch editor recaptured via normal Start, manual Pause, settings, and touch tab.');
    await json(baselineMetaPath, original); metadata.baselineTouchCorrection = original.recaptures['touch-settings'];
  } finally { await context.close(); }
}

async function main() {
  const config = options(process.argv.slice(2));
  if (!config.capture || config.help) {
    console.log('Usage: node scripts/fantasia-visual-evidence.mjs --capture [--url http://127.0.0.1:4176] [--baseline-url http://127.0.0.1:4177] [--out docs/evidence/candidate]'); return;
  }
  await mkdir(config.out, { recursive: true });
  assert.ok(!await exists(path.join(config.out, 'metadata.json')), 'Existing candidate evidence is preserved; choose a new --out directory for another capture');
  const baseline = JSON.parse(await readFile(path.join(config.baseline, 'metadata.json'), 'utf8'));
  assert.equal(await git(config.baselineRepo, ['rev-parse', 'HEAD']), baseline.commit, 'K baseline must remain at the metadata commit');
  const source = await sourceIdentity(ROOT), messages = [], actions = [];
  const metadata = { repository: 'chameleonjp-lab/fantasia', generatedAt: new Date().toISOString(), source,
    commit: source.commit, sourceTreeSha256: source.sourceTreeSha256, os: await osDescription(),
    osDetails: { platform: os.platform(), kernelRelease: os.release(), architecture: os.arch() },
    viewport: VIEWPORT, browserDpr: 1, textScale: 1, launch: { executable: config.executable, args: LAUNCH_ARGS, headless: true },
    url: config.url, baselineUrl: config.baselineUrl, baseline: { repository: baseline.repository, commit: baseline.commit,
      browser: baseline.browser, os: baseline.os, viewport: baseline.viewport, browserDpr: baseline.browserDpr, textScale: baseline.textScale },
    screens: {}, actions, console: messages, complete: false, captureBudgetSeconds: 60,
    missingScreens: ['easy', 'victory', 'defeat'],
    notes: ['Actual Chromium screenshots from legal UI actions; read-only observation hook only.',
      'Partial five-state visual evidence; not F-05 or F-06 acceptance. No victory injection, four aircraft poses, 200% text, or physical phone claim.',
      'Initial local storage is empty because every run uses a fresh browser context.',
      'Normal capture waits for at least 15 simulation ticks; actual before/after state is recorded rather than forced to a baseline timestamp.',
      'A recoverable render pause may be resumed through the real Resume button; all other automatic pauses fail capture.'] };
  let browser, timedOut = false;
  const budget = setTimeout(() => { timedOut = true; void browser?.close(); }, 60000);
  try {
    browser = await chromium.launch({ executablePath: config.executable, headless: true, args: LAUNCH_ARGS });
    metadata.browser = `Chromium ${browser.version()} (Playwright ${playwrightVersion})`;
    assert.equal(metadata.browser, baseline.browser, 'Browser version must match K baseline');
    assert.deepEqual(VIEWPORT, baseline.viewport); assert.equal(baseline.browserDpr, 1); assert.equal(baseline.textScale, 1);
    assert.equal(metadata.os, baseline.os, 'Operating system must match K baseline');
    await correctBaselineTouch(browser, config, metadata);
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, isMobile: false, hasTouch: false,
      locale: 'ja-JP', timezoneId: 'UTC', reducedMotion: 'no-preference' });
    const page = await context.newPage();
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) messages.push({ type: message.type(), text: message.text() }); });
    page.on('pageerror', error => messages.push({ type: 'pageerror', text: error.message }));
    await ready(page, config.url, '__fantasiaReadState');
    metadata.screens.home = await capture(page, config.out, 'home', '__fantasiaReadState', 'home', actions);
    let normalFailed = false;
    try {
      await startNormal(page, '__fantasiaReadState', actions);
      metadata.screens.normal = await capture(page, config.out, 'normal', '__fantasiaReadState', 'playing', actions);
    } catch (error) {
      normalFailed = true;
      metadata.normalCaptureFailure = { name: error.name, message: error.message, state: await observation(page, '__fantasiaReadState') };
      if (metadata.normalCaptureFailure.state?.screen !== 'paused') throw error;
      metadata.blockedNormal = await capture(page, config.out, 'normal-blocked', '__fantasiaReadState', 'paused', actions);
      metadata.notes.push('Normal could not be captured while playing; normal-blocked.png shows the actual safe pause and is not a Normal acceptance image. Pause and settings below retain that real stop.');
    }
    if (!normalFailed) { await page.locator('#pause').click(); actions.push({ action: 'manual-pause', state: await observation(page, '__fantasiaReadState') }); }
    else actions.push({ action: 'retain-actual-safe-stop-without-resume', state: await observation(page, '__fantasiaReadState') });
    metadata.screens.pause = await capture(page, config.out, 'pause', '__fantasiaReadState', 'paused', actions);
    await page.locator('#pause-controls').click(); await page.locator('#control-editor-touch').click();
    actions.push({ action: 'select-real-touch-editor' });
    metadata.screens['touch-settings'] = await capture(page, config.out, 'touch-settings', '__fantasiaReadState', 'paused', actions, 'touch');
    await page.locator('#control-editor-keyboard').click(); actions.push({ action: 'select-real-keyboard-editor' });
    metadata.screens['keyboard-settings'] = await capture(page, config.out, 'keyboard-settings', '__fantasiaReadState', 'paused', actions, 'keyboard');
    await context.close();
    metadata.sourceAfter = await sourceIdentity(ROOT);
    metadata.sourceUnchangedDuringCapture = metadata.sourceAfter.sourceTreeSha256 === source.sourceTreeSha256;
    assert.ok(metadata.sourceUnchangedDuringCapture, 'Runtime sources changed during capture; images are preserved but cannot be treated as one candidate');
    assert.ok(!messages.some(message => message.type === 'pageerror'), 'A browser runtime error occurred during capture');
    metadata.complete = !normalFailed;
    if (normalFailed) process.exitCode = 1;
  } catch (error) { metadata.failure = { name: timedOut ? 'CaptureBudgetExceeded' : error.name,
    message: timedOut ? 'The 60 second total browser capture budget expired; completed images and observations are preserved.' : error.message }; process.exitCode = 1; }
  finally {
    clearTimeout(budget); await browser?.close(); metadata.finishedAt = new Date().toISOString();
    metadata.missingScreens = [...new Set([...metadata.missingScreens, ...['home', 'normal', 'pause', 'touch-settings', 'keyboard-settings'].filter(name => !metadata.screens[name])])];
    await json(path.join(config.out, 'metadata.json'), metadata);
  }
  console.log(JSON.stringify({ complete: metadata.complete, directory: config.out, screens: Object.keys(metadata.screens), failure: metadata.failure ?? metadata.normalCaptureFailure ?? null }));
}

await main();
