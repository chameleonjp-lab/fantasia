import test from 'node:test';import assert from 'node:assert/strict';
import {detailAccessIssues,type DetailAccessEvidence} from '../browser-acceptance/detail-scroll-contract';
function fixture():DetailAccessEvidence{return {active:true,viewportId:'campaign-hud-details',expectedEntryIds:['timer','site-1'],actualEntryIds:['timer','site-1'],expectedFragments:['timer:0:0','site-1:0:0'],persistentIds:['site-1','site-2','site-3','site-4','site-5','site-6','site-7','campaign-mode-status','lives-count',...Array.from({length:7},(_,i)=>`campaign-site-state-${i+1}`),'pause','bomb','loop'],samples:['keyboard','touch'].flatMap(method=>[0,100].map((scrollTop,i)=>({method:method as 'keyboard'|'touch',scrollTop,phase:'playing',neutralInput:true,fullHudScroll:{windowX:0,windowY:0,appLeft:0,appTop:0,hudLeft:0,hudTop:0},persistentIds:['site-1','site-2','site-3','site-4','site-5','site-6','site-7','campaign-mode-status','lives-count',...Array.from({length:7},(_,i)=>`campaign-site-state-${i+1}`),'pause','bomb','loop'],fullyVisibleFragments:[i?'site-1:0:0':'timer:0:0']}))) };}
test('every detail fragment is reached by native keyboard and touch while critical HUD stays fixed',()=>assert.deepEqual(detailAccessIssues(fixture()),[]));
test('missing details, fake nonmoving samples, unread fragments and whole-HUD scroll fail',()=>{
 for(const change of [(e:DetailAccessEvidence)=>e.actualEntryIds.pop(),(e:DetailAccessEvidence)=>{for(const s of e.samples)s.scrollTop=0;},(e:DetailAccessEvidence)=>{e.samples[3].fullyVisibleFragments=[];},(e:DetailAccessEvidence)=>{e.samples[0].fullHudScroll.hudTop=5;},(e:DetailAccessEvidence)=>{e.samples[0].persistentIds=[];},(e:DetailAccessEvidence)=>{e.samples[1].neutralInput=false;},(e:DetailAccessEvidence)=>{e.samples[0].phase='paused';}]){const e=fixture();change(e);assert.ok(detailAccessIssues(e).length>0);}
});

import {consumedDetailInputIssues} from '../browser-acceptance/detail-scroll-contract';
const consumedFixture=()=>Array.from({length:4},(_,i)=>({label:'detail-scroll-consumed-neutral-input',tick:i+1,input:{turn:0,climb:0,accelerate:false,brake:false,fire:false,bomb:false,loop:false}}));
test('report independently validates every consumed neutral field instead of trusting its label',()=>{
 assert.deepEqual(consumedDetailInputIssues(consumedFixture()),[]);
 const torpedo=consumedFixture();(torpedo[0].input as any).torpedo=true;assert.ok(consumedDetailInputIssues(torpedo).some(s=>s.includes('torpedo')));
 for(const key of ['turn','climb','accelerate','brake','fire','bomb','loop']){
   const records=consumedFixture();(records[2].input as any)[key]=['turn','climb'].includes(key)?1:true;
   assert.ok(consumedDetailInputIssues(records).some(issue=>issue.includes(key)));
   delete (records[2].input as any)[key];assert.ok(consumedDetailInputIssues(records).some(issue=>issue.includes(key)));
 }
});
test('missing raw samples, labels only, malformed ticks and partial neutral fields fail closed',()=>{
 for(const records of [undefined,[],consumedFixture().slice(0,3),Array(4).fill({label:'detail-scroll-consumed-neutral-input'}),Array(4).fill({tick:1,input:{turn:0,climb:0}}),Array(4).fill({tick:NaN,input:consumedFixture()[0].input})])assert.ok(consumedDetailInputIssues(records).length);
});

import {activeFixedStatusIds,type FixedStatusEvidence} from '../browser-acceptance/detail-scroll-contract';
const statusFixture=():FixedStatusEvidence=>({screen:'playing',status:'running',position:{x:0,y:400,z:0},protectionTicks:0,reloadTicksRemaining:0,text:{'campaign-threat':'','reload-status':'','payload-status':''}});
test('active warnings derive from state while dormant nonempty warning and respawn text do not force visibility',()=>{
 const e=statusFixture();e.text.warning='低空注意';e.text['respawn-status']='復活まで1秒';assert.deepEqual(activeFixedStatusIds(e),[]);
 for(const mutate of [(e:FixedStatusEvidence)=>{e.position.y=20;},(e:FixedStatusEvidence)=>{e.position.x=2200;},(e:FixedStatusEvidence)=>{e.protectionTicks=60;}]){const active=statusFixture();mutate(active);assert.ok(activeFixedStatusIds(active).includes('warning'));}
 e.status='respawning';assert.ok(activeFixedStatusIds(e).includes('respawn-status'));
});
test('nonempty threat/reload/payload and actual reload stay required regardless of hidden or missing text',()=>{
 const e=statusFixture();for(const id of ['campaign-threat','reload-status','payload-status'])e.text[id]='active';assert.deepEqual(activeFixedStatusIds(e),['campaign-threat','reload-status','payload-status']);
 const reload=statusFixture();reload.reloadTicksRemaining=60;assert.deepEqual(activeFixedStatusIds(reload),['reload-status']);
});

import {detailScrollMeasurement,detailSettlingIssues} from '../browser-acceptance/detail-scroll-observation';
import {collectHudTextGeometry} from '../browser-acceptance/text-geometry';
import {runInNewContext} from 'node:vm';
function atomicFixture(){
 const sample={scrollTop:100,scrollTopBefore:100,scrollHeight:200,clientHeight:98,motion:{sequence:3,endedSequence:3,trusted:true},
  input:{keys:[],steerPointer:null,turn:0,climb:0,heldPointers:{bomb:[],loop:[]}},
  geometry:{viewport:{width:200,height:200},regions:[{key:'viewport',kind:'detail-viewport',rect:{x:0,y:0,width:200,height:98}}],styles:[],runs:[{text:'last fragment',owner:'last',ancestorRegions:[],styleKeys:[],fragments:[{x:2,y:75,width:60,height:21}]}]}};
 return {...sample,settling:{first:structuredClone(detailScrollMeasurement(sample)),elapsedWallMs:32}};
}
test('native scroll completion and real-wall-time stable geometry are both required',()=>{
 assert.deepEqual(detailSettlingIssues(atomicFixture()),[]);
 for(const change of [(s:any)=>delete s.settling,(s:any)=>s.settling.elapsedWallMs=0,(s:any)=>s.settling.elapsedWallMs=1501,(s:any)=>s.settling.elapsedWallMs=NaN,
  (s:any)=>s.motion.endedSequence=2,(s:any)=>s.motion.trusted=false,(s:any)=>s.motion.sequence=.5,(s:any)=>s.scrollTopBefore=82,
  (s:any)=>s.geometry.runs[0].fragments[0].y+=18,(s:any)=>s.geometry.regions[0].rect.height=90,(s:any)=>s.clientHeight=100,
  (s:any)=>s.input.keys.push('ArrowDown'),(s:any)=>s.input.heldPointers.bomb.push(1),(s:any)=>delete s.input]){
  const sample=atomicFixture();change(sample);assert.ok(detailSettlingIssues(sample).length,'unsettled/malformed evidence must fail');
 }
});
test('atomic collector handle expression remains browser-serializable without host dependencies',()=>{
 const collector=runInNewContext(`(${collectHudTextGeometry.toString()})`);
 assert.equal(typeof collector,'function');
 assert.ok(!collector.toString().includes('__name'));
});
