import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('K import provenance and explicit camera migration remain pinned', () => {
  const manifest = JSON.parse(readFileSync('docs/KAISEN_IMPORT_MANIFEST.json', 'utf8'));
  assert.equal(manifest.commit, '3d751051dc6212482a129e8da596ddd349b2f9f5');
  for (const path of ['src/aircraft.ts', 'src/flight-view.ts', 'src/flight.ts',
    'src/dialog-focus.ts', 'src/render-queue.ts', 'public/third-party-notices.txt']) {
    const original = manifest.files.find((file: { path: string }) => file.path === path);
    assert.ok(original, path);
    const bytes = readFileSync(path);
    // The immutable original import manifest still describes Kaisen 3d75105.
    // These two files intentionally diverge for the camera-rate rollout based
    // on Kaisen 67ac107 and the reviewed horizontal-pitch-hold correction.
    // Pin both provenance and migrated bytes; behavioral coverage lives in
    // flight.test.ts and campaign-flight.test.ts, not in a relaxed hash check.
    const cameraMigration: Record<string, { imported: string; migrated: string }> = {
      'src/flight.ts': {
        imported: '8fe62d521bc2cfa11b0ab8cb3c0609c54a3d80355eff15a72257eea1aa4770a5',
        migrated: '516ed2327166e65f37ff1559356b93da5885d9acecbe483390c5281e36dc60ac',
      },
      'src/flight-view.ts': {
        imported: '1f9b7e040c2270de5838f24bad93c7ac1c75c7827ba3c1b58591ef6271a20363',
        migrated: 'e1f76d03ec6b95ea225113e355d1fa7c6db9ac44aa61aed4a4f991b6edcaf9a9',
      },
    };
    const migration = cameraMigration[path];
    if (migration) assert.equal(original.sha256, migration.imported, `${path} original import remains documented`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), migration?.migrated ?? original.sha256, path);
  }
  const readme = readFileSync('README.md', 'utf8');
  assert.ok(readme.startsWith('# fantasia\nファンタジア\n'));
  assert.ok(readme.includes('速度調整レバー（共通UI候補）'));
});
