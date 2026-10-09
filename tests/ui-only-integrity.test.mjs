import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
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
