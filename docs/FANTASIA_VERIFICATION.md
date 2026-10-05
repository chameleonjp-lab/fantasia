# Fantasia 実装検証記録

公開判定は **未合格**。実装を保存し、未実行・失敗を残す。`RELEASE_GATE.json` の `ready` は false のままとし、Pages の公開操作は行わない。これは計画書 P7/P8 の品質条件による停止であり、公開の追加承認待ちではない。

計画書P7のゲート: 「全必須行の証拠が揃う。未達のスマホ実機をエミュレーション結果で埋めない。」今回の明示的な公開依頼を承認として扱ったうえで、この未達条件を公開合格に置き換えない。

作業中に main へ入った PR #3（`4d217d839875c3e7ddc066add284c66089418926`）の速度レバー追補・READMEを保持した。追補が「先行実装PRに無断で変更を混ぜない」と指定しているため、本候補は従来のNormal5タッチ操作を実装したまま。レバー・v2保存移行・共通fixture35件の製品接続は別途未完で、F-03/F-04の追加公開条件として扱う。

## 実装範囲

固定した K の零戦、飛行、カメラ、入力設定、描画ライフサイクルを取り込み、独立した60Hz戦役を接続した。7軍・7陣地・7砲台、兵科・竜・地形衝突、予告攻撃、実弾、占領、有限補充、救援、復活、裁定、有限得点、モード別記録を実装。由来と保持ファイルは [FANTASIA_PROVENANCE.md](FANTASIA_PROVENANCE.md) と import manifest を参照。

本番出力はローカル JS/CSS と third-party notices のみ。開発用観測 API は読み取り専用で、本番ビルドから除去する。Pages workflow は手動起動かつ全 F 条件・実機・独立レビューの合格を確認してから公開する。

## 証拠の扱い

2026-10-05 UTC、論理・UI候補 `fe7e03935dd4ff4c59a14a6f35511f50aaf7e9e2` で `npm test` **126/126**、`npm run build` が成功。build manifest は同候補を指定して公開内容のallowlist、相対asset URL、notice、観測API除去を検査した結果。Viteは815kBのJS chunkサイズ警告を出す。分割・実端末の読み込み性能は合格未宣言。

同候補の人工470体・7200tickは全体数を保持し、弾最大510、shot event36883、最終hash `d8b298f9`。更新時間中央値2.83ms、p95 5.95ms、p99 26.55ms、最大112.38ms。並行ブラウザ/pilot処理があるクラウドVM上の論理測定であり、規定PC・スマートフォンやWebGL frame性能の認定ではない。10回の論理dispose確認も、10回のブラウザ再出撃・memory検査と区別する。

`evidence/pilot/report.json` はEasy・seed20261005・turret-sweep戦術の15000tick試行。正規FlightInput・K飛行・実弾と占領を通して1/7陣地、砲台1/7破壊、残機3。時間上限で終了し、勝利なし。保存した圧縮入力を新規戦役へ再生し入力hashとstate hashが一致した。別戦術・10seed・通常ブラウザ完走の証拠ではない。

ブラウザ統合の初回検査では両モードの開始・手動停止・restart・homeが一度成功。その後、SwiftShaderのheadless shellと通常Chromiumの双方でGPU fence完了待ちが監視時間を超え、アプリが正しく停止する状況を再現した。初回タッチ検査は停止overlayに遮られ、正式入力の合格を確認できなかった。試験は読み取り観測が `paused` / `render` / `stalled` を示す場合だけ環境依存skipとして区別し、通常のframe遅延・logicエラーは失敗のままとする。skipを合格件数や実機証拠には数えない。停止閾値と論理actor数は変更していない。

保存したブラウザ出力: `evidence/browser/initial-integration-run.txt` は1件合格、設定タブ選択の試験不具合で1件失敗、6件未実行（選択を修正済み）。`frame-budget-run.txt` とPNG/contextは通常Chromiumでの初回loopタッチ試験の実失敗。約19tickで0.25秒frame watchdogが停止し、pause overlayがtapを遮った。全10件の現行ブラウザsuiteは合格未宣言。描画・frame停止を試験から除外して成功扱いする変更は行わない。

同条件の新画像は `evidence/candidate-chromium/`。1440×900、DPR1、Chromium149、Debian13、文字100%。home/pause/実タッチ設定/キーボード設定を取得した。Normalは開始直後の0.3667秒gapで停止し、`normal-blocked.png` として別記（Normal合格画像ではない）。`complete:false`、runtime hashは撮影中不変。旧 `touch-settings.png` が実はキーボード設定だった誤記を、元画像を `keyboard-from-touch-entry.png` に保存して実Kのタッチタブを撮り直して訂正した。起動失敗の最初の試行も `candidate/metadata.json` に保存。

エージェント目視では共通設定パネルの配置・色・文字サイズが一致。CDP実フォントは両作品ともtitle=Noto Serif CJK JP、tab=Noto Sans CJK JP、timer=Noto Sans Mono CJK JPでサイズが一致した。homeは題名・世界・戦役集計・記録表示の許可差分がある。新homeのfooterは初期cropより下になりscrollが必要で、全200%到達性は合格未確認。これは人による全画像比較の承認ではなく、4姿勢・Easy・勝敗画像も未取得。

GitHub CI run [37258940524](https://github.com/chameleonjp-lab/fantasia/actions/runs/37258940524) はunit/build成功、browser4件成功・4件失敗で全体failure。取得したartifactを実際に確認すると、成功した4viewportのPNGはすべてframe停止overlayで、JSONのphaseもpausedだった。DOMの配置計測は成立しても操作視界の合格ではないため、これらを無効なlive画像として保存し、撮影後のphaseとoverlay不在を試験の必須条件へ追加した。`evidence/ci-initial/` はこの問題の実証で、F-07合格証拠ではない。タブ切替でdocument自体がvisibleのままのheadless環境は、実visibilitychangeを捏造せず別skipとして扱う。

後続CI run37259471127も6失敗・3成功・1skipで全体failure。frame停止と、描画復帰文言・重複キーの捕捉継続表示に対する試験の期待値不具合を確認した。期待値はKの実挙動に合わせて修正。最終の設定単独ブラウザ試験は1/1成功（7.0秒）で、タッチ配置保存/破棄、キーボード再割当、重複拒否とEscape復帰、専用storage保存を実UIで確認した。これは飛行・全suiteの合格とは区別する。

戦役の回転対称性を安定させるため、actor/projectile/lockedAim座標を各方面の回転前座標で1µmへ量子化する。接触距離を大きく緩める処理ではなく、同じ位相の計算で生じる丸め差を固定する。1800tickの全7方面 actor位置・HP/攻撃状態/弾属性/前線状態を両モードで比較する検査を追加した。弾位置・actor速度・補充周期後・操縦入力の回転比較は未完。地形描画は解析的高さ問い合わせに対する三角形内の表示近似で、実測最大差約0.83cm。これらは許容誤差を記録した実装判断で、全視覚条件の合格宣言ではない。

- `evidence/baseline/` は固定 K を実際の Chromium で起動した画像。現時点では8状態・4姿勢すべてを満たしていない。
- `evidence/automated/` は自動試験・ビルド・測定の実出力。初期測定と最終候補の測定を区別する。
- 人工470体負荷は兵科とHPを維持用に変更した計測 fixture。ゲームプレイ勝利、実機、WebGL性能試験の代用ではない。
- FlightInput pilot は通常の K 飛行入力と実際の戦役処理を通す論理試験。ブラウザ正式入力による勝利の代用ではない。
- Playwright は viewport emulation / SwiftShader。実機スマートフォンの合格とはしない。

## F 条件追跡

| 条件 | 現在の証拠 | 判定 |
| --- | --- | --- |
| F-01 | 初期数・ID・全7軍進行・immutable snapshot の unit | 自動部分のみ |
| F-02 | 固定blob manifest、保持ファイルSHA、README、notice | 自動部分検証済み、許可差分レビュー必要 |
| F-03..04 | 設定・キー・入力所有・cancel・storage guard unit、ブラウザ試験 | 統合ブラウザ結果を別記、全条件合格未宣言 |
| F-05..07 | 実 K 基準画像、一部新画面、viewport試験 | 全8状態・4姿勢・100/200%の比較未完 |
| F-08..10 | 距離・倍率・遮蔽・lock・misfire・K5球/hull・移動sweep・爆弾境界 unit | 予告映像などブラウザ証跡未完 |
| F-11 | 占領二段階・人数・砲台・contest・回復境界 unit | 自動部分のみ |
| F-12..13 | 有限予約・cap・cancel・owner変更・救援境界 unit | 自動部分のみ |
| F-14..15 | 復活freeze・境界猶予・相打ち裁定・得点・記録 unit | 実勝利結果画面未取得 |
| F-16..17 | 同seed/同入力hash、空間探索oracle、7回転公平性の検査 | 全fps/LOD/回転証跡未完 |
| F-18 | 470体・120秒の論理負荷、10論理restart | 実機frame・20分WebGLsoak・10ブラウザrestart/memory未完 |
| F-19..20 | 正規 FlightInput pilot と無介入公平性の検査 | Normal/Easy正式入力完走・10seed・複数戦術の規定未達 |

## 公開までの残作業

計画で指定した実機スマートフォンおよびデスクトップ環境で性能と操作を検証する。全状態・全姿勢の画像を同条件で比較し、人の所見を保存する。Normal/Easy の規定時間内の勝利を正式入力で取得し、consumed-input replay、複数戦術・10seedの結果を残す。最終候補 SHA に対して不足している F 条件を再検証し、独立レビューと公開ゲートがすべて合格した場合に Pages を公開し、実URLと配信 manifest を確認する。

実機条件を viewport emulation で置き換えたり、fixture のHP/所有者変更を勝利証跡に使ったりしない。公開準備済み workflow があることと、公開条件に合格したことを分けて記録する。
