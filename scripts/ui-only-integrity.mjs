import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const UI_ONLY_SOURCE_BASELINE = Object.freeze([
  { path: 'index.html', sha256: '2bb4109ecc8bc9c74ab965ca6fab00077539fe7cb50a082f4406772bd2f152d5', anchors: [['<main id="app"', 1], ['id="campaign-sites"', 1], ['id="pause-screen"', 1], ['id="result"', 1], ['src="/src/main.ts"', 1]] },
  { path: 'src/main.ts', sha256: '1b34c99733a85def13c295efb47ca4f3616588aaad4b82cdf1cacfccf515fb24', anchors: [['function updateHUD() {', 1], ['function finish() {', 1], ['function preparationFailed(error: unknown) {', 1], ['frameId = requestAnimationFrame(frame);', 2], ['// Removed by production builds. Observation cannot rewrite a run or inject results.', 1]] },
  { path: 'src/style.css', sha256: '22febc0f4723a96152f8b4a54c15d2c9fecf2865d6ba9e6cd021eae6e46bec14', anchors: [['#app {', 1], ['#result {', 1], ['.fantasia-shell .campaign-sites {', 5], ['#app.fantasia-shell #hud button[data-flight-control] {', 1], ['.flight-data > .health-track { top: 180px; }', 1], ['#app[data-campaign-hud="compact"] .campaign-site { min-height: 48px; }', 1], ['#warning { top: 162px; bottom: auto; }', 1], ['#announcement { top: 84px !important; bottom: auto; }', 1], ['#campaign-hud-details {\n  position: absolute; left: 8px; top: 220px; width: 114px; height: 96px;', 1], ['#app[data-campaign-hud="compact"] .flight-data > .health-label { width: max-content; }', 1], ['#app[data-campaign-hud="compact"] #hud .hud-actions #game-sound,', 1], ['#app[data-campaign-hud="compact"] #hud .hud-actions #pause { left: calc(50% + 26px) !important; top: calc(100dvh - 54px - var(--safe-bottom)) !important; }', 1], ['#app[data-campaign-hud="compact"] #hud #fire { left: 340px !important; top: 250px !important; right: auto !important; bottom: auto !important; }', 1], ['#app[data-campaign-hud="compact"][data-mode="normal"] #hud #loop { left: 265px !important; top: 250px !important; }', 1], ['#app[data-campaign-hud="compact"][data-mode="normal"] #hud #fire { left: 220px !important; top: 500px !important; right: auto !important; bottom: auto !important; }', 1]] },
  { path: 'src/control-settings.css', sha256: 'c04d27c450da70f85a3c843bb5e7fd0905d455f1e9cf16b66609adf605fe8f4e', anchors: [['.settings-input-picker button {', 1], ['#control-settings .settings-footer button {', 1], ['#control-settings .settings-main {', 1]] },
  { path: 'src/control-settings.ts', sha256: '8ae26ea17dca2782ec13853c040414d329e8799af6162c69b3e54b748a06ac80', anchors: [['export class ControlSettings {', 1], ['private save(): void {', 1], ['this.dialog.querySelector<HTMLButtonElement>(\'#control-save\')!.textContent = \'今回だけ使う\';', 1]] },
  { path: 'src/settings-storage.ts', sha256: '72146f811b2bf34036f2ba03f146a1fbd2b4ee0f31793cc6cac233aa17813ee5', anchors: [['export function persistSettingsBatch(', 1], ['export function readSettingsValue(', 1]] },
  { path: 'src/keyboard-settings.ts', sha256: '00fab37cbb9acf40c8a37e9e6511e6fed8395d374cad452ca494f8c11c8f6531', anchors: [['export const KEYBOARD_STORAGE_KEY', 1], ['export class KeyboardSettings', 1]] },
  { path: 'src/campaign-hud.ts', sha256: 'e8d71b5838ce7ce6a73a5a3384ce098ac80e1844c38e850d2a816f1d746a1523', anchors: [['export function campaignSiteReadouts(', 1], ['export function updateCampaignHud(', 1]] },
  { path: 'src/campaign-hud-layout.ts', sha256: '9a48c46a1d086b2041a1a18f6005cd059b5470d6420396781a263e4ee9a23f32', anchors: [['export class CampaignHudLayout', 1], ['export function createCampaignHudLayout(', 1], ['export function layoutCampaignHud(', 1]] },
  { path: 'src/campaign-scene.ts', sha256: 'fccb66a3b8855d2d84d08703150ca9524bf2baa37d337b6b430b818be496cbed', anchors: [['export class CampaignScene {', 1], ['private projection(position: Vec) {', 1], ["private drawOverlay(state: CampaignState, player: Aircraft, mode: 'normal' | 'easy', selectedTargetId?: number | null) {", 1], ['private drawThreats(state: CampaignState) {', 1], ['private drawRadar(state: CampaignState, player: Aircraft) {', 1], ['this.drawOverlay(state, player, mode, selectedTargetId);', 1]] },
  { path: 'src/aim-indicator.ts', sha256: '2f2e129e0ffbe41462577f1dc10a137b037f5cb1b280ab1ee50c182b8c155140', anchors: [['export function aimRadius(', 1], ["return mode === 'normal' ? Math.max(26, Math.min(38, Math.min(width, height) * .085)) : Math.min(width, height) * .135;", 1]] },
  // Camera rollout: explicit migrated bytes; original import remains in KAISEN_IMPORT_MANIFEST.json.
  { path: 'src/flight-view.ts', sha256: 'e1f76d03ec6b95ea225113e355d1fa7c6db9ac44aa61aed4a4f991b6edcaf9a9', anchors: [['export const FLIGHT_FOV = 64;', 1], ['export function getFlightCameraPose(', 1], ['const TAN_HALF_FOV = Math.tan(FLIGHT_FOV * Math.PI / 360);', 1]] },
  { path: 'src/gun-sight.ts', sha256: '436c9e7c6a6864513489de6d8172d85d97bd1bf685b60678890f848a9acd2b71', anchors: [['export function projectGunSight(', 1], ['const depth = 500;', 1], ["projectFlightTarget(player, aim, width / height, 'normal')", 1]] },
  { path: 'src/campaign-hud-details.ts', sha256: 'ead47d2ed8b7e6d583b33f2aeecc6a3c3c8faff76246408131223cad132344cb', anchors: [['export class CampaignHudDetails {', 1], ["add('.flight-data .campaign-limit', 'campaign-limit'); add('.flight-data .ammo', 'ammo');", 1], ["add('#campaign-threat', 'campaign-threat'); add('#reload-status', 'reload-status');", 1], ['if (critical) {', 1], ['private refreshTypographyForViewport() {', 1], ['private hasExternalTypographyOverride() {', 1], ['this.refreshTypographyForViewport();', 1], ['if (!compact && !this.hasExternalTypographyOverride()) this.restoreTypography();', 1], ['parent.insertBefore(node, before);', 1]] },
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
