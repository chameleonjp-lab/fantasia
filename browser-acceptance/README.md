# Clean-sheet Fantasia browser acceptance: driver proof only

Baseline: `6ab5803c10382a52cbb56e7272b7cdea24f70af5`. This is new test code, not an edited copy of the previous 16 checks. The previous browser files remain inactive for recovery and because some unchanged logical unit tests import their pure helpers. Both default Playwright discovery and `npm run test:browser` now select only this new proof.

## Present scope

One bounded test: actual Normal and Easy preparation commits at tick zero; a native keyboard bomb input consumes one bomb over one isolated simulation tick; the next tick does not repeat it; Pause freezes simulation and stops frame submission; explicit Resume advances one tick without catch-up; Home creates a new run.

The app, campaign, DOM, Canvas2D and WebGL renderer are real. No HP/ownership/game-state setter, fake rendering receipt, renderer replacement, `gl.finish()`, app-fence deletion or app queue reset is used. A separately owned native WebGL fence drains prior commands before advancing the test clock. Only this test-owned fence is deleted. A failed fence/deadline/cleanup fails the proof rather than pretending the GPU completed.

Playwright Clock controls page time in 16 ms steps. Runner wall time stays real: the proof has a 45 s total budget, at most 120 steps, a 15 s maximum native-fence wait within that total, and bounded protocol calls/cleanup. Coordinate clicks first verify real visibility, viewport position and `elementFromPoint` ownership. No forced clicks or synthetic DOM click dispatches are used. A stalled page requires context teardown; unconfirmed cleanup is failure evidence.

This pacing deliberately excludes wall-clock performance claims. Recorded simulated clocks or per-tick timings must not be used as FPS/CPU/GPU measurements. SwiftShader, when used by CI, is identified as that backend. The full suite and release acceptance remain incomplete even if the proof passes.

## Ten-case architecture after proof review

1. Start readiness, both modes, cancel and stale-start invalidation
2. Continuous keyboard/drag controls, releases and mode restrictions
3. Touch/keyboard single-action bomb/loop edges; cancel/lost capture/repeat
4. Pause/resume/Home/restart ownership and cleared input
5. Settings tabs, Save/Discard, duplicate keys, storage errors and focus
6. Native resize/context interruption and deliberate recovery
7. Explicit controlled scheduling/render faults and safe-stop behavior
8. Full-size actual HUD geometry, center sight, hit targets and viewport/DPR matrix
9. Actual 200% text: change text while test time is stationary, render fresh geometry, verify readable controls/Save/Discard/Close
10. Separate fresh-context native capability smoke with ordinary wall time and no injected clock/faults

These ten cases are pending, not skipped tests counted as acceptance. Do not expand them until this mechanism is demonstrated in a native browser. The new report preserves raw outcomes, labels the proof separately and always records the unfinished suite/device/performance status. The existing release gate is unchanged and false.

## Environment and limits

Local `/usr/bin/chromium` exists but both ordinary and approved escalated launches failed before page creation with `process_singleton_posix.cc: socket() failed: Operation not permitted`. No local native proof has run. Local helper tests validate fence ownership and bounds only. No further launch workaround should be attempted here. The next permitted validation is one root-reviewed exact-head CI proof using the already configured Chromium setup.

Unsupported native visibility/background lifecycle remains unverified; synthetic events cannot certify it. F-18 maximum-load/120 s/20 min/10 restart performance, physical iPhone behavior, full victories and source visual comparisons remain separate release evidence. Screenshots hidden behind a pause overlay cannot certify live geometry.

## Recovery

All 21 original browser files plus package/config/reporter/Verify workflow are preserved in the verified recovery document `Fantasia-old-browser-suite-recovery-6ab5803c.md` and at the fixed Git commit. The recovery manifest records every blob SHA, byte count and SHA-256. No original runtime or logical unit test was changed. The abandoned CDP timing diagnostic is not included.
