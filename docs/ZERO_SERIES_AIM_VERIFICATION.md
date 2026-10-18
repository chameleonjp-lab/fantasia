# ゼロシリーズ 操作・標的・照準の検証記録

対象 `fantasia`、開始main `7b59137065ae7af26b37f0fa304c16bf7483ed50`、作業branch `codex/zero-series-aim-camera-20261012`。ユーザーの2026-10-11修正依頼と「8件ともPRまで」の再開指示に基づく。mainへの変更・merge・Ready化・公開は行わずDraft PRまで。

## 差分と回帰

実CampaignFlightControllerへ保持ID/actor再生成世代/slewを接続。実岩・height fieldでLOS、Easy HUDは選択IDと射程でgate。横200% protected HUDと日本語fontの縦respawn配置を修正。

共通A/B円内優先・候補順・20cm距離逆転・保持余裕境界0.015±誤差・微小操縦所有・逆方向入力・死亡/画面外/消失・再生成世代・slew解除・同tick射撃再検証を追加した。具体的な適用範囲とHUD役割差は[共通契約](ZERO_SERIES_AIM_CONTRACT.md)参照。0.015は新設計でユーザー指定の測定値ではない。

provenanceは追加したlock import/type/factoryの3行だけを除外して旧flight本体hashを検査。neutral境界2100m到達の期待を新しい円内優先の結果へ更新し、6tick warning/2100m/600tick timerは維持。HUD探索の合計120000・4px間隔・文字/ボタン寸法・no-fitは維持し、CJKと旧fontの4実測fixtureを追加。

## 実行結果

| 層 | コマンド/証拠 | 結果・限界 |
| --- | --- | --- |
| 単体 | `npm test` | **469 pass / 0 fail / 0 skip、終了0**。最新の製品sourceとtestを検査。 |
| 型/製品build | `npm run build` | 終了0。TypeScript noEmitとVite製品bundle。既存chunk-size警告あり。 |
| 関連browser | `PLAYWRIGHT_BROWSERS_PATH=<browser-cache> npm run test:browser` | **8 pass、終了0**（指定UI suite、日本語font）。既存12秒test/90秒global/1.5秒expectを維持。HUDはfresh 10＋回転10すべて完了、失敗0、実経過10008ms。 |
| Normal実進行 | `node --import tsx docs/evidence/aim-camera/verify-normal-fire.mts` | 同seed20261011、3操縦条件×12tickのfire on/off、位置/姿勢/速度/名目camera一致。自機発射8対0、36tick組。製品公開simulation APIを実行。 |
| 製品画面 | 5viewport×DPR1/2×Normal/Easy=20画像 | Chromium 153.0.8010.0 / SwiftShader、実buildと通常DOM操作。fixture注入なし。日本語fontあり、page error 0。回転/負荷で保護停止のlast frameが含まれ、20枚すべての連続飛行は主張しない。 |
| 入力所有 | 追加EventTarget検査＋上記関連browser | 模擬EventTargetと実DOM経路を実iPhoneから区別。 |
| WebKit/iPhone | 未実行 | 公式browser取得が不正archiveで失敗し、WebKit binary/実端末なし。申告症状は未確認・未解決。 |
| 描画FPS/実機 | 未実行 | 固定60Hz論理を維持。実描画30/60/120Hzの比較合格やhardware性能を主張しない。 |

実行したsource/test/scriptのSHA256・log hash・記録日時、20viewportのDOM測定/画像hashは[evidence.json](evidence/aim-camera/evidence.json)。Normal対照の実行scriptと[result](evidence/aim-camera/normal-fire-result.json)も保存した。PR本文に接続先から返った最終head SHAと、ローカルindex treeとの一致を記す。自己参照を避け、evidence.json自体のhashは同JSONへ入れない。公式Playwright 1.61.1想定Chromiumとは異なるfallback binaryであるため、標準browser取得の成功とは扱わない。repositoryの依存・CI・fontを追加変更していない。

## 失敗・画像確認・残件

提出初回head `86d19a9f06585d6cb41b05c554af875f70c1614f` のActions run `38157438345` は2回ともHUD testの12秒制限で失敗した。初回は全20配置を測定し配置失敗0、再実行は最後の回転caseを制限時間で中断した。時間制限を増やさず、独立したfresh documentだけを2件ずつ並行実行へ変更。caseごとのfailure/baseline/areaと時間を返し、`Promise.allSettled` 後に元のcase順で集計する。fresh全10件をjoinしてから既存10rotationと最後のread-only identity検査を従来順で実行し、PNG/JSON、200%文字、44pxボタン、4px間隔、Canvas判定、120000探索上限、失敗集約を維持した。並列work合計をwall時間から引かず、`hud-execution-timing.json` にwall/fresh phase wallとsetup/capture workを分けて記録する。変更後のローカル標準コマンドで8件合格、fresh/rotationとも10件完了・失敗0を確認。公式CIの最終head結果はPR本文へ追記する。

画像568×320 DPR1のNormal/Easyと、568×320 DPR2のEasyはworldが暗いframeで、scene paintの受入には使わない。DPR2には5件の保護停止frameもあり、capture時のdataset=playingだけで描画完成とは判定しない。portrait/852×393/1280×720の描画と、指定UI-only 200%検査は別証拠。

最初のbrowser取得/実行には環境起因の不正archive・SwiftShader準備timeoutがあった。ウチオトセの初回はasset接続resetで1失敗し、同sourceの再実行で合格。ファンタジアの旧font横protected 200%配置は変更前mainでも失敗し、実測fixtureを追加して製品layoutを修正。日本語fontの縦respawnで追加失敗を見つけ、旧fontも守る15000回probe＋残予算fallbackで修正し、最新469単体と指定8browserを再検査。失敗をskipやbudget縮小/寸法縮小で隠していない。これらは各作品へ同じ失敗を帰属させる説明ではなく、シリーズ共通の検証環境と個別是正の記録。

実画像を開いて確認した：[Normal/Easy縦画面](evidence/aim-camera/portrait-comparison.jpg)、[5viewport DPR1](evidence/aim-camera/viewport-contact.jpg)、[DPR2](evidence/aim-camera/viewport-dpr2.jpg)、[停止/設定](evidence/aim-camera/pause-settings.jpg)。画像は実製品PNGから内容を変えず縮小/並置した閲覧用JPG。セーフエリア/200%文字拡大は各指定UI suiteの検査範囲に限り、通常製品20画像がその全受入を代用しない。描画画像はlayoutの確認用で、操作感・FPS性能・iPhoneの受入ではない。

独立した読取reviewで同ID実経路、実遮蔽、Normal camera/照準、入力所有、guardの許可差分を確認。ゲキチンは実scene.renderをGPUだけ省いた独立camera投影で5viewport/沈没0・2・4.9秒を検査し、誤差1e-8 CSS px未満。論理/自動検査の成立と人間の実機受入は分ける。

射撃時の上下ずれは次のように切り分ける。ボタンfireだけではこの短いNormal対照でpitch/camera差を再現しない。1指持替えは操縦release→climb=0→既存水平復帰が起きるのでfire起因と断定しない。Easy標的補助の不一致とゲキチンNormal固定照準/衝突cameraは別の確認済み経路として修正。センリョウの危険時自動上昇は射撃とは別の保護。実iPhone特有のpointer capture/イベント順序は引き続き未確認。

マージ前iPhone手順：(1)Normalで操縦指の微上下を維持し別指で射撃、射撃指のみ離す/移動。(2)操縦指を離して同じ指で射撃し、release時の水平復帰と比較。(3)Easyの円内A/画面端B・遮蔽・微入力で標的/発射を確認。(4)ゲキチン母艦近傍・bank/上昇、センリョウ安全高度/危険接近で照準/回避表示を見る。(5)回転→停止→設定Save/Cancel→明示再開、速度目標とfresh inputを確認。上下ずれが残れば作品/mode/iPhone・iOS/指操作/場面を記録。実機受入とmergeは利用者が行う。


## 2026-10-18 Easy追尾開始時の上下反転対策

確認日時：2026-10-18 12:33 JST。比較元mainは `ea986603108b679d4f7ea01168f1a9dc5b6a7d31`。本節より前の検査・画像は各記載時点の記録で、今回の実機確認を意味しない。

Easyの両軸無入力時だけ、追尾pitchの平滑化をゼロではなく現在姿勢から開始する。新規捕捉・対象切替・再捕捉・ゼロ通過を区別し、微小手動入力へ戻るときは絶対姿勢の履歴を相対角速度へ持ち越さない。turnだけの入力でも、任意の `steeringActive` が省略されても手動経路へ戻る。旧simulation経路は対象喪失時の既存減衰を保ち、減衰中の絶対姿勢を手動rateとして再利用しない。

campaignの対象制限（兵士・dragonの補助強度0、turretの既存強度）、遮蔽、世代、対象選択、yaw、Normal操作は維持。今回の変更は既存7ファイル：`src/flight-target.ts`、`src/campaign-flight.ts`、`src/simulation.ts`、`tests/campaign-aim-regression.test.ts`、`tests/campaign-flight.test.ts`、`tests/simulation.test.ts`、本書。

- 変更前sourceで新規helper回帰、実campaign turret捕捉、実legacy捕捉の各回帰が失敗することを確認。上下標的と現在pitch正負の両方を検査。
- 変更後 `npm test`：485件合格、失敗0、skip0。campaign turn-onlyの任意flag省略時はpitch差分0.0005rad未満も個別再確認（初回relative slewの上限に基づく）。
- `npm run test:legacy`：702件中677合格・25失敗・skip0。比較元mainは699件中674合格・25失敗。失敗名の集合は完全一致、新規失敗0・解消0。追加3回帰は合格。旧艦船系を含むこの任意suiteは全合格ではなく、対象外の既知失敗を隠すskipや期待値変更はしていない。
- `npm run build`：TypeScriptとVite成功。既存の500kB超bundle警告あり。
- 独立読取レビューでsource・回帰を確認。旧helperとの相対入力比較も一致。
- 今回はローカル論理・build検査まで。CIの最新head結果はPRへ記録する。ブラウザー描画・iPhone実機での体感改善、マージ、本番反映は未実施。

旧版は上記固定main commitに保持。復元はこの差分のrevertで可能。同じ公開リポジトリのDraft PRへ提出し、追加素材・依存・workflowの変更は含めない。

### legacy比較で一致した25失敗名

- approved four-ship mission reaches all-clear through real inputs while idle is not a guaranteed win
- standard mission remains reachable through circular touch conversion with six/seven tick sample jitter
- Easy fleet pilot clears actual CI26 request/acceptance delays without saturated yaw oscillation
- easy browser pilot clears with recorded uneven sampling plus one-tick delivery lag
- normal browser pilot clears with recorded uneven sampling plus one-tick delivery lag
- Normal fleet-first pilot clears acceptance-relative CI20 cadence with 1-tick delivery lag
- Normal fleet-first pilot clears acceptance-relative CI20 cadence with 5-tick delivery lag
- Normal recovery pilot clears actual CI21 observed request/acceptance timings
- easy clears with CI28 component delivery timing from a fresh mission
- normal clears with CI28 component delivery timing from a fresh mission
- easy clears with CI29 component delivery timing from a fresh mission
- mixed target selection still follows the closest visible target regardless of its assist strength
- air-to-ship switching keeps the existing smooth response and manual climb clears residual pull
- rule guide shows only the active device instructions and current keyboard bindings
- source offscreen yaw boost ramps gently in both modes without amplifying bank or pitch
- Normal input releases only the ended finger while steering and another action remain held
- CI38 consumed inputs preserve the real collision
- CI38 consumed inputs preserve the real collision except the verified lateral dodge
- Normal default fleet clears through manual fire and circular input with six/seven and coarse twelve tick hold
- easy/touch: score rules explain contribution, clear-only bonuses and rounding
- easy/keyboard: score rules explain contribution, clear-only bonuses and rounding
- normal/touch: score rules explain contribution, clear-only bonuses and rounding
- normal/keyboard: score rules explain contribution, clear-only bonuses and rounding
- real circular-stick mapping reaches and completes reload with six/seven tick sample jitter
- browser reload practice engages aircraft and completes real magazines despite uneven input delivery

### 同日12:43 JST：inactive controller構造の互換性

初回head `1f08f977070c9cfa3bd7ee16dc084885288d595e` の[CI run 39094141179](https://github.com/chameleonjp-lab/fantasia/actions/runs/39094141179)は成功。併行検査で判明した任意modeキーの互換性も同じ承認範囲で是正し、inactive・clear・対象切替時は不要キー自体を取り除く。legacy経路は既存減衰がゼロになるまでmodeを保持する。数値制御と対象制限は変更しない。

最終ローカル再検査：`npm test` 486/486合格、build成功、関連3ファイル37/37合格。optional `test:legacy` は703件中678合格・25失敗・skip0で、上記baselineの失敗名25件と完全一致。初期inactive、activeから対象喪失・manual release・clearのcontrollerキー一致回帰を追加した。再提出headのCIは別途照合し、初回headの成功を転記しない。
