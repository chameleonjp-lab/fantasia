export type Box = { id?: string; x:number; y:number; width:number; height:number };
export function assertFreshGeometry(actual: Box[], cached: Box[], label: string, tolerance=0.75) {
  if(actual.length!==cached.length) throw new Error(`${label}: actual/cached box count differs`);
  const sort=(boxes:Box[])=>boxes.map((box,index)=>({box,index})).sort((a,b)=>(a.box.id??'').localeCompare(b.box.id??'')||a.index-b.index).map(v=>v.box);
  const a=sort(actual), b=sort(cached);
  for(let i=0;i<a.length;i++) {
    if(a[i].id!==b[i].id) throw new Error(`${label}: actual/cached ID differs`);
    for(const key of ['x','y','width','height'] as const) if(!Number.isFinite(a[i][key])||!Number.isFinite(b[i][key])||Math.abs(a[i][key]-b[i][key])>tolerance)
      throw new Error(`${label}: stale ${a[i].id} ${key}`);
  }
}
/** Same visibility contract as the production adapter, callable in-page and in fixtures. */
export function createVisibilityPredicate() { return (node: HTMLElement): boolean => {
  if(node.closest('[hidden]') || node.getClientRects().length===0) return false;
  const style=node.ownerDocument.defaultView!.getComputedStyle(node);
  if(style.visibility==='hidden'||style.display==='none') return false;
  const rect=node.getBoundingClientRect();
  return rect.width>0&&rect.height>0;
}; }
