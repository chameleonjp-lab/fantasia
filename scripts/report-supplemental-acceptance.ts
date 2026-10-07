import {readFile,realpath,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {supplementalReport,type SupplementalSuite} from './supplemental-acceptance-report';
const suite=process.argv[2] as SupplementalSuite;
if(!['throttle','active-critical'].includes(suite))throw Error('Expected explicit supplemental suite');
const root=resolve('supplemental-results');await mkdir(root,{recursive:true});
const source=resolve(root,suite==='throttle'?'throttle-integration-results.json':'active-critical-results.json');
const seen=new Set<string>();
function preserve(bytes:Buffer,label:string){
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const ref={label,bytes:bytes.length,sha256,encoding:'base64',compressed:false,chunks:Math.ceil(bytes.length/12000)};
  if(!seen.has(sha256)) {
    console.log('FANTASIA_EVIDENCE_FILE '+JSON.stringify(ref));
    for(let offset=0,index=0;offset<bytes.length;offset+=12000,index++)console.log(`FANTASIA_EVIDENCE_CHUNK ${sha256} ${index} ${bytes.subarray(offset,offset+12000).toString('base64')}`);
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
process.exitCode=report.status==='passed'?0:1;
