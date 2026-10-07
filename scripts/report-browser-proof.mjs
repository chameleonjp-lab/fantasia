import { readFile, mkdir, writeFile } from 'node:fs/promises';

const source = 'test-results/clean-browser-proof-results.json';
let raw, loadError;
try { raw = JSON.parse(await readFile(source, 'utf8')); }
catch (error) { loadError = String(error); }
const cases = [];
function visit(suite) {
  for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) cases.push({
    title: spec.title, project: test.projectName, status: test.status,
    attempts: (test.results ?? []).map(result => ({ status: result.status, error: result.error, errors: result.errors })),
  });
  for (const child of suite.suites ?? []) visit(child);
}
if (raw) visit(raw);
const passed = cases.filter(item => item.status === 'expected' && item.attempts.length === 1 && item.attempts[0].status === 'passed').length;
const failed = cases.filter(item => item.status === 'unexpected' || item.attempts.some(attempt => ['failed', 'timedOut', 'interrupted'].includes(attempt.status))).length;
const skipped = cases.filter(item => item.status === 'skipped').length;
const report = {
  schemaVersion: 1, source, classification: 'controlled-clock-real-renderer-driver-proof',
  driverProof: loadError ? 'unavailable' : cases.length === 1 && passed === 1 && failed === 0 && skipped === 0 ? 'passed' : 'not-passed',
  counts: { discovered: cases.length, passed, failed, skipped }, loadError,
  suiteRebuildComplete: false, acceptanceCasesCompleted: 0,
  pendingAcceptanceCases: ['start/cancel/modes', 'continuous controls', 'single-action ownership', 'pause/resume/restart',
    'settings/storage/focus', 'resize/context recovery', 'explicit safety faults', 'responsive HUD/hit targets',
    'actual 200% text', 'uncontrolled-clock native capability'],
  physicalDeviceAcceptance: 'unverified', performanceAcceptance: 'not measured', releaseReady: false,
  note: 'This single proof checks the proposed real-renderer driver only. It cannot complete F-03/F-07/F-18/F-19 or establish an iPhone freeze fix. Native browser execution is required before the driver itself is verified.',
  cases,
};
await mkdir('test-results', { recursive: true });
await writeFile('test-results/browser-proof-acceptance.json', JSON.stringify(report, null, 2));
await writeFile('test-results/browser-proof-acceptance.md', `# Clean-sheet browser driver proof\n\nDriver: ${report.driverProof}\n\nCases: ${passed} passed, ${failed} failed, ${skipped} skipped, ${cases.length} discovered\n\nFull acceptance rebuild: incomplete (0/10 core cases completed). Physical-device and performance acceptance: unverified. Release ready: false.\n\n${report.note}\n`);
console.log(`Driver proof: ${report.driverProof}; browser acceptance incomplete; release ready: false`);
// A skipped, missing or malformed driver run cannot silently become a green proof.
process.exitCode = report.driverProof === 'passed' ? 0 : 1;
