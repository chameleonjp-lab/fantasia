import test from 'node:test';
import assert from 'node:assert/strict';
import { Frustum, Matrix4, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { Campaign, makeCampaignActor } from '../src/campaign';
import { CampaignFlightController } from '../src/campaign-flight';
import { getFlightCameraPose } from '../src/flight-view';
import { updateQuaternion } from '../src/flight';
import type { GameMode, FlightInput } from '../src/types';
import { CampaignScene } from '../src/campaign-scene';
const neutral: FlightInput = {turn:0,climb:0,fire:false,loop:false,viewAspect:874/402};
function fixture(mode:GameMode, kind?:'sword'|'dragon'|'turret', right=105, behind=false, friendly=false) {
 const campaign=new Campaign(mode,73);campaign.state.actors=[];
 campaign.state.player.position={x:0,y:1500,z:0};campaign.state.player.previous={...campaign.state.player.position};
 const controller=new CampaignFlightController(campaign.state);
 if(kind){const position=new Vector3(),q=new Quaternion();getFlightCameraPose(controller.player,mode,position,q);
  const point=new Vector3(right,0,behind?500:-500).applyQuaternion(q).add(position);
  const actor=makeCampaignActor(900,friendly?'friendly':'enemy',kind,0,null,{x:point.x,y:point.y,z:point.z});
  actor.velocity={x:8,y:0,z:0};campaign.state.actors=[actor];}
 return {campaign,controller};
}
test('campaign enemy class, placement, disappearance and fire never change manual flight in either mode',()=>{
 for(const mode of ['easy','normal'] as const)for(const turn of [0,.1,-.3])for(const climb of [0,.1,-.2]){
  const samples=[fixture(mode),...(['sword','dragon','turret'] as const).flatMap(kind=>[fixture(mode,kind),fixture(mode,kind,0,true),fixture(mode,kind,105,false,true)])];
  for(let tick=0;tick<12;tick++){
   for(let i=0;i<samples.length;i++){const {campaign,controller}=samples[i];if(tick===6&&i%2)campaign.state.actors=[];controller.step(campaign.state,{...neutral,turn,climb,fire:i%2===1});}
   for(const sample of samples.slice(1)){assert.ok(sample.controller.player.position.distanceTo(samples[0].controller.player.position)<.001);assert.ok(sample.controller.player.quaternion.angleTo(samples[0].controller.player.quaternion)<.001*Math.PI/180);}
  }
 }
});
test('campaign Easy trigger uses the live circle but every gun muzzle fires straight',()=>{
 for(const kind of ['sword','dragon','turret'] as const){const {campaign,controller}=fixture('easy',kind,0);
  const output=controller.step(campaign.state,neutral);assert.equal(output.fire,true);
  const forward=new Vector3(0,0,-1).applyQuaternion(controller.player.quaternion);
  for(const weapon of ['mg','cannon'] as const)for(const direction of output.shotDirections![weapon])assert.ok(new Vector3(direction.x,direction.y,direction.z).angleTo(forward)<.001*Math.PI/180);
  campaign.state.actors[0].hp=0;assert.equal(controller.step(campaign.state,neutral).fire,false);
 }
});
test('campaign centered steering owner holds twenty degrees until release in both modes',()=>{
 for(const mode of ['easy','normal'] as const){const {campaign,controller}=fixture(mode);const p=controller.player;p.pitch=20*Math.PI/180;updateQuaternion(p);
  for(let tick=0;tick<12;tick++)controller.step(campaign.state,{...neutral,steeringActive:true});
  assert.ok(Math.abs(p.pitch-20*Math.PI/180)<.001*Math.PI/180);
  controller.step(campaign.state,neutral);assert.ok(p.pitch<20*Math.PI/180&&p.pitch>0);
 }
});
function renderScene(state:any) {
 let actorX=0;
 const scene:any=Object.assign(Object.create(CampaignScene.prototype),{
  disposed:false,runId:state.runId,lastTick:0,visualTime:0,prepared:false,pollRender:()=> 'ready',
  hero:{root:new Object3D(),propeller:new Object3D(),ailerons:[new Object3D(),new Object3D()],elevator:new Object3D()},
  camera:new PerspectiveCamera(64,1,.5,22000),sky:new Object3D(),groundView:new Frustum(),viewProjection:new Matrix4(),scene:{},
  updateActors(view:any){actorX=view.actors[0]?.position.x??0;},updateProjectiles(){},updateTelegraphs(){},updateEffects(){},drawOverlay(){},renderer:{render(){}},
 });return {scene,get actorX(){return actorX;}};
}
test('campaign renderer samples player, target and camera at the same halfway time',()=>{
 for(const mode of ['easy','normal'] as const){const {campaign,controller}=fixture(mode,'dragon',0),state=campaign.state,view=renderScene(state);
  const beforeQuaternion=controller.player.quaternion.clone();
  state.actors[0].position.x=100;view.scene.capturePresentation?.(state,controller.player);
  controller.player.position.x=20;controller.player.pitch=.2;controller.player.bank=.4;updateQuaternion(controller.player);
  state.actors[0].position.x=200;state.simTick++;
  view.scene.render(state,controller.player,mode,0,null,.5);
  assert.equal(view.scene.hero.root.position.x,10);assert.equal(view.actorX,150);
  const expected={...controller.player,position:new Vector3(10,1500,0),quaternion:beforeQuaternion.slerp(controller.player.quaternion,.5),bank:.2};
  const position=new Vector3(),rotation=new Quaternion();getFlightCameraPose(expected,mode,position,rotation);
  assert.ok(view.scene.camera.position.distanceTo(position)<.001);assert.ok(view.scene.camera.quaternion.angleTo(rotation)<.001*Math.PI/180);
 }
});
test('campaign rising camera has no repeated view over forty-eight 120Hz presentation frames',()=>{
 for(const mode of ['easy','normal'] as const){const {campaign,controller}=fixture(mode),state=campaign.state,view=renderScene(state);let previous:Vector3|undefined,repeats=0;
  for(let tick=0;tick<25;tick++){view.scene.capturePresentation?.(state,controller.player);campaign.step(controller.step(state,{...neutral,climb:.45,steeringActive:true}));controller.sync(state);
   for(const alpha of [0,.5]){view.scene.render(state,controller.player,mode,0,null,alpha);const forward=view.scene.camera.getWorldDirection(new Vector3());if(tick>0&&previous&&forward.distanceTo(previous)<1e-12)repeats++;previous=forward;}
  }assert.equal(repeats,0,`${mode}: repeated view in 48 frames`);
 }
});
test('campaign reticle color follows sampled target entry and exit rather than authoritative trigger ID',()=>{
 for(const entering of [false,true]){const {campaign,controller}=fixture('easy','dragon',0),state=campaign.state,view=renderScene(state),scene=view.scene;
  const origin=new Vector3(),q=new Quaternion();getFlightCameraPose(controller.player,'easy',origin,q);
  const point=(right:number)=>new Vector3(right,0,-500).applyQuaternion(q).add(origin);
  const before=point(entering?100:0),after=point(entering?0:100);state.actors[0].position={x:before.x,y:before.y,z:before.z};
  scene.capturePresentation?.(state,controller.player);state.actors[0].position={x:after.x,y:after.y,z:after.z};state.simTick++;
  const stop=new Error('first reticle stroke'),colors:string[]=[];
  Object.assign(scene,{width:874,height:402,overlayVisible:true,hudLayout:{update(){}},ctx:{shadowBlur:0,clearRect(){},beginPath(){},arc(){},strokeStyle:'',stroke(){colors.push(this.strokeStyle);throw stop;}}});
  scene.drawOverlay=(CampaignScene.prototype as any).drawOverlay;
  for(const alpha of [0,.5,1]){try{scene.render(state,controller.player,'easy',0,entering?900:null,alpha);}catch(error){if(error!==stop)throw error;}}
  assert.deepEqual(colors,entering?['#ffffff','#ff645b','#ff645b']:['#ff645b','#ff645b','#ffffff']);
 }
});
test('campaign reset between pause and resume discards the previous display pose',()=>{
 for(const mode of ['easy','normal'] as const){const {campaign,controller}=fixture(mode),state=campaign.state,view=renderScene(state);
  view.scene.capturePresentation(state,controller.player);controller.player.position.x=20;state.simTick++;view.scene.render(state,controller.player,mode,0,null,1);const current=view.scene.camera.position.clone();
  view.scene.resetPresentation();view.scene.render(state,controller.player,mode,0,null,0);assert.ok(view.scene.camera.position.distanceTo(current)<1e-12);
 }
});
