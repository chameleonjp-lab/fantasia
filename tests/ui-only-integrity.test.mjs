import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformWithEsbuild } from 'vite';
import { assertExactUiOnlyPath, verifyUiOnlySources, UI_ONLY_SOURCE_BASELINE } from '../scripts/ui-only-integrity.mjs';
import { uiOnlyTestPlugin } from '../scripts/vite.ui-only-plugin.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'fantasia-ui-only-integrity-'));
  const knownFiles = [], knownDirectories = new Set([root]);
  t.after(async () => {
    for (const path of knownFiles.reverse()) {
      try {
        const info = await lstat(path);
        if (!info.isFile() && !info.isSymbolicLink()) { console.warn(`[ui-only-fixture-cleanup] retained non-file fixture path ${path}`); continue; }
        await unlink(path);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const path of [...knownDirectories].sort((a, b) => b.length - a.length)) {
      try { await rmdir(path); }
      catch (error) {
        if (error.code === 'ENOENT') continue;
        if (error.code === 'ENOTEMPTY' || error.code === 'EEXIST') { console.warn(`[ui-only-fixture-cleanup] retained directory with unknown contents ${path}`); continue; }
        throw error;
      }
    }
  });
  for (const entry of UI_ONLY_SOURCE_BASELINE) {
    const target = resolve(root, entry.path);
    await mkdir(dirname(target), { recursive: true });
    for (let directory = dirname(target); directory.startsWith(root) && directory !== root; directory = dirname(directory)) knownDirectories.add(directory);
    await copyFile(resolve(repo, entry.path), target);
    knownFiles.push(target);
  }
  return root;
}

test('UI-only source paths, hashes, anchors, and regular-file checks fail closed', async t => {
  const root = await fixture(t);
  const valid = await verifyUiOnlySources(root);
  assert.equal(valid.paths.length, UI_ONLY_SOURCE_BASELINE.length);
  assert.doesNotThrow(() => assertExactUiOnlyPath(root, resolve(root, 'src/main.ts'), 'src/main.ts'));
  assert.throws(() => assertExactUiOnlyPath(root, resolve(root, 'src/other.ts'), 'src/main.ts'), /path mismatch/);
  assert.throws(() => assertExactUiOnlyPath(root, '../outside.ts', 'src/main.ts'), /escapes project root/);

  const main = resolve(root, 'src/main.ts');
  const original = await readFile(main, 'utf8');
  await writeFile(main, `${original}\n// drift\n`);
  await assert.rejects(verifyUiOnlySources(root), /source hash mismatch: src\/main\.ts/);

  const missingAnchorText = original.replace('function finish() {', 'function finishFixture() {');
  await writeFile(main, missingAnchorText);
  const mainEntry = UI_ONLY_SOURCE_BASELINE.find(entry => entry.path === 'src/main.ts');
  const expectedDriftHash = createHash('sha256').update(missingAnchorText).digest('hex');
  const anchorBaseline = UI_ONLY_SOURCE_BASELINE.map(entry => entry.path === 'src/main.ts' ? { ...entry, sha256: expectedDriftHash } : entry);
  await assert.rejects(verifyUiOnlySources(root, anchorBaseline), /source anchor mismatch: src\/main\.ts/);

  await unlink(main);
  await symlink(resolve(repo, 'src/main.ts'), main);
  await assert.rejects(verifyUiOnlySources(root), /not a regular file: src\/main\.ts/);
  assert.ok(mainEntry);
});

test('virtual-scene and live-HUD dependencies reject both source-hash and anchor drift', async t => {
  const root = await fixture(t);
  const dependencyPaths = ['src/aim-indicator.ts', 'src/flight-view.ts', 'src/gun-sight.ts', 'src/campaign-hud-details.ts'];
  for (const sourcePath of dependencyPaths) {
    const entry = UI_ONLY_SOURCE_BASELINE.find(candidate => candidate.path === sourcePath);
    assert.ok(entry, `${sourcePath} must be pinned`);
    assert.ok(entry.anchors.length > 0, `${sourcePath} must have source anchors`);
    const target = resolve(root, sourcePath);
    const original = await readFile(target, 'utf8');

    await writeFile(target, `${original}\n// hash drift fixture\n`);
    await assert.rejects(
      verifyUiOnlySources(root),
      error => error instanceof Error && error.message.includes(`source hash mismatch: ${sourcePath}`),
    );
    await writeFile(target, original);

    const anchor = entry.anchors[0][0];
    const altered = original.replace(anchor, '/* anchor drift fixture */');
    assert.notEqual(altered, original, `${sourcePath} anchor must exist in its fixture`);
    await writeFile(target, altered);
    const alteredHash = createHash('sha256').update(altered).digest('hex');
    const hashAdjustedBaseline = UI_ONLY_SOURCE_BASELINE.map(candidate => candidate.path === sourcePath
      ? { ...candidate, sha256: alteredHash }
      : candidate);
    await assert.rejects(
      verifyUiOnlySources(root, hashAdjustedBaseline),
      error => error instanceof Error && error.message.includes(`source anchor mismatch: ${sourcePath}`),
    );
    await writeFile(target, original);
  }
});

test('the Vite test transform suppresses frames, uses the UI adapter, and preserves the read-only product hook', async () => {
  const plugin = uiOnlyTestPlugin();
  assert.equal(plugin.apply, 'serve', 'test-only source transform is never installed in a production build');
  await plugin.configResolved({ root: repo });
  const mainPath = resolve(repo, 'src/main.ts');
  const original = await readFile(mainPath, 'utf8');
  const marker = '// Removed by production builds. Observation cannot rewrite a run or inject results.';
  const hookStart = original.indexOf(marker);
  const hookEnd = original.indexOf("\nwindow.addEventListener('pagehide'", hookStart);
  assert.ok(hookStart >= 0 && hookEnd > hookStart);
  const readOnlyHook = original.slice(hookStart, hookEnd);
  const transformed = plugin.transform(original, mainPath);
  assert.equal(typeof transformed, 'string');
  assert.match(transformed, /__fantasiaUiOnlyTest/);
  assert.doesNotMatch(transformed, /requestAnimationFrame\(frame\)/);
  assert.match(transformed, /graphicsReady = true;\s*frameId = 0; \/\* UI-only test server: no natural frames or simulation\. \*\/\s*el<HTMLButtonElement>\('start'\)\.disabled = false;/,
    'suppressing the frame must preserve the following start-enable statement');
  assert.ok(transformed.includes(readOnlyHook), 'the original read-only observation hook remains byte-identical');
  assert.equal(plugin.transformIndexHtml.order, 'pre');
  assert.equal(plugin.transformIndexHtml.handler(await readFile(resolve(repo, 'index.html'), 'utf8')), null);
  assert.equal(plugin.resolveId('./campaign-scene', mainPath), '\0fantasia-ui-only:campaign-scene');
  const stub = plugin.load('\0fantasia-ui-only:campaign-scene');
  const compiledStub = await transformWithEsbuild(stub, 'virtual-campaign-scene.js');
  assert.match(compiledStub.code, /ProductCampaignScene\.prototype\.drawOverlay\.call/);
  assert.match(stub, /CampaignScene as ProductCampaignScene/);
  assert.match(stub, /ProductCampaignScene\.prototype\.drawOverlay\.call\(this, state, player, mode\)/);
  assert.doesNotMatch(stub, /new ProductCampaignScene\s*\(/, 'the real WebGL scene constructor is never invoked');
  assert.match(stub, /ProductCampaignScene\.prototype\.drawBombGuide\.call\(this, state\)/);
  assert.match(stub, /ProductCampaignScene\.prototype\.drawThreats\.call\(this, state\)/);
  assert.match(stub, /ProductCampaignScene\.prototype\.drawRadar\.call\(this, state, player\)/);
  assert.match(stub, /createCampaignHudLayout\(canvas\)/);
  assert.equal((stub.match(/createCampaignHudLayout\(canvas\)/g) ?? []).length, 1, 'the host owns one shared HUD layout');
  const productScenePath = resolve(repo, 'src/campaign-scene.ts');
  const productSceneSource = await readFile(productScenePath, 'utf8');
  assert.equal(plugin.transform(productSceneSource, productScenePath), null, 'the original campaign scene is hash checked and served unchanged');
  assert.equal(plugin.transform(original, resolve(repo, 'src/other.ts')), null);
});


test('UI-only scene matches product initialization and explicit resize lifecycle without resizing on render', async () => {
  const plugin = uiOnlyTestPlugin(); await plugin.configResolved({ root: repo });
  const stub = plugin.load('\0fantasia-ui-only:campaign-scene');
  let bounds = { width: 393, height: 852 }, invalidations = 0, projections = 0, paints = 0;
  const canvas = { getBoundingClientRect: () => bounds };
  const overlay = { width: 0, height: 0, getContext: () => ({}) };
  const layout = { invalidate() { invalidations++; } };
  class Camera { position = {}; quaternion = {}; constructor(_fov, aspect) { this.aspect = aspect; }
    updateProjectionMatrix() { projections++; } updateMatrixWorld() {} }
  const context = { PerspectiveCamera: Camera, Vector3: class {}, FLIGHT_FOV: 60,
    getFlightCameraPose() {}, createCampaignHudLayout(value) { assert.equal(value, canvas); return layout; },
    ProductCampaignScene: class { drawOverlay() { paints++; } } };
  // Evaluate the actual virtual scene, replacing only its imported dependencies.
  runInNewContext(stub.replace(/^import .*;\n/gm, '').replace('export class CampaignScene', 'globalThis.CampaignScene = class CampaignScene'), context);
  const scene = new context.CampaignScene(canvas, overlay);
  assert.equal(invalidations, 1); assert.equal(projections, 1);
  assert.equal(scene.width, 393); assert.equal(scene.height, 852);
  assert.equal(scene.camera.aspect, 393 / 852); assert.equal(overlay.width, 393); assert.equal(overlay.height, 852);
  for (let i = 0; i < 3; i++) assert.equal(scene.render({}, {}, 'normal'), true);
  assert.equal(paints, 3); assert.equal(invalidations, 1, 'drawing alone must not force HUD remeasurement');
  assert.equal(projections, 1, 'drawing alone must not repeat size-dependent camera setup');

  const main = await readFile(resolve(repo, 'src/main.ts'), 'utf8');
  const transformed = plugin.transform(main, resolve(repo, 'src/main.ts'));
  const start = transformed.indexOf('function resize() {'), end = transformed.indexOf("window.addEventListener('pageshow'", start);
  assert.ok(start >= 0 && end > start);
  const handlers = {}, pauses = [];
  runInNewContext(transformed.slice(start, end), { scene, pause: reason => pauses.push(reason),
    window: { addEventListener: (name, handler) => { handlers[name] = handler; },
      visualViewport: { addEventListener: (name, handler) => { handlers[`visual-${name}`] = handler; } } } });
  for (const [event, width, height] of [['resize', 568, 320], ['visual-resize', 320, 568]]) {
    bounds = { width, height }; handlers[event]();
    assert.equal(scene.width, width); assert.equal(scene.height, height);
    assert.equal(scene.camera.aspect, width / height); assert.equal(overlay.width, width); assert.equal(overlay.height, height);
  }
  assert.deepEqual(pauses, ['resize', 'resize']); assert.equal(invalidations, 3); assert.equal(projections, 3);
  bounds = { width: 0, height: 0 }; scene.resize();
  assert.equal(invalidations, 3); assert.equal(scene.width, 320); assert.equal(scene.height, 568);
});
