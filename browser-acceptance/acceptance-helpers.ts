import { expect, type TestInfo } from '@playwright/test';
import { RealRendererDriver } from './real-driver';
import { assertFreshGeometry, createVisibilityPredicate } from './geometry-contract';
import { assertCaptureCancelled, type CaptureEvent } from './capture-contract';
import { CASES } from './acceptance-cases';

export async function runCase(driver: RealRendererDriver, info: TestInfo, id: string, body: () => Promise<void>) {
  const row = CASES.find(row => row[0] === id)!;
  let outcome = 'failed', backend: unknown;
  try {
    await driver.boot(); backend = await driver.backend(); await body();
    expect(driver.pageErrors).toEqual([]); expect(driver.releasedFences).toBe(driver.createdFences);
    driver.evidence.push({ label: 'case-assertions-completed', id }); outcome = 'passed';
  } finally {
    await info.attach('clean-acceptance-evidence', { contentType: 'application/json', body: JSON.stringify({
      schemaVersion: 1, id, category: row[1], classification: 'controlled-clock-functional', outcome,
      runtimeMocked: false, rendererMocked: false, applicationQueueModified: false,
      faultInjection: id === 'render-fault' ? 'Canvas2D.clearRect throws once' : id === 'frame-gap' ? 'Playwright clock fastForward(400)' : ['storage-failure','storage-session','storage-future-rollback'].includes(String(id)) ? 'Storage.setItem throws' : null,
      physicalDeviceAcceptance: 'unverified', performanceAcceptance: 'not-measured', releaseReady: false,
      backend, steps: driver.budget.steps, ownedFencesCreated: driver.createdFences,
      ownedFencesReleased: driver.releasedFences, pageErrors: driver.pageErrors, observations: driver.evidence,
    }, null, 2) });
  }
}
export async function inputAt(driver: RealRendererDriver, tick: number) {
  const audit = await driver.audit(); expect(audit.dropped).toBe(0);
  const entries = audit.entries.filter((entry: any) => entry.tick <= tick);
  expect(entries.length).toBeGreaterThan(0);
  driver.evidence.push({ label: 'consumed-input', tick, audit });
  return entries.at(-1).input;
}
export async function neutral(driver: RealRendererDriver) {
  const state = await driver.full();
  expect(state.controlsInput.keys).toEqual([]); expect(state.controlsInput.steerPointer).toBeNull();
  expect(state.controlsInput.turn).toBe(0); expect(state.controlsInput.climb).toBe(0);
  for (const ids of Object.values(state.controlsInput.heldPointers)) expect(ids).toEqual([]);
}
export async function frozen(driver: RealRendererDriver, frames = 3) {
  const before = await driver.requireState('freeze-before'); expect(before.phase).toBe('paused');
  for (let n = 0; n < frames; n++) await driver.step();
  const after = await driver.requireState('freeze-after');
  expect(after.phase).toBe('paused'); expect(after.tick).toBe(before.tick);
  expect(after.activeTicks).toBe(before.activeTicks); expect(after.queue.submittedCount).toBe(before.queue.submittedCount);
  await neutral(driver); return after;
}
export async function liveGeometry(driver: RealRendererDriver) {
  const state = await driver.requireState('live-geometry'); expect(state.phase).toBe('playing');
  const full = await driver.full(), layout = full.render.hudLayout;
  const visibility=await driver.call('create test visibility predicate',()=>driver.page.evaluateHandle(createVisibilityPredicate));
  let dom;
  try { dom = await driver.call('collect current live DOM geometry',()=>driver.page.evaluate((visible) => {
    const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; };
    const canvas = rect(document.querySelector('#flight')!);
    const panels=[...document.querySelectorAll<HTMLElement>('.flight-data > *, .hud-top .time-block, #campaign-threat, #payload-status, #reload-status, #warning, #announcement, #respawn-status, #flight-tip')]
      .filter(node=>visible(node)&&(!node.matches('.hud-top .time-block')||(canvas.width<=360&&canvas.height>canvas.width)));
    const obstacles=[...document.querySelectorAll<HTMLElement>('.hud-top, #campaign-sites .campaign-site[data-site], #hud button')].filter(visible);
    const nodes=[...new Set([...panels,...obstacles])];
    const local=(node:HTMLElement)=>({id:node.id||node.className,...rect(node),x:rect(node).x-canvas.x,y:rect(node).y-canvas.y});
    return { canvas, viewport: {width:innerWidth,height:innerHeight}, sites:[...document.querySelectorAll('#campaign-sites .campaign-site[data-site]')].map(rect),
      panels:panels.map(local),obstacles:obstacles.map(local),
      nodes:nodes.map(node => ({id:node.id || node.className, button:node.tagName==='BUTTON', panel:panels.includes(node), scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,...rect(node)})),
      overlays: ['home','pause-screen','result'].map(id => ({id, hidden:document.getElementById(id)!.hidden})), dpr:devicePixelRatio };
  },visibility)); } finally {await visibility.dispose();}
  // Preserve independently collected current DOM even if the first assertion fails.
  driver.evidence.push({label:'live-dom-geometry-before-assertions',dom,layout});
  expect(layout.status).toBe('placed'); expect(layout.measurements).toBeGreaterThan(0);
  expect(full.render.sites).toBe(7); expect(full.render.calls).toBeGreaterThan(0); expect(full.render.triangles).toBeGreaterThan(0);
  // 0.75 CSS-pixel tolerance covers subpixel CSS rounding, never clipping or stale-size reuse.
  assertFreshGeometry(dom.panels, (layout.panels??[]).map((p:any)=>({...p.rect,id:p.id})), 'live panels');
  assertFreshGeometry(dom.obstacles, layout.obstacles.filter((r:any)=>!['aim-and-reload-ring','central-flight-lane'].includes(r.id)), 'live obstacles');
  expect(dom.sites).toHaveLength(7); expect(dom.overlays.every(item => item.hidden)).toBe(true);
  const boxes = [layout.radar.rect, ...(layout.panels ?? []).map((p:any) => p.rect), ...layout.obstacles,
    ...(layout.canvasLabels ?? []).filter((p:any) => p.status === 'placed').map((p:any) => p.rect)];
  const inside = (r:any) => { expect(Number.isFinite(r.x+r.y+r.width+r.height)).toBe(true); expect(r.width).toBeGreaterThan(0); expect(r.height).toBeGreaterThan(0);
    expect(r.x).toBeGreaterThanOrEqual(-1); expect(r.y).toBeGreaterThanOrEqual(-1);
    expect(r.x+r.width).toBeLessThanOrEqual(dom.canvas.width+1); expect(r.y+r.height).toBeLessThanOrEqual(dom.canvas.height+1); };
  for (const box of boxes) inside(box);
  for (const node of dom.nodes) {
    inside({...node,x:node.x-dom.canvas.x,y:node.y-dom.canvas.y});
    expect(node.x).toBeGreaterThanOrEqual(-1); expect(node.y).toBeGreaterThanOrEqual(-1);
    expect(node.x+node.width).toBeLessThanOrEqual(dom.viewport.width+1); expect(node.y+node.height).toBeLessThanOrEqual(dom.viewport.height+1);
    if(node.button||node.panel) { expect(node.scrollWidth).toBeLessThanOrEqual(node.clientWidth+1); expect(node.scrollHeight).toBeLessThanOrEqual(node.clientHeight+1); }
    if(node.button) { expect(node.width).toBeGreaterThanOrEqual(44); expect(node.height).toBeGreaterThanOrEqual(44); }
  }
  const overlap = (a:any,b:any) => Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>1 && Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>1;
  const sight = layout.obstacles.find((r:any) => r.id === 'aim-and-reload-ring'); expect(sight).toBeTruthy();
  const siteRects = dom.sites.map(r => ({...r,x:r.x-dom.canvas.x,y:r.y-dom.canvas.y}));
  for (const r of siteRects) { inside(r); expect(overlap(r,sight)).toBe(false); expect(overlap(r,layout.radar.rect)).toBe(false); }
  for(let i=0;i<siteRects.length;i++) for(let j=i+1;j<siteRects.length;j++) expect(overlap(siteRects[i],siteRects[j])).toBe(false);
  for(const node of dom.nodes.filter(n=>n.button)) expect(overlap({...node,x:node.x-dom.canvas.x,y:node.y-dom.canvas.y},sight)).toBe(false);
  for(let i=0;i<dom.panels.length;i++) for(let j=i+1;j<dom.panels.length;j++) expect(overlap(dom.panels[i],dom.panels[j])).toBe(false);
  for(const panel of dom.panels) for(const site of siteRects) expect(overlap(panel,site)).toBe(false);
  for(const panel of layout.panels ?? []) { expect(overlap(panel.rect,sight)).toBe(false); expect(overlap(panel.rect,layout.radar.rect)).toBe(false); }
  for (const selector of ['#pause','#bomb','#loop', ...(state.mode==='normal'?['#fire','#accelerate','#brake']:[])]) await driver.point(selector);
  driver.evidence.push({ label:'actual-live-dom-geometry', dom, layout }); return {dom,layout};
}

/** Establish actual native capture before requesting its loss; no synthetic events. */
export async function cancelNativeCapture(driver:RealRendererDriver, control:'bomb'|'loop') {
  const selector=`#${control}`, point=await driver.point(selector);
  await driver.page.locator(selector).evaluate(node=>{
    const events:Array<{type:string;pointerId:number;isTrusted:boolean;targetId:string}>=[];
    const record=(event:Event)=>{const p=event as PointerEvent;events.push({type:p.type,pointerId:p.pointerId,isTrusted:p.isTrusted,targetId:(p.currentTarget as Element).id});};
    const types=['pointerdown','gotpointercapture','lostpointercapture','pointerup'];
    for(const type of types)node.addEventListener(type,record);
    (window as any).__acceptanceCaptureObservation={events,remove:()=>{for(const type of types)node.removeEventListener(type,record);}};
  });
  try {
    await driver.page.mouse.move(point.x,point.y);await driver.page.mouse.down();
    // setPointerCapture initially sets only a pending override. This real move
    // processes it, producing gotpointercapture before release is requested.
    await driver.page.mouse.move(point.x+1,point.y);
    const active=await driver.page.locator(selector).evaluate((node,control)=>{
      const events=(window as any).__acceptanceCaptureObservation.events;
      const held=(window as any).__fantasiaReadState(false).controlsInput.heldPointers[control];
      return {events:[...events],held:[...held],captured:held.length===1&&node.hasPointerCapture(held[0])};
    },control);
    driver.evidence.push({label:'native-capture-established',control,...active});
    expect(active.captured).toBe(true);expect(active.held).toHaveLength(1);
    expect(active.events.map((e:CaptureEvent)=>e.type)).toEqual(['pointerdown','gotpointercapture']);
    for(const event of active.events as CaptureEvent[]) {expect(event.isTrusted).toBe(true);expect(event.pointerId).toBe(active.held[0]);expect(event.targetId).toBe(control);}
    await driver.page.locator(selector).evaluate((node,pointerId)=>node.releasePointerCapture(pointerId),active.held[0]);
    await driver.page.mouse.move(point.x+2,point.y);
    const cancelled=await driver.page.evaluate(control=>({events:[...(window as any).__acceptanceCaptureObservation.events],heldBeforeUp:[...(window as any).__fantasiaReadState(false).controlsInput.heldPointers[control]]}),control);
    driver.evidence.push({label:'native-capture-cancelled-before-up',control,pointerId:active.held[0],...cancelled});
    assertCaptureCancelled(cancelled.events,active.held[0],control,cancelled.heldBeforeUp);
    await driver.page.mouse.up();
  } finally {
    const observations=await driver.page.evaluate(()=>{const o=(window as any).__acceptanceCaptureObservation;const events=[...o.events];o.remove();delete (window as any).__acceptanceCaptureObservation;return events;});
    driver.evidence.push({label:'native-capture-event-sequence',control,events:observations});
  }
}
