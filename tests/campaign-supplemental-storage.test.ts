import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

test('supplemental job log restores exact raw bytes after lossless compression and preserves failure', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'supplemental-log-'));
  try {
    await mkdir(resolve(dir, 'supplemental-results'));
    // Include Japanese, original CRLF, compressible diagnostics and binary
    // payloads, so recovery verifies the original bytes rather than parsed JSON.
    const bytes = Buffer.from(JSON.stringify({ suites: [], note: '検査は失敗のまま',
      diagnostics: 'native renderer observation\n'.repeat(50000), binary: randomBytes(30000).toString('base64') }) + '\r\n');
    await writeFile(resolve(dir, 'supplemental-results/throttle-integration-results.json'), bytes);
    const result = spawnSync(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'),
      resolve('scripts/report-supplemental-acceptance.ts'), 'throttle'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const lines = result.stdout.trim().split('\n');
    const references = lines.filter(l => l.startsWith('FANTASIA_EVIDENCE_FILE ')).map(l => JSON.parse(l.slice(23)));
    const ref = references.find(r => r.label === 'throttle-integration-results.json');
    assert.ok(ref); assert.equal(ref.compression, 'gzip'); assert.equal(ref.compressed, true);
    const chunks = lines.filter(l => l.startsWith(`FANTASIA_EVIDENCE_CHUNK ${ref.sha256} `))
      .map(l => { const [, , index, data] = l.split(' '); return { index: Number(index), bytes: Buffer.from(data, 'base64') }; });
    assert.deepEqual(chunks.map(c => c.index), Array.from({ length: ref.chunks }, (_, i) => i));
    assert.ok(lines.includes(`FANTASIA_EVIDENCE_END ${ref.sha256}`));
    const encoded = Buffer.concat(chunks.map(c => c.bytes));
    const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    assert.equal(encoded.length, ref.encodedBytes); assert.equal(digest(encoded), ref.encodedSha256);
    const restored = gunzipSync(encoded);
    assert.equal(restored.length, ref.bytes); assert.equal(digest(restored), ref.sha256); assert.deepEqual(restored, bytes);
    assert.ok(result.stdout.length < bytes.length / 5);
    const summary = JSON.parse(await readFile(resolve(dir, 'supplemental-results/throttle-summary.json'), 'utf8'));
    assert.equal(summary.status, 'not-passed'); assert.equal(summary.releaseReady, false); assert.deepEqual(summary.raw, ref);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
