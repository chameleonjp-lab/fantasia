export interface TextRect {x:number;y:number;width:number;height:number}
export interface TextRegion {key:string;kind:string;rect:TextRect;ancestorRegions?:string[];detailEntryId?:string}
export interface TextStyleEvidence {
  key:string;rect:TextRect;clipRect:TextRect;overflowX:string;overflowY:string;textOverflow:string;
  scrollWidth:number;clientWidth:number;scrollHeight:number;clientHeight:number;whiteSpace:string;
  lineClamp:string;maxLines:string;contain:string;transform:string;translate:string;zoom:string;
  clipPath:string;maskImage:string;legacyClip:string;borderRadius:string[];overflowClipMargin:string;
  unsupported:string[];
}
export interface TextRun {text:string;owner:string;ancestorRegions:string[];fragments:TextRect[];styleKeys:string[]}
export interface TextGeometry {viewport:{width:number;height:number};regions:TextRegion[];styles:TextStyleEvidence[];runs:TextRun[]}

/** Read-only DOM evidence, executed in the page with the exact tested visibility predicate. */
export function collectHudTextGeometry(visible:(node:HTMLElement)=>boolean):TextGeometry {
  // Object methods keep serialized browser code independent of host transpiler helpers.
  const read={rect(r:DOMRect){return {x:r.x,y:r.y,width:r.width,height:r.height};},
    cssVisible(node:HTMLElement){let n:HTMLElement|null=node;while(n){const s=getComputedStyle(n);if(n.hidden||s.display==='none'||s.visibility==='hidden')return false;n=n.parentElement;}return true;}};
  const selectors:Array<[string,string]>=[['panel','.flight-data > *, .hud-top .time-block, #campaign-threat, #payload-status, #reload-status, #warning, #announcement, #respawn-status, #flight-tip, #throttle-layout-note'],
    ['detail-viewport','#campaign-hud-details'],['detail-entry','#campaign-hud-details [data-campaign-detail]'],['persistent','#campaign-mode-status, #hud > .target-tally, #hud > #bomb-hint'],['header','.hud-top'],['site','#campaign-sites .campaign-site[data-site]'],['control','#hud button, #hud [role="slider"]']];
  const regionNodes:Array<{key:string;kind:string;node:HTMLElement;rect:TextRect}>=[];
  for(const [kind,selector]of selectors)for(const node of document.querySelectorAll<HTMLElement>(selector))if((visible(node)||(!!node.textContent?.trim()&&read.cssVisible(node)))&&!regionNodes.some(r=>r.node===node))
    regionNodes.push({key:`${kind}:${node.id||node.className}:${regionNodes.length}`,kind,node,rect:read.rect(node.getBoundingClientRect())});
  const textNodes=new Set<Text>();
  for(const region of regionNodes){const walker=document.createTreeWalker(region.node,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))if(node.textContent?.trim())textNodes.add(node as Text);}
  const styles:TextStyleEvidence[]=[],styleCache=new Map<HTMLElement,string>();
  const inspect={node(node:HTMLElement):string{
    const known=styleCache.get(node);if(known)return known;
    const key=`style:${node.id||node.className||node.tagName}:${styles.length}`,s=getComputedStyle(node),r=node.getBoundingClientRect();
    const unsupported:string[]=[];
    if(s.transform!=='none'){const matrix=new DOMMatrixReadOnly(s.transform);if(!matrix.is2D||matrix.a!==1||matrix.b!==0||matrix.c!==0||matrix.d!==1)unsupported.push('non-translation-transform');}
    if(s.scale!=='none'&&s.scale!=='1')unsupported.push('individual-scale');if(s.rotate!=='none'&&s.rotate!=='0deg')unsupported.push('individual-rotation');
    if(s.translate!=='none'&&s.translate.split(/\s+/).length>2&&parseFloat(s.translate.split(/\s+/)[2])!==0)unsupported.push('3d-individual-translation');
    if(s.zoom!=='1'&&s.zoom!=='normal')unsupported.push('css-zoom');
    if(s.clipPath!=='none')unsupported.push('clip-path');if(s.maskImage!=='none')unsupported.push('mask-image');
    if(s.clip!=='auto')unsupported.push('legacy-clip');
    if(Number(s.opacity)===0)unsupported.push('zero-opacity');
    const clipping=['hidden','clip','auto','scroll'].includes(s.overflowX)||['hidden','clip','auto','scroll'].includes(s.overflowY)||/\b(paint|strict|content)\b/.test(s.contain);
    const radii=[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius];
    if(clipping&&radii.some(v=>v.split(/\s+/).some(p=>parseFloat(p)!==0)))unsupported.push('rounded-clip');
    if((s.overflowX==='clip'||s.overflowY==='clip')&&s.overflowClipMargin!=='0px')unsupported.push('overflow-clip-margin');
    const lineClamp=s.getPropertyValue('-webkit-line-clamp')||s.getPropertyValue('line-clamp')||'none',maxLines=s.getPropertyValue('max-lines')||'none';
    styles.push({key,rect:read.rect(r),clipRect:{x:r.x+node.clientLeft,y:r.y+node.clientTop,width:node.clientWidth,height:node.clientHeight},overflowX:s.overflowX,overflowY:s.overflowY,textOverflow:s.textOverflow,
      scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,whiteSpace:s.whiteSpace,
      lineClamp,maxLines,contain:s.contain,transform:s.transform,translate:s.translate,zoom:s.zoom,clipPath:s.clipPath,maskImage:s.maskImage,legacyClip:s.clip,borderRadius:radii,overflowClipMargin:s.overflowClipMargin,unsupported});
    styleCache.set(node,key);return key;
  }};
  const runs:TextRun[]=[];
  for(const node of textNodes){const parent=node.parentElement;if(!parent||!read.cssVisible(parent))continue;
    const ancestors=regionNodes.filter(r=>r.node.contains(node));if(!ancestors.length)continue;
    const owner=ancestors.reduce((a,b)=>a.node.contains(b.node)?b:a);
    const raw=node.textContent!,start=raw.search(/\S/),end=raw.search(/\s*$/);const range=document.createRange();range.setStart(node,start);range.setEnd(node,end);
    const fragments=[...range.getClientRects()].map(read.rect);range.detach();
    const styleKeys:string[]=[];let ancestor:HTMLElement|null=parent;while(ancestor){styleKeys.push(inspect.node(ancestor));ancestor=ancestor.parentElement;}
    runs.push({text:raw.slice(start,end),owner:owner.key,ancestorRegions:ancestors.map(a=>a.key),fragments,styleKeys});
  }
  return {viewport:{width:innerWidth,height:innerHeight},regions:regionNodes.map(({key,kind,rect,node})=>({key,kind,rect,...(node.dataset?.campaignDetail?{detailEntryId:node.dataset.campaignDetail}:{}),ancestorRegions:regionNodes.filter(r=>r.node!==node&&r.node.contains(node)).map(r=>r.key)})),styles,runs};
}

/** Text may extend outside its own visible-overflow circle; it may never be lost or cover unrelated content. */
export function textGeometryIssues(data:TextGeometry,reservations:TextRegion[]=[],tolerance=.75):string[] {
  const issues:string[]=[],styles=new Map(data.styles.map(s=>[s.key,s]));
  const valid=(r:TextRect)=>[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
  const overlap=(a:TextRect,b:TextRect)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>tolerance&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>tolerance;
  const contained=(r:TextRect,b:TextRect,x=true,y=true)=>(!x||(r.x>=b.x-tolerance&&r.x+r.width<=b.x+b.width+tolerance))&&(!y||(r.y>=b.y-tolerance&&r.y+r.height<=b.y+b.height+tolerance));
  const clips=(value:string)=>['hidden','clip','auto','scroll'].includes(value);
  if(!data.runs.length)issues.push('missing-visible-text-runs');
  for(const [index,run]of data.runs.entries()){
    const label=`text[${index}] ${run.owner} ${JSON.stringify(run.text)}`;
    if(!run.text.trim()||!run.fragments.length)issues.push(`${label}: missing-full-text-fragments`);
    if(!data.regions.some(r=>r.key===run.owner))issues.push(`${label}: missing-owner`);
    const chain=run.styleKeys.map(key=>styles.get(key));if(!chain.length||chain.some(s=>!s))issues.push(`${label}: missing-style-chain`);
    for(const style of chain){if(!style)continue;
      for(const reason of style.unsupported)issues.push(`${label}: unsupported-${reason} at ${style.key}`);
      // Range geometry alone cannot prove completeness under line clamping.
      if(!['none','normal','0',''].includes(style.lineClamp)||!['none','normal','0',''].includes(style.maxLines))issues.push(`${label}: line-clamp-completeness-unverified at ${style.key}`);
      if(clips(style.overflowX)&&style.scrollWidth>style.clientWidth+1)issues.push(`${label}: clipped-inline-overflow(${style.textOverflow}) at ${style.key}`);
      if(clips(style.overflowY)&&style.scrollHeight>style.clientHeight+1)issues.push(`${label}: clipped-block-overflow at ${style.key}`);
    }
    for(const fragment of run.fragments){
      if(!valid(fragment)){issues.push(`${label}: ${fragment.width===0||fragment.height===0?'zero-area-fragment-completeness-unverified':'invalid-text-fragment'}`);continue;}
      if(!contained(fragment,{x:0,y:0,...data.viewport}))issues.push(`${label}: text-outside-viewport`);
      for(const style of chain){if(!style)continue;const paint=/\b(paint|strict|content)\b/.test(style.contain);
        if((paint||clips(style.overflowX)||clips(style.overflowY))&&!contained(fragment,style.clipRect,paint||clips(style.overflowX),paint||clips(style.overflowY)))issues.push(`${label}: text-crosses-clip at ${style.key}`);
      }
      for(const region of [...data.regions,...reservations])if(!run.ancestorRegions.includes(region.key)&&region.key!==run.owner&&overlap(fragment,region.rect))issues.push(`${label}: text-overlaps-${region.kind} ${region.key}`);
    }
  }
  // Each run is a distinct Text node (deduplicated during collection). Even
  // siblings within one control/header/site must not obscure one another.
  for(let i=0;i<data.runs.length;i++)for(let j=i+1;j<data.runs.length;j++){
    const a=data.runs[i],b=data.runs[j];
    if(a.fragments.some(x=>b.fragments.some(y=>overlap(x,y))))issues.push(`text-owner-collision ${a.owner} / ${b.owner}`);
  }
  return [...new Set(issues)];
}

/** Only the explicitly authorized detail viewport may clip secondary text.
 * Fully visible fragments retain all other ancestor/viewport/collision checks.
 * Offscreen fragments are NOT accepted: the traversal must later cover each ID. */
export function detailGeometrySnapshot(data:TextGeometry) {
  const viewport=data.regions.find(r=>r.kind==='detail-viewport');
  if(!viewport)throw new Error('Missing authorized detail viewport');
  const viewportStyle=data.styles.find(s=>s.key.startsWith('style:campaign-hud-details:'));
  if(!viewportStyle)throw new Error('Missing detail clipping style');
  const box=viewportStyle.clipRect, tolerance=.75;
  const inside=(r:TextRect)=>r.x>=box.x-tolerance&&r.y>=box.y-tolerance&&r.x+r.width<=box.x+box.width+tolerance&&r.y+r.height<=box.y+box.height+tolerance;
  const expected:string[]=[],visible:string[]=[];
  // Membership comes from DOM ancestry, never the first selector's kind.
  // Older raw artifacts did not record region ancestry; an owned text run's
  // ancestor chain still proves that owner's DOM membership without guessing
  // from coordinates or suppressing unrelated fixed/critical regions.
  const detailKeys=new Set(data.regions.filter(r=>r.ancestorRegions
    ?r.ancestorRegions.includes(viewport.key)
    :data.runs.some(run=>run.owner===r.key&&run.ancestorRegions.includes(viewport.key))).map(r=>r.key));
  const intersect=(r:TextRect):TextRect=>{
    const x=Math.max(r.x,box.x,0),y=Math.max(r.y,box.y,0);
    return {x,y,width:Math.max(0,Math.min(r.x+r.width,box.x+box.width,data.viewport.width)-x),height:Math.max(0,Math.min(r.y+r.height,box.y+box.height,data.viewport.height)-y)};
  };
  const runs=data.runs.flatMap((run,index)=>{
    if(!run.ancestorRegions.includes(viewport.key))return [run];
    const fragments=run.fragments.filter((r,i)=>{const id=`${run.owner}:${index}:${i}`;expected.push(id);if(inside(r)){visible.push(id);return true;}return false;});
    return fragments.length?[{...run,fragments}]:[];
  });
  const projected:TextGeometry={...data,runs,regions:data.regions.flatMap(r=>{
      if(!detailKeys.has(r.key))return [r];
      const rect=intersect(r.rect);
      return rect.width>0&&rect.height>0?[{...r,rect}]:[];
    }),
    styles:data.styles.map(s=>s===viewportStyle?{...s,scrollHeight:s.clientHeight}:s)};
  // Overflow-visible text may remain visible even when its owner's border box
  // is wholly clipped. Preserve ownership without inventing a visible obstacle.
  for(const run of projected.runs)if(detailKeys.has(run.owner)&&!projected.regions.some(r=>r.key===run.owner)) {
    const owner=data.regions.find(r=>r.key===run.owner)!;
    projected.regions.push({...owner,rect:intersect(owner.rect)});
  }
  const completenessIssues:string[]=[];
  for(const run of data.runs.filter(r=>r.ancestorRegions.includes(viewport.key))){
    if(!run.fragments.length)completenessIssues.push(`missing-detail-fragments: ${run.text}`);
    for(const key of run.styleKeys){const s=data.styles.find(s=>s.key===key);if(!s){completenessIssues.push('missing-detail-style');continue;}
      if(s.unsupported.length||!['none','normal','0',''].includes(s.lineClamp)||!['none','normal','0',''].includes(s.maxLines))completenessIssues.push(`unsupported-detail-completeness: ${key}`);
      if(['hidden','clip','auto','scroll'].includes(s.overflowX)&&s.scrollWidth>s.clientWidth+1)completenessIssues.push(`clipped-detail-inline: ${key}`);
      if(s!==viewportStyle&&['hidden','clip','auto','scroll'].includes(s.overflowY)&&s.scrollHeight>s.clientHeight+1)completenessIssues.push(`clipped-detail-block: ${key}`);
    }
  }
  return {projected,expected,visible,completenessIssues:[...new Set(completenessIssues)]};
}
