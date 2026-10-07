import './style.css';
import './control-settings.css';
import { Vector3 } from 'three';
import { Campaign, campaignScore, formatCampaignTicks } from './campaign';
import { CAMPAIGN_DT, CAMPAIGN_LIMIT_TICKS, SUSPENDED_CAMPAIGN_RULES_VERSION } from './campaign-config';
import { predictBombImpact, type BombPrediction } from './campaign-combat';
import { CampaignRecords, type RecordSaveStatus } from './campaign-records';
import { CampaignFlightController } from './campaign-flight';
import { terrainHeight, distanceSquared, sweepSphere } from './campaign-terrain';
import { CampaignScene } from './campaign-scene';
import { CampaignStartPreparation, type StartPreparationFailure } from './campaign-start';
import { updateCampaignHud } from './campaign-hud';
import type { CampaignEvent } from './campaign-types';
import { forwardOf } from './flight';
import { FlightControls } from './input';
import { ControlSettings } from './control-settings';
import { KeyboardSettings, ControlInputPresentation } from './keyboard-settings';
import { RulesGuide } from './rules-guide';
import { FlightAudio } from './audio';
import type { FlightInput, GameEvent, GameMode } from './types';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI: ${id}`);
  return node as T;
}
const app = el('app'), canvas = el<HTMLCanvasElement>('flight'), overlay = el<HTMLCanvasElement>('markers');
const STANDARD_SEED = 20261005;
let selectedMode: GameMode = 'easy';
let campaign = new Campaign(selectedMode, STANDARD_SEED), state = campaign.state;
let flight = new CampaignFlightController(state), player = flight.player;
let screen: 'home' | 'preparing' | 'playing' | 'paused' | 'result' = 'home';
let scene: CampaignScene | null = null;
let graphicsReady = false, contextLost = false, disposed = false;
let accumulator = 0, lastFrame = 0, frameId = 0;
let pendingLoop = false, pendingBomb = false;
let announcementUntil = 0, announcementPriority = 0;
let respawnRemaining = 0, pauseCount = 0, performanceInterrupted = false;
let fatalLogicError: string | null = null;
let renderStatus: 'ready' | 'pending' | 'stalled' | 'failed' = 'ready';
let lastFrameGap = 0;
let lastInterruption: { reason: string; gap: number; render: unknown } | null = null;
let frameIntervals: number[] = [], updateTimes: number[] = [];
let inputAudit: { tick: number; input: FlightInput }[] = [];
let inputAuditSignature = '', inputAuditDropped = 0;
const pauseReasons = new Set<string>();
const records = new CampaignRecords();
const audio = new FlightAudio(); audio.enabled = false;
const buttons = {
  fire: el<HTMLButtonElement>('fire'), loop: el<HTMLButtonElement>('loop'),
  throttle: el<HTMLElement>('throttle'),
  bomb: el<HTMLButtonElement>('bomb'),
};
for (const button of Object.values(buttons)) button.dataset.flightControl = 'true';
const keyboardSettings = new KeyboardSettings(), inputPresentation = new ControlInputPresentation();
const settings = new ControlSettings(buttons, keyboardSettings, inputPresentation);
let rules: RulesGuide | null = null;
const controls = new FlightControls(canvas, buttons, () => screen === 'playing' && state.status === 'running'
  && !settings.isOpen && !rules?.isOpen, keyboardSettings);
let bombPrediction: BombPrediction | null = null, bombPredictionTick = -1;
const modeName = (mode: GameMode) => mode === 'easy' ? 'イージー' : 'ノーマル';
const formatTicks = formatCampaignTicks;
const startPreparation = new CampaignStartPreparation<{ mode: GameMode; runId: string }>({
  now: () => performance.now(),
  poll: () => {
    if (!scene || contextLost) throw new Error('Renderer unavailable');
    renderStatus = scene.pollRender(); return scene.diagnostics().queue;
  },
  submit: selection => {
    if (!scene || selection.runId !== state.runId || selection.mode !== state.mode) return null;
    // The staged HUD has real layout boxes, but remains transparent/inert.
    // Prepare its initial text, layout and Canvas2D drawing before live time.
    updateHUD(); scene.setOverlayVisible(true);
    if (!scene.render(state, player, selection.mode)) return null;
    const rendered = scene.diagnostics();
    if (!rendered.hudLayout.measurements || (rendered.hudLayout.canvas?.width ?? 0) <= 0 || (rendered.hudLayout.canvas?.height ?? 0) <= 0) {
      throw new Error('Initial HUD preparation unavailable');
    }
    return rendered.queue;
  },
  schedule: (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
  complete: selection => {
    if (disposed || contextLost || document.hidden || settings.isOpen || rules?.isOpen
      || screen !== 'preparing' || selection.runId !== state.runId || selection.mode !== selectedMode) {
      home(); return;
    }
    // This is the playing boundary, after acknowledgment of the selected view.
    // Drop preparation time and all stale input; the next rAF starts with dt=0.
    setScreen('playing'); syncAudio(); scene?.setOverlayVisible(true);
    updateHUD();
  },
  failed: reason => {
    if (reason === 'render-failed') renderStatus = 'failed';
    if (screen === 'playing') setScreen('preparing');
    clearInput(); syncStartPreparation(reason); syncAudio();
  },
});
function syncStartPreparation(reason: StartPreparationFailure | null = startPreparation.snapshot().failure) {
  const preparing = screen === 'preparing', contextWaiting = contextLost && screen === 'home';
  const failed = preparing && reason !== null;
  el('start-cancel').hidden = !preparing;
  el('start-retry').hidden = !failed || reason === 'render-failed';
  el<HTMLButtonElement>('start-retry').disabled = contextLost || renderStatus === 'failed' || document.hidden;
  el('start-status').hidden = !preparing && !contextWaiting;
  el('start-status').textContent = contextWaiting ? '描画が中断されました。復帰を待つか、再読み込みしてください' : !failed ? `${modeName(state.mode)}の出撃画面を準備しています。作戦時間はまだ進みません（最大15秒）`
    : reason === 'timeout' ? '準備が15秒以内に完了しませんでした。時間は進んでいません。再試行するか、ホームへ戻れます'
      : reason === 'context-lost' ? contextLost ? '描画が中断されました。復帰を待つか、再読み込みしてください'
        : '描画が復帰しました。「準備を再試行」で出撃画面を準備できます'
        : reason === 'render-failed' ? '出撃画面を準備できませんでした。再読み込みしてお試しください'
          : '表示や操作が切り替わったため準備を止めました。「準備を再試行」で再開できます';
  el('reload').hidden = !(contextWaiting || failed && (reason === 'render-failed' || reason === 'context-lost'));
  el<HTMLButtonElement>('start').disabled = !graphicsReady || contextLost || preparing || renderStatus === 'failed';
  if (graphicsReady) {
    if (contextWaiting || preparing) el('start').textContent = contextWaiting ? '描画の復帰を待っています' : failed ? '出撃の準備を停止しました' : '出撃画面を準備しています';
    else el('start').innerHTML = '出撃する <span aria-hidden="true">↗</span>';
  }
}
function leavePreparation() {
  if (screen !== 'preparing') return;
  startPreparation.cancel(); setScreen('home'); syncAudio();
}

function clearInput() {
  controls.clear(); pendingLoop = false; pendingBomb = false; flight.clearPending(); accumulator = 0; lastFrame = 0;
}
function keyboardDescription() { return keyboardSettings.describe(state.mode); }
function syncInstructions() {
  const touch = inputPresentation.value === 'touch'; app.dataset.input = inputPresentation.value;
  el('flight-tip').textContent = touch ? 'ドラッグで操縦' : 'キーで操縦';
  el('input-guide').textContent = touch ? '画面をドラッグして操縦' : 'キーボードで操縦';
  el('mode-guide').textContent = state.mode === 'easy' ? '照準円内・1.2km以内へ自動射撃 · 7方面の地上軍を支援'
    : touch ? '照準補助なし・手動射撃 · 射撃は長押し・速度はレバーで調整' : '照準補助なし・手動射撃 · 射撃・加減速はキーを長押し';
  el('keyboard-guide').hidden = touch; el('keyboard-guide').textContent = keyboardDescription();
}
function updateBestRecord() {
  if (state.rulesVersion === SUSPENDED_CAMPAIGN_RULES_VERSION) {
    el('best-record').textContent = '暫定版では最速記録を保存しません（既存記録は保持）';
    return;
  }
  const best = records.best(state);
  el('best-record').textContent = best ? `この端末の最速 ${formatTicks(best.recordTicks)} · ${best.score.toLocaleString('ja-JP')}点`
    : records.status === 'future-version' ? '新しい形式の記録を保護しています'
      : records.status === 'unavailable' ? '記録を読み込めません。出撃はできます' : 'この端末の最速記録 —';
}
function syncMode() {
  clearInput(); app.dataset.mode = state.mode; controls.setMode(state.mode); settings.setActiveMode(state.mode);
  el('rules-variant').textContent = state.rulesVersion === SUSPENDED_CAMPAIGN_RULES_VERSION ? '暫定版 · 竜火球停止' : '7陣地占領戦';
  el('normal-controls').hidden = state.mode !== 'normal'; el('friendly-fire-guide').hidden = state.mode !== 'normal';
  el('hud-mode').textContent = modeName(state.mode); el('result-mode').textContent = modeName(state.mode);
  syncInstructions(); updateBestRecord();
}
function resetCampaign() {
  campaign.dispose(); campaign = new Campaign(selectedMode, STANDARD_SEED); state = campaign.state;
  flight = new CampaignFlightController(state); player = flight.player; bombPrediction = null; bombPredictionTick = -1;
  respawnRemaining = 0; pauseCount = 0; performanceInterrupted = false; fatalLogicError = null; clearInput();
}
syncMode();
const unsubscribeKeyboard = keyboardSettings.subscribe(() => { clearInput(); syncInstructions(); });
// Presentation can change on the compatibility click after a valid touch release.
// Keep that completed single-action edge available for the next fixed tick.
const unsubscribePresentation = inputPresentation.subscribe(syncInstructions);
rules = new RulesGuide(() => ({ mode: state.mode, input: inputPresentation.value, keyboardDescription: keyboardDescription() }), clearInput);
for (const id of ['home-rules', 'pause-rules']) {
  const button = el(id); button.addEventListener('click', () => { leavePreparation(); clearInput(); rules?.open(button); });
}
for (const [id, allowBoth] of [['home-controls', true], ['pause-controls', false], ['result-controls', true]] as const) {
  const button = el(id); button.addEventListener('click', () => { leavePreparation(); clearInput(); settings.open(button, screen === 'home' ? selectedMode : state.mode, allowBoth); });
}
el('control-settings').addEventListener('close', clearInput);
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="game-mode"]')) {
  radio.addEventListener('change', () => {
    if ((screen !== 'home' && screen !== 'preparing') || !radio.checked) return;
    leavePreparation(); selectedMode = radio.value === 'normal' ? 'normal' : 'easy'; resetCampaign(); syncMode(); updateHUD();
  });
}
function setScreen(next: typeof screen) {
  settings.close(); rules?.close(); screen = next; app.dataset.screen = next;
  el('home').hidden = next !== 'home' && next !== 'preparing';
  const hud = el('hud');
  hud.hidden = next !== 'preparing' && next !== 'playing' && next !== 'paused';
  hud.inert = next === 'preparing';
  for (const node of [hud, el('announcement')]) {
    if (next === 'preparing') node.setAttribute('aria-hidden', 'true'); else node.removeAttribute('aria-hidden');
  }
  if (next === 'home') el('announcement').textContent = '';
  el('pause-screen').hidden = next !== 'paused'; el('result').hidden = next !== 'result';
  el('start-cancel').hidden = next !== 'preparing'; clearInput();
  if (next === 'home') syncStartPreparation();
  const focus = next === 'preparing' ? 'start-cancel' : next === 'home' ? 'start' : next === 'paused' ? 'resume' : next === 'result' ? 'retry' : null;
  if (focus) el<HTMLButtonElement>(focus).focus({ preventScroll: true }); else canvas.focus({ preventScroll: true });
}
function announce(text: string, duration = 3, priority = 0) {
  if (state.activeTicks < announcementUntil && priority < announcementPriority) return;
  announcementPriority = priority; el('announcement').dataset.campaignCritical = String(priority >= 1); el('announcement').textContent = text; announcementUntil = state.activeTicks + duration * 60;
}
function syncAudio() {
  audio.active = state.status === 'running' && screen === 'playing' && !document.hidden; audio.sync();
  el('home-sound').textContent = audio.enabled ? '音をオフにする' : '音をオンにする'; el('game-sound').textContent = audio.enabled ? '音 ON' : '音 OFF';
  el('game-sound').setAttribute('aria-label', audio.enabled ? '音をオフにする' : '音をオンにする');
  for (const id of ['home-sound', 'game-sound']) el(id).setAttribute('aria-pressed', String(audio.enabled));
}
async function toggleAudio() {
  audio.enabled = !audio.enabled; syncAudio();
  if (audio.enabled) { await audio.unlock(); syncAudio(); if (audio.failed) announce('音を再生できません。飛行は続けられます'); }
}
for (const id of ['home-sound', 'game-sound']) el(id).addEventListener('click', () => void toggleAudio());
function begin() {
  if (!scene || !graphicsReady || disposed || contextLost || document.hidden || screen === 'playing'
    || startPreparation.active || renderStatus === 'failed' || settings.isOpen || rules?.isOpen) return;
  // AudioContext.resume must run synchronously inside this click's user gesture.
  // Audio stays inactive until the selected frame actually completes.
  void audio.unlock().then(() => { if (!disposed) syncAudio(); });
  resetCampaign(); announcementUntil = 0; announcementPriority = 0; pauseReasons.clear(); audio.resetFlight(); syncMode(); frameIntervals = []; updateTimes = [];
  if (import.meta.env.DEV) { inputAudit = []; inputAuditSignature = ''; inputAuditDropped = 0; }
  setScreen('preparing'); announce('7軍の進軍開始 · 砲台と竜を排除し、旗をそろえよう', 5);
  startPreparation.begin({ mode: state.mode, runId: state.runId });
  syncStartPreparation(); syncAudio(); updateHUD();
}
function home() {
  startPreparation.cancel(); audio.resetFlight(); resetCampaign(); syncMode(); pauseReasons.clear(); setScreen('home');
  el('announcement').textContent = ''; syncAudio(); updateHUD(); scene?.setOverlayVisible(false);
}
function pause(reason: string) {
  clearInput(); if (screen === 'preparing') { startPreparation.interrupt('interrupted'); return; }
  if (screen !== 'playing' && screen !== 'paused') return;
  if (screen === 'playing') pauseCount++; pauseReasons.add(reason); if (screen !== 'paused') setScreen('paused');
  el('pause-reason').textContent = contextLost ? '描画が中断されました。復帰を待っています'
    : fatalLogicError ? '作戦の処理を続けられません。再読み込みしてお試しください'
      : reason === 'render-failed' ? '描画を続けられません。再読み込みしてお試しください'
        : reason === 'render' ? '描画の完了を待っています。復帰後に再開できます'
          : reason === 'frame' ? '更新の遅れが0.25秒を超えました。この出撃は最速記録に保存しません'
            : reason === 'resize' ? '表示サイズが変わったため停止しました。タイムも止まっています' : '作戦時間と戦況を止めています。操作して再開できます';
  el<HTMLButtonElement>('resume').disabled = contextLost || !!fatalLogicError || renderStatus === 'stalled' || renderStatus === 'failed';
  el('pause-reload').hidden = renderStatus !== 'failed' && !fatalLogicError; updateBombCue(); syncAudio();
}
function resume() {
  if (settings.isOpen || rules?.isOpen || document.hidden || contextLost || fatalLogicError || screen !== 'paused' || renderStatus === 'stalled' || renderStatus === 'failed') return;
  pauseReasons.clear(); setScreen('playing'); syncAudio(); void audio.unlock().then(syncAudio); updateBombCue();
}
function showRecordStatus(status: RecordSaveStatus) {
  el('record-session-only').hidden = status !== 'unavailable' && status !== 'future-version';
  el('record-status').textContent = status === 'saved' ? 'この端末の最速記録を更新しました'
    : status === 'unchanged' ? 'この端末の最速記録はそのままです'
      : status === 'session-only' ? '今回の記録を、このタブを閉じるまで残しました'
        : status === 'future-version' ? '新しい形式の記録を保護するため保存しません。「このタブだけ」で今回の記録を残せます'
          : status === 'unavailable' ? '記録を保存できませんでした。「このタブだけ」で今回の記録を残せます'
            : state.rulesVersion === SUSPENDED_CAMPAIGN_RULES_VERSION ? '竜火球を停止した暫定版のため、最速記録には保存しません'
              : performanceInterrupted ? '性能停止があったため、通常の最速記録には保存しません' : '敗北した出撃はクリア記録へ保存しません';
}
function finish() {
  const result = state.resultSnapshot; if (!result || screen === 'result') return;
  audio.finishFlight(); setScreen('result'); el('announcement').textContent = '';
  el('result-title').textContent = result.status === 'victory' ? '全陣地を占領' : '作戦終了';
  el('result-kicker').textContent = result.status === 'victory' ? 'SEVEN FLAGS UNITED' : 'MISSION REPORT';
  const causes: Record<string, string> = {
    '地形に接触': '地形への衝突で最後の機体を失いました', '撃墜': '最後の機体が撃墜されました', '作戦圏外': '作戦圏外で最後の機体を失いました',
    '残機なし': 'すべての機体を失いました', '全軍の再建不能': '味方地上軍の生存兵と予備兵が尽き、再建できません', '作戦期限20分': '20分の作戦期限に達しました',
  };
  el('result-reason').textContent = result.status === 'victory' ? '味方地上軍が7つの旗を同時にそろえました' : causes[result.reason] ?? result.reason;
  el('result-mode').textContent = modeName(result.mode); el('result-score').textContent = result.score.toLocaleString('ja-JP');
  for (const [id, key] of [['captures', 'capture'], ['turrets', 'turrets'], ['clear', 'success'], ['speed', 'speed'],
    ['friendlyDamagePenalty', 'friendlyDamage'], ['friendlyKillPenalty', 'friendlyKills'], ['selfLossPenalty', 'selfLoss']] as const) el(`result-score-${id}`).textContent = result.breakdown[key].toLocaleString('ja-JP');
  el('result-score-version').textContent = `ルール ${result.rulesVersion} · 地図 ${result.mapVersion}`; el('result-score-version').dataset.scoreRulesVersion = result.rulesVersion;
  el('friendly-fire-result').textContent = `誤射 ${state.friendlyDamage} HP · 味方兵の誤射撃破 ${state.friendlyKills}体`;
  el('result-time-label').textContent = result.status === 'victory' ? '記録タイム' : '参考タイム'; el('result-time').textContent = formatTicks(result.recordTicks);
  el('result-active-time').textContent = `${formatTicks(result.activeTicks)} / +${formatTicks(result.respawnPenaltyTicks)}`; el('result-sites').textContent = `${result.capturedSites} / 7`;
  el('result-forces').textContent = `${state.actors.filter(a => a.team === 'friendly' && a.kind === 'ground' && a.hp > 0).length} / ${state.armies.reduce((sum, army) => sum + army.reserveCount, 0)}`;
  el('result-lives').textContent = `${result.selfLosses} / ${result.livesRemaining}`; el('result-kills').textContent = `${result.enemyKills} / ${result.friendlyLosses}`;
  el('result-pauses').textContent = `${pauseCount}回${performanceInterrupted ? ' · 性能停止あり' : ''}`;
  showRecordStatus(records.save(result, pauseCount, performanceInterrupted)); updateBestRecord(); el('result').scrollTop = 0;
}
el('record-session-only').addEventListener('click', () => {
  if (state.resultSnapshot) { showRecordStatus(records.useSessionOnly(state.resultSnapshot, pauseCount, performanceInterrupted)); updateBestRecord(); }
});
function handleEvents(events: readonly CampaignEvent[]) {
  for (const event of events) {
    const position = event.position ?? state.player.position;
    const type: GameEvent['type'] | null = event.kind === 'selfLoss' || event.kind === 'kill' ? 'kill'
      : event.kind === 'shot' ? 'shot' : event.kind === 'hit' ? event.targetRef?.id === player.id ? 'damage' : 'hit' : event.kind === 'explosion' ? 'ordnance-impact' : null;
    if (type) {
      const audioEvent: GameEvent = { id: event.id, tick: event.tick, type, position: new Vector3(position.x, position.y, position.z), owner: event.sourceRef?.id ?? -1, target: event.targetRef?.id };
      if (event.weapon === 'bomb') audioEvent.weapon = 'bomb';
      if (type === 'ordnance-impact') audio.worldEvent(audioEvent, player, 'ordnance-impact');
      else audio.event(audioEvent, event.kind !== 'selfLoss' && (type === 'kill' || event.sourceRef?.id === player.id || event.targetRef?.id === player.id));
    }
    if (event.kind === 'selfLoss') { announce('自機喪失 · 復活すると記録時間に10秒加算', 4, 5); audio.finishFlight(); }
    if (event.kind === 'capture') announce(`陣地${(event.siteId ?? 0) + 1} ${event.team === 'friendly' ? '味方が占領' : '敵が奪還'}`, 3, 3);
    if (event.kind === 'neutralize') announce(`陣地${(event.siteId ?? 0) + 1}の旗が中立化`, 2, 3);
    if (event.kind === 'reinforcement' && event.team === 'enemy') announce('敵の補填部隊が進軍しています', 3, 2);
    if (event.kind === 'rescue') announce('隣軍の救援隊が出発', 3, 2);
    if (event.kind === 'shot' && event.weapon === 'bomb' && event.sourceRef?.id === player.id) announce('爆弾投下 · 地上の味方位置にも注意', 2, 1);
  }
}
function consumeTick(input: FlightInput) {
  if (import.meta.env.DEV) {
    const signature = JSON.stringify(input);
    if (signature !== inputAuditSignature) {
      if (inputAudit.length < 20000) inputAudit.push({ tick: state.simTick, input: { ...input } }); else inputAuditDropped++;
      inputAuditSignature = signature;
    }
  }
  campaign.step(flight.step(state, input)); flight.sync(state);
  if (flight.lastLoopCompleted) audio.event({ id: 10000000 + state.simTick, tick: state.simTick, type: 'loop', owner: player.id, position: player.position.clone() }, true);
  handleEvents(state.events);
  if (state.status === 'respawning') { respawnRemaining = 3; clearInput(); syncAudio(); }
}
function updateBombCue() {
  if (bombPredictionTick !== state.simTick) {
    bombPrediction = predictBombImpact(player.position, forwardOf(player).multiplyScalar(player.speed), player.quaternion); bombPredictionTick = state.simTick;
  }
  const ready = (screen === 'playing' || screen === 'preparing') && state.status === 'running' && state.player.bombs > 0 && state.player.protectionTicks === 0;
  const affected = bombPrediction ? state.actors.filter(actor => actor.hp > 0 && distanceSquared(actor.position, bombPrediction!.position) < 45 ** 2
    && sweepSphere({ ...bombPrediction!.position, y: bombPrediction!.position.y + .1 }, actor.position, 0) === null) : [];
  const enemy = affected.some(actor => actor.team === 'enemy'), friendly = affected.some(actor => actor.team === 'friendly');
  const text = !ready ? state.player.protectionTicks > 0 ? '復活保護中' : player.bombReloadTicks > 0 ? '補給中' : '投下待機'
    : friendly && state.mode === 'normal' ? '味方が爆風圏内' : enemy ? '敵が爆風圏内' : '落下地点の予測';
  el('bomb').dataset.ready = String(ready && enemy && !(friendly && state.mode === 'normal')); el('bomb-hint').dataset.campaignCritical = String(state.player.protectionTicks > 0 || (friendly && state.mode === 'normal')); el('bomb-hint').textContent = text;
  el('bomb').setAttribute('aria-label', `爆弾を投下・${player.bombs}発・${text}（予測）`);
}
function positionReloadStatus() {
  if (state.mode === 'normal' && scene) {
    const sight = scene.gunSight(player); el('reload-status').style.top = `${sight.y + 52}px`; el('reload-status').style.left = `${sight.x}px`;
  } else { el('reload-status').style.removeProperty('top'); el('reload-status').style.removeProperty('left'); }
}
function updateHUD() {
  el('timer').textContent = formatTicks(state.activeTicks + state.respawnPenaltyTicks); el('score').textContent = String(state.resultSnapshot?.score ?? campaignScore(state).total);
  el('enemy-count').textContent = String(state.sites.filter(site => site.owner === 'friendly').length); el('lives-count').textContent = String(state.livesRemaining);
  el('allies-count').textContent = String(state.actors.filter(actor => actor.team === 'friendly' && actor.kind === 'ground' && actor.hp > 0).length);
  el('reserves-count').textContent = String(state.armies.reduce((sum, army) => sum + army.reserveCount, 0));
  const remaining = Math.max(0, CAMPAIGN_LIMIT_TICKS - state.activeTicks); el('remaining-time').textContent = `${Math.floor(remaining / 3600)}:${String(Math.floor(remaining / 60) % 60).padStart(2, '0')}`;
  el('mg-ammo').textContent = String(player.mg); el('cannon-ammo').textContent = String(player.cannon);
  el('bomb-ammo').textContent = player.bombReloadTicks > 0 ? `補給 ${(player.bombReloadTicks / 60).toFixed(1)}秒` : `残り${player.bombs}発`;
  el('reload-status').hidden = player.reloadTicksRemaining <= 0; el('reload-status').textContent = player.reloadTicksRemaining > 0 ? `再装填中 あと${(player.reloadTicksRemaining / 60).toFixed(1)}秒` : '';
  el('reload-status').dataset.progress = String(1 - player.reloadTicksRemaining / 360);
  const health = Math.max(0, Math.min(100, player.health / player.maxHealth * 100)); el('health').textContent = String(Math.ceil(health)); el('health-bar').style.width = `${health}%`;
  el('altitude').textContent = `${Math.round(player.position.y)}m`; el('speed').textContent = `${Math.round(player.speed * 3.6)}km/h`;
  const outside = Math.hypot(player.position.x, player.position.z) > 2100, protectedPlayer = state.player.protectionTicks > 0;
  el('warning').hidden = screen !== 'playing' || state.status !== 'running' || (!outside && !protectedPlayer && player.position.y - terrainHeight(player.position.x, player.position.z) >= 65);
  el('warning').textContent = outside ? `作戦圏へ戻って · あと${Math.ceil(state.player.boundaryTicks / 60)}秒`
    : protectedPlayer ? `復活保護 あと${(state.player.protectionTicks / 60).toFixed(1)}秒 · 自機攻撃不可` : '低空注意 · 機首を上げて';
  el('loop-status').textContent = player.loopProgress > 0 ? '宙返り中' : player.loopCooldown > 0 ? `${player.loopCooldown.toFixed(1)}秒` : 'すぐ使える';
  el('flight-tip').hidden = state.activeTicks > 480; el('respawn-status').hidden = screen !== 'playing' || state.status !== 'respawning';
  el('respawn-status').textContent = `復活まで ${Math.max(1, Math.ceil(respawnRemaining))}秒 · 戦況と作戦時間は停止中`;
  if (state.activeTicks > announcementUntil) el('announcement').textContent = '';
  updateCampaignHud(state, player); updateBombCue(); positionReloadStatus();
}
function frame() {
  const now = performance.now(); if (disposed) return; frameId = requestAnimationFrame(frame);
  // Preparation owns submission, including its failed state until a deliberate
  // retry/cancel. Home rendering must not replenish the queue while it drains.
  if (startPreparation.ownsRendering) {
    clearInput(); startPreparation.step(); updateHUD(); return;
  }
  const dt = lastFrame ? Math.max(0, (now - lastFrame) / 1000) : 0; lastFrame = now; lastFrameGap = dt;
  if (scene && !contextLost) renderStatus = scene.pollRender(now);
  if (screen === 'playing') {
    if (renderStatus === 'stalled' || renderStatus === 'failed') {
      performanceInterrupted = true; lastInterruption = { reason: renderStatus, gap: dt, render: scene?.diagnostics() }; pause(renderStatus === 'failed' ? 'render-failed' : 'render');
    } else if (state.status === 'respawning') {
      respawnRemaining -= dt;
      if (respawnRemaining <= 0) {
        campaign.resumeRespawn(); flight.sync(state, true); bombPredictionTick = -1; clearInput(); audio.resetFlight(); syncAudio(); announce('復活 · 2秒の保護中は自機も攻撃できません', 2, 5);
      }
    } else if (state.status === 'running') {
      if (accumulator + dt > .25) {
        performanceInterrupted = true; lastInterruption = { reason: 'frame', gap: dt, render: scene?.diagnostics() }; pause('frame');
      } else {
        accumulator += dt;
        if (dt > 0) { frameIntervals.push(dt * 1000); if (frameIntervals.length > 7200) frameIntervals.shift(); }
        const sampled = controls.sample(false); pendingLoop ||= sampled.loop; pendingBomb ||= !!sampled.bomb; sampled.viewAspect = scene?.camera.aspect ?? 1;
        let first = true;
        while (accumulator + 1e-9 >= CAMPAIGN_DT && screen === 'playing' && state.status === 'running') {
          const consumed = { ...sampled, throttle: controls.sampleThrottle(), loop: first && pendingLoop, bomb: first && pendingBomb }, before = performance.now();
          try { consumeTick(consumed); }
          catch (error) {
            fatalLogicError = error instanceof Error ? error.message : 'Unknown simulation failure'; performanceInterrupted = true; console.error('Fantasia simulation stopped', error); pause('logic'); break;
          }
          updateTimes.push(performance.now() - before); if (updateTimes.length > 7200) updateTimes.shift();
          accumulator = Math.max(0, accumulator - CAMPAIGN_DT); first = false; pendingLoop = false; pendingBomb = false;
          if (state.activeTicks === CAMPAIGN_LIMIT_TICKS - 7200) announce('作戦期限まで、あと2分', 5, 3);
          if (state.activeTicks === CAMPAIGN_LIMIT_TICKS - 1800) announce('作戦期限まで、あと30秒', 5, 4);
        }
        audio.update(player.speed); if (state.resultSnapshot) finish();
      }
    }
  }
  if (screen === 'paused') {
    el<HTMLButtonElement>('resume').disabled = contextLost || !!fatalLogicError || renderStatus === 'stalled' || renderStatus === 'failed'; el('pause-reload').hidden = renderStatus !== 'failed' && !fatalLogicError;
    if (pauseReasons.has('render') && renderStatus === 'ready') el('pause-reason').textContent = '描画が復帰しました。操作して再開できます。この出撃は最速記録には保存しません';
  }
  updateHUD();
  // A paused scene drains its existing fence without replenishing GPU work.
  // Check the current screen here: this frame may just have entered safety pause.
  // Keep rAF/polling and DOM recovery controls alive; resize/context restoration
  // may clear the canvas, but drawing waits for deliberate Resume/Home/Restart.
  if (scene && !contextLost && screen !== 'paused') {
    try {
      scene.setOverlayVisible(screen === 'playing'); scene.render(state, player, state.mode, screen === 'playing' ? dt : 0);
      if (scene.diagnostics().queue.status === 'failed') {
        renderStatus = 'failed'; if (screen === 'home') preparationFailed(new Error('GPU frame completion unavailable')); else if (screen === 'playing') { performanceInterrupted = true; pause('render-failed'); }
      }
    } catch (error) {
      if (screen === 'home') preparationFailed(error); else { console.error('Fantasia renderer failed', error); renderStatus = 'failed'; performanceInterrupted = true; pause('render-failed'); }
    }
  }
}
for (const id of ['start', 'start-retry', 'retry', 'pause-restart']) el(id).addEventListener('click', begin);
for (const id of ['start-cancel', 'result-home', 'pause-home']) el(id).addEventListener('click', home);
el('pause').addEventListener('click', () => pause('manual')); el('resume').addEventListener('click', resume);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause('hidden'); else { clearInput(); if (screen === 'preparing') syncStartPreparation(); } }); window.addEventListener('blur', () => pause('blur'));
document.addEventListener('keydown', event => {
  if (settings.isOpen || rules?.isOpen) return;
  // Detail browsing owns native navigation even when a user bound that key to pause.
  if (event.code !== 'Escape' && event.target instanceof HTMLElement && event.target.closest('#campaign-hud-details')) return;
  if (keyboardSettings.matchesPause(event)) { event.preventDefault(); if (screen === 'playing') pause('manual'); else if (screen === 'paused') resume(); }
  if (event.key === 'Tab' && screen === 'paused') {
    const items = Array.from(el('pause-screen').querySelectorAll<HTMLElement>('button:not([hidden]):not(:disabled), summary')).filter(item => item.offsetParent !== null);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); } else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0]?.focus(); }
  }
});
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault(); contextLost = true; renderStatus = 'failed';
  if (screen === 'preparing') { startPreparation.interrupt('context-lost'); clearInput(); syncStartPreparation(); }
  else { pause('context'); if (screen === 'home' && graphicsReady) syncStartPreparation(); }
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false; clearInput(); scene?.resetRenderQueue(); renderStatus = 'ready'; el<HTMLButtonElement>('resume').disabled = !!fatalLogicError; el('pause-reason').textContent = '描画が復帰しました。操作して再開できます';
  if (graphicsReady && (screen === 'preparing' || screen === 'home')) syncStartPreparation();
});
function resize() { pause('resize'); scene?.resize(); }
window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize);
window.addEventListener('pageshow', event => { clearInput(); if (event.persisted) pause('restored'); });
let preparationGeneration = 0;
function preparationFailed(error: unknown) {
  preparationGeneration++; startPreparation.cancel(); graphicsReady = false; cancelAnimationFrame(frameId); scene?.dispose(); scene = null;
  el<HTMLButtonElement>('start').disabled = true; el('start').textContent = '出撃の準備ができませんでした'; el('startup-error').hidden = false;
  el('startup-error').textContent = '3D画面の準備が完了しませんでした。再読み込みしてお試しください'; el('reload').hidden = false; console.error('Fantasia renderer preparation failed', error);
}
for (const id of ['reload', 'pause-reload']) el(id).addEventListener('click', () => location.reload());
try {
  scene = new CampaignScene(canvas, overlay); updateHUD(); scene.setOverlayVisible(false); scene.render(state, player, state.mode);
  const attempt = ++preparationGeneration; let timeout: ReturnType<typeof setTimeout>;
  void Promise.race([scene.prepare(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Renderer preparation timed out')), 15000); })])
    .then(() => {
      if (disposed || attempt !== preparationGeneration) return; if (contextLost) throw new Error('Rendering context was lost while preparing');
      graphicsReady = true; frameId = requestAnimationFrame(frame); el<HTMLButtonElement>('start').disabled = false; el('start').innerHTML = '出撃する <span aria-hidden="true">↗</span>';
    }).catch(error => { if (!disposed && attempt === preparationGeneration) preparationFailed(error); }).finally(() => clearTimeout(timeout));
} catch (error) { preparationFailed(error); }

// Removed by production builds. Observation cannot rewrite a run or inject results.
if (import.meta.env.DEV) {
  Object.defineProperty(window, '__fantasiaReadState', {
    value: (history: boolean | 'audit' = true) => JSON.parse(JSON.stringify(history === 'audit'
      ? { mode: state.mode, seed: state.seed, rulesVersion: state.rulesVersion, mapVersion: state.mapVersion, startHeading: state.startHeading, entries: inputAudit, dropped: inputAuditDropped }
      : {
        phase: screen === 'preparing' ? 'preparing' : screen === 'home' ? 'ready' : screen === 'paused' ? 'paused' : screen === 'result' ? 'ended' : state.status === 'respawning' ? 'respawning' : 'playing',
        screen, startPreparation: startPreparation.snapshot(), mode: state.mode, selectedMode, status: state.status, graphicsReady, tick: state.simTick, elapsed: state.activeTicks / 60, activeTicks: state.activeTicks,
        player, campaignPlayer: state.player, campaign: campaign.snapshot(), sites: state.sites, armies: state.armies, actors: state.actors, projectiles: state.projectiles.length, result: state.resultSnapshot,
        bombGuide: bombPrediction, respawnRemaining, controlsInput: controls.peek(), settingsOpen: settings.isOpen, rulesOpen: rules?.isOpen ?? false,
        render: scene?.diagnostics(), renderStatus, lastFrameGap, lastInterruption, pauseReasons: [...pauseReasons], pauseCount, performanceInterrupted, fatalLogicError,
        audio: { enabled: audio.enabled, active: audio.active, failed: audio.failed, voices: audio.activeEffectVoiceCount, sources: audio.activeEffectSourceCount },
        frameIntervals: history ? frameIntervals : undefined, updateTimes: history ? updateTimes : undefined,
      })), configurable: true,
  });
}
window.addEventListener('pagehide', event => {
  pause('hidden'); if (event.persisted || disposed) return; disposed = true; preparationGeneration++; startPreparation.dispose(); cancelAnimationFrame(frameId);
  controls.dispose(); settings.dispose(); rules?.dispose(); unsubscribeKeyboard(); unsubscribePresentation(); inputPresentation.dispose(); audio.dispose(); scene?.dispose(); campaign.dispose();
});
