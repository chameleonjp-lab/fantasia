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

test('compact report recomputes raw consumed neutral input and rejects every action even with a neutral label',async()=>{
 const make=()=>{
  const raw=fixture();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),e=>{
   e.observations.find((o:any)=>o.label==='actual-live-dom-geometry').dom.compact=true;
   const persistentIds=['campaign-mode-status','lives-count','pause','bomb','loop',...Array.from({length:7},(_,i)=>`site-${i+1}`),...Array.from({length:7},(_,i)=>`campaign-site-state-${i+1}`)];
   const geometry={viewport:{width:200,height:200},regions:[{key:'viewport',kind:'detail-viewport',rect:{x:10,y:10,width:100,height:100}},{key:'entry',kind:'detail-entry',rect:{x:11,y:11,width:98,height:150}}],styles:[{key:'style:campaign-hud-details:0',clipRect:{x:11,y:11,width:98,height:98},overflowX:'hidden',overflowY:'auto',scrollWidth:98,clientWidth:98,scrollHeight:200,clientHeight:98,lineClamp:'none',maxLines:'none',contain:'none',unsupported:[]}],runs:[{text:'detail',owner:'entry',ancestorRegions:['entry','viewport'],fragments:[{x:20,y:20,width:40,height:15}],styleKeys:['style:campaign-hud-details:0']}]};
   const fragments=['entry:0:0'],samples=['keyboard','touch'].flatMap(method=>[0,100].map(scrollTop=>({method,scrollTop,phase:'playing',neutralInput:true,persistentIds,fullyVisibleFragments:fragments,fullHudScroll:{windowX:0,windowY:0,appLeft:0,appTop:0,hudLeft:0,hudTop:0}})));
   e.observations.find((o:any)=>o.label==='full-text-geometry-before-assertions').textGeometry=geometry;
   e.observations.push({label:'authorized-detail-scroll-proof',active:true,viewportId:'campaign-hud-details',expectedEntryIds:['entry'],actualEntryIds:['entry'],expectedFragments:fragments,persistentIds,samples},
    ...samples.map(sample=>({label:'detail-scroll-snapshot',...sample,geometry,reservations:[],statusEvidence:{screen:'playing',status:'running',position:{x:0,y:400,z:0},protectionTicks:0,reloadTicksRemaining:0,text:{}}})),
    {label:'detail-scroll-native-events',events:['keydown','keyup','pointerdown','touchstart','touchend'].map(type=>({type,isTrusted:true,key:type==='keydown'?'ArrowDown':undefined,pointerType:type==='pointerdown'?'touch':undefined}))},
    ...Array.from({length:4},(_,i)=>({label:'detail-scroll-consumed-neutral-input',tick:i+1,input:{turn:0,climb:0,fire:false,bomb:false,loop:false,accelerate:false,brake:false}})));
  });return raw;
 };
 assert.equal((await report(make())).browserAcceptance,'passed');
 for(const key of ['turn','climb','fire','bomb','loop','accelerate','brake']){
  const raw=make();changeEvidence(raw,CASES.findIndex(c=>c[1]===8),e=>{e.observations.find((o:any)=>o.label==='detail-scroll-consumed-neutral-input').input[key]=['turn','climb'].includes(key)?1:true;});
  assert.equal((await report(raw)).browserAcceptance,'not-passed',key);
 }
 const hidden=make();changeEvidence(hidden,CASES.findIndex(c=>c[1]===8),e=>{e.observations.find((o:any)=>o.label==='detail-scroll-snapshot').statusEvidence.protectionTicks=60;});
 assert.equal((await report(hidden)).browserAcceptance,'not-passed','active warning cannot disappear from raw persistent evidence');
});
