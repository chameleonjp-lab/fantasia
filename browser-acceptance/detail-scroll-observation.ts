import type {TextGeometry} from './text-geometry';

/** Compact raw coordinate evidence, not a declared visibility/pass flag. */
export function detailScrollMeasurement(sample:{geometry:TextGeometry;scrollTop:number;scrollHeight:number;clientHeight:number;motion:{sequence:number;endedSequence:number;trusted:boolean}}) {
  return {scrollTop:sample.scrollTop,scrollHeight:sample.scrollHeight,clientHeight:sample.clientHeight,motion:sample.motion,
    viewport:sample.geometry.viewport,regions:sample.geometry.regions.map(r=>({key:r.key,rect:r.rect})),
    fragments:sample.geometry.runs.map(r=>({text:r.text,owner:r.owner,fragments:r.fragments})),
    clips:sample.geometry.styles.map(s=>({key:s.key,clipRect:s.clipRect}))};
}

/** Recompute stability from raw coordinates and native scroll/scrollend sequence.
 * An old separately collected scrollTop, a timer, or a pass flag is insufficient. */
export function detailSettlingIssues(sample:any):string[] {
  try {
    const first=sample.settling?.first,elapsed=sample.settling?.elapsedWallMs,motion=sample.motion;
    if(!first||!Number.isFinite(elapsed)||elapsed<32||elapsed>1500)return ['Missing bounded wall-time stability evidence'];
    if(!motion||motion.trusted!==true||!Number.isInteger(motion.sequence)||motion.sequence<0||!nativeCompletionMatches(sample))return ['Native scrolling has not ended'];
    if(!Number.isFinite(sample.scrollTop)||!Number.isFinite(sample.scrollHeight)||!Number.isFinite(sample.clientHeight)||sample.clientHeight<=0||sample.scrollHeight<=sample.clientHeight||sample.scrollTop<0||sample.scrollTop>sample.scrollHeight-sample.clientHeight)return ['Invalid atomic scroll dimensions'];
    if(sample.scrollTopBefore!==sample.scrollTop||(sample.scrollTop>0&&motion.sequence===0))return ['Inconsistent atomic scroll observation'];
    if(JSON.stringify(first)!==JSON.stringify(detailScrollMeasurement(sample)))return ['Scroll/geometry moved during stability interval'];
    if(!Number.isFinite(sample.settling.totalWallMs)||sample.settling.totalWallMs<elapsed||sample.settling.totalWallMs>1500)return ['Missing bounded complete observation interval'];
    const operationIssues=detailOperationIssues(sample.settling.operation,sample);if(operationIssues.length)return operationIssues;
    const input=sample.input;
    if(!input||!Array.isArray(input.keys)||input.keys.length||input.steerPointer!==null||input.turn!==0||input.climb!==0||!input.heldPointers||Object.values(input.heldPointers).some((ids:any)=>!Array.isArray(ids)||ids.length))return ['Missing/non-neutral atomic raw input'];
    return [];
  }catch{return ['Malformed atomic detail observation'];}
}

/** A completion from a prior gesture cannot settle this native operation. */
export function detailOperationIssues(operation:any,sample:any):string[] {
  const before=operation?.before,b=before?.motion,m=sample?.motion;
  if(!['home','arrow','page','tab','touch'].includes(operation?.kind)||!before||!Number.isFinite(before.scrollTop)||before.scrollTop<0||!Number.isFinite(sample?.scrollTop)||sample.scrollTop<0||!b||!m)return ['Missing native operation baseline'];
  for(const motion of [b,m])if(motion.trusted!==true||!['sequence','endedSequence','endCount'].every(k=>Number.isInteger(motion[k])&&motion[k]>=0)||motion.endedSequence>motion.sequence)return ['Malformed native operation sequence'];
  if(operation.direction!==undefined&&![1,-1].includes(operation.direction))return ['Invalid native operation direction'];
  if(m.sequence<b.sequence||m.endCount<b.endCount||!nativeCompletionMatches(sample))return ['Native operation has not completed'];
  if(operation.kind==='tab'){
    if(!operation.entryId||before.focusEntry===operation.entryId||sample.focusEntry!==operation.entryId||!Number.isInteger(b.tabCount)||b.tabCount<0||!Number.isInteger(m.tabCount)||m.tabCount<=b.tabCount)return ['Native Tab did not reach the requested detail entry'];
    if(sample.scrollTop===before.scrollTop&&m.sequence===b.sequence&&m.endCount===b.endCount)return [];
  }
  if(operation.kind==='home'&&before.scrollTop===0&&sample.scrollTop===0&&m.sequence===b.sequence&&m.endCount===b.endCount)return [];
  if(m.sequence<=b.sequence||m.endCount<=b.endCount)return ['No new native scrollend for this operation'];
  if(operation.kind==='home'?sample.scrollTop!==0:operation.kind==='tab'?sample.scrollTop===before.scrollTop:(sample.scrollTop-before.scrollTop)*(operation.direction??1)<=0)return ['Native operation did not reach its target'];
  return [];
}

/** A late scroll notification may describe the SAME completed viewport position.
 * Accept it only with event-time coordinates for this exact target, never by time alone. */
export function nativeCompletionMatches(sample:any):boolean {
 const m=sample?.motion;if(!m)return false;
 const c=m.completion,l=m.lastScroll,trail=m.trailingScrolls;
 if(m.endedSequence===m.sequence)return c===undefined||c.targetIsViewport===true&&c.target==='campaign-hud-details'&&c.isTrusted===true&&c.sequence===m.sequence&&c.scrollTop===sample.scrollTop&&c.scrollHeight===sample.scrollHeight&&c.clientHeight===sample.clientHeight;
 return m.endedSequence<m.sequence&&m.trailingSamePosition===true&&c?.target==='campaign-hud-details'&&l?.target===c.target
  &&c.sequence===m.endedSequence&&l.sequence===m.sequence
  &&Array.isArray(trail)&&trail.length===m.sequence-m.endedSequence
  &&trail.every((p:any,i:number)=>p.sequence===m.endedSequence+i+1&&p.target===c.target)
  &&[c,l,...trail].every(p=>p.targetIsViewport===true&&p.isTrusted===true&&p.scrollTop===sample.scrollTop&&p.scrollHeight===sample.scrollHeight&&p.clientHeight===sample.clientHeight);
}

/** Cross-check the late-notification branch against the retained native event log. */
export function nativeDetailEventIssues(sample:any,events:any[]):string[] {
 try {
  const m=sample.motion;
  if(sample.settling?.operation?.kind==='tab'&&events.filter(e=>e.type==='keydown'&&e.key==='Tab'&&e.isTrusted).length<m.tabCount)return ['Missing native Tab event'];
  if(m.endedSequence===m.sequence&&m.completion===undefined)return [];
  const ends=events.filter(e=>e.type==='scrollend'&&e.sequence===m.endedSequence&&e.endCount===m.endCount);
  const trailing=events.filter(e=>e.type==='scroll'&&e.sequence>m.endedSequence&&e.sequence<=m.sequence);
  if(ends.length!==1||trailing.length!==m.trailingScrolls?.length)return ['Missing completion/trailing native event records'];
  const same=(a:any,b:any)=>['target','targetIsViewport','isTrusted','scrollTop','scrollHeight','clientHeight','sequence'].every(k=>a[k]===b[k]);
  if(!same(ends[0],m.completion)||trailing.some((e,i)=>!same(e,m.trailingScrolls[i])))return ['Completion coordinates differ from native event log'];
  return [];
 }catch{return ['Malformed native scroll event correspondence'];}
}
