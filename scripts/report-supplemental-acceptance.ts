import {readFile,realpath,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdirSync,writeFileSync} from 'node:fs';
import {supplementalReport,type SupplementalSuite} from './supplemental-acceptance-report';
const suite=process.argv[2] as SupplementalSuite;
if(!['throttle','active-critical'].includes(suite))throw Error('Expected explicit supplemental suite');
const root=resolve('supplemental-results');await mkdir(root,{recursive:true});
const source=resolve(root,suite==='throttle'?'throttle-integration-results.json':'active-critical-results.json');
const seen=new Set<string>();
function preserve(bytes:Buffer,label:string){
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const encoded=gzipSync(bytes);
  const ref={label,bytes:bytes.length,sha256,encoding:'base64',compressed:true,compression:'gzip',
    encodedBytes:encoded.length,encodedSha256:createHash('sha256').update(encoded).digest('hex'),chunks:Math.ceil(encoded.length/12000)};
  if(suite==='active-critical')Object.assign(ref,{storage:'artifact',path:`evidence-bytes/${sha256}.gz`,encoding:'binary',chunks:0});
  if(!seen.has(sha256)) {
    console.log('FANTASIA_EVIDENCE_FILE '+JSON.stringify(ref));
    if(suite==='active-critical'){
      mkdirSync(resolve(root,'evidence-bytes'),{recursive:true});
      writeFileSync(resolve(root,`evidence-bytes/${sha256}.gz`),encoded,{flag:'wx'});
    }else for(let offset=0,index=0;offset<encoded.length;offset+=12000,index++)console.log(`FANTASIA_EVIDENCE_CHUNK ${sha256} ${index} ${encoded.subarray(offset,offset+12000).toString('base64')}`);
    console.log('FANTASIA_EVIDENCE_END '+sha256);seen.add(sha256);
  }
  return ref;
}
const attachments=async(path:string)=>{
  if(path.includes('\\')||path.split('/').includes('..'))throw Error('Unsafe attachment path');
  let local=resolve(root,path);
  if(!isAbsolute(path)&&path.startsWith('supplemental-results/'))local=resolve(path);
  const actual=await realpath(local),rel=relative(root,actual);
  if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw Error('Attachment outside supplemental root');
  const bytes=await readFile(actual);preserve(bytes,rel);return bytes;
};
let raw:any,rawRef:any,loadError='';
try {const bytes=await readFile(source);rawRef=preserve(bytes,basename(source));raw=JSON.parse(bytes.toString('utf8'));}catch(e){loadError=String(e);}
const report=await supplementalReport(raw,suite,attachments);
if(loadError){report.issues.unshift(loadError);report.status='not-passed';}
const bytes=Buffer.from(JSON.stringify({...report,raw:rawRef},null,2)+'\n');
await writeFile(resolve(root,`${suite}-summary.json`),bytes,{flag:'wx'});preserve(bytes,`${suite}-summary.json`);
console.log(`Supplemental ${suite}: ${report.status} ${report.counts.validated}/${report.counts.expected}; releaseReady=false`);
if(suite==='active-critical'&&report.status!=='passed')console.log(JSON.stringify({issues:report.issues,
  failedCases:report.cases.filter(c=>!c.validated).map(c=>({id:c.id,totalErrors:c.errors.length,errorsShown:c.errors.slice(0,20)})),
  completeReport:`${suite}-summary.json`},null,2));
process.exitCode=report.status==='passed'?0:1;
