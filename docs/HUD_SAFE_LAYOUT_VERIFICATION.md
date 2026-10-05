# HUD safe-layout candidate: verification and limits

## Status

This is a review candidate, not a completed release acceptance. Product HUD wiring
is implemented, but live before/after acceptance remains unverified. No gameplay,
input, control persistence, renderer quality, or watchdog threshold is changed.
An explicit `blocked` placement is a failure, not a hidden or reduced-size HUD.

Base: `36b0e3b8130acb7149a646845b46f72294a3798a` (main rechecked 2026-10-05).
This candidate is separate from PR #5 (`e7d69dfc075b6908c162009828253fd9a312be37`),
which changes README and Pages checkout history. Neither change is included here.
The candidate commit is the commit containing this document; use its exact SHA
when comparing CI artifacts. Do not substitute the base or PR #5's results.

## Six-file scope

- `src/campaign-hud-layout.ts`: pure full-size placement, CSS-pixel conversion,
  Scene-owned ResizeObserver/targeted MutationObserver adapter, cleanup, cached
  measurements, actual DOM reservations and read-only layout diagnostics
- `src/campaign-scene.ts`: adapter lifecycle and radar center only; actual sight
  and reload-ring footprint are reserved without changing how they render
- `src/style.css`: measured Fantasia notification position overrides its independent
  bottom anchor; font, size, content and button diameters remain unchanged
- `tests/campaign-hud-layout.test.ts`: geometry, caption, insets, no-space behavior,
  cache invalidation, repeated resize and observer cleanup
- `browser-tests/fantasia.spec.ts`: original live/skip expectations retained;
  additional radar/caption and notification checks against current DOM, Normal
  viewport coverage, DPR2 rotation, and rectangle/image evidence
- this document

The radar remains radius 42 below 360 CSS px and radius 49 otherwise, range 2.4km,
with its original caption. The reserved box additionally contains the stroke
fringe. Notification text is measured at its existing rendered width and height;
its preferred position is 8 CSS px below the measured flight-data/ammo box.
Alternative positions are used only when the complete rectangle fits.

All placement diagnostics are canvas-local CSS pixels. DOM viewport coordinates
are translated by the actual canvas origin. DPR is not multiplied into DOM
geometry. Notification output is translated back to its actual containing block.

## Baseline evidence

[PR #5](https://github.com/chameleonjp-lab/fantasia/pull/5) uses unchanged runtime
from this candidate's base. Its verification artifact contains
`evidence/fantasia-sites-320x568.png` and `.json`, and corresponding 393×852,
568×320, and 852×393 files. The 320 screenshot shows the original radar covering
site cards and the threat lane colliding with the ammunition readout.

393×852, 568×320, and 852×393 site dimensions in the unit test were extracted
from CI trace geometry (852 column widths are rounded there to 0.01 CSS px).
The 320 unit fixture is derived from the same CSS and measured row height.
Its controls and other HUD rectangles are a geometry fixture, not a live DOM
measurement. It must not be called an actual-device or browser-layout pass.

[PR #5's completed CI](https://github.com/chameleonjp-lab/fantasia/actions/runs/37326733150) reported 126 unit passes and build success; browser results
were 2 passed, 7 failed, 1 skipped. Saved failures include frame-gap and GPU-fence
safety stops. Those earlier failures remain separate from this patch's results.
A CPU-observed fence wait is not a measurement of GPU execution time alone.

## Candidate checks completed locally

- `npm test`: 138 tests passed, 0 failed, 0 skipped (126 existing + 12 new)
- `npm run build`: TypeScript and Vite passed; existing large-bundle warning remains
- `npx playwright test fantasia.spec.ts --project=chromium --list`: 16 tests discovered
- `git diff --check`: passed
- Extra standalone browser-spec TypeScript check could not resolve the existing
  `node:fs/promises` import because Node type declarations are not declared here;
  the standard source build and Playwright discovery above pass. No dependency
  or compiler configuration was changed
- Existing three modified files were retained before editing and SHA-256 recorded
- The new adapter is imported by the production Scene, not an unconnected experiment

Browser discovery is not browser execution. Local Chromium launch/socket access
and cloud localhost access were previously blocked in this environment. No
alternate flags, ports, proxies or environments are used to bypass those denials.
Live Chromium execution, candidate screenshots and all physical-device checks
remain pending an authorized supported runner.

## Known geometry concern; do not relax the gate

A derived 320×568 Normal fixture containing the default fire, acceleration,
brake, loop and bomb rectangles, initial announcement, instruments and threat
has no candidate for the full-size radar and notification. This is a warning of
an unresolved required condition, not a confirmed live-DOM result. Easy's derived
fixture does have a non-overlapping arrangement. The added Normal browser test
requires actual full-size placement and fails on `blocked`.

The fallback preserves full size and clamps the location inside current safe
bounds when the complete box fits the viewport, including after rotation. If a
box itself exceeds those bounds it can still overflow; that remains a failure.
It reports `blocked` and does not call the condition accepted. It does not change
saved controls, omit content, reduce font/radius, auto-pause, change game rules or
weaken the render/frame stop policy. A demonstrated live no-space case requires
a separately reviewed layout choice before this change can be accepted.

## Browser evidence and failure classification

The original suite's four Easy viewport tests and 200% text test now assert the
radar's circle plus caption against all seven site rectangles, instruments,
visible notification/warning lanes, aim/reload-ring area and visible controls.
New Normal tests cover 320×568, 393×852, 568×320, 852×393 and 1440×900. A DPR2 test
checks 393×852 → 852×393 → 393×852 with unchanged saved settings.

HUD assertions save `test-results/evidence/*-hud.png` and `*-hud.json` before
requiring live flight. JSON includes measured DOM boxes, cached layout, placement
status, DPR, phase and pause reasons. Existing `saveEvidence` also retains state.
A page behind a pause overlay is not accepted as a successful layout screenshot.

Classify failures using both records:

1. `phase !== playing`, renderer stalled/failed, frame-gap or fence stop: runtime
   protection failure. Preserve it; do not replace it with a geometry pass
2. Live `hudLayout.status === blocked/invalid`, clipping, or measured overlap:
   HUD placement failure, even if unit/build pass
3. Missing layout evidence because startup/input failed: unverified layout;
   an earlier passing test or synthetic fixture does not fill that gap

## Outstanding acceptance matrix

Not yet verified on this candidate: same-engine/OS-font/DPR/seed/input/tick
before/after image comparisons; full Normal/Easy × five-viewports × DPR1/2 matrix;
physical safe-area insets; actual browser zoom 200% (different from CSS text
200%); long Japanese threats together with low-altitude/reload/respawn/supply;
default and custom controls; 20 real settings-save/cancel, rotate, pause/resume
and restart cycles; live input/state equality and observer/resource stability.
Unit adapter repetition and one DPR2 browser test do not cover all these cases.
Rendering-latency diagnosis and release-gate completion remain separate work.

## Restoration

This patch has one isolated scope. Restore by reverting only its commit through
a normal reviewed revert. The three existing files can be compared/restored from
base `36b0e3b8130acb7149a646845b46f72294a3798a`; the other three are new. Preserve
later user edits and obtain approval before any changed restoration scope. No
force push, main rewrite, merge, deployment, or deletion is part of this work.
