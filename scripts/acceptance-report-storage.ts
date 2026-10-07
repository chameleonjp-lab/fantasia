import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type ByteReference = { bytes: number; sha256: string; path?: string; rawPointer?: string; encoding?: 'base64'; containerSha256?: string };
export type AttachmentContext = { rawPointer: string; sourcePath?: string; inline: boolean };
export type AttachmentStore = (bytes: Buffer, context: AttachmentContext) => Promise<ByteReference>;
export function byteReference(bytes: Buffer): ByteReference {
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

// Every output filename is generated here, never taken from evidence. Exclusive
// creation prevents an existing artifact (including a symlink) being overwritten.
export async function createReportStorage(output: string) {
  await mkdir(output, { recursive: true });
  const root = await realpath(output);
  const bundle = await mkdtemp(resolve(root, 'clean-acceptance-evidence-'));
  let sequence = 0;
  const save = async (bytes: Buffer): Promise<ByteReference> => {
    const path = resolve(bundle, `${sequence++}.bin`);
    await writeFile(path, bytes, { flag: 'wx' });
    return { ...byteReference(bytes), path: relative(root, path).split(sep).join('/') };
  };
  async function preserveRaw(source: string) {
    const original = await realpath(source), rel = relative(root, original);
    const inRoot = rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    const path = inRoot ? original : resolve(bundle, 'playwright-results.json');
    const hash = createHash('sha256'); let bytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); },
    });
    if (inRoot) { for await (const chunk of createReadStream(original)) { bytes += chunk.length; hash.update(chunk); } }
    else await pipeline(createReadStream(original), meter, createWriteStream(path, { flags: 'wx' }));
    return { bytes, sha256: hash.digest('hex'), path: relative(root, path).split(sep).join('/') };
  }
  async function indexAttachment(bytes: Buffer, context: AttachmentContext, raw: ByteReference): Promise<ByteReference> {
    if (context.inline) return { ...byteReference(bytes), path: raw.path, rawPointer: context.rawPointer + '/body', encoding: 'base64', containerSha256: raw.sha256 };
    if (context.sourcePath) {
      const actual = await realpath(context.sourcePath), rel = relative(root, actual);
      if (rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
        const current = await readFile(actual);
        if (byteReference(current).sha256 !== byteReference(bytes).sha256) throw new Error('Attachment changed while indexing');
        return { ...byteReference(bytes), path: rel.split(sep).join('/') };
      }
    }
    return save(bytes);
  }
  return { root, save, preserveRaw, indexAttachment };
}

// The source directory is the only trusted attachment root. A downloaded CI
// artifact may retain the runner's absolute /.../test-results/... paths; relocate
// that explicit suffix into this root without ever reading the runner path.
export async function resolveSourceAttachment(source: string, attachment: string): Promise<string> {
  if (attachment.includes('\\') || attachment.split('/').some(part => part === '..')) throw new Error('Unsafe attachment path');
  const root = await realpath(dirname(resolve(source)));
  let path = resolve(root, attachment);
  const inside = (candidate: string) => { const rel = relative(root, candidate); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
  if (!inside(path)) {
    const marker = '/test-results/';
    const index = attachment.lastIndexOf(marker);
    if (index < 0) throw new Error('Attachment outside source directory');
    path = resolve(root, attachment.slice(index + marker.length));
  } else if (!isAbsolute(attachment) && attachment.startsWith('test-results/') && basename(root) === 'test-results') {
    path = resolve(root, attachment.slice('test-results/'.length));
  }
  if (!inside(path) || !inside(await realpath(path))) throw new Error('Attachment escapes source directory');
  return path;
}

export async function readSourceAttachment(source: string, attachment: string): Promise<Buffer> {
  return readFile(await resolveSourceAttachment(source, attachment));
}

// Consumers must verify before using a stored reference; hashes detect missing,
// truncated or modified evidence. The trusted index itself must be retained.
export async function readVerifiedReference(output: string, reference: ByteReference): Promise<Buffer> {
  if (!reference.path || isAbsolute(reference.path) || reference.path.includes('\\') || reference.path.split('/').some(p => p === '..')) throw new Error('Unsafe evidence reference');
  const root = await realpath(output), path = resolve(root, reference.path);
  const actual = await realpath(path), rel = relative(root, actual);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Evidence reference escapes output');
  let bytes = await readFile(actual);
  if (reference.encoding === 'base64') {
    if (byteReference(bytes).sha256 !== reference.containerSha256) throw new Error('Raw container integrity mismatch');
    if (!reference.rawPointer?.startsWith('/')) throw new Error('Missing raw JSON pointer');
    let value: any = JSON.parse(bytes.toString('utf8'));
    for (const key of reference.rawPointer.slice(1).split('/')) {
      const decoded = key.replace(/~1/g, '/').replace(/~0/g, '~');
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, decoded)) throw new Error('Missing raw JSON pointer target');
      value = value[decoded];
    }
    if (typeof value !== 'string') throw new Error('Non-string base64 target');
    bytes = Buffer.from(value, 'base64');
  }
  const digest = byteReference(bytes);
  if (digest.bytes !== reference.bytes || digest.sha256 !== reference.sha256) throw new Error('Evidence integrity mismatch');
  return bytes;
}
