import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFreshGeometry } from '../browser-acceptance/geometry-contract';
const box={id:'health',x:10,y:20,width:80,height:22};
test('actual DOM boxes match independently cached boxes within one CSS pixel',()=>{
  assert.doesNotThrow(()=>assertFreshGeometry([box],[{...box,x:10.5}],'panel'));
});
test('stale positions, enlarged dimensions, missing/extra IDs and invalid geometry fail',()=>{
  for(const cached of [[{...box,x:12}],[{...box,width:40}],[],[box,box],[{...box,id:'other'}],[{...box,height:NaN}]])
    assert.throws(()=>assertFreshGeometry([box],cached,'panel'));
});

import { createVisibilityPredicate } from '../browser-acceptance/geometry-contract';
const visible=createVisibilityPredicate();
function node(overrides:{hidden?:boolean;rects?:number;width?:number;height?:number;display?:string;visibility?:string}={}) {
 const o={hidden:false,rects:1,width:130,height:20,display:'block',visibility:'visible',...overrides};
 return {closest:()=>o.hidden?{}:null,getClientRects:()=>Array(o.rects).fill({}),getBoundingClientRect:()=>({width:o.width,height:o.height}),
  ownerDocument:{defaultView:{getComputedStyle:()=>({display:o.display,visibility:o.visibility})}}} as unknown as HTMLElement;
}
test('exact in-page visibility predicate retains full positive rectangles',()=>{
 assert.equal(visible(node()),true);
});
test('empty threat/payload widths with zero height, zero width, missing rects and hidden nodes are not visible boxes',()=>{
 for(const override of [{height:0},{width:0},{rects:0},{hidden:true},{display:'none'},{visibility:'hidden'}]) assert.equal(visible(node(override)),false);
});
