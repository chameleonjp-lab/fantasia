import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildAcceptanceReport } from './clean-acceptance-report';
import { byteReference, createReportStorage, readSourceAttachment, resolveSourceAttachment } from './acceptance-report-storage';
const source=process.argv[2]??'test-results/clean-browser-acceptance-results.json';
const output=process.argv[3]??'test-results';
const storage=await createReportStorage(output);
let raw:unknown,loadError:string|undefined,rawReference;
try {
  rawReference=await storage.preserveRaw(source);
  // Parse the preserved bytes, not a potentially changed original.
  const bytes=await readFile(resolve(storage.root,rawReference.path));
  if (byteReference(bytes).sha256!==rawReference.sha256) throw new Error('Raw report changed while indexing');
  raw=JSON.parse(bytes.toString('utf8'));
} catch(error) { loadError=String(error); }
const report=await buildAcceptanceReport(raw,path=>readSourceAttachment(source,path),async (bytes,context)=>{
  if (!rawReference) throw new Error('Raw report was not preserved');
  const sourcePath=context.inline ? undefined : await resolveSourceAttachment(source,context.sourcePath!);
  return storage.indexAttachment(bytes,{...context,sourcePath},rawReference);
});
if(loadError) { report.issues.unshift(loadError); report.browserAcceptance='not-passed'; }
const indexedReport={...report,raw:rawReference};
await writeFile(resolve(storage.root,'clean-browser-acceptance.json'),JSON.stringify(indexedReport,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(storage.root,'clean-browser-acceptance.md'),`# Clean-sheet browser acceptance\n\nResult: ${report.browserAcceptance}\n\nValidated ${report.counts.validated}/${report.counts.expected} cases across 10 required categories.\n\n${report.note}\n\nEvidence: see the JSON index for the unchanged raw report and lossless raw JSON-pointer/base64 references or existing attachment paths, decoded byte sizes and SHA-256 hashes. Raw JSON pointers retain complete case/attempt metadata.\n\nPhysical devices: unverified. Performance: not measured. Release ready: false.\n\n${report.productContractBlocks.map(b=>'- '+b.gate+': '+b.status+' — '+b.reason).join('\n')}\n\n${report.issues.map(i=>'- '+i).join('\n')}\n`,{flag:'wx'});
console.log(`Clean browser acceptance: ${report.browserAcceptance} (${report.counts.validated}/${report.counts.expected}); release ready: false`);
process.exitCode=report.browserAcceptance==='passed'?0:1;
