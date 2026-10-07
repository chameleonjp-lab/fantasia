import {criticalStateActive,criticalText,fixedCriticalTextIssues,FIXED_INSTRUMENTS,type CriticalKind} from '../browser-acceptance/active-critical-contract';
import {detailGeometrySnapshot,textGeometryIssues,type TextRegion} from '../browser-acceptance/text-geometry';
import {createHash} from 'node:crypto';
type Json=Record<string,any>;
export type SupplementalSuite='throttle'|'active-critical';
export const throttleIds=['throttle-normal','throttle-easy','throttle-save','throttle-recovery'];
const profiles=['small-portrait','small-landscape','portrait-text-200'];
const sequences=['descent-lifecycle','flight-warning-sequence'];
const modes=['normal','easy'];
export const supplementalRegistry=(suite:SupplementalSuite)=>suite==='throttle'?throttleIds:profiles.flatMap(p=>modes.flatMap(m=>sequences.map(s=>`${p}/${m}/${s}`)));
const emptyArray=(v:unknown)=>Array.isArray(v)&&v.length===0;
const count=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
const validBackend=(v:any)=>v?.webgl2===true&&typeof v.version==='string'&&v.version.length>0&&typeof v.renderer==='string'&&v.renderer.length>0&&typeof v.browserDpr==='number'&&Number.isFinite(v.browserDpr)&&v.browserDpr>0;
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export async function supplementalReport(raw:any,suite:SupplementalSuite,read:(path:string)=>Promise<Buffer>) {
  const expected=supplementalRegistry(suite),seen=new Set<string>(),issues:string[]=[],cases:Json[]=[];
  if(!raw||!Array.isArray(raw.suites))issues.push('Missing Playwright suites');
  if(raw?.errors?.length)issues.push('Top-level runner errors');
  async function visit(node:any,ancestors:string[]=[],pointer='') {
    if(!node||typeof node!=='object'){issues.push('Malformed suite');return;}
    const trail=[...ancestors,node.title];
    for(const [si,spec] of (node.specs??[]).entries()) for(const [ti,test] of (spec.tests??[]).entries()) {
      const errors:string[]=[];
      const id=suite==='throttle'?(String(spec.title).match(/^\[(throttle-[a-z]+)\]/)?.[1]??'unknown')
        :`${trail.find(t=>String(t).startsWith('active-critical-'))?.slice('active-critical-'.length)}/${String(spec.title).endsWith('-normal')?'normal':'easy'}/${String(spec.title).replace(/-(normal|easy)$/,'')}`;
      if(!id||!expected.includes(id))errors.push('Unexpected case');
      if(seen.has(id))errors.push('Duplicate case');seen.add(id);
      const project=suite==='throttle'?'clean-browser-acceptance':'active-critical-candidate';
      if(test.projectName!==project||test.expectedStatus!=='passed'||test.status!=='expected')errors.push('Unexpected project/status');
      if(!Array.isArray(test.results)||test.results.length!==1)errors.push('Exactly one attempt required');
      const attempts=test.results??[];if(attempts.some((a:any)=>a.status!=='passed'||a.retry!==0||a.error||a.errors?.length))errors.push('Failed/retried/skipped attempt');
      const name=suite==='throttle'?'throttle-integration-evidence':'active-critical-evidence';
      const attachments=attempts.flatMap((a:any)=>a.attachments??[]),matches=attachments.filter((a:any)=>a.name===name);
      let evidence:any;const refs:Json[]=[];
      for(const [i,a]of attachments.entries())try {
        if(typeof a.body!=='string'&&typeof a.path!=='string')throw Error('No evidence bytes');
        const bytes=typeof a.body==='string'?Buffer.from(a.body,'base64'):await read(a.path);
        refs.push({name:a.name,bytes:bytes.length,sha256:hash(bytes),...(a.path?{path:a.path}:{rawPointer:`${pointer}/specs/${si}/tests/${ti}/results/0/attachments/${i}/body`,encoding:'base64'})});
        if(a.name===name){if(a.contentType!=='application/json')throw Error('Wrong content type');evidence=JSON.parse(bytes.toString('utf8'));}
      }catch(e){errors.push(`Unreadable attachment: ${String(e)}`);}
      if(matches.length!==1||!evidence)errors.push('Exactly one readable evidence required');
      if(evidence) {
        if(evidence.physicalDeviceAcceptance!=='unverified'||evidence.performanceAcceptance!=='not-measured'||!validBackend(evidence.backend))errors.push('Missing renderer identity/verification boundary');
        if(evidence.outcome!=='passed'||evidence.releaseReady!==false||evidence.runtimeMocked!==false||evidence.rendererMocked!==false||evidence.applicationQueueModified!==false||evidence.classification!=='controlled-clock-functional')errors.push('Invalid completion evidence');
        if(suite==='throttle') {
          if(evidence.id!==id||!emptyArray(evidence.pageErrors)||!count(evidence.ownedFencesCreated,1)||!count(evidence.ownedFencesReleased,1)||evidence.ownedFencesCreated!==evidence.ownedFencesReleased||!count(evidence.steps,1,120)||evidence.maxSteps!==120)errors.push('Invalid throttle identity/errors/fences');
          if(!Array.isArray(evidence.observations)||evidence.observations.filter((o:any)=>o?.label==='throttle-case-completed'&&o.id===id).length!==1)errors.push('Missing explicit case completion');
        } else {
          if(`${evidence.profile?.id}/${evidence.mode}/${evidence.sequence}`!==id||evidence.stage!=='complete'||evidence.stateInjected!==false||evidence.warningDomFabricated!==false)errors.push('Invalid warning identity/state');
          const kinds=evidence.sequence==='descent-lifecycle'?['low-altitude','respawning','protection']:['enemy-targeting',...(evidence.mode==='normal'?['reload']:[]),'boundary','bomb-announcement'];
          const completed=(evidence.evidence??[]).filter((e:any)=>e.label==='critical-state-completed');
          if(JSON.stringify(completed.map((e:any)=>e.kind))!==JSON.stringify(kinds))errors.push('Incomplete ordered critical states');
          const displays=evidence.displays??[],acquisitions=evidence.acquisitions??[];
          if(displays.length!==kinds.length||acquisitions.length!==kinds.length)errors.push('Missing acquisition/display evidence');
          for(const d of displays)if(!emptyArray(d.pageErrors)||!count(d.createdFences)||!count(d.releasedFences)||d.createdFences!==d.releasedFences||!count(d.steps,0,120)||!Array.isArray(d.observations))errors.push('Warning display errors/missing fences/steps');
          for(const d of acquisitions)if(!emptyArray(d.pageErrors)||!count(d.createdFences)||!count(d.releasedFences)||d.createdFences!==d.releasedFences||!count(d.steps,0,1800)||!Array.isArray(d.observations))errors.push('Warning acquisition errors/missing fences/steps');
          for(const [i,kind]of kinds.entries()) {
            const observations=displays[i]?.observations??[];
            for(const label of ['active-critical-before','active-critical-after','active-critical-proof-completed']) {
              const items=observations.filter((o:any)=>o.label===label);
              if(items.length!==1||(items[0].kind??items[0].witness?.kind)!==kind)errors.push(`Missing ${kind} ${label}`);
              if(items.length===1&&label!=='active-critical-proof-completed')try {
                const v=items[0],layout=v.raw?.render?.hudLayout;
                if(!criticalStateActive(kind as CriticalKind,v.raw,v.witness))errors.push(`${kind} no longer active`);
                if(layout?.status!=='placed'||!(v.raw.render.calls>0)||!(v.raw.render.triangles>0))errors.push(`${kind} missing live render`);
                if(JSON.stringify(v.sites?.map((s:any)=>s.number).sort())!==JSON.stringify(['1','2','3','4','5','6','7'])||!v.sites.every((s:any)=>s.visible===true&&s.inDetails===false))errors.push(`${kind} incomplete sites`);
                if(!v.scroll||Object.values(v.scroll).some(x=>x!==0))errors.push(`${kind} moved whole HUD`);
                const required={...Object.fromEntries((kind==='respawning'?['hud-mode','lives-count']:FIXED_INSTRUMENTS).map(id=>[id,''])),...criticalText(kind as CriticalKind,v.raw.campaign)};
                errors.push(...fixedCriticalTextIssues(v.geometry,required));
                const reservations:TextRegion[]=[{key:'canvas:radar',kind:'radar',rect:layout.radar.rect},...layout.obstacles.filter((r:any)=>['aim-and-reload-ring','central-flight-lane'].includes(r.id)).map((r:any)=>({key:`canvas:${r.id}`,kind:'sight-reservation',rect:r})),...(layout.canvasLabels??[]).filter((r:any)=>r.rect).map((r:any)=>({key:`canvas:${r.id}`,kind:'canvas-label',rect:r.rect}))].map(r=>({...r,rect:{...r.rect,x:r.rect.x+v.canvas.x,y:r.rect.y+v.canvas.y}}));
                const projected=v.compact?detailGeometrySnapshot(v.geometry):null;
                errors.push(...(projected?.completenessIssues??[]),...textGeometryIssues(projected?.projected??v.geometry,reservations));
              }catch(e){errors.push(`Malformed critical snapshot: ${String(e)}`);}

            }
          }
        }
      }
      cases.push({id,title:spec.title,project,validated:!errors.length,errors,attachments:refs});
    }
    for(const [i,child]of (node.suites??[]).entries())await visit(child,trail,`${pointer}/suites/${i}`);
  }
  for(const [i,s]of (raw?.suites??[]).entries())await visit(s,[],`/suites/${i}`);
  for(const id of expected)if(!seen.has(id))issues.push(`Missing ${id}`);
  if(cases.length!==expected.length)issues.push('Incorrect case count');
  if(cases.some(c=>!c.validated))issues.push('Invalid cases');
  return {suite,status:issues.length?'not-passed':'passed',counts:{expected:expected.length,observed:cases.length,validated:cases.filter(c=>c.validated).length},issues,cases,releaseReady:false,physicalDeviceAcceptance:'unverified',performanceAcceptance:'not-measured'};
}
