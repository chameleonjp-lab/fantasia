import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, basename, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SAFETY_ANNOTATION = 'functional observation blocked after recorded safety stop';
const clean = text => String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const rawFailures = new Set(['failed', 'timedOut', 'interrupted']);
const queueStates = new Set(['ready', 'pending', 'stalled', 'failed']);

export function readJson(path) {
  try { return { status: 'available', value: JSON.parse(readFileSync(path, 'utf8')) }; }
  catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : error instanceof SyntaxError ? 'malformed' : 'unreadable', error: String(error.message) }; }
}

// Explicit names from fantasia.spec.ts. Unknown titles/projects/files stay unclassified.
function captureNames(title) {
  let match = /^all seven campaign sites fit around the aiming area at (320x568|568x320|393x852|852x393)$/.exec(title);
  if (match) return [`fantasia-easy-${match[1]}`];
  match = /^Normal full-size radar and notification avoid DOM HUD at (320x568|568x320|393x852|852x393|1440x900)$/.exec(title);
  if (match) return [`fantasia-normal-${match[1]}`];
  if (title === 'settings and all seven site indicators remain usable with actual text rendered at 200%') return ['fantasia-desktop-text-200'];
  if (title === 'rotation keeps CSS pixel reservations and saved control settings intact') return ['fantasia-dpr2-initial-393x852', 'fantasia-dpr2-852x393', 'fantasia-dpr2-393x852'];
  return [];
}

function guardFailure(error) {
  if (!object(error) || basename(error.location?.file ?? '') !== 'fantasia.spec.ts') return null;
  const message = clean(error.message), line = error.location?.line;
  const highlighted = message.match(/^>\s*(\d+)\s*\|\s*(.+)$/m);
  if (!highlighted || Number(highlighted[1]) !== line || !message.includes(`at expectHudSafeLayout (`)) return null;
  if (!message.match(new RegExp(`at expectHudSafeLayout \\([^\\n]*fantasia\\.spec\\.ts:${line}:\\d+\\)`))) return null;
  const source = highlighted[2].trim();
  if (source === "expect(hud.phase, 'HUD acceptance requires live flight').toBe('playing');"
    && message.includes('Error: HUD acceptance requires live flight') && /Received:\s*"paused"/.test(message)) return 'live-phase';
  if (source === "await expect(page.locator('#pause-screen')).toBeHidden();"
    && message.includes("Locator:  locator('#pause-screen')") && /Expected:\s*hidden/.test(message)
    && /Received:\s*visible/.test(message)) return 'pause-overlay';
  if (source === 'if (!assertionsFailed) expect(hudCaptureProblems(capture.final),'
    && message.includes('Error: The last HUD observation must still show live flight and clear safety states')
    && message.includes('phase is paused')) return 'final-safety';
  return null;
}

function completeObservation(value) {
  return object(value) && Number.isFinite(value.capturedAtMs) && Number.isInteger(value.tick)
    && Number.isInteger(value.activeTicks) && ['playing', 'paused'].includes(value.phase)
    && Array.isArray(value.pauseReasons) && value.pauseReasons.every(reason => typeof reason === 'string')
    && queueStates.has(value.renderStatus) && value.fatalLogicError === null
    && typeof value.performanceInterrupted === 'boolean' && queueStates.has(value.render?.queue?.status);
}
function safetyStop(value) {
  if (!completeObservation(value) || value.phase !== 'paused' || !value.performanceInterrupted || value.pauseReasons.length !== 1) return false;
  const reason = { frame: 'frame', render: 'stalled', 'render-failed': 'failed' }[value.pauseReasons[0]];
  return !!reason && value.lastInterruption?.reason === reason;
}
function inspectCapture(name, readEvidence) {
  const path = `${name}-capture.json`, record = readEvidence(path);
  if (record.status !== 'available') return { path, status: record.status, error: record.error };
  const value = record.value;
  if (!object(value) || value.diagnosticError || !['before', 'after', 'final'].every(key => completeObservation(value[key]))
    || value.before.capturedAtMs > value.after.capturedAtMs || value.after.capturedAtMs > value.final.capturedAtMs) {
    return { path, status: 'incomplete', reason: 'Complete ordered before/after/final safety observations are required' };
  }
  return { path, status: 'available', observations: value };
}
function matchesGuard(capture, guard, readEvidence) {
  if (capture.status !== 'available' || !safetyStop(capture.observations.final)) return false;
  if (guard === 'final-safety') return true;
  if (guard === 'pause-overlay') return safetyStop(capture.observations.after);
  const hud = readEvidence(capture.path.replace('-capture.json', '-hud.json'));
  return hud.status === 'available' && hud.value?.phase === 'paused' && hud.value?.fatalLogicError === null
    && JSON.stringify(hud.value?.pauseReasons) === JSON.stringify(capture.observations.before.pauseReasons)
    && safetyStop(capture.observations.before);
}

export function readAttachmentJson(attachment, artifactsRoot) {
  if (attachment.path) {
    // Keep Playwright's path inside the artifact tree; never flatten to a basename.
    const source = attachment.path.replaceAll('\\', '/');
    const marker = '/test-results/';
    const local = source.includes(marker) ? source.slice(source.lastIndexOf(marker) + marker.length)
      : source.startsWith('test-results/') ? source.slice('test-results/'.length)
      : isAbsolute(source) ? relative(resolve(artifactsRoot), source) : source;
    const target = resolve(artifactsRoot, local), within = relative(resolve(artifactsRoot), target);
    if (within.startsWith('..') || isAbsolute(within)) return { status: 'unmapped', error: 'Attachment path is outside the artifact tree' };
    return { ...readJson(target), artifactPath: within };
  }
  if (typeof attachment.body === 'string') {
    try { return { status: 'available', value: JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')), artifactPath: 'inline Playwright attachment' }; }
    catch (error) { return { status: 'malformed', error: String(error.message) }; }
  }
  return { status: 'missing', error: 'Attachment has no path or inline body' };
}

function firstTouchEvidence(title, results, readAttachment) {
  const action = /^the first touch (bomb|loop) release after keyboard-default input reaches exactly one live tick$/.exec(title)?.[1];
  if (!action) return undefined;
  const attachments = results.flatMap(result => result.attachments ?? []).filter(item =>
    item.name === `first-touch-${action}-input-audit.json` && item.contentType === 'application/json');
  const files = attachments.map(attachment => {
    const record = readAttachment(attachment), value = record.value;
    const complete = record.status === 'available' && object(value) && value.action === action
      && object(value.audit) && Array.isArray(value.audit.entries) && Number.isInteger(value.audit.dropped)
      && object(value.validation) && typeof value.validation.status === 'string';
    return { name: attachment.name, path: attachment.path ?? null, artifactPath: record.artifactPath ?? null,
      status: record.status === 'available' && !complete ? 'incomplete' : record.status,
      ...(complete ? { declaredValidation: value.validation, dropped: value.audit.dropped } : {}),
      ...(record.error ? { error: record.error } : {}) };
  });
  return { action, status: files.length ? 'attachments-referenced-not-independently-validated' : 'audit-attachments-absent', files,
    limitation: 'A raw pass or one compressed audit entry does not establish one consumed tick; inspect lossless ranges and observed gameplay effect. F-03 remains incomplete.' };
}

export function buildReport(browser, readEvidence = () => ({ status: 'missing' }), readAttachment = () => ({ status: 'missing' })) {
  const report = { schemaVersion: 1, browserOutput: { status: browser.status, ...(browser.error ? { error: browser.error } : {}) },
    release: { ready: false, acceptance: { 'F-03': 'incomplete', 'F-07': 'incomplete', 'F-18': 'unobserved-named-device-performance' } },
    physicalPerformance: { status: 'not-run-or-not-provided', namedDeviceEvidence: 'absent-from-this-evidence-set',
      limitation: 'The configured Chromium SwiftShader runner is not proven to be the specified physical target. Fence completion latency is CPU-observed and is not a GPU timer sum.' },
    limitations: ['Reporting never changes raw test outcomes or excuses a functional defect.',
      'Correct safety behavior is not completed F-03/F-07 acceptance. Unit/build success cannot make a comprehensive green result.',
      'Skips and missing evidence are not passes; no conclusion that all software-renderer failures are environmental.'],
    counts: { passed: 0, failed: 0, skipped: 0, 'not-run': 0, unknown: 0 }, evidenceIssues: [], checks: [] };
  if (browser.status !== 'available') { report.browserOutput.outcome = browser.status === 'missing' ? 'not-run' : 'unavailable'; return report; }
  const value = browser.value;
  if (!object(value) || !Array.isArray(value.suites)) {
    report.browserOutput = { status: 'malformed', outcome: 'unavailable', error: 'Expected a Playwright JSON report with suites[]' }; return report;
  }
  report.rawStats = value.stats ?? null;
  report.rawRunErrors = value.errors ?? [];
  function visit(suites, parents = []) {
    for (const suite of suites) {
      if (!object(suite) || (suite.specs !== undefined && !Array.isArray(suite.specs))
        || (suite.suites !== undefined && !Array.isArray(suite.suites))) { report.evidenceIssues.push('Malformed suite record'); continue; }
      for (const spec of suite.specs ?? []) {
        if (!object(spec) || !Array.isArray(spec.tests)) { report.evidenceIssues.push('Malformed spec record'); continue; }
        for (const test of spec.tests) {
          if (!object(test) || !Array.isArray(test.results) || !test.results.every(object)) { report.evidenceIssues.push(`Malformed results for ${spec.title}`); continue; }
          const results = test.results, rawStatus = results.at(-1)?.status ?? 'not-run';
          // A clean pass needs agreement from every attempt AND Playwright's aggregate/expectation.
          // Unexpected passes, flaky results, unknown statuses and mixed skipped/passed attempts cannot pass.
          const knownAttempts = results.every(result => ['passed', 'skipped', ...rawFailures].includes(result.status));
          const cleanAttempts = results.every(result => result.status === 'passed' && !result.error
            && (result.errors === undefined || (Array.isArray(result.errors) && result.errors.length === 0)));
          const outcome = !results.length ? 'not-run'
            : results.some(result => rawFailures.has(result.status)) || test.status === 'unexpected' ? 'failed'
            : !knownAttempts || !['passed', 'failed', 'skipped'].includes(test.expectedStatus) ? 'unknown'
            : test.status === 'skipped' && results.every(result => result.status === 'skipped') ? 'skipped'
            : test.status === 'expected' && test.expectedStatus === 'passed' && cleanAttempts ? 'passed' : 'unknown';
          report.counts[outcome]++;
          const check = { title: spec.title, suite: [...parents, suite.title].filter(Boolean), file: spec.file,
            project: test.projectName, rawStatus, rawTestStatus: test.status, expectedStatus: test.expectedStatus,
            outcome, annotations: test.annotations ?? [], attempts: results, classification: outcome === 'failed' ? 'unclassified failure' : null };
          const known = basename(spec.file ?? '') === 'fantasia.spec.ts' && test.projectName === 'chromium';
          const names = known ? captureNames(spec.title) : [];
          check.captures = names.map(name => inspectCapture(name, readEvidence));
          if (outcome === 'failed' && results.length === 1 && rawFailures.has(results[0].status)) {
            const errors = results[0].errors ?? (results[0].error ? [results[0].error] : []);
            // More than one reported error could conceal an earlier assertion. Refuse to infer.
            const guard = errors.length === 1 ? guardFailure(errors[0]) : null;
            const matches = guard ? check.captures.filter(capture => matchesGuard(capture, guard, readEvidence)) : [];
            if (known && guard && matches.length === 1) {
              check.classification = SAFETY_ANNOTATION;
              check.classificationEvidence = { guard, capture: matches[0].path,
                failureLocation: errors[0].location, note: 'Raw failure retained; later functional assertions may be unobserved. This does not establish a root cause or physical performance.' };
            }
          }
          const firstTouch = firstTouchEvidence(spec.title, results, readAttachment);
          if (firstTouch) check.firstTouchEvidence = firstTouch;
          report.checks.push(check);
        }
      }
      visit(suite.suites ?? [], [...parents, suite.title].filter(Boolean));
    }
  }
  visit(value.suites);
  report.browserOutput.outcome = report.evidenceIssues.length || report.rawRunErrors.length ? 'incomplete-or-run-error'
    : !report.checks.length ? 'not-run' : report.counts.failed ? 'failed' : report.counts.skipped || report.counts['not-run'] || report.counts.unknown ? 'incomplete' : 'passed-observed-checks-only';
  return report;
}

export function markdown(report) {
  const lines = ['# Browser acceptance evidence', '', `Browser output: ${report.browserOutput.status}; ${report.browserOutput.outcome}.`,
    `Observed checks: ${Object.entries(report.counts).map(([key, count]) => `${count} ${key}`).join(', ')}.`,
    '', '**Release ready: false. F-03/F-07 remain incomplete. F-18 named-device performance is unobserved.**', '',
    ...report.limitations.map(text => `- ${text}`), `- ${report.physicalPerformance.limitation}`, '', '## Raw outcomes and evidence', ''];
  if (report.browserOutput.error) lines.push(`Evidence error: ${report.browserOutput.error}`, '');
  for (const issue of report.evidenceIssues) lines.push(`Evidence issue: ${issue}`);
  for (const check of report.checks) {
    lines.push(`- ${check.title}: raw ${check.rawStatus}; reported ${check.rawTestStatus ?? 'unavailable'}; ${check.outcome}`);
    if (check.classification) lines.push(`  - ${check.classification}`);
    if (check.classificationEvidence) lines.push(`  - Guard: ${check.classificationEvidence.guard}; matching evidence/${check.classificationEvidence.capture}`);
    for (const capture of check.captures) lines.push(`  - evidence/${capture.path}: ${capture.status}`);
    if (check.firstTouchEvidence) lines.push(`  - First-touch audit: ${check.firstTouchEvidence.status}`,
      ...check.firstTouchEvidence.files.map(file => `  - ${file.name}: ${file.artifactPath ?? file.path ?? "location unavailable"}; ${file.status}`));
    for (const annotation of check.annotations) lines.push(`  - ${annotation.type}: ${annotation.description ?? ''}`);
  }
  lines.push('', 'JSON preserves raw attempts, errors, skips, attachments and source statistics. This report is diagnostic; existing browser-step failure propagation and release gates remain authoritative.', '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  const resultsPath = option('--results', 'test-results/browser-results.json');
  const evidencePath = option('--evidence', 'test-results/evidence');
  const out = option('--out', 'test-results');
  const report = buildReport(readJson(resultsPath), name => readJson(join(evidencePath, name)),
    attachment => readAttachmentJson(attachment, dirname(resultsPath)));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'browser-acceptance.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, 'browser-acceptance.md'), markdown(report));
  console.log(`Evidence summary written to ${out}; ${report.browserOutput.outcome}; release ready: false`);
  // Emission is not test acceptance. A separate always() step cannot erase the browser step's failure.
  if (report.browserOutput.status !== 'available' || report.evidenceIssues.length) process.exitCode = 2;
}
