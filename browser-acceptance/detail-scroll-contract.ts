/** Authorized detail-only scrolling must demonstrate complete real access, not hide failed text. */
export interface DetailAccessSample {
  method:'keyboard'|'touch';scrollTop:number;phase:string;neutralInput:boolean;
  fullHudScroll:{windowX:number;windowY:number;appLeft:number;appTop:number;hudLeft:number;hudTop:number};
  persistentIds:string[];fullyVisibleFragments:string[];
}
export interface DetailAccessEvidence {
  active:boolean;viewportId:string;expectedEntryIds:string[];actualEntryIds:string[];
  expectedFragments:string[];persistentIds:string[];samples:DetailAccessSample[];
}
export function detailAccessIssues(e:DetailAccessEvidence):string[] {
  if(!e.active)return ['Details access proof must describe an active authorized fallback'];
  const issues:string[]=[];
  for(const id of ['campaign-mode-status','lives-count','pause','bomb','loop',...Array.from({length:7},(_,i)=>`site-${i+1}`),...Array.from({length:7},(_,i)=>`campaign-site-state-${i+1}`)])if(!e.persistentIds.includes(id))issues.push(`Missing required persistent item ${id}`);
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
    if(sample.phase!=='playing'||sample.neutralInput!==true)issues.push(`${sample.method}: scroll affected flight or lost live state`);
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
  if(e.screen==='playing'&&e.status==='running'&&(Math.hypot(e.position.x,e.position.z)>2100||e.protectionTicks>0||e.position.y-terrainHeight(e.position.x,e.position.z)<65))ids.push('warning');
  if(e.screen==='playing'&&e.status==='respawning')ids.push('respawn-status');
  return ids;
}
