# HUD placement and indexed geometry: verification and limits

## Status

This is a draft review candidate, not release acceptance. The restored HUD patch
has been extended to pack every full-size instrument/readout around actual DOM
controls, site cards, header, safe-area bounds, and the actual aim/reload-ring
footprint. A blocked result remains a failure and never hides or shrinks content.
Separate, narrowly reviewed renderer changes retain existing geometry indexes
and reject only wholly off-camera ground bodies beyond side clip planes;
it does not alter triangles, attributes, materials, quality settings, game rules,
input settings/persistence, or render/frame safety thresholds.

Base: `36b0e3b8130acb7149a646845b46f72294a3798a`.
The complete base checkout was reconstructed from 214 GitHub blobs, all verified
against their Git object hashes. The original six-file restored candidate and
untouched base were retained separately before further edits.

This candidate is separate from [PR #5](https://github.com/chameleonjp-lab/fantasia/pull/5),
which changes only README and Pages checkout history. Neither change is included.
Use the exact commit containing this document for candidate CI and image checks.

## Seven-file scope

- `src/campaign-hud-layout.ts`: full-size rectangle packing; measured fixed controls
  and movable readouts; CSS-pixel conversion; cached scene-owned observers; safe
  cleanup; and read-only placement diagnostics
- `src/campaign-scene.ts`: HUD lifecycle/radar center, plus GeometryBuilder index
  preservation with unchanged expanded triangle attributes
- `src/style.css`: narrow-portrait header/readout arrangement, full text wrapping,
  and scene-owned translation offsets that preserve normal flow and transforms
- `tests/campaign-hud-layout.test.ts`: 22 geometry/cache/DOM-adapter regressions
- `tests/campaign-geometry.test.ts`: 13 index-preservation/conservative ground-rejection regressions
- `browser-tests/fantasia.spec.ts`: live geometry/content guards and compact
  assertion polling, while preserving every original full-state evidence field
- this document

## Layout behavior

Radar radius remains 42 below 360 CSS pixels, and 49 otherwise; range and caption
are unchanged. The measured box includes the caption and stroke fringe. Health
bar length remains 118 CSS pixels. Flight-control placement, all button diameters,
opacity, settings and stored values are untouched. Utility pause/sound positions
follow the approved header reflow.

At 320-pixel portrait width, the unchanged elapsed-time text becomes a movable
readout. The top tally bar puts each number beside its labels, retaining the
44-pixel utility buttons and every original font size. The seven unchanged cards
keep their four-plus-three row grouping; only inter-row whitespace is removed.
Measured row positions protect both the actual projected sight and the existing
84-pixel screen-center lane. Landscape cards that conflict with those regions
may move individually to another full-size slot; fixed controls never move.
The planned toolbar height is 46 pixels (44-pixel buttons and two 1-pixel borders),
but runtime placement always uses its actual measured bounds, including wrapping
or enlarged text. This new typography/layout still requires second-head CI.

Exact production control clamping places the 96-pixel fire button at x=216:
after 4-pixel gaps, the lower corridor is only 115.6 pixels wide. Its text wraps
at 114 pixels. Text-container widths change, never font sizes or gauge/button
sizes. Radar placement follows the available space instead of assuming a corner
must fit.

Every readout is packed at its complete measured width and height. The search
has a deterministic 120,000 candidate/intersection-operation ceiling. Exhaustion
reports blocked, not a partial success. An already legal preferred position is tried before building alternative grids,
preventing spacious desktop layouts from exhausting the budget. Fixed-site
conflicts and out-of-bounds cards are explicit failures. Stable readouts are not repacked merely
because the sight moved without reaching them. Geometry is remeasured on resize,
visibility/style changes, font loads, or changed text dimensions. Identical writes
and same-size changing numeric readouts are coalesced. Same-frame mutation records are flushed before drawing.

DOM positions are converted from the actual canvas origin into CSS pixels, never
multiplied by DPR. Individual CSS translation preserves each original containing
block and text flow. Owned offsets are removed before a fresh measurement and
restored on disposal without changing unrelated inline styles.

## Renderer and observation changes

GeometryBuilder previously expanded indexed geometry using toNonIndexed(). It
now clones the indexed source, applies the same transform/color operations, and
retains the same triangle indices. Non-indexed inputs receive identity indices
for merging. Regression tests compare expanded position/normal/color attributes,
index bounds, triangle count, mixed inputs, groups/ranges, and disposal/reset.
Independent actual-model comparison found identical expanded attributes for all
ten meshes (eight ground team/class meshes and both dragon parts); 336 ground instances retain
134,764 triangles while stored vertices fall from 404,292 to 190,372. This is a
structural comparison, not a measured live-render latency improvement.

Routine browser state polls now return only fields used by assertions. Full
saveEvidence snapshots still include every original field via JSON.stringify
inside the page and JSON.parse in the runner. Original assertions, skips,
timeouts and render/frame stop conditions remain unchanged. Trace call durations
included queue/transport cost, so they are not reported as pure JS or GPU time.

The follow-up additionally omits ground-body draw submission only when the full
transformed bound is strictly outside a side clip plane. It preserves the original
capacity-limited actor prefix, matrix order, separate ground shadows, gameplay,
near/far-only exclusions and uncertain inputs. Unknown or boundary cases remain
submitted. Diagnostics retain ground actor admission separately from the new
`groundSubmitted` count. Five added regressions cover conservative bounds,
Float32 boundary behavior, fail-open inputs, transformed geometry and compaction.
The isolated renderer variant passed 13 focused tests/build and its actual-model
Float32 oracle. Those component-only results were not integrated acceptance;
the fresh integrated results are recorded below.

## Baseline evidence

The unchanged-main [fresh baseline run](https://github.com/chameleonjp-lab/fantasia/actions/runs/37389054418)
reported 126 unit passes and a successful build; browser results were one passed,
eight failed and one skipped. These results and images are baseline evidence,
not candidate results.

The older [PR #5 run](https://github.com/chameleonjp-lab/fantasia/actions/runs/37326733150)
reported 126 unit passes/build success and two browser passes, seven failures,
one skip. Its 320 screenshot shows original radar/site overlap and notification
collision with ammunition. Keep the old and fresh baseline runs distinct.

393/568/852 site dimensions in fixtures come from earlier CI traces. The 320
readout/text rectangles are source-derived; default button sizes and positions
use the real controlDisplaySize/controlBounds functions. Fixture passes are not
live DOM, screenshot, or physical-device passes.

## First PR CI and pre-resumption checkpoint

[PR #6 first-head CI](https://github.com/chameleonjp-lab/fantasia/actions/runs/37390794157)
ran head `3c2f3b645af108922f7f611c8937b26c35b2994c`: 152 unit passes, build success,
and eight browser passes, seven failures, one existing headless visibility skip.
That exact head is preserved as a recoverable checkpoint.

Observed failures include a 6-pixel landscape header/site overlap, the enlarged
header covering site cards, measurements captured before the first/current-size
HUD frame, and a desktop pause after screenshot capture. Inspecting the actual
projected Normal sight also exposed overlap that the older screen-center-only
site assertion had missed, including a portrait test that had passed its original
assertions. Those older passes must not be called complete HUD acceptance.

The current follow-up adds both reserved regions, measured card arrangement,
current-size/text readiness checks, preferred-position fast paths, and numeric
before/after/final screenshot diagnostics. No original live-flight, placement,
center-lane or safety-stop assertion is removed. A blocked layout satisfies only
readiness to be inspected; it still fails acceptance.

Twenty-one HUD-focused tests passed before the final cache correction and ground
patch integration, including replay of exact
first-head CI geometry and separately labeled predictions for the new toolbar
layout. A wide-header timer cache regression and a Normal568 source-derived-sight
regression were then defined but were not yet executed at that checkpoint. New typography has not
been measured in a browser yet. At that checkpoint, integrated suite/build
results still needed refreshing; the
first head's 152 passes were not evidence for this follow-up. Execution was paused
and no integrated pass was claimed. The later validation below supersedes that
paused status.

Local Chromium/socket and cloud localhost access were previously denied. This
work does not retry them with alternate flags, ports, proxies or environments.
Candidate live Chromium execution and screenshots require the supported CI runner.
The existing large-bundle build warning is not suppressed.

## Latest integrated validation — 2026-10-06

Fresh checks on the frozen integrated tree
`fdc4686d9b47bc3d728e7b1c3e02e3bc225b8148` completed successfully:

- Full unit suite: 161 passed, zero failed, cancelled or skipped
- TypeScript source checking and Vite production build: passed
- Playwright definition discovery: 16 tests; this is not browser execution
- Patch applicability and whitespace checks against both pinned main and the
  first PR #6 head: passed
- Post-check identity: all 218 source files still matched that frozen tree;
  all 214 pinned-base files and the recovered candidate backup were unchanged

The existing bundle-size warning remains. Previous build output was retained
before generating new output. After these checks only this verification document
was updated; the other six changed source/test files are byte-identical to the
validated tree. Supported CI must still run the updated PR head, and its real
browser results/screenshots are pending. No browser pass, merge readiness or
release acceptance is claimed by these local results.

## Browser acceptance and remaining work

The browser assertions record actual full-size panels, fixed controls/sites,
radar/caption, safe bounds, actual aim footprint, central flight lane, DPR, phase
and pause reasons. Separate capture JSON preserves phase, frame gap, queue
metrics and last-interruption details before/after screenshots and on failures. Every
panel must avoid fixed controls, aim, radar and other panels, stay within safe
bounds, match cached geometry, and retain unclipped text. The reflowed header
must avoid the seven-site strip. Evidence is saved before assertions. Paused
screenshots, blocked/invalid placement and unavailable startup evidence fail or
remain unverified under the existing safety-stop contract.

The original four Easy viewport tests, 200% CSS text test, five Normal viewport
tests and DPR2 rotation test remain in the suite. No skip or live-flight
expectation is relaxed to obtain a layout pass.

Outstanding: exact-candidate CI, same-engine/OS-font/DPR/seed/input/tick baseline
versus candidate screenshots, full Normal/Easy × five viewports × DPR1/2, physical
safe-area insets, actual browser zoom 200% (different from CSS text scaling), long
Japanese threats with reload/low altitude/respawn/supply notices, default/custom
controls, and 20 real settings/rotate/pause/resume/restart cycles. Arbitrary large
custom controls or oversized notices can remain blocked and must not be accepted.
The 359/360-pixel radar-radius boundary is also not live-verified; the 360-pixel
radar must retain its larger box and cannot assume the 320-pixel corner fits.

## Restoration

Restore by reverting only this isolated commit through a normal reviewed revert.
The three existing files can be compared with the pinned base; four files are
new. Preserve later user edits and obtain approval for changed restoration scope.
No main rewrite, force push, merge, release-gate override or deployment is part
of this candidate.
