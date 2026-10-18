// Inserted into src/main.ts only by scripts/vite.ui-only-plugin.mjs.
if (import.meta.env.DEV && location.pathname === '/__ui-only') {
  function uiOnlyCanvas() {
    if (!scene) throw new Error('UI-only canvas host is unavailable');
    return scene.diagnostics(player, state.mode);
  }

  function uiOnlyLayout() {
    return uiOnlyCanvas().hudLayout;
  }

  function uiOnlyLayoutEvidence() {
    const canvas = uiOnlyCanvas();
    const owner = scene?.hudLayout;
    return {
      searchInput: owner?.measurement ?? null,
      sight: canvas.sight,
      layout: owner?.diagnostics?.() ?? canvas.hudLayout,
    };
  }

  function uiOnlyPaint() {
    if (screen !== 'playing' || !['running', 'respawning'].includes(state.status)) {
      throw new Error(`UI-only paint requires a fixed HUD state: screen=${screen}; status=${state.status}; pauseReasons=${[...pauseReasons].join(',')}`);
    }
    scene.setOverlayVisible(true);
    if (!scene.render(state, player, state.mode)) throw new Error('UI-only Canvas2D painter did not render');
    return uiOnlyCanvas();
  }

  function uiOnlyReset() {
    home();
    return { screen, mode: state.mode };
  }

  function uiOnlyHud(mode, alert, fixturePriority = 0) {
    if (mode !== 'easy' && mode !== 'normal') throw new Error(`Unknown UI-only mode: ${mode}`);
    selectedMode = mode;
    resetCampaign();
    syncMode();
    if (alert === 'reachable-reload-loss' || alert === 'reachable-controls-ready') {
      if (mode !== 'normal') throw new Error('Reachable reload-loss requires Normal controls');
      // Actual flight inputs and campaign reducers from a standard new run.
      // No actor/site/ammo/position/status writes and no synthetic announcement.
      // This is input-equation reachability, not native browser input E2E.
      announcementUntil = 0; announcementPriority = 0; el('announcement').textContent = '';
      scene.setUiOnlyThreat(null);
      const input = { turn: 0, climb: 0, accelerate: false, brake: false, fire: false, bomb: false, loop: false,
        viewAspect: window.innerWidth / window.innerHeight, steeringRevision: 0 };
      const path = []; let steps = 0;
      const step = patch => {
        campaign.step(flight.step(state, { ...input, ...patch })); flight.sync(state); handleEvents(state.events); steps++;
      };
      while (state.status === 'running' && player.reloadTicksRemaining <= 0 && steps < 1000) step({ fire: true });
      path.push({ action: 'fire', steps, tick: state.simTick, reloadTicksRemaining: player.reloadTicksRemaining });
      if (alert === 'reachable-controls-ready') {
        if (state.status !== 'running' || player.reloadTicksRemaining <= 0) throw new Error('Reachable controls preparation failed');
        setScreen('playing'); updateHUD(); scene.setOverlayVisible(true); scene.render(state, player, state.mode);
        return { status: state.status, fixtureKind: 'input-equations-reachable-controls', path };
      }
      const fireSteps = steps;
      while (state.status === 'running' && steps < 1600) step({ climb: -1 });
      path.push({ action: 'descend', steps: steps - fireSteps, tick: state.simTick, reloadTicksRemaining: player.reloadTicksRemaining });
      if (state.status !== 'respawning' || player.reloadTicksRemaining <= 0 || !state.events.some(event => event.kind === 'selfLoss'))
        throw new Error('Input-equation path did not reach simultaneous reload and self-loss');
      respawnRemaining = 3;
      setScreen('playing'); updateHUD(); scene.setOverlayVisible(true);
      if (!scene.render(state, player, state.mode)) throw new Error('Reachable-state Canvas2D painter did not render');
      const rendered = uiOnlyCanvas();
      return { screen, mode: state.mode, layout: rendered.hudLayout, canvas: rendered, status: state.status,
        announcementPriority, announcementText: el('announcement').textContent, fixtureKind: 'input-equations-reachable-state',
        reachability: { seed: state.seed, nativeInput: false, stateOverrides: false, path, selfLossEvent: state.events.find(event => event.kind === 'selfLoss') } };
    }
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
    // Synthetic reload stress state still obeys authoritative ammo invariants.
    state.player.mg = 0; state.player.cannon = 0;
    state.player.reloadUntilTick = state.simTick + 108;
    bombPrediction = null; bombPredictionTick = state.simTick; // updateHUD does not calculate flight prediction for this fixed state.
    state.player.protectionTicks = 0;
    state.player.boundaryTicks = alert === 'outside' ? 90 : 600;
    scene.setUiOnlyThreat(null);
    const turret = state.actors.find(actor => actor.team === 'enemy' && actor.class === 'turret');
    if (turret && alert !== 'respawn' && alert !== 'protected') {
      turret.phase = 'telegraph';
      turret.targetRef = { id: state.player.id, generation: state.player.generation };
      turret.fireAtTick = state.simTick + 72;
      turret.lockedAim = null;
      scene.setUiOnlyThreat(turret);
    }
    if (alert === 'respawn' || alert === 'protected') {
      // Use the real loss/respawn reducers, rather than a status-only label.
      campaign.step({ playerPosition: { x: 0, y: ground, z: 0 } });
      if (state.status !== 'respawning') throw new Error('UI fixture failed to enter actual respawn');
      respawnRemaining = 2.4;
      if (alert === 'protected') { campaign.resumeRespawn(); respawnRemaining = 0; }
    }
    // One authoritative state feeds both the HUD and the renderer.
    flight.sync(state, true);
    setScreen('playing');
    announcementUntil = 0; announcementPriority = 0; el('announcement').textContent = '';
    // Lifecycle notices and threat notices describe this fixture's state.
    // Priority remains an explicit synthetic stress dimension, not a claim
    // that normal gameplay emits this exact combination or priority.
    const announcementText = alert === 'respawn' ? '自機喪失 · 復活すると記録時間に10秒加算'
      : alert === 'protected' ? '復活 · 2秒の保護中は自機も攻撃できません'
      : `砲台の予告 · 陣地${turret.laneId + 1} · ${((turret.fireAtTick - state.simTick) / 60).toFixed(1)}秒`;
    announce(announcementText, 5, fixturePriority);
    updateHUD();
    scene.setOverlayVisible(true);
    if (!scene.render(state, player, state.mode)) throw new Error('UI-only Canvas2D painter did not render');
    const rendered = uiOnlyCanvas();
    return { screen, mode: state.mode, layout: rendered.hudLayout, canvas: rendered, status: state.status, announcementPriority: fixturePriority, announcementText, fixtureKind: 'synthetic-hud-stress' };
  }

  // Browser-native presses can be held across the real consumeTick loss path.
  // Held presses are native; descent inputs and elapsed frame time are
  // adapter-controlled. Campaign state is never injected.
  function uiOnlyControlLifecycle(action) {
    if (action === 'lose') {
      if (screen !== 'playing' || state.status !== 'running') throw new Error('Loss transition requires an active run');
      const input = { turn: 0, climb: -1, accelerate: false, brake: false, fire: false, bomb: false, loop: false,
        viewAspect: window.innerWidth / window.innerHeight, steeringRevision: 0 };
      let steps = 0;
      while (state.status === 'running' && steps++ < 1000) consumeTick(input);
      if (state.status !== 'respawning') throw new Error('Descent did not reach a real loss');
      updateHUD(); uiOnlyPaint();
    } else if (action === 'elapsed') {
      // Exercise the production frame's frozen/pause and respawn/resume wiring.
      lastFrame = performance.now() - 3100; frame();
    } else if (action !== 'inspect') throw new Error(`Unknown control lifecycle action: ${action}`);
    return { screen, status: state.status, remaining: respawnRemaining, input: controls.peek(),
      pendingLoop, pendingBomb, sample: action === 'inspect' ? controls.sample(false) : null,
      stateOverrides: false, nativeHeldInput: true, controlledDescentInput: true, controlledFrameTime: true };
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
    value: Object.freeze({ reset: uiOnlyReset, hud: uiOnlyHud, paint: uiOnlyPaint, canvas: uiOnlyCanvas, evidence: uiOnlyLayoutEvidence,
      controlLifecycle: uiOnlyControlLifecycle, pause: uiOnlyPause, result: uiOnlyResult, startupError: uiOnlyStartupError, layout: uiOnlyLayout }),
    configurable: false, enumerable: false, writable: false,
  });
}
