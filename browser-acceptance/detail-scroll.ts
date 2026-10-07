import {unreadDetailFragments,nativeTouchTravel} from './detail-navigation';
import {expect} from '@playwright/test';
import {detailScrollMeasurement,detailSettlingIssues,detailOperationIssues} from './detail-scroll-observation';
import {RealRendererDriver} from './real-driver';
import {collectHudTextGeometry,detailGeometrySnapshot,textGeometryIssues,type TextRegion} from './text-geometry';
import {createVisibilityPredicate} from './geometry-contract';
import {detailAccessIssues,activeFixedStatusIds,type FixedStatusEvidence,type DetailAccessEvidence} from './detail-scroll-contract';

/** Native navigation only: never assign scrollTop, dispatch synthetic events,
 * shrink text, alter layout, or replace the runtime input/renderer. */
export async function verifyDetailScroll(d:RealRendererDriver,reservations:TextRegion[]) {
  const traversalStarted=performance.now();let stage='setup',currentOperation:any,lastAtomic:any;
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
    const events:any[]=[];
    const motion:any={sequence:0,endedSequence:0,endCount:0,tabCount:0,trusted:true,trailingSamePosition:false,trailingScrolls:[]};
    const mutations={count:0,attributes:0,childList:0,characterData:0};
    const mutation=new MutationObserver(records=>{for(const r of records){mutations.count++;mutations[r.type]++;}});
    mutation.observe(node,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','style','class','data-campaign-detail']});
    const record=(event:Event)=>{
      const position={isTrusted:event.isTrusted,targetIsViewport:event.target===node,target:event.target===node?'campaign-hud-details':(event.target as HTMLElement)?.id??'unknown',scrollTop:node.scrollTop,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight};
      motion.trusted&&=event.isTrusted;
      if(event.type==='keydown'&&(event as KeyboardEvent).key==='Tab')motion.tabCount++;
      if(event.type==='scroll'){
        motion.sequence++;motion.lastScroll={...position,sequence:motion.sequence};motion.trailingScrolls.push(motion.lastScroll);const end=motion.completion;
        motion.trailingSamePosition=motion.trailingSamePosition&&!!end&&position.target===end.target&&position.scrollTop===end.scrollTop&&position.scrollHeight===end.scrollHeight&&position.clientHeight===end.clientHeight;
      }
      if(event.type==='scrollend'){motion.endedSequence=motion.sequence;motion.endCount++;motion.completion={...position,sequence:motion.sequence};motion.trailingSamePosition=true;motion.trailingScrolls=[];}
      events.push({type:event.type,key:(event as KeyboardEvent).key,pointerType:(event as PointerEvent).pointerType,...position,sequence:motion.sequence,endCount:motion.endCount});
    };
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
    return {geometry:data,statusEvidence,layout,focusEntry:(document.activeElement as HTMLElement)?.closest<HTMLElement>('[data-campaign-detail]')?.dataset.campaignDetail??null,canvas:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},input,
      scrollTopBefore,motion:{...(window as any).__detailScrollEvents.motion},scrollHeight:v.scrollHeight,clientHeight:v.clientHeight,
      scrollTop:v.scrollTop,phase:state.phase,neutralInput:input.keys.length===0&&input.steerPointer===null&&input.turn===0&&input.climb===0&&Object.values(input.heldPointers).every((ids:any)=>ids.length===0),
      fullHudScroll:{windowX:scrollX,windowY:scrollY,appLeft:app.scrollLeft,appTop:app.scrollTop,hudLeft:hud.scrollLeft,hudTop:hud.scrollTop},
      requiredIds:required.map(ids.of),visibleIds:visible.map(ids.of)};
  },{collector,visibility} as any),cap);
  // No full text walk or runtime-state serialization while waiting for native
  // completion. Reads never advance the page clock or bypass a reflowing runtime.
  const light=(cap:number,readRuntime=false)=>d.call('lightweight native scroll observation',()=>viewport.evaluate((v,readRuntime)=>{
    const r=v.getBoundingClientRect(),o=(window as any).__detailScrollEvents;
    return {focusEntry:(document.activeElement as HTMLElement)?.closest<HTMLElement>('[data-campaign-detail]')?.dataset.campaignDetail??null,scrollTop:v.scrollTop,scrollHeight:v.scrollHeight,clientHeight:v.clientHeight,motion:{...o.motion},mutations:{...o.mutations},
      viewportRect:{x:r.x,y:r.y,width:r.width,height:r.height},
      ...(readRuntime?{layoutMeasurements:(window as any).__fantasiaReadState(false).render.hudLayout.measurements}:{})};
  },readRuntime),cap);
  const beginOperation=async(kind:'home'|'arrow'|'page'|'tab'|'touch',direction=1,entryId?:string)=>{
    stage='operation-baseline';currentOperation={kind,direction,...(entryId?{entryId}:{})};
    const before=await light(1500,true);currentOperation={...currentOperation,before};stage='native-input';
    return {...currentOperation,evidenceIndex:d.evidence.length};
  };
  const sample=async(method:'keyboard'|'touch',operation:Awaited<ReturnType<typeof beginOperation>>)=>{
    const started=performance.now();let deadline=started;
    const operationEvidence={kind:operation.kind,direction:operation.direction,...(operation.entryId?{entryId:operation.entryId}:{}),before:operation.before};
    const history:any[]=[];let candidates=0,fullCaptures=0;
    const record=(stage:string,value:any)=>{candidates++;const entry={stage,elapsedWallMs:performance.now()-started,...value};
      if(history.length===32)history.splice(8,1);history.push(entry);};
    let first:ReturnType<typeof detailScrollMeasurement>|undefined,firstAt=0,atomic:any,settling:any,lastLight:any,lightAt=0;
    let failure:string|undefined;
    try {
      stage='settling-budget';deadline=started+Math.min(1500,d.budget.remaining('native detail scroll settling'));
      while(performance.now()<deadline){
        stage='native-completion-wait';const probe=await light(Math.max(1,deadline-performance.now()));record('native-wait',probe);
        const operationIssues=detailOperationIssues(operation,probe);
        if(operationIssues.length){first=undefined;lastLight=undefined;}
        else if(!lastLight||JSON.stringify(lastLight)!==JSON.stringify(probe)){lastLight=probe;lightAt=performance.now();first=undefined;}
        else if(performance.now()-lightAt>=32){
          fullCaptures++;record('full-capture-start',{fullCaptures});
          stage='full-atomic-capture';atomic=await capture(Math.max(1,deadline-performance.now()));const measurement=detailScrollMeasurement(atomic),now=performance.now();
          record('full-capture-result',{scrollTop:atomic.scrollTop,scrollTopBefore:atomic.scrollTopBefore,motion:atomic.motion,
            layoutMeasurements:atomic.layout.measurements,fragmentCount:atomic.geometry.runs.reduce((n:number,r:any)=>n+r.fragments.length,0),
            viewport:atomic.geometry.viewport,lastFragment:atomic.geometry.runs.at(-1)?.fragments.at(-1)});
          if(now>deadline)break;
          if(detailOperationIssues(operation,atomic).length||JSON.stringify(atomic.motion)!==JSON.stringify(probe.motion)||atomic.scrollTop!==probe.scrollTop){first=undefined;lastLight=undefined;}
          else if(first&&JSON.stringify(first)===JSON.stringify(measurement)&&now-firstAt>=32){
            settling={first,elapsedWallMs:now-firstAt,operation:operationEvidence,totalWallMs:now-started};break;
          }else if(!first||JSON.stringify(first)!==JSON.stringify(measurement)){first=measurement;firstAt=now;}
        }
        await d.call('native detail scroll poll interval',()=>new Promise<void>(resolve=>setTimeout(resolve,16)),Math.max(1,deadline-performance.now()));
      }
      expect(settling,'Trusted operation-specific scrollend and stable atomic geometry required within real-time bound').toBeTruthy();
    }catch(error){failure=String(error);throw error;}
    finally {
      const ticks=d.evidence.slice(operation.evidenceIndex).filter((o:any)=>['before-input-tick','input-tick'].includes(o.label)).map((o:any)=>({label:o.label,tick:o.tick,layoutMeasurements:o.render?.hudLayout?.measurements}));
      d.evidence.push({label:'detail-scroll-observation-attempt',method,operation:operationEvidence,outcome:settling?'settled':'failed',
        stage,cumulativeWallMs:performance.now()-traversalStarted,totalWallMs:performance.now()-started,candidates,fullCaptures,history,ticks,...(failure?{failure}:{})});
    }
    expect(detailSettlingIssues({...atomic,settling})).toEqual([]);lastAtomic=atomic;stage='validate-geometry';
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
    d.evidence.push({label:'detail-scroll-snapshot',method,...observed,statusEvidence,geometry:data,settling,scrollTopBefore:atomic.scrollTopBefore,motion:atomic.motion,scrollHeight:atomic.scrollHeight,clientHeight:atomic.clientHeight,input:atomic.input,focusEntry:atomic.focusEntry,layoutMeasurements:atomic.layout.measurements,reservations:currentReservations,visibleFragments:snapshot.visible,geometryIssues});
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
    const seen=(method:'keyboard'|'touch')=>new Set(evidence.samples.filter(s=>s.method===method).flatMap(s=>s.fullyVisibleFragments));
    const complete=(method:'keyboard'|'touch')=>evidence.expectedFragments.every(id=>seen(method).has(id));
    // Preserve a native held-arrow/consumed-input check, including any live reflow.
    const heldArrow=await beginOperation('arrow');await d.page.keyboard.down('ArrowDown');await consumedNeutral();await d.page.keyboard.up('ArrowDown');
    top=await sample('keyboard',heldArrow);
    const restart=await beginOperation('home');await d.page.keyboard.press('Home');top=await sample('keyboard',restart);
    // Native Tab scrolls the real focusable entry into view. DOM focus is used
    // only for the viewport setup above, never to substitute for this traversal.
    for(const [entryIndex,entryId] of contract.actual.entries()){
      if(entryIndex>0&&complete('keyboard'))break;
      const operation=await beginOperation('tab',1,entryId);await d.page.keyboard.press('Tab');top=await sample('keyboard',operation);
      const visited=new Set<string>();
      const fragmentLimit=unreadDetailFragments(lastAtomic.geometry,new Set(),entryId).length*4+4;
      for(let i=0;i<fragmentLimit;i++){
        const pending=unreadDetailFragments(lastAtomic.geometry,seen('keyboard'),entryId);if(!pending.length)break;
        const target=pending[0],direction=target.delta<0?-1:1,key=`${top}:${target.id}`;
        const phaseShift=visited.has(key);visited.add(key);
        const kind=phaseShift?'page':'arrow',button=phaseShift?(direction>0?'PageDown':'PageUp'):(direction>0?'ArrowDown':'ArrowUp');
        const adjustment=await beginOperation(kind,direction);await d.page.keyboard.press(button);top=await sample('keyboard',adjustment);
      }
      expect(unreadDetailFragments(lastAtomic.geometry,seen('keyboard'),entryId),`Native keyboard must read every fragment in ${entryId}`).toEqual([]);
    }
    expect(complete('keyboard'),'Every keyboard fragment must be reached independently').toBe(true);await consumedNeutral();
    const focused=await d.page.evaluateHandle(()=>document.activeElement);
    try{expect(await focused.evaluate(n=>!!n?.closest('#campaign-hud-details')&&(n as HTMLElement).id!=='campaign-hud-details')).toBe(true);await consumedNeutral();
      expect(await focused.evaluate(n=>document.activeElement===n),'Detail child focus must survive a live HUD update').toBe(true);
    }finally{await focused.dispose();}
    await viewport.focus();const touchHome=await beginOperation('home');await d.page.keyboard.press('Home');
    // Native CDP touch gestures are trusted browser input, unlike dispatchEvent.
    const session=await d.page.context().newCDPSession(d.page);
    try {
      top=await sample('touch',touchHome);expect(top).toBe(0);
      let slop=15;
      const maxMoves=evidence.expectedFragments.length*4+20;
      for(let i=0;i<maxMoves&&!complete('touch');i++){
        const target=unreadDetailFragments(lastAtomic.geometry,seen('touch'))[0];expect(target).toBeTruthy();
        const rect=await viewport.boundingBox();expect(rect).toBeTruthy();const r=rect!,travel=nativeTouchTravel(target.delta,r.height,slop),direction=travel<0?-1:1;
        const x=r.x+r.width*.5,y=direction>0?r.y+r.height-8:r.y+8;
        d.evidence.push({label:'detail-scroll-navigation-plan',method:'touch',targetFragment:target.id,targetRect:target.rect,delta:target.delta,travel,remaining:unreadDetailFragments(lastAtomic.geometry,seen('touch')).length});
        const operation=await beginOperation('touch',direction);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        if(i===0)await consumedNeutral();
        for(let j=1;j<=4;j++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-travel*j/4,id:1}]});await d.page.waitForTimeout(20);}
        await d.page.waitForTimeout(90);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        const next=await sample('touch',operation);
        slop=Math.max(0,Math.min(20,Math.abs(travel)-Math.abs(next-top)));top=next;
      }
      expect(complete('touch'),'Every touch fragment must be reached independently').toBe(true);await consumedNeutral();
    }finally{await session.detach();}
    const events=await d.page.evaluate(()=>(window as any).__detailScrollEvents.events);
    for(const type of ['keydown','keyup','pointerdown','touchstart','touchend'])expect(events.some((e:any)=>e.type===type&&e.isTrusted)).toBe(true);
    expect(events.some((e:any)=>!e.isTrusted)).toBe(false);
    expect(events.some((e:any)=>e.type==='keydown'&&e.key==='ArrowDown')).toBe(true);
    expect(events.some((e:any)=>e.type==='pointerdown'&&e.pointerType==='touch')).toBe(true);
    expect(detailAccessIssues(evidence)).toEqual([]);
  }catch(error){
    d.evidence.push({label:'detail-scroll-traversal-failure',stage,cumulativeWallMs:performance.now()-traversalStarted,operation:currentOperation,error:String(error),lastRaw:lastAtomic?{scrollTop:lastAtomic.scrollTop,motion:lastAtomic.motion,layoutMeasurements:lastAtomic.layout.measurements,viewport:lastAtomic.geometry.viewport}:null});throw error;
  }finally{
    const events=await d.page.evaluate(()=>{const o=(window as any).__detailScrollEvents;const events=o.events;o.remove();delete (window as any).__detailScrollEvents;return events;});
    d.evidence.push({label:'detail-scroll-native-events',events});
    await collector.dispose();await visibility.dispose();d.evidence.push({label:'authorized-detail-scroll-proof',...evidence,issues:detailAccessIssues(evidence)});}
}
