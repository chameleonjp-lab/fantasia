import {test, expect, type TestInfo} from '@playwright/test';
import {RealRendererDriver} from './real-driver';
import {inputAt, neutral, liveGeometry} from './acceptance-helpers';

async function run(info:TestInfo, d:RealRendererDriver, id:string, body:()=>Promise<void>) {
  let outcome='failed',backend:unknown;
  try {await d.boot();backend=await d.backend();await body();expect(d.pageErrors).toEqual([]);expect(d.createdFences).toBe(d.releasedFences);d.evidence.push({label:'throttle-case-completed',id});outcome='passed';}
  finally {await info.attach('throttle-integration-evidence',{contentType:'application/json',body:JSON.stringify({
    id,outcome,classification:'controlled-clock-functional',runtimeMocked:false,rendererMocked:false,
    applicationQueueModified:false,releaseReady:false,physicalDeviceAcceptance:'unverified',performanceAcceptance:'not-measured',backend,steps:d.budget.steps,maxSteps:d.budget.maxSteps,
    pageErrors:d.pageErrors,ownedFencesCreated:d.createdFences,ownedFencesReleased:d.releasedFences,observations:d.evidence
  })});}
}

async function tabTo(d:RealRendererDriver, selector:string) {
  for(let count=0;count<80;count++) {
    if(await d.page.locator(selector).evaluate(node=>node===document.activeElement))return;
    await d.page.keyboard.press('Tab');
  }
  throw new Error(`Native Tab did not reach ${selector}`);
}
async function opacityTo(d:RealRendererDriver,value:number) {
  await tabTo(d,'#control-opacity');await d.page.keyboard.press('Home');
  for(let n=20;n<value;n++)await d.page.keyboard.press('ArrowRight');
  await expect(d.page.locator('#control-opacity')).toHaveValue(String(value));
}

test('[throttle-normal] Native multi-pointer lever, focused pulse and interruption reach the campaign',async({page},info)=>{
  const d=new RealRendererDriver(page);
  await run(info,d,'throttle-normal',async()=>{
    await d.start('normal');await liveGeometry(d);
    await expect(page.locator('#accelerate,#brake')).toHaveCount(0);
    await expect(page.locator('#throttle')).toHaveAttribute('role','slider');
    const lever=await page.locator('#throttle').boundingBox();expect(lever).toBeTruthy();
    expect(lever!.width).toBeGreaterThanOrEqual(44);expect(lever!.height).toBeGreaterThanOrEqual(88);
    const steer=await d.point('#flight'),fire=await d.point('#fire');await d.point('#throttle');
    const cdp=await page.context().newCDPSession(page);
    type Touch={id:number;x:number;y:number};
    const touches:Touch[]=[{id:1,...steer}];
    const send=async(type:'touchStart'|'touchMove'|'touchEnd'|'touchCancel',points:Touch[]=touches)=>d.call('native touch ownership',()=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points}));
    try {
      await send('touchStart');touches[0].x+=18;touches[0].y-=10;await send('touchMove');
      touches.push({id:2,...fire});await send('touchStart');
      touches.push({id:3,x:lever!.x+lever!.width/2,y:lever!.y+22});await send('touchStart');
      let state=await d.nextTick(),input=await inputAt(d,state.tick-1);
      expect(input.throttle).toBe(1);expect(input.fire).toBe(true);expect(input.turn).toBeGreaterThan(0);
      const owned=(await d.full()).controlsInput;expect(owned.throttlePointer).not.toBeNull();expect(owned.steerPointer).not.toBeNull();
      touches[2].y=lever!.y+lever!.height+15;await send('touchMove');
      state=await d.nextTick();input=await inputAt(d,state.tick-1);expect(input.throttle).toBe(-1);expect(input.fire).toBe(true);
      const releasedLever=touches.pop()!;await send('touchEnd',[releasedLever]);state=await d.nextTick();input=await inputAt(d,state.tick-1);
      expect(input.throttle).toBe(0);expect(input.fire).toBe(true);expect(input.turn).toBeGreaterThan(0);
      const remaining=touches.splice(0);await send('touchEnd',remaining);await d.nextTick();await neutral(d);
    } finally {try {if(touches.length){await send('touchCancel',[]);touches.length=0;}} finally {await cdp.detach();}}
    // Native focus and a complete key gesture before any fixed tick: consumed exactly once.
    await tabTo(d,'#throttle');await expect(page.locator('#throttle')).toBeFocused();
    await page.keyboard.down('ArrowUp');await page.keyboard.up('ArrowUp');
    const first=await d.nextTick();expect((await inputAt(d,first.tick-1)).throttle).toBe(1);
    const next=await d.nextTick();expect((await inputAt(d,next.tick-1)).throttle).toBe(0);
    // Configured speed keys also carry a complete gesture before the next fixed tick.
    for(const [key,axis]of [['w',1],['s',-1]] as const){
      await page.keyboard.down(key);await page.keyboard.up(key);
      const pulse=await d.nextTick();expect((await inputAt(d,pulse.tick-1)).throttle).toBe(axis);
      const released=await d.nextTick();expect((await inputAt(d,released.tick-1)).throttle).toBe(0);
    }
    const shortBox=await page.locator('#throttle').boundingBox();expect(shortBox).toBeTruthy();
    const shortSession=await page.context().newCDPSession(page);
    try {
      const touch={id:5,x:shortBox!.x+shortBox!.width/2,y:shortBox!.y+22};
      await shortSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
      await shortSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[touch]});
      const pulse=await d.nextTick();expect((await inputAt(d,pulse.tick-1)).throttle).toBe(1);
      const released=await d.nextTick();expect((await inputAt(d,released.tick-1)).throttle).toBe(0);
    }finally{await shortSession.detach();}
    await page.keyboard.down('ArrowDown');await page.keyboard.up('ArrowDown');
    await d.click('#pause');await neutral(d);
    await d.click('#resume');await d.waitState('explicit resume',s=>s.phase==='playing');
    const resumed=await d.nextTick();expect((await inputAt(d,resumed.tick-1)).throttle).toBe(0);await neutral(d);
    await info.attach('throttle-normal-screen',{contentType:'image/png',body:await page.screenshot()});
  });
});

test('[throttle-easy] Easy preserves cruise and omits the lever from play and settings',async({page},info)=>{
  const d=new RealRendererDriver(page);
  await run(info,d,'throttle-easy',async()=>{
    await d.start('easy');await expect(page.locator('#throttle')).toBeHidden();
    await page.keyboard.down('w');const first=await d.nextTick();expect((await inputAt(d,first.tick-1)).throttle).toBe(0);
    await page.keyboard.up('w');await d.nextTick();await neutral(d);
    await d.click('#pause');await d.click('#pause-controls');await d.click('#control-editor-touch');
    await expect(page.locator('#control-target option[value="throttle"]')).toBeDisabled();
    expect(await page.locator('#control-preview [data-control="throttle"]').isVisible()).toBe(false);
    await d.click('#control-cancel');await d.click('#resume');await d.waitState('explicit Easy resume',s=>s.phase==='playing');
    await d.nextTick();await neutral(d);
  });
});

test('[throttle-save] Explicit v2 Save preserves legacy bytes and reloads the lever layout',async({page},info)=>{
  const raw=JSON.stringify({version:1,controls:{fire:{x:.83,y:.84,size:96,opacity:.9},loop:{x:.83,y:.66,size:72,opacity:.78},
    accelerate:{x:.17,y:.84,size:76,opacity:.82},brake:{x:.17,y:.66,size:76,opacity:.82},bomb:{x:.39,y:.94,size:52,opacity:.88}}});
  await page.addInitScript(raw=>{if(localStorage.getItem('fantasia-controls-v1')===null)localStorage.setItem('fantasia-controls-v1',raw);},raw);
  const d=new RealRendererDriver(page);
  await run(info,d,'throttle-save',async()=>{
    expect(await page.evaluate(()=>localStorage.getItem('fantasia-controls-v2'))).toBeNull();
    await d.click('#home-controls');await d.click('#control-editor-touch');
    await page.locator('#control-mode').selectOption('normal');
    await page.locator('#control-target').selectOption('throttle');
    await opacityTo(d,70);await d.click('#control-save');
    const saved=await page.evaluate(()=>({legacy:localStorage.getItem('fantasia-controls-v1'),current:localStorage.getItem('fantasia-controls-v2'),other:localStorage.getItem('kaisen-controls-v2')}));
    expect(saved.legacy).toBe(raw);expect(saved.other).toBeNull();expect(saved.current).not.toBeNull();
    expect(JSON.parse(saved.current!).version).toBe(2);expect(JSON.parse(saved.current!).controls.throttle.opacity).toBe(.7);
    d.evidence.push({label:'explicit-save-storage',saved});
    await d.start('normal');await expect(page.locator('#throttle')).toHaveCSS('opacity','0.7');
    await d.home();await d.click('#home-controls');await d.click('#control-editor-touch');
    await page.locator('#control-mode').selectOption('normal');await page.locator('#control-target').selectOption('throttle');
    await opacityTo(d,60);await d.click('#control-cancel');
    expect(await page.evaluate(()=>localStorage.getItem('fantasia-controls-v2'))).toBe(saved.current);
    await page.reload();await d.waitState('reload ready',s=>s.phase==='ready',80);
    await d.start('normal');await expect(page.locator('#throttle')).toHaveCSS('opacity','0.7');await neutral(d);
  });
});

test('[throttle-recovery] Failed real storage rollback remains visible and unchanged Save restores the journal',async({page},info)=>{
  const d=new RealRendererDriver(page);
  await run(info,d,'throttle-recovery',async()=>{
    await d.click('#home-controls');await d.click('#control-editor-touch');
    await page.locator('#control-mode').selectOption('normal');await page.locator('#control-target').selectOption('throttle');
    await opacityTo(d,70);await d.click('#control-save');
    const before=await page.evaluate(()=>localStorage.getItem('fantasia-controls-v2'));expect(before).not.toBeNull();
    await d.click('#home-controls');await d.click('#control-editor-touch');
    await page.locator('#control-mode').selectOption('normal');await page.locator('#control-target').selectOption('throttle');
    await opacityTo(d,60);await d.click('#control-editor-keyboard');
    await d.click('[data-key-action="bomb"]');await page.keyboard.press('KeyB');
    // Bounded environmental fault only: real Storage writes throw; app state/renderer are not replaced.
    await page.evaluate(before=>{
      const original=Storage.prototype.setItem;
      (window as any).__restoreThrottleStorage=()=>{Storage.prototype.setItem=original;delete (window as any).__restoreThrottleStorage;};
      Storage.prototype.setItem=function(key,value){
        if(this===localStorage&&(key==='fantasia-keyboard-v1'||key==='fantasia-controls-v2'&&value===before))throw new DOMException('Test quota','QuotaExceededError');
        return original.call(this,key,value);
      };
    },before);
    try {
      await d.click('#control-save');await expect(page.locator('#control-storage-note')).toBeVisible();
      await expect(page.locator('#control-save')).toHaveText('今回だけ使う');
      const failed=await page.evaluate(()=>({raw:localStorage.getItem('fantasia-controls-v2'),journal:localStorage.getItem('fantasia-controls-recovery-v1')}));
      expect(failed.journal).not.toBeNull();expect(failed.raw).not.toBe(before);
      await d.click('#control-cancel');await d.click('#home-controls');
      await expect(page.locator('#control-storage-note')).toContainText('復元');
      // Recovery must run even though Cancel restored the draft and no value is edited on reopen.
      await page.evaluate(()=>(window as any).__restoreThrottleStorage());
      await d.click('#control-save');await expect(page.locator('#control-settings')).not.toBeVisible();
      const restored=await page.evaluate(()=>({raw:localStorage.getItem('fantasia-controls-v2'),keys:localStorage.getItem('fantasia-keyboard-v1'),journal:localStorage.getItem('fantasia-controls-recovery-v1')}));
      expect(restored.raw).toBe(before);expect(restored.keys).toBeNull();expect(restored.journal).toBeNull();
      d.evidence.push({label:'real-storage-recovery',fault:'Storage.setItem throws for keyboard write and normal rollback',failed,restored});
      await d.start('normal');await expect(page.locator('#throttle')).toHaveCSS('opacity','0.7');await neutral(d);
    } finally {await page.evaluate(()=>(window as any).__restoreThrottleStorage?.());}
  });
});
