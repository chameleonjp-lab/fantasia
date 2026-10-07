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
