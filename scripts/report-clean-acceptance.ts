import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { buildAcceptanceReport } from './clean-acceptance-report';
const source=process.argv[2]??'test-results/clean-browser-acceptance-results.json';
const output=process.argv[3]??'test-results';
let raw:unknown,loadError:string|undefined;
try{raw=JSON.parse(await readFile(source,'utf8'));}catch(error){loadError=String(error);}
const report=await buildAcceptanceReport(raw,async path=>{
  // Playwright stores paths relative to the run cwd. An absolute path is copied unchanged.
  if(isAbsolute(path)) return readFile(path,'utf8');
  try{return await readFile(resolve(path),'utf8');}catch{return readFile(resolve(dirname(source),path),'utf8');}
});
if(loadError) report.issues.unshift(loadError);
await mkdir(output,{recursive:true});
await writeFile(resolve(output,'clean-browser-acceptance.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(resolve(output,'clean-browser-acceptance.md'),`# Clean-sheet browser acceptance\n\nResult: ${report.browserAcceptance}\n\nValidated ${report.counts.validated}/${report.counts.expected} cases across 10 required categories.\n\n${report.note}\n\nPhysical devices: unverified. Performance: not measured. Release ready: false.\n\n${report.productContractBlocks.map(b=>'- '+b.gate+': '+b.status+' — '+b.reason).join('\n')}\n\n${report.issues.map(i=>'- '+i).join('\n')}\n`);
console.log(`Clean browser acceptance: ${report.browserAcceptance} (${report.counts.validated}/${report.counts.expected}); release ready: false`);
process.exitCode=report.browserAcceptance==='passed'?0:1;
