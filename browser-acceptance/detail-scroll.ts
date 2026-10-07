import {expect} from '@playwright/test';
import {detailScrollMeasurement,detailSettlingIssues,detailOperationIssues} from './detail-scroll-observation';
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
  const collector=await d.page.evaluateHandle(`(${collectHudTextGeometry.toString()})`);
  await viewport.evaluate(node=>{
    const events:Array<{type:string;isTrusted:boolean;key?:string;pointerType?:string}>=[];
    const motion={sequence:0,endedSequence:0,endCount:0,trusted:true};
    const mutations={count:0,attributes:0,childList:0,characterData:0};
    const mutation=new MutationObserver(records=>{for(const r of records){mutations.count++;mutations[r.type]++;}});
    mutation.observe(node,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','style','class','data-campaign-detail']});
    const record=(event:Event)=>{events.push({type:event.type,isTrusted:event.isTrusted,key:(event as KeyboardEvent).key,pointerType:(event as PointerEvent).pointerType});
      if(event.type==='scroll'){motion.sequence++;motion.trusted&&=event.isTrusted;}
      if(event.type==='scrollend'){motion.endedSequence=motion.sequence;motion.endCount++;motion.trusted&&=event.isTrusted;}};
    const types=['keydown','keyup','pointerdown','touchstart','touchend','scroll','scrollend'];for(const type of types)node.addEventListener(type,record,{passive:true});
    (window as any).__detailScrollEvents={events,motion,mutations,remove:()=>{mutation.disconnect();for(const type of types)node.removeEventListener(type,record);}};
  });
  // One synchronous browser task reads geometry, scroll offsets, viewport,
  // critical status, renderer reservations and raw application input together.
  const capture=(cap:number)=>d.call('atomic detail scroll observation',()=>d.page.evaluate(({collector,visibility})=>{
    const scrollTopBefore=document.querySelector<HTMLElement>('#campaign-hud-details')!.scrollTop;
    const data=collector(visibility),state=(window as any).__fantasiaReadState(false),input=state.controlsInput;
    const v=document.querySelector<HTMLElement>('#campaign-hud-details')!,app=document.querySelector<HTMLElement>('#app')!,hud=document.querySelector<HTMLElement>('#hud')!;
    const rect=document.querySelector<HTMLElement>('#flight')!.getBoundingClientRect(),layout=state.render.hudLayout;
    const statusEvidence={screen:state.screen,status:state.status,position:state.player.position,protectionTicks:state.campaignPlayer.protectionTicks,reloadTicksRemaining:state.player.reloadTicksRemaining,
      text:Object.fromEntries(['campaign-threat','reload-status','payload-status'].map(id=>[id,document.getElementById(id)?.textContent??'']))};
    const required=[...document.querySelectorAll<HTMLElement>('#campaign-sites [data-site], #campaign-sites .campaign-site-number, #campaign-sites .campaign-site-owner, #campaign-sites .campaign-site-state, #hud button, #campaign-mode-status, #lives-count, [data-campaign-critical="true"]')].filter(n=>n.matches('[data-campaign-critical="true"]')?!!n.textContent?.trim():!n.closest('[hidden]'));
    const candidates=[...new Set([...required,...['campaign-threat','reload-status','payload-status','warning','respawn-status'].map(id=>document.getElementById(id)).filter((n):n is HTMLElement=>!!n)])];
    const visible=candidates.filter(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return !n.closest('[hidden]')&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.left>=-.75&&r.top>=-.75&&r.right<=innerWidth+.75&&r.bottom<=innerHeight+.75;});
    const ids={of(n:HTMLElement){return n.id||(n.dataset.site?`site-${n.dataset.site}`:`${n.className}-${n.closest<HTMLElement>('[data-site]')?.dataset.site}`);}};
    return {geometry:data,statusEvidence,layout,canvas:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},input,
      scrollTopBefore,motion:{...(window as any).__detailScrollEvents.motion},scrollHeight:v.scrollHeight,clientHeight:v.clientHeight,
      scrollTop:v.scrollTop,phase:state.phase,neutralInput:input.keys.length===0&&input.steerPointer===null&&input.turn===0&&input.climb===0&&Object.values(input.heldPointers).every((ids:any)=>ids.length===0),
      fullHudScroll:{windowX:scrollX,windowY:scrollY,appLeft:app.scrollLeft,appTop:app.scrollTop,hudLeft:hud.scrollLeft,hudTop:hud.scrollTop},
      requiredIds:required.map(ids.of),visibleIds:visible.map(ids.of)};
  },{collector,visibility} as any),cap);
  // No full text walk or runtime-state serialization while waiting for native
  // completion. Reads never advance the page clock or bypass a reflowing runtime.
  const light=(cap:number,readRuntime=false)=>d.call('lightweight native scroll observation',()=>viewport.evaluate((v,readRuntime)=>{
    const r=v.getBoundingClientRect(),o=(window as any).__detailScrollEvents;
    return {scrollTop:v.scrollTop,scrollHeight:v.scrollHeight,clientHeight:v.clientHeight,motion:{...o.motion},mutations:{...o.mutations},
      viewportRect:{x:r.x,y:r.y,width:r.width,height:r.height},
      ...(readRuntime?{layoutMeasurements:(window as any).__fantasiaReadState(false).render.hudLayout.measurements}:{})};
  },readRuntime),cap);
  const beginOperation=async(kind:'home'|'arrow'|'touch')=>({kind,before:await light(1500,true),evidenceIndex:d.evidence.length});
  const sample=async(method:'keyboard'|'touch',operation:Awaited<ReturnType<typeof beginOperation>>)=>{
    const started=performance.now(),deadline=started+Math.min(1500,d.budget.remaining('native detail scroll settling'));
    const history:any[]=[];let candidates=0,fullCaptures=0;
    const record=(stage:string,value:any)=>{candidates++;const entry={stage,elapsedWallMs:performance.now()-started,...value};
      if(history.length===32)history.splice(8,1);history.push(entry);};
    let first:ReturnType<typeof detailScrollMeasurement>|undefined,firstAt=0,atomic:any,settling:any,lastLight:any,lightAt=0;
    let failure:string|undefined;
    try {
      while(performance.now()<deadline){
        const probe=await light(Math.max(1,deadline-performance.now()));record('native-wait',probe);
        const operationIssues=detailOperationIssues(operation,probe);
        if(operationIssues.length){first=undefined;lastLight=undefined;}
        else if(!lastLight||JSON.stringify(lastLight)!==JSON.stringify(probe)){lastLight=probe;lightAt=performance.now();first=undefined;}
        else if(performance.now()-lightAt>=32){
          fullCaptures++;record('full-capture-start',{fullCaptures});
          atomic=await capture(Math.max(1,deadline-performance.now()));const measurement=detailScrollMeasurement(atomic),now=performance.now();
          record('full-capture-result',{scrollTop:atomic.scrollTop,scrollTopBefore:atomic.scrollTopBefore,motion:atomic.motion,
            layoutMeasurements:atomic.layout.measurements,fragmentCount:atomic.geometry.runs.reduce((n:number,r:any)=>n+r.fragments.length,0),
            viewport:atomic.geometry.viewport,lastFragment:atomic.geometry.runs.at(-1)?.fragments.at(-1)});
          if(now>deadline)break;
          if(detailOperationIssues(operation,atomic).length||JSON.stringify(atomic.motion)!==JSON.stringify(probe.motion)||atomic.scrollTop!==probe.scrollTop){first=undefined;lastLight=undefined;}
          else if(first&&JSON.stringify(first)===JSON.stringify(measurement)&&now-firstAt>=32){
            settling={first,elapsedWallMs:now-firstAt,operation:{kind:operation.kind,before:operation.before},totalWallMs:now-started};break;
          }else if(!first||JSON.stringify(first)!==JSON.stringify(measurement)){first=measurement;firstAt=now;}
        }
        await d.call('native detail scroll poll interval',()=>new Promise<void>(resolve=>setTimeout(resolve,16)),Math.max(1,deadline-performance.now()));
      }
      expect(settling,'Trusted operation-specific scrollend and stable atomic geometry required within real-time bound').toBeTruthy();
    }catch(error){failure=String(error);throw error;}
    finally {
      const ticks=d.evidence.slice(operation.evidenceIndex).filter((o:any)=>['before-input-tick','input-tick'].includes(o.label)).map((o:any)=>({label:o.label,tick:o.tick,layoutMeasurements:o.render?.hudLayout?.measurements}));
      d.evidence.push({label:'detail-scroll-observation-attempt',method,operation:{kind:operation.kind,before:operation.before},outcome:settling?'settled':'failed',
        totalWallMs:performance.now()-started,candidates,fullCaptures,history,ticks,...(failure?{failure}:{})});
    }
    expect(detailSettlingIssues({...atomic,settling})).toEqual([]);
    const data=atomic.geometry,snapshot=detailGeometrySnapshot(data),layout=atomic.layout,canvas=atomic.canvas;
    expect(canvas.width).toBeGreaterThan(0);expect(canvas.height).toBeGreaterThan(0);expect(layout.status).toBe('placed');
    const currentReservations:TextRegion[]=[{key:'canvas:radar',kind:'radar',rect:layout.radar.rect},
      ...layout.obstacles.filter((r:any)=>['aim-and-reload-ring','central-flight-lane'].includes(r.id)).map((r:any)=>({key:`canvas:${r.id}`,kind:'sight-reservation',rect:r})),
      ...(layout.canvasLabels??[]).filter((r:any)=>r.rect).map((r:any)=>({key:`canvas:${r.id}`,kind:'canvas-label',rect:r.rect}))]
      .map(r=>({...r,rect:{...r.rect,x:r.rect.x+canvas.x,y:r.rect.y+canvas.y}}));
    const geometryIssues=[...snapshot.completenessIssues,...textGeometryIssues(snapshot.projected,currentReservations)];
    const statusEvidence:FixedStatusEvidence=atomic.statusEvidence,activeStatusIds=activeFixedStatusIds(statusEvidence);
    const requiredIds=[...new Set([...atomic.requiredIds,...activeStatusIds])];
    const observed={scrollTop:atomic.scrollTop,phase:atomic.phase,neutralInput:atomic.neutralInput,fullHudScroll:atomic.fullHudScroll,
      requiredIds,persistentIds:requiredIds.filter(id=>atomic.visibleIds.includes(id))};
    expect(activeStatusIds.every(id=>observed.persistentIds.includes(id))).toBe(true);
    // Both the required set and every currently active critical status must remain visible.
    expect(observed.persistentIds).toEqual(observed.requiredIds);
    if(!evidence.expectedFragments.length){evidence.expectedFragments=snapshot.expected;evidence.persistentIds=observed.requiredIds;}
    expect(snapshot.expected,'Full text fragment inventory cannot disappear during traversal').toEqual(evidence.expectedFragments);
    evidence.samples.push({method,...observed,fullyVisibleFragments:snapshot.visible});
    d.evidence.push({label:'detail-scroll-snapshot',method,...observed,statusEvidence,geometry:data,settling,scrollTopBefore:atomic.scrollTopBefore,motion:atomic.motion,scrollHeight:atomic.scrollHeight,clientHeight:atomic.clientHeight,input:atomic.input,layoutMeasurements:atomic.layout.measurements,reservations:currentReservations,visibleFragments:snapshot.visible,geometryIssues});
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
    await d.point('#campaign-hud-details');await viewport.focus();const home=await beginOperation('home');await d.page.keyboard.press('Home');
    // Native scroll animations settle on browser compositor time without advancing
    // game time. This is not a page-clock replacement or a fake scroll assignment.
    let top=await sample('keyboard',home);expect(top).toBe(0);
    const maxMoves=Math.ceil(contract.max/20)+20;
    for(let i=0;i<maxMoves&&top<contract.max-1;i++){
      const operation=await beginOperation('arrow');await d.page.keyboard.down('ArrowDown');if(i===0)await consumedNeutral();await d.page.keyboard.up('ArrowDown');
      const next=await sample('keyboard',operation);expect(next,'Native ArrowDown must advance detail scroll').toBeGreaterThan(top);top=next;
    }
    expect(top).toBeGreaterThanOrEqual(contract.max-1);await consumedNeutral();
    await viewport.focus();await d.page.keyboard.press('Tab');
    const focused=await d.page.evaluateHandle(()=>document.activeElement);
    try{expect(await focused.evaluate(n=>!!n?.closest('#campaign-hud-details'))).toBe(true);await consumedNeutral();
      expect(await focused.evaluate(n=>document.activeElement===n),'Detail child focus must survive a live HUD update').toBe(true);
    }finally{await focused.dispose();}
    await viewport.focus();const touchHome=await beginOperation('home');await d.page.keyboard.press('Home');
    // Native CDP touch gestures are trusted browser input, unlike dispatchEvent.
    const session=await d.page.context().newCDPSession(d.page);
    try {
      top=await sample('touch',touchHome);expect(top).toBe(0);
      const rect=await viewport.boundingBox();expect(rect).toBeTruthy();
      const r=rect!,travel=Math.max(20,Math.min(40,r.height*.45)),x=r.x+r.width*.5,y=r.y+r.height-8;
      for(let i=0;i<maxMoves&&top<contract.max-1;i++){
        const operation=await beginOperation('touch');await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        if(i===0)await consumedNeutral();
        for(let j=1;j<=4;j++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-travel*j/4,id:1}]});await d.page.waitForTimeout(20);}
        await d.page.waitForTimeout(90);
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        const next=await sample('touch',operation);expect(next,'Native touch pan must advance detail scroll').toBeGreaterThan(top);top=next;
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
    await collector.dispose();await visibility.dispose();d.evidence.push({label:'authorized-detail-scroll-proof',...evidence,issues:detailAccessIssues(evidence)});}
}
