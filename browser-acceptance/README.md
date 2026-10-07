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

## First full-suite CI and test-harness corrections

PR #8 head `2b27b417c3a64c5c16e54ebd94ee772ad10e1e3e`, run `37560246507`, executed all 34 cases: 10 passed and 24 failed. The reporter correctly validated 10/34 and kept releaseReady=false. All 340 test-owned GPU fences were released. Its native capability case observed a later completed receipt without a safety stop; that remains a bounded capability observation, not FPS certification.

This follow-up corrects three setup mistakes and one observation mismatch, without changing the runtime or relaxing product assertions:

- Mixed turn/climb input legitimately loses speed to aerodynamic drag. Preserve consumed mixed-input/release checks and compare separate fresh straight neutral/acceleration/braking runs for the physical throttle effect
- Capture the settings range baseline before any value-changing click; use non-mutating focus before ArrowRight and Discard
- A pending pointer capture is not active capture. Establish trusted gotpointercapture with native movement, then request release and process trusted lostpointercapture with another native movement. Require cleared application holds before pointerup; retain both complete bomb/loop sequences in evidence and validate them in the reporter
- Empty panels can have positive width but zero height. Use exactly the adapter's hidden/client-rect/display/visibility/positive-width/positive-height predicate. Keep strict actual/cache comparisons and persist the independent DOM/layout observation before assertions, including failed layout states

Five actual-200%-text cases recorded blocked layouts with visible clipping/overlap/out-of-bounds content. Those assertions remain unchanged and are expected to stay red until separately authorized product fixes pass native verification. These test-only corrections do not fix the product layouts or the already documented lever/v2 gaps. The corrected candidate needs its own native CI run; the previous 10 passes are not fresh proof for this source.

## Full-text geometry observation correction

The next exact-head run, `37562240798` at `db86575d20ea4dd39a7131935ad8f8a3813eaab0`, passed all 14 non-layout cases; all 20 layout cases remained failed. The original four input/settings issues and 15 incorrect panel counts were resolved. The reporter validated 14/34; all 403 test-owned fences were released, with no page errors. The five known 200%-text blocked layouts remained failures.

A separate test assumption was too strong: scrollWidth greater than clientWidth does not by itself prove clipped text when a control intentionally allows visible overflow. The ordinary bomb description can be readable just outside its fixed circle. This candidate replaces that blanket containment assertion with explicit full-text evidence, rather than accepting overflow without checking it:

- Collect every nonempty visible DOM text run and every Range.getClientRects fragment in viewport CSS pixels, with complete text, semantic owner, containing regions and ancestor styles. Collect the evidence before any acceptance assertion
- Retain raw scroll/client dimensions. Reject clipped inline/block overflow, including ellipsis; reject unproven line-clamp completeness. Check all fragments against viewport and applicable ancestor client/padding clip rectangles
- Permit an own-control label outside its overflow-visible circle only if it remains complete and avoids unrelated controls, panels, site cards/text, other label owners, radar, the actual sight and central-flight reservations, and canvas-label reservations
- Inspect each wrapped fragment independently. Do not approximate multiple lines by a union rectangle or ignore later lines
- Treat unsupported non-translation transforms, CSS zoom, nonrectangular/rounded clipping, masks or clip paths as unverified failures, not guessed successful clipping calculations
- Preserve the separate actual border-box, 44px button, native hit-test, DOM/cache, precise 200% font and placed-layout gates. No runtime, font, button diameter, case count or release rule is changed

The 200% sound/Pause collision and site ellipsis seen in screenshots must still fail. These changes do not repair those displays or the five blocked layouts. Browser execution of this revised observation remains pending. The pure fixtures cover readable own-circle overflow, actual clipping, sibling-control/sight overlap, ellipsis boundaries, all wrapped lines, ancestor clipping, missing evidence and unverified geometry.


## Authorized detail-only scrolling (2026-10-07)

The user explicitly approved secondary details scrolling on small screens and at 200% text, while seven-site state, the sight, important warnings and controls remain visible. This changes only the former all-details-simultaneously-visible assumption. The original 34 named cases remain; compact fallback adds checks inside each affected case.

- Independently collect all detail text nodes and every Range fragment before filtering. Each fragment must be reached fully through native ArrowDown/Home and separately through trusted Chromium touch panning; unseen fragments cannot pass
- Only the exact `campaign-hud-details` viewport is allowed to scroll/clip vertically. Inline overflow/ellipsis, inner clipping, clamp, unsupported transforms and foreign text/control/radar/sight collisions still fail. All other HUD text stays subject to the original full-text checks; same-owner text collisions remain checked
- The detail viewport remains a real layout obstacle. Offscreen child rectangles are not obstacles, but full raw text/geometry is retained and coverage recomputed by the report validator
- Require seven persistent site cards, mode, lives, controls and active critical warnings at each sample. Document/app/HUD scroll offsets must stay zero. Native hit tests, 44px targets, placed layout and actual/cache geometry checks are retained
- Check neutral input while a native ArrowDown is held and while touch is down, as well as after traversal; inspect consumed runtime inputs. A focused detail child must retain focus across a live HUD update
- Preserve clock/fence, DPR, actual 200% fonts and native capability contracts. No local Chromium launch was attempted: known socket EPERM remains a blocker. Pure tests/type/discovery are not native browser acceptance; the integrated candidate still needs exact-head CI

### Detail projection and minimum-target numerical precision

Region evidence now records DOM ancestor region keys independently of the first matching selector. Thus `announcement`/`flight-tip` registered as panels still belong to the authorized detail viewport when the DOM says so. Only actual descendants are projected to the intersection of their border box, the viewport's client clipping box and the screen. Fully clipped boxes cannot obstruct fixed text; partially visible boxes remain obstacles. Raw rectangles, kinds, text owners and the all-fragment inventory are retained. Historical raw artifacts use the owning text run's recorded viewport ancestry as evidence of membership. Fixed critical panels, foreign controls, sight/radar reservations, same-owner collisions, unsupported clipping and both complete native scroll traversals retain their existing gates.

The required button target is still 44 CSS px. Its numeric comparison has a separate 0.001 CSS-px allowance, never the much larger layout/text tolerance. Native CI run 37566989885, `hud-small-portrait-dpr2-easy`, recorded `game-sound` y=230.8000030517578 and height=43.99998474121094 while the renderer target height was 44. The shortfall is 0.0000152587890625 CSS px (one 1/65536 step); 43.9, 43.99 and 43.9989 fail the pure minimum-target gate. Actual label collisions of 3px and all solver/radar/control failures remain failures.

Re-evaluating that preserved CI evidence does not rerun the browser, supply missing scroll traversal, or change its failed outcome. The acceptance report remains 20/34 validated, not-passed, releaseReady=false until a new exact-commit browser run establishes otherwise.

## Atomic native-scroll observation correction (2026-10-07)

Run `37568986417`, head `d5aad4652d9d1ffd8a1ff72be2931a12d75d5d0f`, retained six failures where the last keyboard fragment was unread. In each, the final keyboard and touch records claimed the same `scrollTop`, while that fragment's keyboard geometry was 15–18 CSS px lower. The old collector awaited separate geometry, runtime, canvas, status and scroll-position calls, so those fields were not one consistent observation. This diagnoses a measurement defect; it does not retroactively pass keyboard access.

Each new detail sample captures text geometry, viewport dimensions, before/after scroll offset, runtime reservations, critical-state evidence, visible fixed IDs and raw input in one synchronous browser task. Native trusted `scroll`/`scrollend` sequence evidence must show completion, and the complete fragment/region/clipping coordinates must then remain exactly equal across at least 32 ms of runner wall time. Settling has a 1500 ms real-time cap within the unchanged 45 s driver budget; it never advances the controlled page clock. The reporter independently recomputes coordinate equality and raw neutral input, checks event completion, and rejects old/missing settlement evidence. Both keyboard and touch must still independently reach every fragment through native operations. No scroll assignment, new geometry allowance, text shrink, skipped case, or layout exemption is introduced.

Local unit/type/discovery checks cannot verify browser `scrollend` timing or these six keyboard outcomes. Native exact-head CI is still required. The prior raw artifacts also do not exercise active warning/protection/reload states; do not infer that coverage from dormant labels.
