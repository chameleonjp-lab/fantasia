import { test, expect } from '@playwright/test';
import { RealRendererDriver } from './real-driver';
import { titleFor } from './acceptance-cases';
import { runCase, inputAt, neutral, frozen, liveGeometry, cancelNativeCapture } from './acceptance-helpers';

const functional = (id: string, body: (d: RealRendererDriver) => Promise<void>) =>
  test(titleFor(id), async ({ page }, info) => { const d = new RealRendererDriver(page); await runCase(d, info, id, () => body(d)); });

functional('start', async d => {
  expect((await d.requireState('ready-before-start')).tick).toBe(0);
  await d.click('label:has(input[value="normal"])'); await d.click('#start');
  const cancelled = await d.requireState('selected-preparing'); expect(cancelled.phase).toBe('preparing'); expect(cancelled.tick).toBe(0);
  await d.page.keyboard.down('ArrowLeft'); await d.page.keyboard.down('z');
  await d.click('#start-cancel'); await d.page.keyboard.up('ArrowLeft'); await d.page.keyboard.up('z');
  for(let n=0;n<4;n++) await d.step();
  const home = await d.requireState('cancel-invalidates-preparation'); expect(home.phase).toBe('ready'); expect(home.tick).toBe(0);
  expect(home.runId).not.toBe(cancelled.runId);
  for(const mode of ['easy','normal'] as const) {
    await d.click(`label:has(input[value="${mode}"])`); await d.click('#start');
    await d.page.keyboard.down('ArrowRight'); await d.page.keyboard.down('z'); await d.page.keyboard.up('ArrowRight'); await d.page.keyboard.up('z');
    const started=await d.reachPlaying(); expect(started.mode).toBe(mode); expect(started.tick).toBe(0); expect(started.activeTicks).toBe(0);
    expect(started.render.calls).toBeGreaterThan(0); expect(started.render.triangles).toBeGreaterThan(0);
    const first=await d.nextTick(); expect(first.bombs).toBe(2); const input=await inputAt(d,first.tick-1); expect(input.turn).toBe(0); expect(input.bomb).toBe(false); await neutral(d);
    await d.home();
  }
});

for(const mode of ['normal','easy'] as const) functional(`controls-${mode}`, async d => {
  await d.start(mode);
  const initial = await d.full();
  await d.page.keyboard.down('ArrowRight'); await d.page.keyboard.down('ArrowUp');
  await d.page.keyboard.down('w'); await d.page.keyboard.down('Space');
  for(let n=0;n<3;n++) { const state=await d.nextTick(), input=await inputAt(d,state.tick-1);
    expect(input.turn).toBe(1); expect(input.climb).toBe(1); expect(input.accelerate).toBe(mode==='normal'); expect(input.fire).toBe(mode==='normal'); }
  const moved=await d.full(); expect(moved.player.position).not.toEqual(initial.player.position);
  // Mixed steering can legitimately lose speed to turn/climb drag; prove the
  // throttle's physical effect separately in matched fresh straight runs below.
  for(const key of ['ArrowRight','ArrowUp','w','Space']) await d.page.keyboard.up(key);
  let state=await d.nextTick(), input=await inputAt(d,state.tick-1);
  expect(input.turn).toBe(0); expect(input.climb).toBe(0); expect(input.accelerate).toBe(false); expect(input.fire).toBe(false);
  await d.page.keyboard.down('s'); state=await d.nextTick(); input=await inputAt(d,state.tick-1); expect(input.brake).toBe(mode==='normal'); await d.page.keyboard.up('s');
  // Real mouse capture on the unobscured centre of the flight canvas.
  const p=await d.point('#flight'); await d.page.mouse.move(p.x,p.y); await d.page.mouse.down(); await d.page.mouse.move(p.x+30,p.y-20);
  state=await d.nextTick(); input=await inputAt(d,state.tick-1); expect(input.turn).toBeGreaterThan(0); expect(input.climb).toBeGreaterThan(0);
  await d.page.mouse.up(); state=await d.nextTick(); input=await inputAt(d,state.tick-1); expect(input.turn).toBe(0); expect(input.climb).toBe(0); await neutral(d);
  if(mode==='easy') await expect(d.page.locator('#normal-controls')).toBeHidden();
  else {
    const outcomes:Array<{action:string;before:number;after:number;ticks:number}>=[];
    for(const action of ['neutral','accelerate','brake'] as const) {
      await d.home();await d.start('normal');const before=await d.full();
      const key=action==='accelerate'?'w':action==='brake'?'s':null;
      if(key)await d.page.keyboard.down(key);
      for(let n=0;n<3;n++) {const tick=await d.nextTick(),sample=await inputAt(d,tick.tick-1);
        expect(sample.turn).toBe(0);expect(sample.climb).toBe(0);expect(sample.fire).toBe(false);
        expect(sample.accelerate).toBe(action==='accelerate');expect(sample.brake).toBe(action==='brake');}
      const after=await d.full();if(key)await d.page.keyboard.up(key);
      outcomes.push({action,before:before.player.speed,after:after.player.speed,ticks:after.tick});
    }
    d.evidence.push({label:'isolated-throttle-physical-effects',outcomes});
    expect(outcomes.map(o=>o.before)).toEqual([initial.player.speed,initial.player.speed,initial.player.speed]);
    expect(outcomes.map(o=>o.ticks)).toEqual([3,3,3]);
    expect(outcomes[1].after).toBeGreaterThan(outcomes[0].after);expect(outcomes[2].after).toBeLessThan(outcomes[0].after);
    const released=await d.nextTick(),sample=await inputAt(d,released.tick-1);expect(sample.accelerate).toBe(false);expect(sample.brake).toBe(false);await neutral(d);
  }
});

for(const mode of ['normal','easy'] as const) functional(`edges-${mode}`, async d => {
  await d.start(mode);
  // Held/repeated native keydown must consume one edge, with a consecutive false boundary.
  await d.page.keyboard.down('z'); let state=await d.nextTick(); expect(state.bombs).toBe(1); expect((await inputAt(d,state.tick-1)).bomb).toBe(true);
  await d.page.keyboard.down('z'); state=await d.nextTick(); expect(state.bombs).toBe(1); expect((await inputAt(d,state.tick-1)).bomb).toBe(false);
  await d.page.keyboard.up('z');
  await cancelNativeCapture(d,'bomb');state=await d.nextTick();
  expect(state.bombs).toBe(1); expect((await inputAt(d,state.tick-1)).bomb).toBe(false);
  await d.tap('#bomb'); state=await d.nextTick(); expect(state.bombs).toBe(0); expect((await inputAt(d,state.tick-1)).bomb).toBe(true);
  state=await d.nextTick(); expect(state.bombs).toBe(0); expect((await inputAt(d,state.tick-1)).bomb).toBe(false);
  await cancelNativeCapture(d,'loop');state=await d.nextTick();expect((await inputAt(d,state.tick-1)).loop).toBe(false);expect((await d.full()).player.loopProgress).toBe(0);
  await d.tap('#loop'); state=await d.nextTick(); expect((await inputAt(d,state.tick-1)).loop).toBe(true);
  const loop=await d.full(); expect(loop.player.loopProgress).toBeGreaterThan(0);
  state=await d.nextTick(); expect((await inputAt(d,state.tick-1)).loop).toBe(false);
  // A fresh run avoids a vacuous repeat check while the prior touch loop is cooling down.
  await d.home(); await d.start(mode); expect((await d.full()).player.loopProgress).toBe(0);
  await d.page.keyboard.down('l'); state=await d.nextTick(); expect((await inputAt(d,state.tick-1)).loop).toBe(true);
  expect((await d.full()).player.loopProgress).toBeGreaterThan(0);
  await d.page.keyboard.down('l'); state=await d.nextTick(); expect((await inputAt(d,state.tick-1)).loop).toBe(false);
  await d.page.keyboard.up('l'); state=await d.nextTick(); expect((await inputAt(d,state.tick-1)).loop).toBe(false); await neutral(d);
});

functional('lifecycle', async d => {
  const original=await d.start('normal'); await d.page.keyboard.down('ArrowLeft'); await d.page.keyboard.down('Space'); await d.nextTick();
  await d.click('#pause'); const pause=await frozen(d); expect(pause.pauseReasons).toEqual(['manual']);
  await d.page.keyboard.up('ArrowLeft'); await d.page.keyboard.up('Space'); await d.click('#resume');
  const resumed=await d.nextTick(); expect(resumed.tick).toBe(pause.tick+1); expect(resumed.runId).toBe(original.runId);
  const input=await inputAt(d,resumed.tick-1); expect(input.turn).toBe(0); expect(input.fire).toBe(false);
  await d.click('#pause'); await d.click('#pause-restart'); const restarted=await d.reachPlaying();
  expect(restarted.runId).not.toBe(original.runId); expect(restarted.bombs).toBe(2); expect(restarted.tick).toBe(0); await neutral(d);
  await d.home(); const home=await d.requireState('home-is-new-run'); expect(home.tick).toBe(0); expect(home.runId).not.toBe(restarted.runId);
  const easy=await d.start('easy'); expect(easy.mode).toBe('easy'); expect(easy.runId).not.toBe(home.runId); await neutral(d);
});

async function keyboardTab(d:RealRendererDriver) { await d.click('#home-controls'); await d.click('#control-editor-keyboard'); await expect(d.page.locator('#control-keyboard-editor')).toBeVisible(); }
async function bindBomb(d:RealRendererDriver,key:string) { await d.click('[data-key-action="bomb"]'); await d.key(key); }
functional('settings', async d => {
  await keyboardTab(d); const original=await d.page.locator('[data-key-action="bomb"]').textContent();
  await bindBomb(d,'ArrowLeft'); await expect(d.page.locator('#keyboard-capture-note')).toContainText('左旋回');
  await expect(d.page.locator('[data-key-action="bomb"]')).toHaveAttribute('aria-pressed','true');
  await d.click('#keyboard-capture-cancel'); await expect(d.page.locator('[data-key-action="bomb"]')).toHaveText(original!); await bindBomb(d,'x'); await d.click('#control-cancel'); await d.step();
  await expect(d.page.locator('#home-controls')).toBeFocused();
  await keyboardTab(d); await expect(d.page.locator('[data-key-action="bomb"]')).toHaveText(original!);
  await bindBomb(d,'x'); await d.click('#control-save'); await d.step(); await expect(d.page.locator('#home-controls')).toBeFocused();
  const stored=await d.page.evaluate(()=>JSON.parse(localStorage.getItem('fantasia-keyboard-v1')!)); expect(stored.bindings.bomb).toBe('KeyX');
  await d.click('#home-controls'); await d.click('#control-editor-touch'); await expect(d.page.locator('#control-touch-editor')).toBeVisible();
  const before=await d.page.locator('#control-size').inputValue(); await d.page.locator('#control-size').focus(); await d.key('ArrowRight');
  expect(await d.page.locator('#control-size').inputValue()).not.toBe(before); await d.click('#control-cancel'); await d.step();
  await d.click('#home-controls'); await d.click('#control-editor-touch'); expect(await d.page.locator('#control-size').inputValue()).toBe(before);
  // Focus stays inside the actual modal even at both ends of keyboard traversal.
  await d.click('#control-close'); await d.step(); await expect(d.page.locator('#home-controls')).toBeFocused();
  await d.click('#home-controls'); await d.page.locator('#control-close').focus(); await d.key('Shift+Tab');
  expect(await d.page.evaluate(()=>document.activeElement?.closest('#control-settings')!==null)).toBe(true);
  await d.key('Tab'); expect(await d.page.evaluate(()=>document.activeElement?.closest('#control-settings')!==null)).toBe(true);
  await d.click('#control-close'); await d.step(); await d.start('normal'); await d.key('z'); expect((await d.nextTick()).bombs).toBe(2);
  await d.key('x'); expect((await d.nextTick()).bombs).toBe(1);
});

functional('storage-failure', async d => {
  await keyboardTab(d); await bindBomb(d,'x');
  await d.page.evaluate(()=>{ const old=Storage.prototype.setItem; (window as any).__restoreAcceptanceStorage=()=>{Storage.prototype.setItem=old;}; Storage.prototype.setItem=function(){throw new DOMException('Acceptance storage fault','QuotaExceededError');}; });
  try {
    await d.click('#control-save'); await expect(d.page.locator('#control-settings')).toBeVisible();
    await expect(d.page.locator('#control-storage-note')).toContainText('保存できません');
    expect(await d.page.evaluate(()=>localStorage.getItem('fantasia-keyboard-v1'))).toBeNull();
    await d.click('#control-cancel'); await d.step(); await d.start('normal');
    await d.key('x'); expect((await d.nextTick()).bombs).toBe(2); await d.key('z'); expect((await d.nextTick()).bombs).toBe(1);
  } finally { await d.page.evaluate(()=>(window as any).__restoreAcceptanceStorage()); }
});


functional('storage-session',async d=>{
  await keyboardTab(d);await bindBomb(d,'x');
  await d.page.evaluate(()=>{const original=Storage.prototype.setItem;(window as any).__restoreAcceptanceStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(){throw new DOMException('Explicit session-only test','QuotaExceededError');};});
  try {
    await d.click('#control-save');await expect(d.page.locator('#control-save')).toHaveText('今回だけ使う');
    await d.click('#control-save');await d.step();await expect(d.page.locator('#control-settings')).toBeHidden();
    expect(await d.page.evaluate(()=>localStorage.getItem('fantasia-keyboard-v1'))).toBeNull();
    await d.start('normal');await d.key('z');expect((await d.nextTick()).bombs).toBe(2);await d.key('x');expect((await d.nextTick()).bombs).toBe(1);
  } finally {await d.page.evaluate(()=>(window as any).__restoreAcceptanceStorage());}
  await d.page.reload({waitUntil:'load'});await d.waitState('session-reload-ready',s=>s.graphicsReady&&s.phase==='ready',80);
  await d.start('normal');await d.key('x');expect((await d.nextTick()).bombs).toBe(2);await d.key('z');expect((await d.nextTick()).bombs).toBe(1);
});
functional('storage-future-rollback',async d=>{
  const future='{"version":99,"keep":"future-owned-data"}';
  await d.page.evaluate(raw=>localStorage.setItem('fantasia-keyboard-v1',raw),future);
  await keyboardTab(d);await bindBomb(d,'x');await d.click('#control-save');
  await expect(d.page.locator('#control-storage-note')).toContainText('保存できません');
  expect(await d.page.evaluate(()=>localStorage.getItem('fantasia-keyboard-v1'))).toBe(future);
  await d.click('#control-cancel');await d.step();
  // Test-context fixture replacement; no user storage or runtime is changed.
  await d.page.evaluate(()=>localStorage.removeItem('fantasia-keyboard-v1'));
  await d.click('#home-controls');await d.click('#control-editor-touch');await d.page.locator('#control-mode').selectOption('normal');
  await d.page.locator('#control-size').focus();await d.key('ArrowRight');
  await d.click('#control-editor-keyboard');await bindBomb(d,'x');
  const prior=await d.page.evaluate(()=>({normal:localStorage.getItem('fantasia-controls-v2'),easy:localStorage.getItem('fantasia-controls-easy-v2'),keys:localStorage.getItem('fantasia-keyboard-v1'),recovery:localStorage.getItem('fantasia-controls-recovery-v1'),legacyNormal:localStorage.getItem('fantasia-controls-v1'),legacyEasy:localStorage.getItem('fantasia-controls-easy-v1')}));
  await d.page.evaluate(()=>{const original=Storage.prototype.setItem;(window as any).__restoreAcceptanceStorage=()=>{Storage.prototype.setItem=original;};(window as any).__acceptanceStorageWrites=[];Storage.prototype.setItem=function(key,value){(window as any).__acceptanceStorageWrites.push(key);if(key==='fantasia-keyboard-v1')throw new DOMException('Explicit second-write failure','QuotaExceededError');return original.call(this,key,value);};});
  try {
    await d.click('#control-save');await expect(d.page.locator('#control-storage-note')).toContainText('保存できません');
    const writes=await d.page.evaluate(()=>(window as any).__acceptanceStorageWrites);expect(writes).toEqual(['fantasia-controls-recovery-v1','fantasia-controls-v2','fantasia-keyboard-v1']);
    expect(await d.page.evaluate(()=>({normal:localStorage.getItem('fantasia-controls-v2'),easy:localStorage.getItem('fantasia-controls-easy-v2'),keys:localStorage.getItem('fantasia-keyboard-v1'),recovery:localStorage.getItem('fantasia-controls-recovery-v1'),legacyNormal:localStorage.getItem('fantasia-controls-v1'),legacyEasy:localStorage.getItem('fantasia-controls-easy-v1')}))).toEqual(prior);
    d.evidence.push({label:'partial-write-rollback',writes,prior});await d.click('#control-cancel');await d.step();
  }finally{await d.page.evaluate(()=>(window as any).__restoreAcceptanceStorage());}
});

functional('resize-context', async d => {
  await d.start('normal'); await d.page.keyboard.down('ArrowRight'); await d.nextTick();
  await d.page.setViewportSize({width:852,height:393});
  const resized=await d.waitState('actual-resize-pause',s=>s.phase==='paused'); expect(resized.pauseReasons).toContain('resize');
  await frozen(d); await d.page.keyboard.up('ArrowRight'); await d.click('#resume'); await d.nextTick();
  await d.drainNativeGpu();
  await d.page.evaluate(()=>{ const gl=document.querySelector<HTMLCanvasElement>('#flight')!.getContext('webgl2')!; const ext=gl.getExtension('WEBGL_lose_context'); if(!ext) throw new Error('Native WEBGL_lose_context unavailable'); (window as any).__acceptanceContextExt=ext; ext.loseContext(); });
  await expect.poll(async()=> (await d.read())?.pauseReasons, {timeout:3000}).toContain('context');
  const lost=await d.read(); expect(lost?.phase).toBe('paused'); await expect(d.page.locator('#resume')).toBeDisabled(); await neutral(d);
  // No test fences can be created in a lost context. Advance only the clock; do not touch app queue.
  await d.page.clock.runFor(48); const lostAfter=await d.read(); expect(lostAfter?.tick).toBe(lost?.tick); expect(lostAfter?.queue.submittedCount).toBe(lost?.queue.submittedCount);
  await d.page.evaluate(()=>(window as any).__acceptanceContextExt.restoreContext());
  await expect.poll(async()=>d.page.evaluate(()=>document.querySelector<HTMLCanvasElement>('#flight')!.getContext('webgl2')!.isContextLost()),{timeout:5000}).toBe(false);
  await expect(d.page.locator('#resume')).toBeEnabled(); const recovered=await frozen(d);
  expect(recovered.tick).toBe(lost?.tick); await d.click('#resume'); const resumed=await d.nextTick(); expect(resumed.tick).toBe(recovered.tick+1);
  expect(resumed.pauseReasons).toEqual([]); expect(resumed.render.calls).toBeGreaterThan(0);
  d.evidence.push({label:'native-context-loss-and-restoration',lost,lostAfter,recovered,resumed});
});

functional('frame-gap', async d => {
  await d.start('normal'); const before=await d.nextTick(); await d.drainNativeGpu();
  await d.page.clock.fastForward(400); const stopped=await d.requireState('injected-frame-gap-stop');
  expect(stopped.phase).toBe('paused'); expect(stopped.pauseReasons).toEqual(['frame']); expect(stopped.tick).toBe(before.tick);
  const full=await d.full(); expect(full.performanceInterrupted).toBe(true); expect(full.lastInterruption.reason).toBe('frame'); expect(full.lastFrameGap).toBeGreaterThan(.25);
  expect(stopped.queue.submittedCount).toBe(before.queue.submittedCount); await frozen(d);
  await d.click('#resume'); const resumed=await d.nextTick(); expect(resumed.tick).toBe(before.tick+1); expect((await d.full()).performanceInterrupted).toBe(true);
  d.evidence.push({label:'record-ineligibility-flag',performanceInterrupted:true,meaning:'ordinary fastest-record path receives this flag; no fabricated victory or record'});
});

functional('render-fault', async d => {
  await d.start('normal'); await d.nextTick(); await d.drainNativeGpu();
  await d.page.evaluate(()=>{ const ctx=document.querySelector<HTMLCanvasElement>('#markers')!.getContext('2d')!, original=ctx.clearRect;
    (window as any).__restoreAcceptanceRender=()=>{ctx.clearRect=original;}; ctx.clearRect=function(){ctx.clearRect=original; throw new Error('Explicit acceptance Canvas2D render fault');}; });
  try {
    await d.step(); const stopped=await d.read(); expect(stopped?.phase).toBe('paused'); expect(stopped?.pauseReasons).toEqual(['render-failed']); expect(stopped?.renderStatus).toBe('failed');
    expect((await d.full()).performanceInterrupted).toBe(true); await expect(d.page.locator('#resume')).toBeDisabled(); await expect(d.page.locator('#pause-reload')).toBeVisible();
    for(let n=0;n<3;n++) await d.step(); const after=await d.read(); expect(after?.tick).toBe(stopped?.tick); expect(after?.queue.submittedCount).toBe(stopped?.queue.submittedCount);
    await neutral(d); d.evidence.push({label:'explicit-render-fault-observations',stopped,after,recordIneligible:(await d.full()).performanceInterrupted});
  } finally { await d.page.evaluate(()=>(window as any).__restoreAcceptanceRender()); }
});

const sizes = [
  {id:'desktop-dpr1',width:1440,height:900,dpr:1}, {id:'portrait-dpr3',width:393,height:852,dpr:3},
  {id:'landscape-dpr3',width:852,height:393,dpr:3}, {id:'small-portrait-dpr2',width:320,height:568,dpr:2}, {id:'small-landscape-dpr2',width:568,height:320,dpr:2},
];
for(const size of sizes) test.describe(size.id,()=>{
  test.use({viewport:{width:size.width,height:size.height},deviceScaleFactor:size.dpr,hasTouch:true});
  for(const mode of ['normal','easy'] as const) test(titleFor(`hud-${size.id}-${mode}`),async({page},info)=>{
    const d=new RealRendererDriver(page); await runCase(d,info,`hud-${size.id}-${mode}`,async()=>{
      await d.start(mode); await d.nextTick(); const measured=await liveGeometry(d); expect(measured.dom.dpr).toBe(size.dpr);
      const full=await d.full(); expect(full.render.pixelRatio).toBeLessThanOrEqual(1.5);
      // Live screenshot precedes any pause; screenshot does not substitute for geometry assertions.
      await info.attach('live-hud', {contentType:'image/png',body:await page.screenshot()}); expect((await d.requireState('after-live-capture')).phase).toBe('playing');
    });
  });
});

for(const size of sizes) test.describe(`text-200-${size.id}`,()=>{
  test.use({viewport:{width:size.width,height:size.height},deviceScaleFactor:size.dpr,hasTouch:true});
  for(const mode of ['normal','easy'] as const) functional(`text-200-${size.id}-${mode}`, async d => {
  await d.start(mode); await d.nextTick(); const before=await d.full();
  // Measure every baseline font first; changing parent fonts must not compound child scaling.
  const enlargement=await d.page.evaluate(()=>{
    const nodes=[...document.querySelectorAll<HTMLElement>('#app *')].filter(node=>!['CANVAS','SCRIPT','STYLE'].includes(node.tagName));
    const sizes=nodes.map(node=>({node,size:parseFloat(getComputedStyle(node).fontSize)}));
    for(const {node,size} of sizes) node.style.setProperty('font-size',`${size*2}px`,'important');
    return sizes.map(({node,size})=>({id:node.id || node.tagName,before:size,after:parseFloat(getComputedStyle(node).fontSize)}));
  });
  const stationary=await d.full(); expect(stationary.tick).toBe(before.tick); expect(stationary.render.hudLayout.measurements).toBe(before.render.hudLayout.measurements);
  expect(enlargement.length).toBeGreaterThan(20); for(const font of enlargement) expect(font.after).toBeCloseTo(font.before*2,2);
  await d.nextTick(); const after=await d.full(); expect(after.render.hudLayout.measurements).toBeGreaterThan(before.render.hudLayout.measurements);
  d.evidence.push({label:'actual-200-percent-text',enlargement,beforeMeasurements:before.render.hudLayout.measurements,afterMeasurements:after.render.hudLayout.measurements,stationaryTick:stationary.tick});await liveGeometry(d);
  await d.click('#pause'); await d.click('#pause-controls'); await d.click('#control-editor-keyboard');
  await d.click('#control-save'); await d.step(); await expect(d.page.locator('#pause-controls')).toBeFocused();
  await d.click('#pause-controls'); await d.click('#control-editor-touch'); await d.click('#control-cancel'); await d.step();
  await d.click('#pause-controls'); await d.click('#control-close'); await d.step(); await expect(d.page.locator('#pause-controls')).toBeFocused(); await frozen(d);
  });
});

// Fresh Playwright context; NO clock installation or GPU pacing. This is a capability
// case with a specified recovery branch, never an uninterrupted/FPS certification.
test(titleFor('native-capability'),async({page},info)=>{
  const d=new RealRendererDriver(page); let outcome='failed', capabilityOutcome='unverified', backend:unknown;
  try {
    await page.goto('/'); await expect.poll(async()=>(await d.read())?.graphicsReady,{timeout:25000}).toBe(true); backend=await d.backend();
    const ready=await d.requireState('native-startup'); expect(ready.phase).toBe('ready'); expect(ready.tick).toBe(0);
    expect(ready.queue.completedCount).toBeGreaterThan(0); await d.click('label:has(input[value="easy"])'); await d.click('#start');
    await expect.poll(async()=>(await d.read())?.phase,{timeout:20000}).not.toBe('preparing');
    const started=await d.requireState('native-start-completed'); expect(['playing','paused']).toContain(started.phase);
    expect(started.render.calls).toBeGreaterThan(0); expect(started.render.triangles).toBeGreaterThan(0);
    // Observe a real later completed receipt or a narrowly specified safety stop.
    await expect.poll(async()=>{const s=await d.read();return !!s && (s.phase==='paused'||s.queue.completedCount>started.queue.completedCount);},{timeout:10000}).toBe(true);
    const observed=await d.requireState('native-receipt-or-safety');
    if(observed.phase==='paused') {
      expect(observed.pauseReasons.length).toBe(1); expect(['frame','render']).toContain(observed.pauseReasons[0]);
      expect((await d.full()).performanceInterrupted).toBe(true); expect(observed.fatalLogicError).toBeNull();
      await expect.poll(async()=>(await d.read())?.renderStatus,{timeout:10000}).toBe('ready');
      const drained=await d.requireState('native-safety-drained'); expect(drained.tick).toBe(observed.tick);
      await page.waitForTimeout(100); const stable=await d.requireState('native-paused-stable'); expect(stable.tick).toBe(drained.tick); expect(stable.queue.submittedCount).toBe(drained.queue.submittedCount);
      await d.click('#resume');
      // Exactly one explicit recovery, no retry loop. A second stop fails this capability case.
      await expect.poll(async()=>(await d.read())?.tick,{timeout:5000}).toBeGreaterThan(stable.tick);
      await expect.poll(async()=>{const s=await d.read(); if(s?.phase==='paused') throw new Error('Second native stop after the single explicit recovery'); return s?.queue.completedCount??0;},{timeout:5000}).toBeGreaterThan(stable.queue.completedCount);
      const recovered=await d.requireState('native-deliberate-recovery'); expect(recovered.queue.completedCount).toBeGreaterThan(stable.queue.completedCount); expect(recovered.phase).toBe('playing'); expect(recovered.pauseReasons).toEqual([]);
      capabilityOutcome='startup-frame-completion-and-one-explicit-safety-recovery';
    } else {
      expect(observed.phase).toBe('playing'); expect(observed.queue.completedCount).toBeGreaterThan(started.queue.completedCount); expect(observed.pauseReasons).toEqual([]);
      capabilityOutcome='startup-and-bounded-frame-completion';
    }
    expect(d.pageErrors).toEqual([]); outcome='passed';
  } finally {
    await info.attach('clean-acceptance-evidence',{contentType:'application/json',body:JSON.stringify({schemaVersion:1,id:'native-capability',category:10,
      classification:'ordinary-wall-clock-capability',outcome,capabilityOutcome,clockInstalled:false,runtimeMocked:false,rendererMocked:false,applicationQueueModified:false,
      physicalDeviceAcceptance:'unverified',performanceAcceptance:'not-measured',releaseReady:false,backend,pageErrors:d.pageErrors,observations:d.evidence},null,2)});
  }
});
