# HUD placement and indexed geometry: verification and limits

## Status

This is a draft review candidate, not release acceptance. The restored HUD patch
has been extended to pack every full-size instrument/readout around actual DOM
controls, site cards, header, safe-area bounds, and the actual aim/reload-ring
footprint. A blocked result remains a failure and never hides or shrinks content.
A separate, narrowly reviewed renderer change retains existing geometry indexes;
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
- `tests/campaign-hud-layout.test.ts`: 18 geometry/cache/DOM-adapter regressions
- `tests/campaign-geometry.test.ts`: eight index-preservation regressions
- `browser-tests/fantasia.spec.ts`: live geometry/content guards and compact
  assertion polling, while preserving every original full-state evidence field
- this document

## Layout behavior

Radar radius remains 42 below 360 CSS pixels, and 49 otherwise; range and caption
are unchanged. The measured box includes the caption and stroke fringe. Health
bar length remains 118 CSS pixels. Button placement, diameters, opacity, settings,
and stored values are untouched.

At 320-pixel portrait width, the header leaves a top-left radar corner. The
unchanged text is rearranged using the unused eighth site-grid cell, the sides
of the aiming lane, and the corridor between existing controls. Exact production
control clamping places the 96-pixel fire button at x=216: after 4-pixel gaps,
the lower corridor is only 115.6 pixels wide. Its text wraps at 114 pixels. This
changes text-container widths, never font sizes or the health bar/button sizes.

Every readout is packed at its complete measured width and height. The search
has a deterministic 120,000 candidate/intersection-operation ceiling. Exhaustion
reports blocked, not a partial success. Stable readouts are not repacked merely
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

## Local checks

Fresh final unit/build/discovery logs are retained with the isolated candidate.
The integrated checks pass: 152 tests (126 existing + 18 HUD + eight geometry),
TypeScript/Vite build, and Playwright discovery of 16 tests. Browser discovery is not
browser execution. The existing large-bundle build warning remains.

Local Chromium/socket and cloud localhost access were previously denied. This
work does not retry them with alternate flags, ports, proxies or environments.
Candidate live Chromium execution and screenshots remain pending the supported
CI runner. The former restored-candidate 138-test claim is historical and is not
used as evidence for this extended code.

## Browser acceptance and remaining work

The browser assertions record actual full-size panels, fixed controls/sites,
radar/caption, safe bounds, aim footprint, DPR, phase and pause reasons. Every
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
