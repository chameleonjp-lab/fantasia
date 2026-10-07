import type {TextGeometry} from './text-geometry';
/** Plan only native input. Coverage still comes exclusively from measured fragments. */
export function unreadDetailFragments(data:TextGeometry,seen:ReadonlySet<string>,entryId?:string){
 const viewport=data.regions.find(r=>r.kind==='detail-viewport'),clip=data.styles.find(s=>s.key.startsWith('style:campaign-hud-details:'))?.clipRect;
 if(!viewport||!clip)throw new Error('Missing detail navigation geometry');
 return data.runs.flatMap((run,index)=>{
  if(!run.ancestorRegions.includes(viewport.key))return [];
  const entry=data.regions.find(r=>r.detailEntryId&&(run.owner===r.key||run.ancestorRegions.includes(r.key)));
  if(entryId!==undefined&&entry?.detailEntryId!==entryId)return [];
  return run.fragments.flatMap((rect,i)=>{const id=`${run.owner}:${index}:${i}`;return seen.has(id)?[]:[{id,entryId:entry?.detailEntryId,rect,delta:rect.y+rect.height/2-(clip.y+clip.height/2),window:clip.height-rect.height}];});
 }).sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x);
}
export function nativeTouchTravel(delta:number,height:number,slop:number){
 if(!Number.isFinite(delta)||!Number.isFinite(height)||height<=32||!Number.isFinite(slop)||slop<0)throw new Error('Invalid native touch geometry');
 const direction=delta<0?-1:1;
 return direction*Math.min(height-16,Math.max(20,Math.abs(delta)+slop));
}
