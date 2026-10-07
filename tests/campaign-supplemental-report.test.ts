import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementalReport,throttleIds} from '../scripts/supplemental-acceptance-report';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
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

test('gzip evidence has the same validated content and retains hashes for encoded and original bytes',async()=>{
 const raw=fixture(),originals=raw.suites[0].specs.map(s=>Buffer.from(s.tests[0].results[0].attachments[0].body,'base64'));
 for(const s of raw.suites[0].specs){const a=s.tests[0].results[0].attachments[0];a.contentType='application/gzip';a.body=gzipSync(Buffer.from(a.body,'base64')).toString('base64');}
 const result=await supplementalReport(raw,'throttle',read);assert.equal(result.status,'passed');assert.equal(result.counts.validated,4);assert.equal(result.releaseReady,false);
 const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 for(const [i,c]of result.cases.entries()){
  const encoded=Buffer.from(raw.suites[0].specs[i].tests[0].results[0].attachments[0].body,'base64'),ref=c.attachments[0];
  assert.equal(ref.bytes,encoded.length);assert.equal(ref.sha256,hash(encoded));assert.equal(ref.compression,'gzip');
  assert.equal(ref.decodedBytes,originals[i].length);assert.equal(ref.decodedSha256,hash(originals[i]));assert.deepEqual(gunzipSync(encoded),originals[i]);
 }
});
for(const defect of ['truncated-gzip','invalid-json','failed-outcome'] as const)test(`gzip evidence fails closed for ${defect}`,async()=>{
 const raw=fixture(),a=raw.suites[0].specs[0].tests[0].results[0].attachments[0],e=JSON.parse(Buffer.from(a.body,'base64').toString());
 if(defect==='failed-outcome')e.outcome='failed';
 const encoded=gzipSync(Buffer.from(defect==='invalid-json'?'not JSON':JSON.stringify(e)));
 a.contentType='application/gzip';a.body=(defect==='truncated-gzip'?encoded.subarray(0,encoded.length-8):encoded).toString('base64');
 assert.equal((await supplementalReport(raw,'throttle',read)).status,'not-passed');
});
