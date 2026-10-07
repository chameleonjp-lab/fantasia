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
