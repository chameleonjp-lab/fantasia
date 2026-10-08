import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExactUiOnlyPath, assertUiOnlySourceText, verifyUiOnlySources, UI_ONLY_SOURCE_BASELINE } from './ui-only-integrity.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const adapterPath = resolve(scriptsDir, 'ui-only-adapter.js');
const virtualSceneId = '\0fantasia-ui-only:campaign-scene';

const sceneStub = `
import { PerspectiveCamera, Vector3 } from 'three';
import { FLIGHT_FOV, getFlightCameraPose } from '/src/flight-view.ts';
import { aimRadius } from '/src/aim-indicator.ts';
import { createCampaignHudLayout } from '/src/campaign-hud-layout.ts';
import { CampaignScene as ProductCampaignScene } from '/src/campaign-scene.ts';

export class CampaignScene {
  constructor(canvas, overlay) {
    this.canvas = canvas; this.overlay = overlay; this.ctx = overlay?.getContext('2d') ?? null;
    this.camera = new PerspectiveCamera(FLIGHT_FOV, 1, .5, 22000);
    this.hudLayout = createCampaignHudLayout(canvas); this.overlayVisible = true;
    this.width = 1; this.height = 1; this.drawCalls = 0; this.testThreat = null; this.bombGuideLabel = null;
    this.resize();
  }
  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    this.width = bounds.width; this.height = bounds.height;
    this.camera.aspect = bounds.width / bounds.height; this.camera.updateProjectionMatrix();
    if (this.overlay && (this.overlay.width !== Math.round(bounds.width) || this.overlay.height !== Math.round(bounds.height))) {
      this.overlay.width = Math.round(bounds.width); this.overlay.height = Math.round(bounds.height);
    }
    this.hudLayout.invalidate();
  }
  setOverlayVisible(value) { this.overlayVisible = value; if (!value) this.ctx?.clearRect(0, 0, this.width, this.height); }
  setUiOnlyThreat(actor) { this.testThreat = actor; }
  render(state, player, mode) {
    this.resize();
    getFlightCameraPose(player, mode, this.camera.position, this.camera.quaternion);
    this.camera.updateMatrixWorld(true);
    if (this.testThreat) {
      const depth = 450, nx = .28, ny = .08, halfFov = Math.tan(FLIGHT_FOV * Math.PI / 360);
      const local = new Vector3(nx * depth * halfFov * this.camera.aspect, ny * depth * halfFov, -depth);
      this.testThreat.position.copy ? this.testThreat.position.copy(local.applyQuaternion(this.camera.quaternion).add(this.camera.position))
        : Object.assign(this.testThreat.position, local.applyQuaternion(this.camera.quaternion).add(this.camera.position));
    }
    this.drawCalls++;
    ProductCampaignScene.prototype.drawOverlay.call(this, state, player, mode);
    return true;
  }
  prepare() { return Promise.resolve(); }
  pollRender() { return 'ready'; }
  diagnostics(player = null, mode = 'easy') {
    const sight = player && mode === 'normal' ? this.gunSight(player) : { x: this.width / 2, y: this.height / 2 };
    return { queue: { status: 'ready' }, drawCalls: this.drawCalls, width: this.width, height: this.height,
      sight, radius: player ? aimRadius(mode, this.width, this.height) : null,
      threatPoint: this.testThreat ? this.projection(this.testThreat.position) : null,
      hudLayout: this.hudLayout.diagnostics() };
  }
  gunSight(player) { return ProductCampaignScene.prototype.gunSight.call(this, player); }
  projection(position) { return ProductCampaignScene.prototype.projection.call(this, position); }
  drawBombGuide(state) { return ProductCampaignScene.prototype.drawBombGuide.call(this, state); }
  drawThreats(state) { return ProductCampaignScene.prototype.drawThreats.call(this, state); }
  drawRadar(state, player) { return ProductCampaignScene.prototype.drawRadar.call(this, state, player); }
  resetRenderQueue() {}
  dispose() { this.hudLayout.dispose(); this.ctx?.clearRect(0, 0, this.width, this.height); }
}
`;

export function uiOnlyTestPlugin() {
  let root;
  let mainPath;
  let expectedMain;
  let adapter;
  const baselineByPath = new Map(UI_ONLY_SOURCE_BASELINE.map(entry => [entry.path, entry]));

  return {
    name: 'fantasia-ui-only-test-transform',
    apply: 'serve',
    enforce: 'pre',
    async configResolved(config) {
      root = resolve(config.root);
      mainPath = resolve(root, 'src/main.ts');
      await verifyUiOnlySources(root);
      const info = await lstat(adapterPath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('UI-only adapter must be a regular file');
      adapter = await readFile(adapterPath, 'utf8');
      if (!adapter.startsWith('// Inserted into src/main.ts only by scripts/vite.ui-only-plugin.mjs.\n')) throw new Error('UI-only adapter anchor mismatch');
      expectedMain = baselineByPath.get('src/main.ts');
    },
    resolveId(source, importer) {
      if (source === './campaign-scene' && importer) {
        const cleanImporter = importer.split('?')[0];
        if (resolve(cleanImporter) === mainPath) return virtualSceneId;
      }
      return null;
    },
    load(id) { if (id === virtualSceneId) return sceneStub; return null; },
    transform(source, id) {
      if (!root) throw new Error('UI-only transform used before root verification');
      const cleanId = id.split('?')[0];
      const relativePath = Object.keys(Object.fromEntries(baselineByPath)).find(path => resolve(root, path) === resolve(cleanId));
      if (relativePath) assertUiOnlySourceText(baselineByPath.get(relativePath), source);
      if (resolve(cleanId) !== mainPath) return null;
      assertExactUiOnlyPath(root, cleanId, 'src/main.ts');
      assertUiOnlySourceText(expectedMain, source);
      const marker = '// Removed by production builds. Observation cannot rewrite a run or inject results.';
      if (source.split(marker).length - 1 !== 1) throw new Error('UI-only main insertion anchor mismatch');
      const frameCall = 'frameId = requestAnimationFrame(frame);';
      if (source.split(frameCall).length - 1 !== 2) throw new Error('UI-only frame suppression anchor mismatch');
      const transformed = source.replaceAll(frameCall, 'frameId = 0; // UI-only test server: no natural frames or simulation.');
      return transformed.replace(marker, `${adapter}\n${marker}`);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const entry = baselineByPath.get('index.html');
        assertUiOnlySourceText(entry, html);
        return null;
      },
    },
  };
}
