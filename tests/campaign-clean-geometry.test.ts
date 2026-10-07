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
