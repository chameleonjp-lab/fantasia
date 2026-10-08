// Inserted into src/main.ts only by scripts/vite.ui-only-plugin.mjs.
if (import.meta.env.DEV && location.pathname === '/__ui-only') {
  function uiOnlyCanvas() {
    if (!scene) throw new Error('UI-only canvas host is unavailable');
    return scene.diagnostics(player, state.mode);
  }

  function uiOnlyLayout() {
    return uiOnlyCanvas().hudLayout;
  }

  function uiOnlyPaint() {
    if (screen !== 'playing' || !['running', 'respawning'].includes(state.status)) throw new Error('UI-only paint requires a fixed HUD state');
    scene.setOverlayVisible(true);
    if (!scene.render(state, player, state.mode)) throw new Error('UI-only Canvas2D painter did not render');
    return uiOnlyCanvas();
  }

  function uiOnlyReset() {
    home();
    return { screen, mode: state.mode };
  }

  function uiOnlyHud(mode, alert) {
    if (mode !== 'easy' && mode !== 'normal') throw new Error(`Unknown UI-only mode: ${mode}`);
    selectedMode = mode;
    resetCampaign();
    syncMode();
    state.status = 'running';
    state.activeTicks = 240;
    state.simTick = 240;
    state.sites.forEach((site, index) => {
      site.owner = ['friendly', 'neutral', 'enemy', 'friendly', 'enemy', 'neutral', 'friendly'][index];
      site.progress = (index + 1) * 5000;
      site.captureProgress = site.progress / 600;
      site.contested = index === 2 || index === 5;
      site.challenger = site.contested ? (index === 2 ? 'friendly' : 'enemy') : null;
    });
    const ground = terrainHeight(0, 0);
    const position = alert === 'outside' ? { x: 2250, y: 300, z: 0 }
      : alert === 'low' ? { x: 0, y: ground + 24, z: 0 } : { x: 0, y: ground + 150, z: 0 };
    player.position.set(position.x, position.y, position.z);
    state.player.position = { ...position };
    state.player.bombs = 0; // Make the actual painter skip its predictive bomb guide.
    player.reloadTicksRemaining = 108;
    state.player.reloadUntilTick = state.simTick + player.reloadTicksRemaining;
    bombPrediction = null; bombPredictionTick = state.simTick; // updateHUD does not calculate flight prediction for this fixed state.
    state.player.protectionTicks = alert === 'protected' ? 180 : 0;
    state.player.boundaryTicks = alert === 'outside' ? 90 : 600;
    scene.setUiOnlyThreat(null);
    const turret = state.actors.find(actor => actor.team === 'enemy' && actor.class === 'turret');
    if (turret) {
      turret.phase = 'telegraph';
      turret.targetRef = { id: state.player.id, generation: state.player.generation };
      turret.fireAtTick = state.simTick + 90;
      turret.lockedAim = null;
      scene.setUiOnlyThreat(turret);
    }
    if (alert === 'respawn') { state.status = 'respawning'; respawnRemaining = 2.4; }
    else state.status = 'running';
    setScreen('playing');
    announce('砲台の予告 · 陣地4 · 1.5秒', 5, 4);
    updateHUD();
    scene.setOverlayVisible(true);
    if (!scene.render(state, player, state.mode)) throw new Error('UI-only Canvas2D painter did not render');
    const rendered = uiOnlyCanvas();
    return { screen, mode: state.mode, layout: rendered.hudLayout, canvas: rendered, status: state.status };
  }

  function uiOnlyPause() {
    if (screen !== 'playing') throw new Error('UI-only pause requires the fixed playing screen');
    pause('manual');
    updateHUD();
    return { screen, status: state.status };
  }

  function uiOnlyResult(reason) {
    const status = reason === 'victory' ? 'victory' : 'defeat';
    selectedMode = state.mode;
    resetCampaign();
    syncMode();
    state.status = status;
    state.activeTicks = 14832;
    state.simTick = 14832;
    bombPrediction = null; bombPredictionTick = state.simTick;
    state.respawnPenaltyTicks = 600;
    state.livesRemaining = reason === 'victory' ? 3 : 0;
    state.selfLosses = reason === '撃墜' ? 3 : 1;
    state.friendlyDamage = 34;
    state.friendlyKills = 1;
    state.friendlyLosses = 8;
    state.enemyKills = 21;
    state.sites.forEach((site, index) => { site.owner = reason === 'victory' ? 'friendly' : index < 3 ? 'friendly' : 'enemy'; });
    const score = reason === 'victory' ? 12420 : 3252;
    state.resultSnapshot = {
      status, reason: reason === 'victory' ? '全陣地占領' : reason,
      activeTicks: state.activeTicks, respawnPenaltyTicks: state.respawnPenaltyTicks,
      recordTicks: state.activeTicks + state.respawnPenaltyTicks,
      capturedSites: reason === 'victory' ? 7 : 3, livesRemaining: state.livesRemaining,
      score, breakdown: { capture: 3000, turrets: 600, success: reason === 'victory' ? 5000 : 0, speed: 320,
        friendlyDamage: -68, friendlyKills: -100, selfLoss: -500, total: score },
      friendlyLosses: state.friendlyLosses, enemyKills: state.enemyKills, selfLosses: state.selfLosses,
      mode: state.mode, seed: state.seed, rulesVersion: state.rulesVersion, mapVersion: state.mapVersion, startHeading: state.startHeading,
    };
    pauseCount = 2;
    performanceInterrupted = false;
    setScreen('playing');
    finish();
    updateHUD();
    return { screen, status, reason };
  }

  function uiOnlyStartupError() {
    home();
    preparationFailed(new Error('UI-only startup failure fixture'));
    return { graphicsReady, startupError: document.getElementById('startup-error')?.textContent };
  }

  Object.defineProperty(window, '__fantasiaUiOnlyTest', {
    value: Object.freeze({ reset: uiOnlyReset, hud: uiOnlyHud, paint: uiOnlyPaint, canvas: uiOnlyCanvas,
      pause: uiOnlyPause, result: uiOnlyResult, startupError: uiOnlyStartupError, layout: uiOnlyLayout }),
    configurable: false, enumerable: false, writable: false,
  });
}
