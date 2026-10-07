import {expect} from '@playwright/test';
import {RealRendererDriver} from './real-driver';
import {collectHudTextGeometry,detailGeometrySnapshot,textGeometryIssues,type TextRegion} from './text-geometry';
import {createVisibilityPredicate} from './geometry-contract';
import {detailAccessIssues,activeFixedStatusIds,type FixedStatusEvidence,type DetailAccessEvidence} from './detail-scroll-contract';

/** Native navigation only: never assign scrollTop, dispatch synthetic events,
 * shrink text, alter layout, or replace the runtime input/renderer. */
export async function verifyDetailScroll(d:RealRendererDriver,reservations:TextRegion[]) {
  const viewport=d.page.locator('#campaign-hud-details');
  await expect(viewport).toHaveAttribute('role','region');await expect(viewport).toHaveAttribute('tabindex','0');
  const contract=await d.page.evaluate(()=>{
    const v=document.querySelector<HTMLElement>('#campaign-hud-details')!;
    const expected=['timer','tallies','wingmen','score','flight-tip','loop-status','lives-note',...Array.from({length:7},(_,i)=>`site-${i+1}`)];
    for(const [id,key]of [['announcement','announcement-secondary'],['bomb-hint','bomb-hint-secondary']])if(document.getElementById(id)?.dataset.campaignCritical!=='true')expected.push(key);
    return {expected,actual:[...v.querySelectorAll<HTMLElement>('[data-campaign-detail]')].map(n=>n.dataset.campaignDetail!),max:v.scrollHeight-v.clientHeight,height:v.clientHeight};
  });
  expect(contract.max,'Fallback must actually provide a scrollable detail region').toBeGreaterThan(0);
  const evidence:DetailAccessEvidence={active:true,viewportId:'campaign-hud-details',expectedEntryIds:contract.expected,actualEntryIds:contract.actual,expectedFragments:[],persistentIds:[],samples:[]};
  const visibility=await d.page.evaluateHandle(createVisibilityPredicate);
  await viewport.evaluate(node=>{
    const events:Array<{type:string;isTrusted:boolean;key?:string;pointerType?:string}>=[];
    const record=(event:Event)=>events.push({type:event.type,isTrusted:event.isTrusted,key:(event as KeyboardEvent).key,pointerType:(event as PointerEvent).pointerType});
    const types=['keydown','keyup','pointerdown','touchstart','touchend'];for(const type of types)node.addEventListener(type,record,{passive:true});
    (window as any).__detailScrollEvents={events,remove:()=>{for(const type of types)node.removeEventListener(type,record);}};
  });
  const sample=async(method:'keyboard'|'touch')=>{
    const data=await d.page.evaluate(collectHudTextGeometry,visibility as any),snapshot=detailGeometrySnapshot(data);
    const live=await d.full(),layout=live.render.hudLayout;
    const canvas=await d.page.locator('#flight').boundingBox();expect(canvas).toBeTruthy();expect(layout.status).toBe('placed');
    const currentReservations:TextRegion[]=[{key:'canvas:radar',kind:'radar',rect:layout.radar.rect},
      ...layout.obstacles.filter((r:any)=>['aim-and-reload-ring','central-flight-lane'].includes(r.id)).map((r:any)=>({key:`canvas:${r.id}`,kind:'sight-reservation',rect:r})),
      ...(layout.canvasLabels??[]).filter((r:any)=>r.rect).map((r:any)=>({key:`canvas:${r.id}`,kind:'canvas-label',rect:r.rect}))]
      .map(r=>({...r,rect:{...r.rect,x:r.rect.x+canvas!.x,y:r.rect.y+canvas!.y}}));
    const geometryIssues=[...snapshot.completenessIssues,...textGeometryIssues(snapshot.projected,currentReservations)];
    const statusEvidence:FixedStatusEvidence={screen:live.screen,status:live.status,position:live.player.position,protectionTicks:live.campaignPlayer.protectionTicks,reloadTicksRemaining:live.player.reloadTicksRemaining,
      text:await d.page.evaluate(()=>Object.fromEntries(['campaign-threat','reload-status','payload-status'].map(id=>[id,document.getElementById(id)?.textContent??''])))};
    const activeStatusIds=activeFixedStatusIds(statusEvidence);
    const observed=await d.page.evaluate((activeStatusIds)=>{
      const v=document.querySelector<HTMLElement>('#campaign-hud-details')!,app=document.querySelector<HTMLElement>('#app')!,hud=document.querySelector<HTMLElement>('#hud')!;
      const required=[...document.querySelectorAll<HTMLElement>('#campaign-sites [data-site], #campaign-sites .campaign-site-number, #campaign-sites .campaign-site-owner, #campaign-sites .campaign-site-state, #hud button, #campaign-mode-status, #lives-count, [data-campaign-critical="true"]')].filter(n=>n.matches('[data-campaign-critical="true"]')?!!n.textContent?.trim():!n.closest('[hidden]'));
      for(const id of activeStatusIds){const node=document.getElementById(id);if(node&&!required.includes(node))required.push(node);}
      const visible=required.filter(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return !n.closest('[hidden]')&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.left>=-.75&&r.top>=-.75&&r.right<=innerWidth+.75&&r.bottom<=innerHeight+.75;});
      const state=(window as any).__fantasiaReadState(false),input=state.controlsInput;
      return {scrollTop:v.scrollTop,phase:state.phase,neutralInput:input.keys.length===0&&input.steerPointer===null&&input.turn===0&&input.climb===0&&Object.values(input.heldPointers).every((ids:any)=>ids.length===0),
        fullHudScroll:{windowX:scrollX,windowY:scrollY,appLeft:app.scrollLeft,appTop:app.scrollTop,hudLeft:hud.scrollLeft,hudTop:hud.scrollTop},
        requiredIds:required.map(n=>n.id||(n.dataset.site?`site-${n.dataset.site}`:`${n.className}-${n.closest<HTMLElement>('[data-site]')?.dataset.site}`)),persistentIds:visible.map(n=>n.id||(n.dataset.site?`site-${n.dataset.site}`:`${n.className}-${n.closest<HTMLElement>('[data-site]')?.dataset.site}`))};
    },activeStatusIds);
    expect(activeStatusIds.every(id=>observed.persistentIds.includes(id))).toBe(true);
    // Both the required set and every currently active critical status must remain visible.
    expect(observed.persistentIds).toEqual(observed.requiredIds);
    if(!evidence.expectedFragments.length){evidence.expectedFragments=snapshot.expected;evidence.persistentIds=observed.requiredIds;}
    expect(snapshot.expected,'Full text fragment inventory cannot disappear during traversal').toEqual(evidence.expectedFragments);
    evidence.samples.push({method,...observed,fullyVisibleFragments:snapshot.visible});
    d.evidence.push({label:'detail-scroll-snapshot',method,...observed,statusEvidence,geometry:data,reservations:currentReservations,visibleFragments:snapshot.visible,geometryIssues});
    expect(geometryIssues,'Every reached fragment and every persistent label must be complete and unobscured').toEqual([]);
    return observed.scrollTop;
  };
  const consumedNeutral=async()=>{
    const state=await d.nextTick(),audit=await d.audit();expect(audit.dropped).toBe(0);
    const item=audit.entries.filter((x:any)=>x.tick<=state.tick-1).at(-1);expect(item).toBeTruthy();
    const input=item.input;expect(input.turn).toBe(0);expect(input.climb).toBe(0);
    for(const key of ['accelerate','brake','fire','bomb','loop'])expect(input[key],`Detail scroll leaked ${key}`).toBe(false);
    d.evidence.push({label:'detail-scroll-consumed-neutral-input',input,tick:state.tick});
  };
  try {
    await d.point('#campaign-hud-details');await viewport.focus();await d.page.keyboard.press('Home');
    // Native scroll animations settle on browser compositor time without advancing
    // game time. This is not a page-clock replacement or a fake scroll assignment.
    await expect.poll(()=>viewport.evaluate(n=>n.scrollTop)).toBe(0);
    let top=await sample('keyboard');expect(top).toBe(0);
    const maxMoves=Math.ceil(contract.max/20)+20;
    for(let i=0;i<maxMoves&&top<contract.max-1;i++){
      await d.page.keyboard.down('ArrowDown');if(i===0)await consumedNeutral();await d.page.keyboard.up('ArrowDown');await d.page.waitForTimeout(65);
      const next=await sample('keyboard');expect(next,'Native ArrowDown must advance detail scroll').toBeGreaterThan(top);top=next;
    }
    expect(top).toBeGreaterThanOrEqual(contract.max-1);await consumedNeutral();
    await viewport.focus();await d.page.keyboard.press('Tab');
    const focused=await d.page.evaluateHandle(()=>document.activeElement);
    try{expect(await focused.evaluate(n=>!!n?.closest('#campaign-hud-details'))).toBe(true);await consumedNeutral();
      expect(await focused.evaluate(n=>document.activeElement===n),'Detail child focus must survive a live HUD update').toBe(true);
    }finally{await focused.dispose();}
    await viewport.focus();await d.page.keyboard.press('Home');await expect.poll(()=>viewport.evaluate(n=>n.scrollTop)).toBe(0);
    // Native CDP touch gestures are trusted browser input, unlike dispatchEvent.
    const session=await d.page.context().newCDPSession(d.page);
    try {
      top=await sample('touch');expect(top).toBe(0);
      const rect=await viewport.boundingBox();expect(rect).toBeTruthy();
      const r=rect!,travel=Math.max(20,Math.min(40,r.height*.45)),x=r.x+r.width*.5,y=r.y+r.height-8;
      for(let i=0;i<maxMoves&&top<contract.max-1;i++){
        await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        if(i===0)await consumedNeutral();
        for(let j=1;j<=4;j++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-travel*j/4,id:1}]});await d.page.waitForTimeout(20);}
        await d.page.waitForTimeout(90);
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await d.page.waitForTimeout(60);
        const next=await sample('touch');expect(next,'Native touch pan must advance detail scroll').toBeGreaterThan(top);top=next;
      }
      expect(top).toBeGreaterThanOrEqual(contract.max-1);await consumedNeutral();
    }finally{await session.detach();}
    const events=await d.page.evaluate(()=>(window as any).__detailScrollEvents.events);
    for(const type of ['keydown','keyup','pointerdown','touchstart','touchend'])expect(events.some((e:any)=>e.type===type&&e.isTrusted)).toBe(true);
    expect(events.some((e:any)=>!e.isTrusted)).toBe(false);
    expect(events.some((e:any)=>e.type==='keydown'&&e.key==='ArrowDown')).toBe(true);
    expect(events.some((e:any)=>e.type==='pointerdown'&&e.pointerType==='touch')).toBe(true);
    expect(detailAccessIssues(evidence)).toEqual([]);
  }finally{
    const events=await d.page.evaluate(()=>{const o=(window as any).__detailScrollEvents;const events=o.events;o.remove();delete (window as any).__detailScrollEvents;return events;});
    d.evidence.push({label:'detail-scroll-native-events',events});
    await visibility.dispose();d.evidence.push({label:'authorized-detail-scroll-proof',...evidence,issues:detailAccessIssues(evidence)});}
}
