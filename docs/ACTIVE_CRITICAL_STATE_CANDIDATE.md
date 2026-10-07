# Active critical-state acceptance candidate

## 統合後の位置づけ（2026-10-07）

この文書の以下の本文は、警告検査だけを独立候補として作成した時点の履歴です。共通UI・速度レバー候補への統合後は、結果・添付の保存先が `supplemental-results/active-critical-results.json` と `supplemental-results/active-critical` になり、既存 `verify.yml` の独立 `active-critical` jobへ接続済みです。追加の原bytesは無圧縮base64チャンク・byte数・SHA-256・復元索引でjob logへ保持します。

統合後の現行構成と検査境界は `COMMON_UI_THROTTLE_INTEGRATION.md` および実workflow/configを参照してください。以下の「製品不変」「workflowを含まない」「test-results出力」は独立候補時点の範囲を説明するもので、統合後の現状説明ではありません。新候補の実ブラウザーCIはまだ実行しておらず、定義・配線を実行成功とは扱いません。

## 独立候補作成時点の記録

Base: `chameleonjp-lab/fantasia` commit `a8bc9175f6b690d008ef716fe10735b0a64fde6d`, tree `1e7c2096845fba7621005e05ff48d389e56865cb`.

This additive candidate does **not** certify native-browser acceptance. Local browser startup was deliberately not attempted. Existing production files, the original 34 case identities, their config and their reporter remain unchanged. The shared detail helper has a backwards-compatible explicit respawn phase; its default and the original reporter remain playing-only.

## What was missing

The original suite starts its geometry cases near tick zero. Dormant labels and a function capable of checking active warnings did not establish that warnings actually appeared and stayed visible during native full-detail traversal. In particular, ordinary initial samples did not activate low altitude, out-of-bounds flight, empty-magazine reload, loss/respawn, protection or priority announcements. Respawn has a distinct runtime phase and must not be disguised as playing.

## Twelve tests, thirty-nine independently identified state proofs

Each of these three profiles runs both Normal and Easy, in two sorties:

- 320 × 568, DPR 2, original text
- 568 × 320, DPR 2, original text
- 393 × 852, DPR 3, actual 200% text

The descent sortie covers low altitude → real terrain collision/respawn countdown → protection. The other sortie covers an enemy targeting the player → Normal-only manual ammunition depletion/reload → boundary warning → priority bomb announcement while the boundary warning is active. Easy does not claim a manual-reload proof. Each profile therefore contains 7 Normal and 6 Easy state proofs.

These profiles target compact layouts and enlarged text. They do not claim every warning at every original desktop/DPR profile. Friendly-blast proximity, site loss/depletion/rescue, deadline announcements and a naturally reached Easy automatic reload are not covered by these new activation paths.

## Activation is real input and real state

The seed is the app's existing `20261005`. Keys are native `ArrowDown`, `Space` and `z`; other segments fly without inputs. A native canvas click returns input ownership after a detail traversal. No game state, actor, warning string or visibility is assigned. No test-only DOM warning is created. Native WebGL fences and the actual scene continue running.

Pure unit runs of the production Campaign + CampaignFlightController establish useful acquisition landmarks from a fresh sortie: low altitude at tick 161, terrain collision at 200, enemy targeting at 313, Normal uninterrupted shooting reload at 716, boundary at 1146 Normal / 1147 Easy. The browser candidate waits for state predicates rather than accepting these numbers as browser evidence. Reusing sorties and display ticks can change later absolute ticks.

`resumeRespawn()` is called only by unit tests at the adapter boundary. The browser candidate waits for the app's actual countdown and never invokes it.

## Display and scrolling gates

Every activated state requires nonempty, full text fragments for its specific warnings, outside the details viewport. Playing proofs also retain mode/lives, health, altitude/speed, remaining time, gun ammunition, bombs, the seven real site cards, actual scene sight/radar reservations and visible controls. Current DOM and cached layout rectangles must agree. Visible buttons and sliders retain the 44 CSS-pixel minimum and native center hit tests; controls must not cover the sight.

Every compact proof independently completes both native keyboard and touch full-text traversal. It retains the original 0.75 CSS-pixel geometry tolerance, native operation-specific scrollend, exact coordinate stability, clipping/collision checks, raw input checks and no-whole-HUD-scroll condition. Each settled sample additionally proves that the relevant numeric critical condition remains active and its critical text remains outside scrolling details.

Respawn explicitly requires `phase=respawning`, frozen campaign tick/activeTicks and the actual countdown/loss/protection-source state. Its text traversal checks neutral flight channels without claiming a consumed simulation tick. It does not invent active flight controls while the aircraft is absent. Untrusted evidence cannot select this mode in the original reporter; the caller must explicitly request the phase.

At later flight ticks the runtime intentionally hides its introductory flight tip. Full entry membership and the full visible-fragment inventory remain checked; native Tab navigation skips DOM-hidden entries only, rather than pretending a hidden introductory tip is an active message.

## Running and reporting

Local static commands:

```
npm test
npm run build
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --lib ES2022,DOM,DOM.Iterable browser-acceptance/active-critical*.ts playwright.active-critical.config.ts
npx playwright test --config=playwright.acceptance.config.ts --list
npx playwright test --config=playwright.active-critical.config.ts --list
```

The authorized future native command is `npx playwright test --config=playwright.active-critical.config.ts`; do not run locally where native startup is prohibited. Results go to `test-results/active-critical-results.json`, attachments to `test-results/active-critical`. The original 34 remain separate. No workflow, CI dispatch, GitHub write, merge or deployment is included in this candidate.

The `active-critical-evidence` attachment distinguishes startup/enlargement failure, state acquisition/interruption, and display/scroll failure. A completed state needs matching `critical-state-completed`, `critical-native-acquisition` and `active-critical-proof-completed` records; partial sequences must not pass. A summary should index this single raw attachment, not inline duplicate raw geometry. The integration owner supplies the combined extra-suite fail-closed summary.

## Budgets and evidence size

- Acquisition only: 120 seconds / 1800 controlled native frames per state
- Display proof: unchanged 45 seconds / 120 steps per state
- Each compound case: 720 seconds, no retries
- Entire additional suite: 1500 seconds (25 minutes), fail-closed on timeout

Thirty-nine per-state maxima cannot all be added and assumed to fit the global limit. Actual native duration is unknown until an authorized run. Adding this suite after the original 34 in one 30-minute CI job is not justified. Use an independent job or explicit three-way sharding, with setup/build time budgeted separately; global/test limits establish termination, not a success-time promise.

Acquisition does not store a full snapshot per frame. It stores only source milestones and consumed-input audit. Necessary state is projected to the player, source event, targeted enemies, site ownership and renderer/input observations. A fresh unit snapshot measured 451,487 bytes unprojected versus 1,331 projected (350 actors → no active targeting actors); this is a storage check, not a browser performance measurement. Full scroll geometry, independent stability captures and native events are retained because they are the actual proof. Total artifact size cannot be predicted reliably without native traversal and must be measured at integration. Do not duplicate raw attachments in a second report.

## Verification status

Static/type/build/unit and test discovery are available. Native browser, physical devices, warning screenshots, real scroll timing and exact integrated-head CI remain unverified. No product readiness or release approval follows from this candidate.
