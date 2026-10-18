import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3, Quaternion } from 'three';
import { getFlightAssist, autoFireTarget } from '../src/flight-assist';
import { FLIGHT_FOV, getFlightCameraPose } from '../src/flight-view';
import { createFlightTargetLock, smoothFlightAssistance } from '../src/flight-target';

const numeric = false, callback = false;
const input = { turn: 0, climb: 0, fire: false, loop: false, viewAspect: 393 / 852 };
function player(): any { return {id:1, kind:'aircraft', team:'friendly', health:80, position:numeric?{x:0,y:300,z:0}:new Vector3(0,300,0),
  previous:new Vector3(0,300,0),quaternion:numeric?{x:0,y:0,z:0,w:1}:new Quaternion(), pitch:0,yaw:0,bank:0,speed:110,loopProgress:0,loopCooldown:0}; }
function target(p:any, id:number, x:number, y:number, depth:number, extra:any = {}): any {
  const position = new Vector3(), rotation = new Quaternion();
  if(numeric) { const c=getFlightCameraPose(p,'easy'); position.set(c.position.x,c.position.y,c.position.z);rotation.set(c.rotation.x,c.rotation.y,c.rotation.z,c.rotation.w); }
  else getFlightCameraPose(p,'easy',position,rotation);
  const tan=Math.tan(FLIGHT_FOV*Math.PI/360), point=new Vector3(x*depth*tan*input.viewAspect,y*depth*tan,-depth).applyQuaternion(rotation).add(position);
  return {id,kind:'aircraft',team:'enemy',health:80,hp:80,generation:1,identityGeneration:1,position:numeric?{x:point.x,y:point.y,z:point.z}:point,
    velocity:numeric?{x:0,y:0,z:0}:new Vector3(),quaternion:numeric?{x:0,y:0,z:0,w:1}:new Quaternion(),speed:0,aimHeight:0,...extra};
}
function assist(p:any, ts:any[], i:any=input, lock:any=createFlightTargetLock()) {
  return callback ? getFlightAssist(p,ts,i,'easy',undefined,lock) : getFlightAssist(p,ts,i,'easy',lock);
}
function fire(p:any,ts:any[],lock:any) { return callback ? autoFireTarget(p,ts,'easy',input.viewAspect,undefined,lock) : autoFireTarget(p,ts,'easy',input.viewAspect,lock); }
test('circle A wins over closer off-circle B in either array order',()=>{
  for(const reversed of [false,true]){ const p=player(),a=target(p,2,0,0,950),b=target(p,3,.8,.55,400),lock=createFlightTargetLock();
    const ts=reversed?[b,a]:[a,b],r=assist(p,ts,input,lock);assert.equal(r.turn,0);assert.equal(r.climb,0);assert.equal(fire(p,ts,lock)?.id,2); }
});
test('equal rank has a deterministic ID tie break',()=>{
  for(const reversed of [false,true]){ const p=player(),a=target(p,2,.1,0,500),b=target(p,3,.1,0,500),lock=createFlightTargetLock();
    const ts=reversed?[b,a]:[a,b];assist(p,ts,input,lock);assert.equal(fire(p,ts,lock)?.id,2); }
});
test('20cm distance inversion does not reverse a held off-circle target',()=>{
  const p=player(),lock=createFlightTargetLock(),a=target(p,2,-.8,-.55,500),b=target(p,3,.8,.55,500);
  const origin=new Vector3(p.position.x,p.position.y,p.position.z);
  const left=new Vector3(a.position.x,a.position.y,a.position.z).sub(origin).normalize();
  const right=new Vector3(b.position.x,b.position.y,b.position.z).sub(origin).normalize();
  const setDistance=(t:any, direction:Vector3, distance:number)=> { const v=direction.clone().multiplyScalar(distance).add(origin);t.position=numeric?{x:v.x,y:v.y,z:v.z}:v; };
  setDistance(a,left,500);setDistance(b,right,500.1);
  assist(p,[a],input,lock);
  const before=assist(p,[a,b],input,lock),key=lock.key;
  setDistance(b,right,499.9);const after=assist(p,[b,a],input,lock);
  assert.ok(before.turn<0);assert.ok(after.turn<0);assert.equal(lock.key,key);
});
test('steering owner suppresses target pull even on a small movement or circle promotion',()=>{
  const p=player(),lock=createFlightTargetLock(),a=target(p,2,-.8,-.55,600),b=target(p,3,0,0,500);
  assist(p,[a],input,lock);
  for(const ts of [[a],[a,b]]) { const r=assist(p,ts,{...input,turn:.1,climb:.02,steeringActive:true},lock);assert.equal(r.turn,.1);assert.equal(r.climb,.02); }
});
test('strong reverse manual input remains intact',()=>{
  const p=player(),r=assist(p,[target(p,2,.8,.55,500)],{...input,turn:-.6,climb:-.7});assert.equal(r.turn,-.6);assert.equal(r.climb,-.7);
});
test('dead or out-of-view held targets are released, and no-target clears the lock',()=>{
  const p=player(),lock=createFlightTargetLock(),a=target(p,2,.8,.55,500),b=target(p,3,-.8,-.55,500);
  assist(p,[a],input,lock);const key=lock.key;assert.ok(key);
  a.health=0;a.hp=0;assert.ok(assist(p,[a,b],input,lock).turn<0);assert.notEqual(lock.key,key);
  b.position=target(p,3,2,0,500).position;const r=assist(p,[a,b],input,lock);assert.equal(r.turn,0);assert.equal(r.climb,0);assert.equal(lock.key,null);
});
test('new target identity never inherits the previous identity',()=>{
  const p=player(),lock=createFlightTargetLock(),a=target(p,2,.8,.55,500);assist(p,[a],input,lock);const first=lock.key;
  a.generation=2;a.identityGeneration=2;assist(p,[a],input,lock);assert.notEqual(lock.key,first);
});
test('new pull has bounded rates and losing all targets clears stale pull',()=>{
  const p=player(),state={assistTurn:0,assistClimb:0,responseMultiplier:1,targetLock:createFlightTargetLock()};
  const r=assist(p,[target(p,2,.8,.55,500)],input,state.targetLock);
  const adjusted=smoothFlightAssistance(state,input,r,1/60);assert.ok(Math.abs(adjusted.turn)<=2.5/60+1e-12);assert.ok(Math.abs(adjusted.climb)<=1.5/60+1e-12);
  const neutral=smoothFlightAssistance(state,input,assist(p,[],input,state.targetLock),1/60);assert.equal(neutral.turn,0);assert.equal(neutral.climb,0);
});
test('Normal fire flag does not change steering requests',()=>{
  const p=player(),ts=[target(p,2,.8,.55,500)],i={...input,turn:.2,climb:.1};
  assert.deepEqual(getFlightAssist(p,ts,i,'normal'),getFlightAssist(p,ts,{...i,fire:true},'normal'));
});

test('fire phase revalidates the tick selection without switching to a different ID',()=>{
  const p=player(),lock=createFlightTargetLock(),a=target(p,2,0,0,950),b=target(p,3,.8,.55,400);
  assist(p,[a,b],input,lock);const selected=lock.key;
  a.position=target(p,2,.8,.55,950).position;b.position=target(p,3,0,0,400).position;
  assert.equal(fire(p,[a,b],lock),null);assert.equal(lock.key,selected);
  assist(p,[a,b],input,lock);assert.equal(fire(p,[a,b],lock)?.id,3);
});

import { Campaign, makeCampaignActor } from '../src/campaign';
import { CampaignFlightController } from '../src/campaign-flight';
import { sweepSphere, terrainHeight } from '../src/campaign-terrain';
test('live campaign rejects real rock and height-field occlusion and releases reused actor identities',()=>{
  const cases=[{from:{x:930,y:34,z:-200},to:{x:930,y:34,z:100},yaw:Math.PI,obstacle:0},
    {from:{x:650*Math.cos(Math.PI/7),y:31,z:650*Math.sin(Math.PI/7)},to:{x:1350*Math.cos(Math.PI/7),y:31,z:1350*Math.sin(Math.PI/7)},yaw:-Math.PI/2-Math.PI/7,obstacle:null}];
  for(const fixture of cases){
    const campaign=new Campaign('easy'),state=campaign.state;
    state.player.position={...fixture.from};state.player.previous={...fixture.from};
    const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),fixture.yaw);state.player.quaternion={x:q.x,y:q.y,z:q.z,w:q.w};
    const enemy=makeCampaignActor(900,'enemy','dragon',0,null,fixture.to);state.actors=[enemy];
    assert.ok(fixture.from.y-terrainHeight(fixture.from.x,fixture.from.z)>8);
    assert.equal(sweepSphere(fixture.from,fixture.to,0)?.obstacleId,fixture.obstacle);
    const flight=new CampaignFlightController(state);assert.equal(flight.step(state,input).fire,false);assert.equal(flight.selectedTargetId,null);
    state.player.position.y=100;enemy.position.y=100;flight.sync(state,true);
    assert.equal(flight.step(state,input).fire,true);assert.equal(flight.selectedTargetId,900);
    enemy.generation++;assert.equal(flight.step(state,input).fire,true);
    flight.clearPending();assert.equal(flight.selectedTargetId,null);
  }
});

test('Normal fire cannot alter the live campaign aircraft or camera over a matched twelve-tick trace', () => {
  for (const turn of [-.6, 0, .6]) for (const climb of [-.6, 0, .6]) {
    const campaigns = [new Campaign('normal'), new Campaign('normal')];
    for (const campaign of campaigns) campaign.state.actors = [];
    const flights = campaigns.map(campaign => new CampaignFlightController(campaign.state));
    for (let tick = 0; tick < 12; tick++) {
      for (let i = 0; i < 2; i++) {
        campaigns[i].step(flights[i].step(campaigns[i].state, { ...input, turn, climb, steeringActive: true, fire: i === 1 }));
        flights[i].sync(campaigns[i].state);
      }
      assert.deepEqual(flights[0].player.position, flights[1].player.position);
      assert.deepEqual(flights[0].player.quaternion, flights[1].player.quaternion);
      const poses = flights.map(flight => {
        const position = new Vector3(), rotation = new Quaternion();
        getFlightCameraPose(flight.player, 'normal', position, rotation);
        return { position, rotation, forward: new Vector3(0, 0, -1).applyQuaternion(rotation) };
      });
      assert.deepEqual(poses[0], poses[1], `camera is independent of fire at tick ${tick}`);
    }
  }
});


test('Easy pitch origin survives acquisition, switch, release and zero crossing', () => {
  const state: any = { assistTurn: 0, assistClimb: 0, responseMultiplier: 1, targetLock: createFlightTargetLock() };
  const pull = { turn: 0, climb: .9, responseMultiplier: 1, hasVisibleTarget: true };
  assert.ok(smoothFlightAssistance(state, input, pull, 1/60, .6).climb > .6);
  state.targetLock.changed = true;
  assert.ok(smoothFlightAssistance(state, input, {...pull, climb:-.9}, 1/60, -.6).climb < -.6);
  smoothFlightAssistance(state, input, {...pull, hasVisibleTarget:false}, 1/60, -.6);
  assert.equal(state.assistClimb, 0);
  assert.ok(smoothFlightAssistance(state, input, pull, 1/60, .6).climb > .6);
  const manual = {...input, climb:.1};
  const rate = smoothFlightAssistance(state, manual, {...pull, climb:.2}, 1/60);
  assert.ok(Math.abs(rate.climb - .1) <= .025 + 1e-12, 'absolute history must not leak into manual rates');
  state.targetLock.changed = true;
  assert.equal(smoothFlightAssistance(state, input, {...pull, climb:-.5}, 1/60, .025).climb, 0);
  assert.equal(smoothFlightAssistance(state, input, {...pull, climb:-.5}, 1/60, .025).climb, -.025);
});
