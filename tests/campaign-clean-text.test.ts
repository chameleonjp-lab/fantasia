import test from 'node:test';
import assert from 'node:assert/strict';
import {textGeometryIssues,type TextGeometry,type TextStyleEvidence} from '../browser-acceptance/text-geometry';
const style=(overrides:Partial<TextStyleEvidence>={}):TextStyleEvidence=>({key:'button-style',rect:{x:50,y:50,width:52,height:52},clipRect:{x:51,y:51,width:50,height:50},overflowX:'visible',overflowY:'visible',textOverflow:'clip',scrollWidth:59,clientWidth:50,scrollHeight:50,clientHeight:50,whiteSpace:'nowrap',lineClamp:'none',maxLines:'none',contain:'none',transform:'none',translate:'none',zoom:'1',clipPath:'none',maskImage:'none',legacyClip:'auto',borderRadius:['50%','50%','50%','50%'],overflowClipMargin:'0px',unsupported:[],...overrides});
function fixture():TextGeometry{return {viewport:{width:300,height:200},regions:[{key:'bomb',kind:'control',rect:{x:50,y:50,width:52,height:52}}],styles:[style()],runs:[{text:'落下地点の予測',owner:'bomb',ancestorRegions:['bomb'],fragments:[{x:45,y:90,width:62,height:10}],styleKeys:['button-style']}]};}
test('complete readable description may extend outside its own overflow-visible circle',()=>{
 assert.deepEqual(textGeometryIssues(fixture()),[]);
});
test('real overflow-hidden clipping, viewport loss and foreign control/sight collision fail',()=>{
 let d=fixture();d.styles=[style({overflowX:'hidden'})];assert.ok(textGeometryIssues(d).some(s=>s.includes('clipped-inline-overflow')));
 d=fixture();d.runs[0].fragments[0].x=-2;assert.ok(textGeometryIssues(d).some(s=>s.includes('outside-viewport')));
 d=fixture();d.regions.push({key:'pause',kind:'control',rect:{x:105,y:85,width:44,height:44}});assert.ok(textGeometryIssues(d).some(s=>s.includes('overlaps-control pause')));
 d=fixture();assert.ok(textGeometryIssues(d,[{key:'sight',kind:'sight',rect:{x:100,y:88,width:40,height:40}}]).some(s=>s.includes('overlaps-sight')));
});
test('ellipsis truncation fails even if a reported Range fragment fits; exact fitting boundary passes',()=>{
 const d=fixture();d.styles=[style({overflowX:'hidden',textOverflow:'ellipsis',borderRadius:['0px','0px','0px','0px']})];d.runs[0].fragments=[{x:52,y:90,width:45,height:10}];
 assert.ok(textGeometryIssues(d).some(s=>s.includes('clipped-inline-overflow(ellipsis)')));
 d.styles[0].scrollWidth=50;assert.deepEqual(textGeometryIssues(d),[]);
});
test('all wrapped fragments are checked independently, including later clipped lines',()=>{
 const d=fixture();d.runs[0].fragments=[{x:45,y:90,width:62,height:10},{x:45,y:110,width:40,height:10}];assert.deepEqual(textGeometryIssues(d),[]);
 d.runs[0].fragments[1].y=195;assert.ok(textGeometryIssues(d).some(s=>s.includes('outside-viewport')));
});
test('ancestor clip uses its client/padding box and cannot hide behind own-owner exclusion',()=>{
 const d=fixture();d.styles.push(style({key:'ancestor',overflowX:'hidden',overflowY:'hidden',scrollWidth:200,clientWidth:200,scrollHeight:100,clientHeight:100,clipRect:{x:60,y:0,width:200,height:100},borderRadius:['0px','0px','0px','0px']}));d.runs[0].styleKeys.push('ancestor');
 assert.ok(textGeometryIssues(d).some(s=>s.includes('text-crosses-clip at ancestor')));
});
test('line clamp, unhandled transform/clip and missing visible fragments fail unverified',()=>{
 for(const change of [(d:TextGeometry)=>{d.styles[0].lineClamp='2';},(d:TextGeometry)=>{d.styles[0].unsupported=['rounded-clip'];},(d:TextGeometry)=>{d.runs[0].fragments=[];},(d:TextGeometry)=>{d.runs[0].fragments[0].height=0;},(d:TextGeometry)=>{d.runs[0].styleKeys=[];}]) {const d=fixture();change(d);assert.ok(textGeometryIssues(d).length>0);}
});
test('two outside-circle descriptions must not collide with each other',()=>{
 const d=fixture();d.regions.push({key:'loop',kind:'control',rect:{x:180,y:50,width:52,height:52}});d.runs.push({text:'すぐ使える',owner:'loop',ancestorRegions:['loop'],fragments:[{x:100,y:90,width:62,height:10}],styleKeys:['button-style']});
 assert.ok(textGeometryIssues(d).some(s=>s.includes('text-owner-collision')));
});
test('distinct same-owner text runs cannot obscure one another; adjacent nested text remains valid',()=>{
 const d=fixture();d.runs.push({...d.runs[0],text:'残り2発',fragments:[{x:80,y:91,width:20,height:8}]});
 assert.ok(textGeometryIssues(d).some(s=>s.includes('text-owner-collision bomb / bomb')));
 d.runs[1].fragments=[{x:108,y:90,width:20,height:10}];assert.deepEqual(textGeometryIssues(d),[]);
});

import {runInNewContext} from 'node:vm';
import {collectHudTextGeometry} from '../browser-acceptance/text-geometry';
test('serialized in-page collector does not depend on host transpiler closure helpers',()=>{
 const source=`(${collectHudTextGeometry.toString()})(()=>true)`;
 const result=runInNewContext(source,{document:{querySelectorAll:()=>[]},innerWidth:300,innerHeight:200});
 assert.equal(result.viewport.width,300);assert.equal(result.runs.length,0);
 // An empty fixture is never browser acceptance; the pure gate rejects it.
 assert.ok(textGeometryIssues(result).includes('missing-visible-text-runs'));
});
