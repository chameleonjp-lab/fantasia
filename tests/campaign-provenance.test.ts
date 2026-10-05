import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('K hero, camera, flight, shared dialog and renderer lifecycle remain pinned', () => {
  const manifest = JSON.parse(readFileSync('docs/KAISEN_IMPORT_MANIFEST.json', 'utf8'));
  assert.equal(manifest.commit, '3d751051dc6212482a129e8da596ddd349b2f9f5');
  for (const path of ['src/aircraft.ts', 'src/flight-view.ts', 'src/flight.ts',
    'src/dialog-focus.ts', 'src/render-queue.ts', 'public/third-party-notices.txt']) {
    const original = manifest.files.find((file: { path: string }) => file.path === path);
    assert.ok(original, path);
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), original.sha256, path);
  }
  const readme = readFileSync('README.md', 'utf8');
  assert.ok(readme.startsWith('# fantasia\nファンタジア\n'));
  assert.ok(readme.includes('速度調整レバー（統合待ち）'));
});
