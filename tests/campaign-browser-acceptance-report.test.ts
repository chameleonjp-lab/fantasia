import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReport, markdown, readAttachmentJson, SAFETY_ANNOTATION } from '../scripts/report-browser-acceptance.mjs';

const title = 'Normal full-size radar and notification avoid DOM HUD at 1440x900';
const prefix = 'fantasia-normal-1440x900';
const available = (value: unknown) => ({ status: 'available', value });
const observation = (time: number, stopped = false) => ({ capturedAtMs: time, phase: stopped ? 'paused' : 'playing',
  tick: 30, activeTicks: 30, pauseReasons: stopped ? ['render'] : [], renderStatus: 'pending',
  performanceInterrupted: stopped, fatalLogicError: null, render: { queue: { status: 'pending' } },
  lastInterruption: stopped ? { reason: 'stalled' } : null });
const capture = () => ({ before: observation(1), after: observation(2, true), final: observation(3, true) });
const overlayError = () => ({ location: { file: '/runner/browser-tests/fantasia.spec.ts', line: 199, column: 49 }, message:
  "Error: expect(locator).toBeHidden() failed\nLocator:  locator('#pause-screen')\nExpected: hidden\nReceived: visible\n> 199 | await expect(page.locator('#pause-screen')).toBeHidden();\n    at expectHudSafeLayout (/runner/browser-tests/fantasia.spec.ts:199:49)" });
const browser = (status = 'failed', errors: unknown[] = [overlayError()], name = title) => available({
  stats: { expected: status === 'passed' ? 1 : 0, unexpected: status === 'failed' ? 1 : 0, skipped: status === 'skipped' ? 1 : 0 },
  errors: [], suites: [{ title: 'fantasia.spec.ts', specs: [{ title: name, file: 'fantasia.spec.ts', tests: [{
    status: status === 'passed' ? 'expected' : status === 'skipped' ? 'skipped' : 'unexpected', expectedStatus: 'passed', projectName: 'chromium',
    annotations: status === 'skipped' ? [{ type: 'skip', description: 'Real visibility change not observed' }] : [],
    results: status === 'not-run' ? [] : [{ status, errors, attachments: [] }],
  }] }] }] });
const evidence = (data = capture()) => (name: string) => name === `${prefix}-capture.json` ? available(data) : { status: 'missing' };
const first = (value: any) => value.value.suites[0].specs[0].tests[0];

test('raw pass, failure, skip and not-run stay distinct; release remains blocked', () => {
  for (const status of ['passed', 'failed', 'skipped', 'not-run']) {
    const input = browser(status, []), report = buildReport(input);
    assert.equal(report.checks[0].rawStatus, status);
    assert.equal(report.checks[0].outcome, status);
    assert.equal(report.counts[status], 1);
    assert.deepEqual(report.checks[0].attempts, first(input).results);
    assert.deepEqual(report.rawStats, input.value.stats);
    assert.equal(report.release.ready, false);
    assert.equal(report.release.acceptance['F-03'], 'incomplete');
    assert.equal(report.physicalPerformance.status, 'not-run-or-not-provided');
  }
  const skipped = buildReport(browser('skipped', []));
  assert.equal(skipped.checks[0].annotations[0].description, 'Real visibility change not observed');
});

test('exact overlay guard plus matching ordered capture permits annotation, never pass', () => {
  const report = buildReport(browser(), evidence());
  assert.equal(report.checks[0].classification, SAFETY_ANNOTATION);
  assert.equal(report.checks[0].classificationEvidence.capture, `${prefix}-capture.json`);
  assert.equal(report.checks[0].outcome, 'failed');
  assert.equal(report.browserOutput.outcome, 'failed');
});

test('live-phase guard requires matching paused HUD and capture, not only a later pause', () => {
  const error = { location: { file: '/runner/browser-tests/fantasia.spec.ts', line: 198 }, message:
    "Error: HUD acceptance requires live flight\nExpected: \"playing\"\nReceived: \"paused\"\n> 198 | expect(hud.phase, 'HUD acceptance requires live flight').toBe('playing');\n at expectHudSafeLayout (/runner/browser-tests/fantasia.spec.ts:198:62)" };
  const data = capture(); data.before = observation(1, true);
  const read = (name: string) => name.endsWith('-hud.json') ? available({ phase: 'paused', pauseReasons: ['render'], fatalLogicError: null }) : evidence(data)(name);
  assert.equal(buildReport(browser('failed', [error]), read).checks[0].classification, SAFETY_ANNOTATION);
  assert.equal(buildReport(browser('failed', [error]), evidence()).checks[0].classification, 'unclassified failure');
});

test('a genuine layout assertion is not masked by a later safety pause', () => {
  const error = overlayError();
  error.message = "Error: Full-size HUD placement must not be blocked\nExpected: placed\nReceived: blocked\n> 199 | expect(hud.layout?.status, 'Full-size HUD placement must not be blocked').toBe('placed');\n at expectHudSafeLayout (/runner/browser-tests/fantasia.spec.ts:199:49)";
  assert.equal(buildReport(browser('failed', [error]), evidence()).checks[0].classification, 'unclassified failure');
  assert.equal(buildReport(browser('failed', [error, overlayError()]), evidence()).checks[0].classification, 'unclassified failure');
});

test('final paused guard is classified only when its own assertion failed', () => {
  const error = { location: { file: '/runner/browser-tests/fantasia.spec.ts', line: 275 }, message:
    'Error: The last HUD observation must still show live flight and clear safety states\nphase is paused\n> 275 | if (!assertionsFailed) expect(hudCaptureProblems(capture.final),\n at expectHudSafeLayout (/runner/browser-tests/fantasia.spec.ts:275:42)' };
  assert.equal(buildReport(browser('failed', [error]), evidence()).checks[0].classification, SAFETY_ANNOTATION);
});

test('missing, malformed, incomplete, unordered and non-safety captures refuse classification', () => {
  const incomplete: any = capture(); delete incomplete.final;
  const unordered = capture(); unordered.final.capturedAtMs = 0;
  const manual: any = capture(); manual.final.pauseReasons = ['manual'];
  const logic: any = capture(); logic.final.fatalLogicError = 'simulation failed';
  for (const read of [() => ({ status: 'missing' }), () => ({ status: 'malformed', error: 'Invalid JSON' }),
    evidence(incomplete), evidence(unordered), evidence(manual), evidence(logic)]) {
    const report = buildReport(browser(), read);
    assert.equal(report.checks[0].classification, 'unclassified failure');
    assert.equal(report.counts.failed, 1);
  }
  assert.equal(buildReport(browser(), evidence(incomplete)).checks[0].captures[0].status, 'incomplete');
  assert.equal(buildReport(browser(), () => ({ status: 'malformed' })).checks[0].captures[0].status, 'malformed');
});

test('unknown title, project, source location, retry and ambiguous captures refuse inference', () => {
  const unknown = browser('failed', [overlayError()], 'unmapped future check');
  const project = browser(); first(project).projectName = 'webkit-ui';
  const location = browser(); first(location).results[0].errors[0].location.line = 200;
  const retry = browser(); first(retry).results.push({ status: 'passed', errors: [], attachments: [] });
  const dpr = browser('failed', [overlayError()], 'rotation keeps CSS pixel reservations and saved control settings intact');
  for (const input of [unknown, project, location, retry, dpr]) {
    const report = buildReport(input, () => available(capture()));
    assert.equal(report.checks[0].classification, 'unclassified failure');
    assert.equal(report.counts.failed, 1);
  }
});

test('missing browser output is not-run; malformed output is explicit and never passed', () => {
  for (const input of [{ status: 'missing' }, { status: 'malformed', error: 'Invalid JSON' }, available({ suites: null })]) {
    const report = buildReport(input);
    assert.equal(report.checks.length, 0);
    assert.equal(report.counts.passed, 0);
    assert.equal(report.release.ready, false);
    assert.match(markdown(report), /Release ready: false/);
  }
  assert.equal(buildReport({ status: 'missing' }).browserOutput.outcome, 'not-run');
  assert.equal(buildReport(available({ suites: null })).browserOutput.status, 'malformed');
  assert.equal(buildReport(available({ suites: [] })).browserOutput.outcome, 'not-run');
  assert.equal(buildReport(available({ suites: [null] })).browserOutput.outcome, 'incomplete-or-run-error');
});

test('first-touch proof references actual attachment path; absence and malformed body are explicit', () => {
  const input = browser('passed', [], 'the first touch bomb release after keyboard-default input reaches exactly one live tick');
  assert.equal(buildReport(input).checks[0].firstTouchEvidence.status, 'audit-attachments-absent');
  const attachment = { name: 'first-touch-bomb-input-audit.json', contentType: 'application/json', path: '/runner/test-results/test-case/attachments/hash.json' };
  first(input).results[0].attachments.push(attachment);
  let requested: unknown;
  const report = buildReport(input, undefined, (item: unknown) => { requested = item; return { ...available({ action: 'bomb', audit: { entries: [], dropped: 0 }, validation: { status: 'pass' } }), artifactPath: 'test-case/attachments/hash.json' }; });
  assert.deepEqual(requested, attachment);
  assert.equal(report.checks[0].firstTouchEvidence.files[0].path, attachment.path);
  assert.equal(report.checks[0].firstTouchEvidence.files[0].status, 'available');
  assert.equal(report.release.acceptance['F-03'], 'incomplete');
  assert.equal(readAttachmentJson({ body: Buffer.from('{invalid').toString('base64') }, '/tmp').status, 'malformed');
  assert.equal(readAttachmentJson({ body: Buffer.from('{"action":"bomb"}').toString('base64') }, '/tmp').value.action, 'bomb');
  assert.equal(readAttachmentJson({ path: '../../outside.json' }, '/tmp/report').status, 'unmapped');
});

test('an unexpected pass remains a failed check with its original raw status', () => {
  const input = browser('passed', []);
  Object.assign(first(input), { status: 'unexpected', expectedStatus: 'failed' });
  const report = buildReport(input);
  assert.equal(report.checks[0].rawStatus, 'passed');
  assert.equal(report.checks[0].rawTestStatus, 'unexpected');
  assert.equal(report.checks[0].outcome, 'failed');
  assert.equal(report.checks[0].classification, 'unclassified failure');
  assert.equal(report.counts.passed, 0);
  assert.equal(report.browserOutput.outcome, 'failed');
});

test('unknown or missing earlier attempt status remains unknown after a passed attempt', () => {
  for (const status of ['future-status', undefined]) {
    const input = browser('passed', []);
    first(input).results.unshift({ status, errors: [] });
    const report = buildReport(input);
    assert.equal(report.checks[0].rawStatus, 'passed');
    assert.equal(report.checks[0].outcome, 'unknown');
    assert.equal(report.counts.passed, 0);
    assert.equal(report.browserOutput.outcome, 'incomplete');
    assert.deepEqual(report.checks[0].attempts, first(input).results);
  }
});

test('clean pass requires all attempt statuses, aggregate status and expected status to agree', () => {
  for (const aggregate of ['expected', 'unexpected', 'skipped', 'flaky', 'future-status', undefined]) {
    for (const expected of ['passed', 'failed', 'skipped', 'future-status', undefined]) {
      for (const attempt of ['passed', 'failed', 'timedOut', 'interrupted', 'skipped', 'future-status', undefined]) {
        const input = browser('passed', []), record = first(input);
        Object.assign(record, { status: aggregate, expectedStatus: expected });
        record.results.unshift({ status: attempt, errors: [] });
        const report = buildReport(input);
        const clean = aggregate === 'expected' && expected === 'passed' && attempt === 'passed';
        assert.equal(report.counts.passed, Number(clean), JSON.stringify({ aggregate, expected, attempt }));
        assert.equal(report.browserOutput.outcome === 'passed-observed-checks-only', clean);
        if (['failed', 'timedOut', 'interrupted'].includes(attempt)) assert.equal(report.checks[0].outcome, 'failed');
      }
    }
  }
  for (const error of [{ error: { message: 'contradictory error' } }, { errors: [{ message: 'contradictory error' }] }, { errors: 'malformed' }]) {
    const input = browser('passed', []); Object.assign(first(input).results[0], error);
    assert.equal(buildReport(input).checks[0].outcome, 'unknown');
  }
});
