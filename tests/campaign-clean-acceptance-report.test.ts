import {detailScrollMeasurement} from '../browser-acceptance/detail-scroll-observation';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, titleFor } from '../browser-acceptance/acceptance-cases';
import { buildAcceptanceReport } from '../scripts/clean-acceptance-report';
function fixture() {
  return {suites:[{specs:CASES.map(([id,category])=>{
    const native=id==='native-capability';
    const evidence={schemaVersion:1,id,category,outcome:'passed',runtimeMocked:false,rendererMocked:false,applicationQueueModified:false,
      releaseReady:false,performanceAcceptance:'not-measured',physicalDeviceAcceptance:'unverified',backend:{webgl2:true,version:'WebGL 2.0',unmaskedRenderer:'fixture'},pageErrors:[],
      classification:native?'ordinary-wall-clock-capability':'controlled-clock-functional',clockInstalled:false,steps:10,ownedFencesCreated:10,ownedFencesReleased:10,
      faultInjection:id==='render-fault'?'Canvas2D.clearRect throws once':id==='frame-gap'?'Playwright clock fastForward(400)':['storage-failure','storage-session','storage-future-rollback'].includes(String(id))?'Storage.setItem throws':null,
      capabilityOutcome:'startup-and-bounded-frame-completion',observations:[{label:'home-ready'},{label:'case-assertions-completed',id},
        ...(native?[{label:'native-startup',phase:'ready',tick:0,queue:{completedCount:1}},{label:'native-start-completed',render:{calls:1,triangles:1},queue:{completedCount:2}},{label:'native-receipt-or-safety',phase:'playing',pauseReasons:[],queue:{completedCount:3}}]:[]),
        ...(String(id).startsWith('edges-')?['bomb','loop'].map(control=>({label:'native-capture-cancelled-before-up',control,pointerId:1,heldBeforeUp:[],events:['pointerdown','gotpointercapture','lostpointercapture'].map(type=>({type,pointerId:1,isTrusted:true,targetId:control}))})):[]),
        ...([8,9].includes(Number(category))?[{label:'full-text-geometry-before-assertions',issues:[],reservations:[],textGeometry:{viewport:{width:200,height:200},regions:[{key:'label',kind:'panel',rect:{x:10,y:10,width:50,height:20}}],styles:[{key:'s',overflowX:'visible',overflowY:'visible',lineClamp:'none',maxLines:'none',contain:'none',unsupported:[]}],runs:[{text:'Visible',owner:'label',ancestorRegions:['label'],fragments:[{x:10,y:10,width:40,height:15}],styleKeys:['s']}]}}]:[]),
        ...(category===8?[{label:'actual-live-dom-geometry',dom:{sites:Array(7).fill({})},layout:{status:'placed'}}]:[]),
        ...(category===9?[{label:'actual-200-percent-text',beforeMeasurements:1,afterMeasurements:2,enlargement:Array(21).fill({})}]:[])]};
    return {title:titleFor(String(id)),tests:[{projectName:'clean-browser-acceptance',expectedStatus:'passed',status:'expected',results:[{status:'passed',errors:[],attachments:[{name:'clean-acceptance-evidence',contentType:'application/json',body:Buffer.from(JSON.stringify(evidence)).toString('base64')}]}]}]};
  })}]};
}
const report=(raw:unknown)=>buildAcceptanceReport(raw,async()=>{throw new Error('missing file');});
function changeEvidence(raw:ReturnType<typeof fixture>, index:number, edit:(e:any)=>void) {
  const a=raw.suites[0].specs[index].tests[0].results[0].attachments[0]; const e=JSON.parse(Buffer.from(a.body,'base64').toString()); edit(e); a.body=Buffer.from(JSON.stringify(e)).toString('base64');
}
test('only complete exact discovery with evidence passes; release/performance remain unverified',async()=>{
  const r=await report(fixture()); assert.equal(r.browserAcceptance,'passed'); assert.equal(r.counts.validated,CASES.length);
  assert.equal(r.releaseReady,false); assert.equal(r.physicalDeviceAcceptance,'unverified'); assert.equal(r.performanceAcceptance,'not-measured');
  assert.deepEqual(r.categories.map(c=>c.category),[1,2,3,4,5,6,7,8,9,10]);
});
test('missing, malformed, empty and discovery-only output fail closed',async()=>{
  const discovery=fixture(); for(const s of discovery.suites[0].specs) s.tests[0].results=[];
  for(const raw of [undefined,{}, {suites:[]},{suites:[null]},discovery]) assert.equal((await report(raw)).browserAcceptance,'not-passed');
});
test('missing category, duplicate, renamed and wrong-project cases cannot pass',async()=>{
  for(const mutation of [(r:any)=>r.suites[0].specs.pop(),(r:any)=>r.suites[0].specs.push(r.suites[0].specs[0]),
    (r:any)=>r.suites[0].specs[0].title='renamed',(r:any)=>r.suites[0].specs[0].tests[0].projectName='other']){
    const raw=fixture(); mutation(raw); assert.equal((await report(raw)).browserAcceptance,'not-passed');
  }
});
test('failure, timeout, interruption, skip and retry retain nonpassing raw attempts',async()=>{
  for(const status of ['failed','timedOut','interrupted','skipped']) {
    const raw=fixture(); raw.suites[0].specs[0].tests[0].results[0].status=status;
    const r=await report(raw); assert.equal(r.browserAcceptance,'not-passed'); assert.equal(r.cases[0].attempts[0].status,status);
  }
  const raw=fixture(); raw.suites[0].specs[0].tests[0].results.push(raw.suites[0].specs[0].tests[0].results[0]); assert.equal((await report(raw)).browserAcceptance,'not-passed');
});
test('missing, malformed and mismatched evidence cannot inherit passed Playwright status',async()=>{
  for(const edit of [(e:any)=>{e.id='other';},(e:any)=>{e.category=10;},(e:any)=>{e.outcome='failed';},(e:any)=>{e.pageErrors=['fatal'];},
    (e:any)=>{e.backend={};},(e:any)=>{e.ownedFencesReleased=9;},(e:any)=>{e.observations=[];},(e:any)=>{e.rendererMocked=true;},
    (e:any)=>{e.performanceAcceptance='passed';},(e:any)=>{e.releaseReady=true;},(e:any)=>{e.steps=121;}]) {
    const raw=fixture();changeEvidence(raw,0,edit);assert.equal((await report(raw)).browserAcceptance,'not-passed');
  }
  const raw=fixture();raw.suites[0].specs[0].tests[0].results[0].attachments[0].body='not-json';assert.equal((await report(raw)).browserAcceptance,'not-passed');
  const absent=fixture();absent.suites[0].specs[0].tests[0].results[0].attachments=[];assert.equal((await report(absent)).browserAcceptance,'not-passed');
});
test('controlled native clock, unspecified safety, missing geometry and stale text evidence fail closed',async()=>{
  for(const [id,edit] of [
    ['native-capability',(e:any)=>{e.clockInstalled=true;}],['native-capability',(e:any)=>{e.capabilityOutcome='any-state';}],
    ['native-capability',(e:any)=>{e.capabilityOutcome='startup-frame-completion-and-one-explicit-safety-recovery';}],
    [CASES.find(c=>c[1]===8)![0],(e:any)=>{e.observations=e.observations.filter((o:any)=>o.label!=='actual-live-dom-geometry');}],
    [CASES.find(c=>c[1]===9)![0],(e:any)=>{e.observations.find((o:any)=>o.label==='actual-200-percent-text').afterMeasurements=1;}],
    ['render-fault',(e:any)=>{e.faultInjection=null;}],
  ] as const) {const raw=fixture();changeEvidence(raw,CASES.findIndex(c=>c[0]===id),edit);assert.equal((await report(raw)).browserAcceptance,'not-passed');}
});

test('expected failure, missing expectedStatus and contradictory expected status never pass',async()=>{
  for(const expectedStatus of ['failed','skipped',undefined]) { const raw=fixture(); (raw.suites[0].specs[0].tests[0] as any).expectedStatus=expectedStatus; assert.equal((await report(raw)).browserAcceptance,'not-passed'); }
});

test('native capability needs an actual later completed receipt, not merely a tick',async()=>{
  const raw=fixture();changeEvidence(raw,CASES.findIndex(c=>c[0]==='native-capability'),e=>{e.observations.find((o:any)=>o.label==='native-receipt-or-safety').queue.completedCount=2;});assert.equal((await report(raw)).browserAcceptance,'not-passed');
});

test('edge evidence must retain both trusted, ordered native cancellations before pointerup',async()=>{
 for(const edit of [(e:any)=>{e.observations=e.observations.filter((o:any)=>o.label!=='native-capture-cancelled-before-up');},(e:any)=>{e.observations.find((o:any)=>o.label==='native-capture-cancelled-before-up').events[1].isTrusted=false;}]) {const raw=fixture();changeEvidence(raw,CASES.findIndex(c=>c[0]==='edges-normal'),edit);assert.equal((await report(raw)).browserAcceptance,'not-passed');}
});

test('geometry evidence cannot omit full text or hide clipping behind an empty declared issue list',async()=>{
 for(const edit of [(e:any)=>{e.observations=e.observations.filter((o:any)=>o.label!=='full-text-geometry-before-assertions');},(e:any)=>{e.observations.find((o:any)=>o.label==='full-text-geometry-before-assertions').textGeometry.runs[0].fragments[0].x=-20;}]) {const raw=fixture();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),edit);assert.equal((await report(raw)).browserAcceptance,'not-passed');}
});

test('compact fallback cannot inherit full-text pass without a complete native detail proof',async()=>{
 const raw=fixture();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),e=>{e.observations.find((o:any)=>o.label==='actual-live-dom-geometry').dom.compact=true;});
 assert.equal((await report(raw)).browserAcceptance,'not-passed');
});

function compactFixture(){
  const raw=fixture();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),e=>{
   e.observations.find((o:any)=>o.label==='actual-live-dom-geometry').dom.compact=true;
   const persistentIds=['campaign-mode-status','lives-count','pause','bomb','loop',...Array.from({length:7},(_,i)=>`site-${i+1}`),...Array.from({length:7},(_,i)=>`campaign-site-state-${i+1}`)];
   const geometry={viewport:{width:200,height:200},regions:[{key:'viewport',kind:'detail-viewport',rect:{x:10,y:10,width:100,height:100}},{key:'entry',kind:'detail-entry',rect:{x:11,y:11,width:98,height:150}}],styles:[{key:'style:campaign-hud-details:0',clipRect:{x:11,y:11,width:98,height:98},overflowX:'hidden',overflowY:'auto',scrollWidth:98,clientWidth:98,scrollHeight:200,clientHeight:98,lineClamp:'none',maxLines:'none',contain:'none',unsupported:[]}],runs:[{text:'detail',owner:'entry',ancestorRegions:['entry','viewport'],fragments:[{x:20,y:20,width:40,height:15}],styleKeys:['style:campaign-hud-details:0']}]};
   const fragments=['entry:0:0'],samples=['keyboard','touch'].flatMap(method=>[0,100].map(scrollTop=>({method,scrollTop,phase:'playing',neutralInput:true,persistentIds,fullyVisibleFragments:fragments,fullHudScroll:{windowX:0,windowY:0,appLeft:0,appTop:0,hudLeft:0,hudTop:0}})));
   e.observations.find((o:any)=>o.label==='full-text-geometry-before-assertions').textGeometry=geometry;
   e.observations.push({label:'authorized-detail-scroll-proof',active:true,viewportId:'campaign-hud-details',expectedEntryIds:['entry'],actualEntryIds:['entry'],expectedFragments:fragments,persistentIds,samples},
    ...samples.flatMap(sample=>{const atomic={label:'detail-scroll-snapshot',...sample,geometry,reservations:[],scrollTopBefore:sample.scrollTop,scrollHeight:200,clientHeight:98,motion:{sequence:1,endedSequence:1,endCount:1,trusted:true},input:{keys:[],steerPointer:null,turn:0,climb:0,heldPointers:{}},statusEvidence:{screen:'playing',status:'running',position:{x:0,y:400,z:0},protectionTicks:0,reloadTicksRemaining:0,text:{}}};const operation={kind:sample.scrollTop===0?'home':sample.method==='keyboard'?'arrow':'touch',before:{scrollTop:0,motion:{sequence:sample.scrollTop===0?1:0,endedSequence:sample.scrollTop===0?1:0,endCount:sample.scrollTop===0?1:0,trusted:true}}};return [{label:'detail-scroll-observation-attempt',method:sample.method,operation,outcome:'settled',totalWallMs:100,fullCaptures:2,candidates:1,history:[{stage:'native-wait',elapsedWallMs:0}],ticks:[]},{...atomic,settling:{first:structuredClone(detailScrollMeasurement(atomic as any)),elapsedWallMs:32,totalWallMs:100,operation}}];}),
    {label:'detail-scroll-native-events',events:['keydown','keyup','pointerdown','touchstart','touchend','scroll','scrollend'].map(type=>({type,isTrusted:true,key:type==='keydown'?'ArrowDown':undefined,pointerType:type==='pointerdown'?'touch':undefined}))},
    ...Array.from({length:4},(_,i)=>({label:'detail-scroll-consumed-neutral-input',tick:i+1,input:{turn:0,climb:0,fire:false,bomb:false,loop:false,accelerate:false,brake:false}})));
  });return raw;
}
test('compact report recomputes raw consumed neutral input and rejects every action even with a neutral label',async()=>{
 const make=compactFixture;
 assert.equal((await report(make())).browserAcceptance,'passed');
 for(const key of ['turn','climb','fire','bomb','loop','accelerate','brake']){
  const raw=make();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),e=>{e.observations.find((o:any)=>o.label==='detail-scroll-consumed-neutral-input').input[key]=['turn','climb'].includes(key)?1:true;});
  assert.equal((await report(raw)).browserAcceptance,'not-passed',key);
 }
 for(const corrupt of [(s:any)=>{delete s.settling;},(s:any)=>{s.settling.elapsedWallMs=0;},(s:any)=>{s.scrollTopBefore=7;},(s:any)=>{s.motion.endedSequence=0;},(s:any)=>{s.settling.first.fragments[0].fragments[0].y+=18;},(s:any)=>{s.input.turn=1;},(s:any)=>{s.phase='paused';},(s:any)=>{s.fullHudScroll.hudTop=4;}]){
  const raw=make();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),e=>corrupt(e.observations.find((o:any)=>o.label==='detail-scroll-snapshot')));
  assert.equal((await report(raw)).browserAcceptance,'not-passed','unsettled, inconsistent or non-neutral snapshot fails closed');
 }
 for(const corrupt of [(a:any)=>{a.outcome='failed';},(a:any)=>{a.history=[];},(a:any)=>{a.fullCaptures=1;},(a:any)=>{a.operation.kind='direct-scroll';},(a:any)=>{a.history=Array(33).fill({});}]){
  const raw=make();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),e=>corrupt(e.observations.find((o:any)=>o.label==='detail-scroll-observation-attempt')));
  assert.equal((await report(raw)).browserAcceptance,'not-passed','missing or contradictory bounded history fails');
 }
 const hidden=make();changeEvidence(hidden,CASES.findIndex(c=>c[1]===8),e=>{e.observations.find((o:any)=>o.label==='detail-scroll-snapshot').statusEvidence.protectionTicks=60;});
 assert.equal((await report(hidden)).browserAcceptance,'not-passed','active warning cannot disappear from raw persistent evidence');
});

test('report indexes full attachment bytes without duplicating payload; validation still inspects full evidence',async()=>{
 const raw=fixture(); const padding='large-payload-'.repeat(200000);
 changeEvidence(raw,0,e=>{e.padding=padding;e.pageErrors=['failure after a large payload'];});
 const saved:Buffer[]=[];
 const {byteReference}=await import('../scripts/acceptance-report-storage');
 const r=await buildAcceptanceReport(raw,async()=>{throw new Error('unexpected file');},async bytes=>{
  saved.push(bytes);return {...byteReference(bytes),path:`evidence/${saved.length}.bin`};
 });
 assert.equal(r.browserAcceptance,'not-passed');assert.equal(r.cases[0].validated,false);
 assert.ok(r.cases[0].errors.includes('Page errors or missing error evidence'));
 assert.equal(r.schemaVersion,2);assert.ok(JSON.stringify(r).length<100000);
 assert.equal(JSON.stringify(r).includes('large-payload-'),false);
 assert.equal(r.cases[0].attempts[0].attachments[0].body,undefined);
 assert.equal(r.cases[0].evidence.sha256,byteReference(saved[0]).sha256);
 assert.equal(JSON.parse(saved[0].toString()).padding,padding);
 assert.equal(r.cases[0].rawPointer,'/suites/0/specs/0/tests/0');
});

test('unavailable evidence storage fails closed and retries retain every attachment reference',async()=>{
 const raw=fixture();raw.suites[0].specs[0].tests[0].results.push(raw.suites[0].specs[0].tests[0].results[0]);
 const r=await report(raw);assert.equal(r.browserAcceptance,'not-passed');
 assert.equal(r.cases[0].attempts.length,2);
 assert.equal(r.cases[0].attempts[1].attachments.length,1);
 const failed=await buildAcceptanceReport(fixture(),async()=>'',async()=>{throw new Error('storage failed');});
 assert.equal(failed.browserAcceptance,'not-passed');assert.equal(failed.counts.validated,0);
 assert.ok(failed.cases.every(c=>c.errors.some((e:string)=>e.includes('storage failed'))));
});

test('late scroll completion must match independent native event records, including target identity',async()=>{
 const make=()=>{const raw=compactFixture();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),e=>{
  const sample=e.observations.find((o:any)=>o.label==='detail-scroll-snapshot');
  const position={target:'campaign-hud-details',targetIsViewport:true,isTrusted:true,scrollTop:sample.scrollTop,scrollHeight:sample.scrollHeight,clientHeight:sample.clientHeight};
  sample.motion={sequence:2,endedSequence:1,endCount:2,trusted:true,trailingSamePosition:true,
   completion:{...position,sequence:1},lastScroll:{...position,sequence:2},trailingScrolls:[{...position,sequence:2}]};
  sample.settling.first=structuredClone(detailScrollMeasurement(sample));
  const log=e.observations.find((o:any)=>o.label==='detail-scroll-native-events');
  log.events=log.events.filter((event:any)=>!['scroll','scrollend'].includes(event.type));
  log.events.push({type:'scrollend',...position,sequence:0,endCount:1},{type:'scroll',...position,sequence:1},{type:'scrollend',...position,sequence:1,endCount:2},{type:'scroll',...position,sequence:2});
 });return raw;};
 assert.equal((await report(make())).browserAcceptance,'passed');
 const corruptions=[
  (events:any[])=>events.filter(e=>e.type!=='scrollend'),
  (events:any[])=>events.filter(e=>!(e.type==='scroll'&&e.sequence===2)),
  (events:any[])=>[...events,{...events.find(e=>e.type==='scrollend'&&e.endCount===2)}],
  ...['target','targetIsViewport','scrollTop','scrollHeight','clientHeight','sequence','endCount'].map(key=>(events:any[])=>events.map(e=>e.type==='scrollend'?{...e,[key]:key==='target'?'other':key==='targetIsViewport'?false:999}:e)),
  (events:any[])=>events.map(e=>e.type==='scroll'&&e.sequence===2?{...e,scrollTop:99}:e),
  // Retain the event count but remove all event-time coordinate/target evidence.
  (events:any[])=>events.map(e=>['scroll','scrollend'].includes(e.type)?{type:e.type,isTrusted:true}:e),
 ];
 for(const corrupt of corruptions){const raw=make();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),e=>{
  const log=e.observations.find((o:any)=>o.label==='detail-scroll-native-events');log.events=corrupt(log.events);
 });assert.equal((await report(raw)).browserAcceptance,'not-passed','forged/missing independent event evidence must fail closed');}
});

test('Tab settlement cannot claim more trusted native Tab inputs than the retained event log',async()=>{
 const make=()=>{const raw=compactFixture();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),e=>{
  const sample=e.observations.find((o:any)=>o.label==='detail-scroll-snapshot');
  sample.motion.tabCount=1;sample.focusEntry='entry';
  sample.settling.operation={kind:'tab',entryId:'entry',before:{scrollTop:0,focusEntry:'other',motion:{sequence:1,endedSequence:1,endCount:1,trusted:true,tabCount:0}}};
  sample.settling.first=structuredClone(detailScrollMeasurement(sample));
  e.observations.find((o:any)=>o.label==='detail-scroll-observation-attempt').operation=structuredClone(sample.settling.operation);
  e.observations.find((o:any)=>o.label==='detail-scroll-native-events').events.push({type:'keydown',key:'Tab',isTrusted:true});
 });return raw;};
 assert.equal((await report(make())).browserAcceptance,'passed');
 for(const edit of [
  (e:any)=>{const log=e.observations.find((o:any)=>o.label==='detail-scroll-native-events');log.events=log.events.filter((event:any)=>event.key!=='Tab');},
  (e:any)=>{e.observations.find((o:any)=>o.label==='detail-scroll-native-events').events.find((event:any)=>event.key==='Tab').isTrusted=false;},
  (e:any)=>{const sample=e.observations.find((o:any)=>o.label==='detail-scroll-snapshot');sample.motion.tabCount=2;sample.settling.first=structuredClone(detailScrollMeasurement(sample));},
 ]){const raw=make();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),edit);assert.equal((await report(raw)).browserAcceptance,'not-passed');}
});
