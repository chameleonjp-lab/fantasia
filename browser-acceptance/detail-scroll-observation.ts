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
    if(!motion||motion.trusted!==true||!Number.isInteger(motion.sequence)||motion.sequence<0||motion.endedSequence!==motion.sequence)return ['Native scrolling has not ended'];
    if(!Number.isFinite(sample.scrollTop)||!Number.isFinite(sample.scrollHeight)||!Number.isFinite(sample.clientHeight)||sample.clientHeight<=0||sample.scrollHeight<=sample.clientHeight||sample.scrollTop<0||sample.scrollTop>sample.scrollHeight-sample.clientHeight)return ['Invalid atomic scroll dimensions'];
    if(sample.scrollTopBefore!==sample.scrollTop||(sample.scrollTop>0&&motion.sequence===0))return ['Inconsistent atomic scroll observation'];
    if(JSON.stringify(first)!==JSON.stringify(detailScrollMeasurement(sample)))return ['Scroll/geometry moved during stability interval'];
    const input=sample.input;
    if(!input||!Array.isArray(input.keys)||input.keys.length||input.steerPointer!==null||input.turn!==0||input.climb!==0||!input.heldPointers||Object.values(input.heldPointers).some((ids:any)=>!Array.isArray(ids)||ids.length))return ['Missing/non-neutral atomic raw input'];
    return [];
  }catch{return ['Malformed atomic detail observation'];}
}
