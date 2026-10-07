import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementalReport,throttleIds} from '../scripts/supplemental-acceptance-report';
function fixture(){return {suites:[{title:'throttle-integration.spec.ts',specs:throttleIds.map(id=>({title:`[${id}] Expected synthetic reporter fixture`,tests:[{projectName:'clean-browser-acceptance',expectedStatus:'passed',status:'expected',results:[{status:'passed',retry:0,attachments:[{name:'throttle-integration-evidence',contentType:'application/json',body:Buffer.from(JSON.stringify({id,outcome:'passed',classification:'controlled-clock-functional',runtimeMocked:false,rendererMocked:false,applicationQueueModified:false,releaseReady:false,physicalDeviceAcceptance:'unverified',performanceAcceptance:'not-measured',backend:{webgl2:true,version:'synthetic fixture',renderer:'unit only',browserDpr:1},steps:1,maxSteps:120,ownedFencesCreated:1,ownedFencesReleased:1,pageErrors:[],observations:[{label:'throttle-case-completed',id}]})).toString('base64')}]}]}]}))}]};}
const read=async()=>{throw Error('No fixture file attachment');};
test('supplemental reporter accepts exact synthetic registry, never marks release ready',async()=>{
 const result=await supplementalReport(fixture(),'throttle',read);assert.equal(result.status,'passed');assert.equal(result.counts.validated,4);assert.equal(result.releaseReady,false);
});
for(const defect of ['missing','duplicate','retry','skip','attachment','outcome','identity','fence','missing-fields','zero-fences','invalid-steps','no-marker','invalid-backend'] as const)test(`supplemental reporter fails closed for ${defect}`,async()=>{
 const raw=fixture(),spec=raw.suites[0].specs[0],result=spec.tests[0].results[0];
 if(defect==='missing')raw.suites[0].specs.pop();
 if(defect==='duplicate')raw.suites[0].specs[1]=structuredClone(spec);
 if(defect==='retry')result.retry=1;
 if(defect==='skip')result.status='skipped';
 if(defect==='attachment')result.attachments=[];
 if(['outcome','identity','fence','missing-fields','zero-fences','invalid-steps','no-marker','invalid-backend'].includes(defect)){
  const e=JSON.parse(Buffer.from(result.attachments[0].body,'base64').toString());
  if(defect==='outcome')e.outcome='failed';if(defect==='identity')e.id='foreign';if(defect==='fence')e.ownedFencesReleased=0;
  if(defect==='missing-fields'){delete e.pageErrors;delete e.ownedFencesCreated;delete e.ownedFencesReleased;}
  if(defect==='zero-fences'){e.ownedFencesCreated=0;e.ownedFencesReleased=0;}
  if(defect==='invalid-steps')e.steps='1';
  if(defect==='no-marker')e.observations=[{}];
  if(defect==='invalid-backend')e.backend={webgl2:true};
  result.attachments[0].body=Buffer.from(JSON.stringify(e)).toString('base64');
 }
 assert.equal((await supplementalReport(raw,'throttle',read)).status,'not-passed');
});
test('warning collection without execution is not a pass',async()=>{
 const report=await supplementalReport({suites:[]},'active-critical',read);assert.equal(report.status,'not-passed');assert.equal(report.counts.expected,12);assert.equal(report.counts.validated,0);
});
