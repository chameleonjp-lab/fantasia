import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCaptureCancelled, type CaptureEvent } from '../browser-acceptance/capture-contract';
const events=():CaptureEvent[]=>['pointerdown','gotpointercapture','lostpointercapture'].map(type=>({type,pointerId:1,isTrusted:true,targetId:'bomb'}));
test('native capture must become active then be lost before pointerup, clearing its hold',()=>{
 assert.doesNotThrow(()=>assertCaptureCancelled(events(),1,'bomb',[]));
});
test('pending-only capture, untrusted events, wrong order/identity and uncleared holds fail',()=>{
 for(const mutate of [
  (e:CaptureEvent[])=>{e.splice(1,1);},(e:CaptureEvent[])=>{e[1].isTrusted=false;},
  (e:CaptureEvent[])=>{[e[1],e[2]]=[e[2],e[1]];},(e:CaptureEvent[])=>{e[2].pointerId=2;},
  (e:CaptureEvent[])=>{e[2].targetId='loop';},(e:CaptureEvent[])=>{e.push({...e[0],type:'pointerup'});},
 ]){const e=events();mutate(e);assert.throws(()=>assertCaptureCancelled(e,1,'bomb',[]));}
 assert.throws(()=>assertCaptureCancelled(events(),1,'bomb',[1]));
 assert.throws(()=>assertCaptureCancelled(events(),NaN,'bomb',[]));
});
