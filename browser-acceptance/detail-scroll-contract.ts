/** Authorized detail-only scrolling must demonstrate complete real access, not hide failed text. */
export interface DetailAccessSample {
  method:'keyboard'|'touch';scrollTop:number;phase:string;neutralInput:boolean;
  fullHudScroll:{windowX:number;windowY:number;appLeft:number;appTop:number;hudLeft:number;hudTop:number};
  persistentIds:string[];fullyVisibleFragments:string[];
}
export interface DetailAccessEvidence {
  active:boolean;phase?:'playing'|'respawning';viewportId:string;expectedEntryIds:string[];actualEntryIds:string[];
  expectedFragments:string[];persistentIds:string[];samples:DetailAccessSample[];
}
export function detailAccessIssues(e:DetailAccessEvidence,phase:'playing'|'respawning'='playing'):string[] {
  if(!e.active)return ['Details access proof must describe an active authorized fallback'];
  const issues:string[]=[];
  if(e.phase!==undefined&&e.phase!==phase)issues.push('Detail phase differs from caller contract');
  for(const id of ['campaign-mode-status','lives-count','pause','game-sound',...(phase==='respawning'?[]:['bomb','loop']),...Array.from({length:7},(_,i)=>`site-${i+1}`),...Array.from({length:7},(_,i)=>`campaign-site-state-${i+1}`)])if(!e.persistentIds.includes(id))issues.push(`Missing required persistent item ${id}`);
  if(new Set(e.persistentIds).size!==e.persistentIds.length)issues.push('Duplicate persistent IDs');
  if(e.viewportId!=='campaign-hud-details')issues.push('Unrecognized scroll viewport');
  if(!e.expectedEntryIds.length||new Set(e.expectedEntryIds).size!==e.expectedEntryIds.length)issues.push('Missing/duplicate detail contract');
  if(JSON.stringify([...e.expectedEntryIds].sort())!==JSON.stringify([...e.actualEntryIds].sort()))issues.push('Detail entries differ from the complete contract');
  if(!e.expectedFragments.length||new Set(e.expectedFragments).size!==e.expectedFragments.length)issues.push('Missing/duplicate full-text fragment identities');
  for(const method of ['keyboard','touch'] as const){
    const samples=e.samples.filter(s=>s.method===method),seen=new Set(samples.flatMap(s=>s.fullyVisibleFragments));
    if(samples.length<2||new Set(samples.map(s=>s.scrollTop)).size<2)issues.push(`${method}: no real scroll movement recorded`);
    for(const id of e.expectedFragments)if(!seen.has(id))issues.push(`${method}: unread detail fragment ${id}`);
  }
  for(const sample of e.samples){
    if(sample.phase!==phase||sample.neutralInput!==true)issues.push(`${sample.method}: scroll affected flight or lost live state`);
    if(Object.values(sample.fullHudScroll).some(v=>v!==0))issues.push(`${sample.method}: whole HUD/document scrolled`);
    if(e.persistentIds.some(id=>!sample.persistentIds.includes(id)))issues.push(`${sample.method}: persistent status/control disappeared`);
  }
  return [...new Set(issues)];
}

/** Independently revalidate consumed runtime inputs; labels/claimed booleans
 * alone are never proof that native scrolling stayed outside flight input. */
export function consumedDetailInputIssues(records:unknown):string[] {
  if(!Array.isArray(records)||records.length<4)return ['Missing keyboard/touch held-and-released consumed input evidence'];
  const issues:string[]=[];
  for(const [index,record]of records.entries()){
    if(!record||typeof record!=='object'||!Number.isInteger(record.tick)||record.tick<1)issues.push(`Consumed input ${index}: missing valid tick`);
    const input=record?.input;
    if(!input||typeof input!=='object'||Array.isArray(input)){issues.push(`Consumed input ${index}: missing raw input`);continue;}
    for(const key of ['turn','climb'])if(input[key]!==0)issues.push(`Consumed input ${index}: ${key} is not neutral`);
    if(input.throttle!==undefined&&input.throttle!==0)issues.push(`Consumed input ${index}: throttle is not neutral`);
    if(input.torpedo!==undefined&&input.torpedo!==false)issues.push(`Consumed input ${index}: torpedo is not neutral`);
    for(const key of ['accelerate','brake','fire','bomb','loop'])if(input[key]!==false)issues.push(`Consumed input ${index}: ${key} is not neutral`);
  }
  return issues;
}

import {terrainHeight} from '../src/campaign-terrain';
export interface FixedStatusEvidence {
  screen:string;status:string;position:{x:number;y:number;z:number};protectionTicks:number;reloadTicksRemaining:number;
  text:Record<string,string>;
}
/** Dormant warning/respawn strings are intentionally retained in the DOM.
 * Determine their activation from observed simulation state, never hidden/CSS. */
export function activeFixedStatusIds(e:FixedStatusEvidence):string[] {
  const ids=['campaign-threat','reload-status','payload-status'].filter(id=>!!e.text[id]?.trim());
  if(e.reloadTicksRemaining>0&&!ids.includes('reload-status'))ids.push('reload-status');
  if(e.screen==='playing'&&e.status==='running'&&(Math.hypot(e.position.x,e.position.z)>2100||e.position.y-terrainHeight(e.position.x,e.position.z)<65))ids.push('warning');
  if(e.screen==='playing'&&e.status==='running'&&e.protectionTicks>0&&!ids.includes('campaign-threat'))ids.push('campaign-threat');
  if(e.screen==='playing'&&e.status==='respawning')ids.push('respawn-status');
  return ids;
}

/** Serializable browser policy: state authorizes exceptions, not computed CSS.
 * Retain the previous explicit-hidden preference for ordinary optional nodes. */
export function detailItemPolicy(e:Pick<FixedStatusEvidence,'screen'|'status'|'protectionTicks'>,n:{id:string;hidden:boolean;critical:boolean;text:string;lifecycle:string}):'required'|'optional'|'inactive-control'|'duplicate-protection' {
  if(e.screen==='playing'&&e.status==='respawning'&&['fire','loop','bomb','throttle'].includes(n.id))return 'inactive-control';
  if(e.screen==='playing'&&e.status==='running'&&e.protectionTicks>0&&n.id==='announcement'&&n.lifecycle==='protection')return 'duplicate-protection';
  if(n.id==='pause'||n.id==='game-sound')return 'required';
  return (n.critical?!!n.text.trim():!n.hidden)?'required':'optional';
}
export function detailLifecycleIssues(e:Pick<FixedStatusEvidence,'screen'|'status'|'protectionTicks'>,controls:Array<{id:string;count:number;rendered:boolean}>,duplicates:Array<{hidden:boolean;inert:boolean;ariaHidden:string|null}>):string[] {
  const issues:string[]=[];
  if(e.screen==='playing'&&e.status==='respawning')for(const id of ['fire','loop','bomb','throttle']){
    const matches=controls.filter(c=>c.id===id);
    if(matches.length!==1||matches[0].count!==1||matches[0].rendered)issues.push(`${id}: inactive control missing, duplicated or rendered during respawn`);
  }
  if(duplicates.length>1)issues.push('Duplicate protection announcement nodes');
  for(const duplicate of duplicates){
    if(e.screen!=='playing'||e.status!=='running'||!(e.protectionTicks>0))issues.push('Protection duplicate excluded outside active protection');
    if(!duplicate.hidden||!duplicate.inert||duplicate.ariaHidden!=='true')issues.push('Protection duplicate remains visible, interactive or announced');
  }
  return issues;
}

/** A bounded prediction of native keys, never evidence of visibility. Step sizes
 * are measured from completed trusted operations; every planned key is remeasured. */
export function planDetailKeys(e:{top:number;max:number;delta:number;window:number;steps:Partial<Record<'arrow'|'page',number>>}) {
  type Action={kind:'arrow'|'page';direction:number};
  const empty=(reason:string,visited=0)=>({actions:[] as Action[],visited,reason,calibration:false});
  if(![e.top,e.max,e.delta,e.window].every(Number.isFinite)||e.max<0)return empty('invalid-geometry');
  if(e.window<0)return empty('fragment-taller-than-viewport');
  const target=e.top+e.delta,lo=target-e.window/2,hi=target+e.window/2;
  if(e.top>=lo&&e.top<=hi)return empty('already-in-interval');
  const kinds=['arrow','page'] as const;
  for(const kind of kinds)if(!(Number.isFinite(e.steps[kind])&&e.steps[kind]!>0))return {actions:[{kind,direction:e.delta<0?-1:1}],visited:0,reason:'measure-native-step',calibration:true};
  const queue:Array<{top:number;actions:Action[]}>=[{top:e.top,actions:[]}],seen=new Set([e.top.toFixed(4)]);
  for(let index=0;index<queue.length&&index<512;index++){
    const node=queue[index];if(node.actions.length>=12)continue;
    for(const kind of kinds)for(const direction of [1,-1]){
      const next=Math.max(0,Math.min(e.max,node.top+direction*e.steps[kind]!)),key=next.toFixed(4);
      if(seen.has(key))continue;
      const actions=[...node.actions,{kind,direction}];
      if(next>=lo&&next<=hi)return {actions,visited:seen.size,reason:'predicted-native-path',calibration:false};
      if(seen.size>=512)return empty('bounded-search-exhausted',seen.size);
      seen.add(key);queue.push({top:next,actions});
    }
  }
  return empty('bounded-search-exhausted',seen.size);
}

/** A trusted touch stroke stays inside the measured scroll clip, not its border box. */
export function planDetailTouch(clip:{x:number;y:number;width:number;height:number},delta:number,slop:number) {
 if(![clip.x,clip.y,clip.width,clip.height,delta,slop].every(Number.isFinite)||clip.width<=8||clip.height<=28||slop<0)
  throw new Error('Invalid native touch clip');
 const direction=delta<0?-1:1,travel=direction*Math.min(clip.height-8,Math.max(20,Math.abs(delta)+slop));
 const x=clip.x+clip.width/2,y=direction>0?clip.y+clip.height-4:clip.y+4;
 return {x,y,endY:y-travel,travel,direction};
}
