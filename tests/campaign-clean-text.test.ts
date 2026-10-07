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

import {detailGeometrySnapshot} from '../browser-acceptance/text-geometry';
function detailFixture():TextGeometry {
 const d=fixture();d.regions.push({key:'details',kind:'detail-viewport',rect:{x:150,y:20,width:100,height:80}},{key:'entry',kind:'detail-entry',rect:{x:152,y:22,width:90,height:180}});
 d.styles.push(style({key:'style:campaign-hud-details:1',clipRect:{x:151,y:21,width:98,height:78},overflowX:'hidden',overflowY:'auto',scrollWidth:98,clientWidth:98,scrollHeight:220,clientHeight:78,borderRadius:['0px','0px','0px','0px']}));
 d.runs.push({text:'all detail lines',owner:'entry',ancestorRegions:['entry','details'],fragments:[{x:155,y:30,width:80,height:18},{x:155,y:120,width:80,height:18}],styleKeys:['style:campaign-hud-details:1']});return d;
}
test('authorized viewport exposes only fully visible fragments while keeping every fragment in required inventory',()=>{
 const d=detailFixture(),s=detailGeometrySnapshot(d);assert.equal(s.expected.length,2);assert.equal(s.visible.length,1);assert.deepEqual(s.completenessIssues,[]);assert.deepEqual(textGeometryIssues(s.projected),[]);
 assert.equal(d.runs[1].owner,'entry');assert.equal(d.runs[1].fragments.length,2);
});
test('detail scroll permission never excuses inline ellipsis, inner clipping, clamp or foreign sight overlap',()=>{
 let d=detailFixture();d.styles[1].scrollWidth=120;assert.ok(detailGeometrySnapshot(d).completenessIssues.length);
 d=detailFixture();d.styles[1].lineClamp='1';assert.ok(detailGeometrySnapshot(d).completenessIssues.length);
 d=detailFixture();d.styles.push(style({key:'inner',overflowY:'hidden',scrollHeight:300}));d.runs[1].styleKeys.push('inner');assert.ok(detailGeometrySnapshot(d).completenessIssues.length);
 d=detailFixture();assert.ok(textGeometryIssues(detailGeometrySnapshot(d).projected,[{key:'sight',kind:'sight',rect:{x:150,y:30,width:100,height:20}}]).some(s=>s.includes('overlaps-sight')));
});
test('persistent clipping and same-detail-owner text collision remain failures in fallback',()=>{
 let d=detailFixture();d.runs[0].fragments[0].x=-10;assert.ok(textGeometryIssues(detailGeometrySnapshot(d).projected).some(s=>s.includes('outside-viewport')));
 d=detailFixture();d.runs.push({...d.runs[1],text:'another text',fragments:[{x:155,y:31,width:30,height:18}]});assert.ok(textGeometryIssues(detailGeometrySnapshot(d).projected).some(s=>s.includes('text-owner-collision')));
});

test('detail ancestry clips panel-first announcement/flight-tip obstacles and preserves raw evidence',()=>{
 const d=detailFixture();d.regions[2].kind='panel';d.regions[2].key='announcement';d.runs[1].owner='announcement';d.runs[1].ancestorRegions=['announcement','details'];
 d.regions[2].rect={x:40,y:110,width:200,height:80};
 // This owner has overflow-visible text inside the viewport despite its own
 // offscreen box. The raw border box must not obstruct the fixed button label.
 const before=JSON.stringify(d),s=detailGeometrySnapshot(d);
 assert.deepEqual(textGeometryIssues(s.projected),[]);assert.equal(JSON.stringify(d),before);
 assert.equal(s.projected.regions.find(r=>r.key==='announcement')!.rect.height,0);
 assert.equal(s.expected.length,2);assert.equal(s.visible.length,1);
 d.regions.push({key:'flight-tip',kind:'panel',ancestorRegions:['details'],rect:{x:40,y:90,width:100,height:50}});
 assert.deepEqual(textGeometryIssues(detailGeometrySnapshot(d).projected),[],'DOM ancestry also handles text-free regions');
});
test('partially visible detail panel keeps its visible obstacle, but its clipped tail is not an obstacle',()=>{
 const d=detailFixture();d.regions[2].kind='panel';d.regions[2].ancestorRegions=['details'];d.regions[2].rect={x:140,y:80,width:130,height:80};
 let s=detailGeometrySnapshot(d);assert.deepEqual(s.projected.regions.find(r=>r.key==='entry')!.rect,{x:151,y:80,width:98,height:19});
 d.runs[0].fragments=[{x:155,y:84,width:20,height:10}];
 assert.ok(textGeometryIssues(detailGeometrySnapshot(d).projected).some(s=>s.includes('text-overlaps-panel entry')),'visible foreign overlap still fails');
 d.runs[0].fragments=[{x:155,y:110,width:20,height:10}];
 assert.deepEqual(textGeometryIssues(detailGeometrySnapshot(d).projected),[],'clipped tail has no visible ink or obstacle');
});
test('fixed critical panels and controls never gain scroll permission from their kind or position',()=>{
 for(const kind of ['panel','persistent','control','detail-entry']) {
  const d=detailFixture();d.regions.push({key:'critical',kind,ancestorRegions:[],rect:{x:50,y:90,width:30,height:10}});
  assert.ok(textGeometryIssues(detailGeometrySnapshot(d).projected).some(s=>s.includes(`text-overlaps-${kind} critical`)));
 }
 const d=detailFixture();d.regions[2].ancestorRegions=[];
 assert.deepEqual(detailGeometrySnapshot(d).projected.regions.find(r=>r.key==='entry')!.rect,d.regions[2].rect,'explicit DOM ancestry is authoritative over legacy fallback');
});

test('collector records actual viewport ancestry even when panel selector wins deduplication',()=>{
 const viewport:any={id:'campaign-hud-details',className:'',getBoundingClientRect:()=>({x:10,y:10,width:100,height:80})};
 const announcement:any={id:'announcement',className:'',getBoundingClientRect:()=>({x:10,y:120,width:100,height:20})};
 const fixed:any={id:'warning',className:'',getBoundingClientRect:()=>({x:10,y:120,width:100,height:20})};
 viewport.contains=(n:any)=>n===viewport||n===announcement;announcement.contains=(n:any)=>n===announcement;fixed.contains=(n:any)=>n===fixed;
 const document={querySelectorAll:(selector:string)=>selector==='#campaign-hud-details'?[viewport]:selector==='#campaign-hud-details [data-campaign-detail]'?[announcement]:selector.startsWith('.flight-data')?[announcement,fixed]:[],createTreeWalker:()=>({nextNode:()=>null})};
 const result=runInNewContext(`(${collectHudTextGeometry.toString()})(()=>true)`,{document,NodeFilter:{SHOW_TEXT:4},innerWidth:300,innerHeight:200});
 const detail=result.regions.find((r:any)=>r.kind==='detail-viewport'),panel=result.regions.find((r:any)=>r.key.startsWith('panel:announcement:')),warning=result.regions.find((r:any)=>r.key.startsWith('panel:warning:'));
 assert.equal(panel.kind,'panel');assert.equal(panel.ancestorRegions.length,1);assert.equal(panel.ancestorRegions[0],detail.key);
 assert.equal(warning.ancestorRegions.length,0);assert.equal(result.regions.length,3);
});
