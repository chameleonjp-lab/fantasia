import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { byteReference, createReportStorage, readSourceAttachment, readVerifiedReference } from '../scripts/acceptance-report-storage';

test('raw archive is byte-exact; binary attachments roundtrip and tampering is rejected',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'clean-report-test-'));
 const source=resolve(dir,'raw.json'),raw=Buffer.from('{"suites":[]}\r\n');await writeFile(source,raw);
 const storage=await createReportStorage(resolve(dir,'out'));
 const rawRef=await storage.preserveRaw(source);
 assert.deepEqual(await readVerifiedReference(storage.root,rawRef),raw);
 assert.deepEqual(await readFile(source),raw);
 const binary=Buffer.from([0,255,128,65]),ref=await storage.save(binary);
 assert.deepEqual(await readVerifiedReference(storage.root,ref),binary);
 await assert.rejects(readVerifiedReference(storage.root,{...ref,bytes:ref.bytes+1}),/integrity/);
 await writeFile(resolve(storage.root,ref.path!),Buffer.from([0,255,128,66]));
 await assert.rejects(readVerifiedReference(storage.root,ref),/integrity/);
 await assert.rejects(readVerifiedReference(storage.root,{...rawRef,path:'../raw.json'}),/Unsafe/);
 await assert.rejects(readVerifiedReference(storage.root,{...rawRef,path:source}),/Unsafe/);
 await symlink(source,resolve(storage.root,'external-link'));
 await assert.rejects(readVerifiedReference(storage.root,{...rawRef,path:'external-link'}),/escapes/);
});

test('attachment input cannot traverse or follow a symlink outside its source root',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'clean-report-path-'));
 const root=resolve(dir,'test-results');await mkdir(root);
 const source=resolve(root,'results.json');await writeFile(source,'{}');
 const bytes=Buffer.from('native bytes');await writeFile(resolve(root,'evidence.json'),bytes);
 assert.deepEqual(await readSourceAttachment(source,'evidence.json'),bytes);
 assert.deepEqual(await readSourceAttachment(source,'test-results/evidence.json'),bytes);
 assert.deepEqual(await readSourceAttachment(source,'/old/runner/test-results/evidence.json'),bytes);
 await writeFile(resolve(dir,'outside'),'secret');await symlink(resolve(dir,'outside'),resolve(root,'link'));
 for(const path of ['../outside','/outside','link','/old/test-results/../outside','..\\outside']) await assert.rejects(readSourceAttachment(source,path));
});

test('storage uses isolated exclusive outputs and never replaces an earlier raw archive',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'clean-report-exclusive-'));
 const source=resolve(dir,'raw.json');await writeFile(source,'original');
 const first=await createReportStorage(resolve(dir,'out')),ref=await first.preserveRaw(source);
 await writeFile(source,'later');
 await assert.rejects(first.preserveRaw(source),/EEXIST/);
 assert.equal((await readVerifiedReference(first.root,ref)).toString(),'original');
 const second=await createReportStorage(resolve(dir,'out')),other=await second.preserveRaw(source);
 assert.notEqual(other.path,ref.path);
 assert.equal((await readVerifiedReference(second.root,other)).toString(),'later');
 assert.deepEqual(byteReference(Buffer.from('original')),{bytes:ref.bytes,sha256:ref.sha256});
});

test('inline attachment references reconstruct from raw without creating decoded payload files',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'clean-report-inline-'));
 const storage=await createReportStorage(dir), bytes=Buffer.from('全文\r\n');
 const source=resolve(dir,'source.json');await writeFile(source,JSON.stringify({suites:[{body:bytes.toString('base64')}]}));
 const raw=await storage.preserveRaw(source);assert.equal(raw.path,'source.json');
 const ref=await storage.indexAttachment(bytes,{inline:true,rawPointer:'/suites/0'},raw);
 assert.equal(ref.path,'source.json');assert.equal(ref.encoding,'base64');
 assert.deepEqual(await readVerifiedReference(dir,ref),bytes);
 const {readdir}=await import('node:fs/promises');
 const bundle=(await readdir(dir)).find(p=>p.startsWith('clean-acceptance-evidence-'))!;
 assert.deepEqual(await readdir(resolve(dir,bundle)),[]);
 await assert.rejects(readVerifiedReference(dir,{...ref,sha256:'0'.repeat(64)}),/integrity/);
 await assert.rejects(readVerifiedReference(dir,{...ref,rawPointer:'/suites/8/body'}),/pointer/);
 await assert.rejects(readVerifiedReference(dir,{...ref,rawPointer:'/suites/0/__proto__'}),/pointer/);
 await writeFile(source,'{}');await assert.rejects(readVerifiedReference(dir,ref),/container integrity/);
});

test('existing source-root binary attachments are referenced without copying',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'clean-report-existing-'));
 const storage=await createReportStorage(dir), bytes=Buffer.from([128,255,0]);
 const path=resolve(dir,'screenshot.png');await writeFile(path,bytes);
 const ref=await storage.indexAttachment(bytes,{inline:false,rawPointer:'/suites/0',sourcePath:path},{bytes:0,sha256:''});
 assert.equal(ref.path,'screenshot.png');assert.deepEqual(await readVerifiedReference(dir,ref),bytes);
 await writeFile(path,'changed');await assert.rejects(storage.indexAttachment(bytes,{inline:false,rawPointer:'',sourcePath:path},{bytes:0,sha256:''}),/changed/);
});
