# Clean-sheet Fantasia browser acceptance

## Scope and provenance

The declared suite has **34 browser cases across ten categories**, replacing default discovery of the retired browser suite. It is new source built around the native real-renderer driver, not edits to the retired checks. Logical unit tests and runtime source remain unchanged. The earlier one-case driver proof remains available only through its explicit proof configuration; it is no longer the default suite.

Source baseline: `a81e73ed82018db75808f53b33f4f6a9973f2875`. Main after PR #6 merged: `81a7ea9238ce1ac8748ce81841dbd092d51e0d84`, with the same tree `8ead77218b95069900a56906928b63ed47744c33`. The new suite must be reviewed and run against its own exact commit. Passing the earlier proof (CI 37556197973) does not mean these new cases passed.

## Declared coverage

1. Start preparation and cancellation, stale preparation invalidation, both selected modes, tick-zero commitment, queued preparation input discarded
2. Normal/Easy continuous keyboard steering, native captured mouse drag, release, and mode-specific manual fire/acceleration/brake restrictions
3. Both modes: one bomb per edge, native key repeat ignored, touch release, real pointer-capture cancellation, touch loop effect, fresh-run keyboard loop effect and consecutive false repeat/release boundaries
4. Pause freezes ticks and GPU submissions, explicit Resume advances without catch-up, Home and Restart create fresh runs, no stale keys/pointers
5. Settings tabs, keyboard Save/Discard, duplicate binding rejection, touch-layout Discard, focus return/containment; explicit storage fault leaves active bindings unchanged; session-only is applied only by its separate action and disappears after reload; future-version protection and second-write failure rollback
6. Actual viewport resize; real WEBGL_lose_context loss/restoration, disabled Resume while lost, frozen ticks/submissions, explicit recovery
7. Explicit Playwright 400 ms frame-gap injection and explicitly labelled one-shot Canvas2D.clearRect render exception; specified safety states, interruption/ordinary-record-ineligibility flag, no paused drawing, no catch-up
8. Ten live HUD cases: both modes at 1440×900/DPR1, 393×852/DPR3, 852×393/DPR3, 320×568/DPR2, 568×320/DPR2
9. The same ten mode/viewport cases with actual 200% computed font sizes, changed while the page clock is stationary, then a fresh renderer measurement; reachable settings Save/Discard/Close and returned focus
10. A separate fresh-context ordinary-wall-clock capability case: real startup, completed-frame receipts and no fatal error. Its narrowly specified frame/render safety branch allows exactly one explicit recovery and requires a new completed receipt. A second stop fails; this never certifies uninterrupted performance

## Real rendering and observation

The campaign, DOM, Canvas2D and WebGL renderer are real. No HP/ownership/game-state setter, fake receipt, renderer replacement, gl.finish(), application-fence deletion or application queue reset is used. The synchronization driver creates, polls and frees only its own GPU fence. Unconfirmed completion or cleanup fails closed. Native context restoration is owned by the app's real context-restored handler, not a test queue reset.

Controlled functional cases use 16 ms page-clock steps. The runner keeps a separate 45 s wall budget, maximum 120 steps, 15 s bounded native fence wait within the total, and bounded calls/cleanup. These elapsed values are orchestration limits, never FPS/CPU/GPU results. The separate capability case installs no clock and does no test-fence pacing.

Native mouse/touch actions verify actual visibility, full viewport bounds and elementFromPoint ownership before dispatch. No forced clicks or synthetic DOM clicks are used. The two intentional failure mechanisms and storage API fault fixtures are explicitly labelled in evidence, not passed off as ordinary rendering or platform failures.

Live geometry independently measures current DOM panel children (including display:contents layouts), seven site cards and fixed obstacles. Actual counts/IDs/rectangles are compared with cached renderer geometry using a 0.75 CSS-pixel rounding tolerance. Synthetic sight and central-flight-lane reservations have no DOM element and are excluded only from the DOM-to-cache identity comparison. Full boxes, real control bounds, 44 px button targets, text overflow, radar/sight/site/panel intersections and fresh text measurements are checked. Nested fixed obstacles such as header/buttons are not incorrectly treated as independent non-overlapping panels. Screenshots are taken only while live and do not replace geometry assertions. Canvas diagnostics are geometry evidence, not pixel/text-rendering equivalence for all in-world labels.

## Fail-closed reporting

`acceptance-cases.ts` is the exact 34-case discovery contract. Run:

```
npm run test:browser
node --import tsx scripts/report-clean-acceptance.ts
```

The reporter requires every exact title/category/project once, expectedStatus=passed, one passed attempt, no errors/retries/skips, and one readable schema-valid evidence attachment. It checks native backend identification, error lists, matching case/category, completion evidence, balanced test-owned fences, explicit injection labels, enlarged-text and seven-site evidence, and native completed receipts. Missing/malformed/discovery-only/duplicate/expected-failure evidence fails. Raw attempts and attachments are retained. A report exit code of zero means only the declared checks and their evidence validated.

Both JSON and Markdown retain product blocks. `suiteImplementationComplete` means the declared bounded suite source exists, not that all F-01–F-20 acceptance is complete. Native execution of the new suite is still required.

## Product gates remain blocked

- F-03: required Normal throttle-lever integration/input/accessibility is absent. Current acceleration/brake-button coverage must not certify the newer lever contract
- F-04: required v1-preserving v2 layout saves/migration and lever settings are absent. Current v1 settings checks do not certify v2
- F-07: declared responsive checks still require native execution and cannot fill missing product/lever acceptance
- F-18: named-device performance, maximum-load firing, 120-second workload, 20-minute soak and restart/leak measurements are not covered
- F-19: actual-input full Normal/Easy victory, defeat/restart and final-candidate independent acceptance are not covered

Physical iPhone behavior, native background/visibility lifecycle, multi-finger ownership, IME/browser-shortcut combinations, full rule outcomes and visual-reference equivalence remain unverified outside the declared cases. Touch viewport/DPR emulation and SwiftShader are not physical-phone or named-desktop acceptance. No old assertion was relaxed to make a safety stop count as uninterrupted performance.

`docs/RELEASE_GATE.json` is unchanged and false. No runtime features, release, merge, deployment, permissions or hosting settings are changed.

## Verification limits and recovery

Local Chromium launches were previously denied before page creation with process_singleton_posix.cc socket() EPERM, including the approved ordinary escalation. No new launch, workaround or download is attempted here. The earlier proof's exact-head native CI succeeded; the full new suite has not yet run natively.

The retired original browser source and configuration remain recoverable at `6ab5803c10382a52cbb56e7272b7cdea24f70af5` and the verified recovery document. Some unchanged logical tests import its pure helpers, so those inactive files remain in the repository. The current change is reversibly preserved as a complete UTF-8 source bundle, SHA-256 manifest and unified patch for root review.
