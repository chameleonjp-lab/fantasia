import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const UI_ONLY_SOURCE_BASELINE = Object.freeze([
  { path: 'index.html', sha256: '2bb4109ecc8bc9c74ab965ca6fab00077539fe7cb50a082f4406772bd2f152d5', anchors: [['<main id="app"', 1], ['id="campaign-sites"', 1], ['id="pause-screen"', 1], ['id="result"', 1], ['src="/src/main.ts"', 1]] },
  { path: 'src/main.ts', sha256: '8323a5fb69c4392d9f9cf01a08e4d796d79729c31388021c04e65fb5abd73e2b', anchors: [['function updateHUD() {', 1], ['function finish() {', 1], ['function preparationFailed(error: unknown) {', 1], ['frameId = requestAnimationFrame(frame);', 2], ['// Removed by production builds. Observation cannot rewrite a run or inject results.', 1]] },
  { path: 'src/style.css', sha256: 'b192ebb8634486e4ec696e30a2cf6d0c9ac3b4aedc993b1f6d51fecaf650b0ea', anchors: [['#app {', 1], ['#result {', 1], ['.fantasia-shell .campaign-sites {', 5], ['#app.fantasia-shell #hud button[data-flight-control] {', 1]] },
  { path: 'src/control-settings.css', sha256: 'c04d27c450da70f85a3c843bb5e7fd0905d455f1e9cf16b66609adf605fe8f4e', anchors: [['.settings-input-picker button {', 1], ['#control-settings .settings-footer button {', 1], ['#control-settings .settings-main {', 1]] },
  { path: 'src/control-settings.ts', sha256: '8ae26ea17dca2782ec13853c040414d329e8799af6162c69b3e54b748a06ac80', anchors: [['export class ControlSettings {', 1], ['private save(): void {', 1], ['this.dialog.querySelector<HTMLButtonElement>(\'#control-save\')!.textContent = \'今回だけ使う\';', 1]] },
  { path: 'src/settings-storage.ts', sha256: '72146f811b2bf34036f2ba03f146a1fbd2b4ee0f31793cc6cac233aa17813ee5', anchors: [['export function persistSettingsBatch(', 1], ['export function readSettingsValue(', 1]] },
  { path: 'src/keyboard-settings.ts', sha256: '00fab37cbb9acf40c8a37e9e6511e6fed8395d374cad452ca494f8c11c8f6531', anchors: [['export const KEYBOARD_STORAGE_KEY', 1], ['export class KeyboardSettings', 1]] },
  { path: 'src/campaign-hud.ts', sha256: '0aa5c36e68b081db408b143f666577b7ac141652f1680c6b444ea9b61fc3c5f4', anchors: [['export function campaignSiteReadouts(', 1], ['export function updateCampaignHud(', 1]] },
  { path: 'src/campaign-hud-layout.ts', sha256: 'cb15384b6592fe4e0a16dcf7ef09e5d9bf44b0e813667bab0d92080b1e4dfff6', anchors: [['export class CampaignHudLayout', 1], ['export function createCampaignHudLayout(', 1], ['export function layoutCampaignHud(', 1]] },
  { path: 'src/campaign-scene.ts', sha256: '09fe69a4b6eb87cceeeaac096274d4605726073e0a4098c1844fffb224eb3bf4', anchors: [['export class CampaignScene {', 1], ['private projection(position: Vec) {', 1], ["private drawOverlay(state: CampaignState, player: Aircraft, mode: 'normal' | 'easy') {", 1], ['private drawThreats(state: CampaignState) {', 1], ['private drawRadar(state: CampaignState, player: Aircraft) {', 1], ['this.drawOverlay(state, player, mode);', 1]] },
  { path: 'src/aim-indicator.ts', sha256: '2f2e129e0ffbe41462577f1dc10a137b037f5cb1b280ab1ee50c182b8c155140', anchors: [['export function aimRadius(', 1], ["return mode === 'normal' ? Math.max(26, Math.min(38, Math.min(width, height) * .085)) : Math.min(width, height) * .135;", 1]] },
  { path: 'src/flight-view.ts', sha256: '1f9b7e040c2270de5838f24bad93c7ac1c75c7827ba3c1b58591ef6271a20363', anchors: [['export const FLIGHT_FOV = 64;', 1], ['export function getFlightCameraPose(', 1], ['const TAN_HALF_FOV = Math.tan(FLIGHT_FOV * Math.PI / 360);', 1]] },
  { path: 'src/gun-sight.ts', sha256: '436c9e7c6a6864513489de6d8172d85d97bd1bf685b60678890f848a9acd2b71', anchors: [['export function projectGunSight(', 1], ['const depth = 500;', 1], ["projectFlightTarget(player, aim, width / height, 'normal')", 1]] },
  { path: 'src/campaign-hud-details.ts', sha256: '654ea7fe6435cf7fad523dd90f44868722d9e40072ed60bcdec78862acbf4d84', anchors: [['export class CampaignHudDetails {', 1], ["add('.flight-data .campaign-limit', 'campaign-limit'); add('.flight-data .ammo', 'ammo');", 1], ["add('#campaign-threat', 'campaign-threat'); add('#reload-status', 'reload-status');", 1], ['if (critical) {', 1], ['parent.insertBefore(node, before);', 1]] },
  { path: 'src/rules-guide.ts', sha256: 'f46c1b5ee0ec82418c9df1fd6807e10d040e6c7577bfcb06ce715a0ed0841012', anchors: [['export class RulesGuide', 1], ['this.dialog.showModal();', 1]] },
]);

function normalizeRelativePath(root, sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath || isAbsolute(sourcePath)) throw new Error(`UI-only integrity path must be relative: ${String(sourcePath)}`);
  const absolute = resolve(root, sourcePath);
  const rel = relative(resolve(root), absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`UI-only integrity path escapes project root: ${sourcePath}`);
  return absolute;
}

export function assertExactUiOnlyPath(root, candidate, expectedRelativePath) {
  const expected = normalizeRelativePath(root, expectedRelativePath);
  if (typeof candidate !== 'string') throw new Error(`UI-only source path is not a string: ${String(candidate)}`);
  const cleanCandidate = candidate.split('?')[0];
  const actual = isAbsolute(cleanCandidate) ? resolve(cleanCandidate) : normalizeRelativePath(root, cleanCandidate);
  if (actual !== expected) throw new Error(`UI-only source path mismatch: expected ${expectedRelativePath}, received ${candidate}`);
  return expected;
}

export function assertUiOnlySourceText(entry, sourceText) {
  const bytes = Buffer.from(sourceText);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== entry.sha256) throw new Error(`UI-only source hash mismatch: ${entry.path} expected ${entry.sha256} received ${digest}`);
  for (const [anchor, expectedCount] of entry.anchors) {
    const count = sourceText.split(anchor).length - 1;
    if (count !== expectedCount) throw new Error(`UI-only source anchor mismatch: ${entry.path} expected ${expectedCount} × ${JSON.stringify(anchor)} received ${count}`);
  }
}

export async function verifyUiOnlySources(root = process.cwd(), baseline = UI_ONLY_SOURCE_BASELINE) {
  const resolvedRoot = resolve(root);
  const seen = new Set();
  for (const entry of baseline) {
    if (seen.has(entry.path)) throw new Error(`Duplicate UI-only integrity path: ${entry.path}`);
    seen.add(entry.path);
    const absolute = normalizeRelativePath(resolvedRoot, entry.path);
    let stat;
    try { stat = await lstat(absolute); }
    catch { throw new Error(`UI-only source path missing: ${entry.path}`); }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`UI-only source path is not a regular file: ${entry.path}`);
    const source = await readFile(absolute, 'utf8');
    assertUiOnlySourceText(entry, source);
  }
  return { root: resolvedRoot, paths: [...seen] };
}
