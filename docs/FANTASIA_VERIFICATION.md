# Fantasia 実装検証記録

公開判定は **未合格**。実装を保存し、未実行・失敗を残す。`RELEASE_GATE.json` の `ready` は false のままとし、Pages の公開操作は行わない。これは計画書 P7/P8 の品質条件による停止であり、公開の追加承認待ちではない。

## 実装範囲

固定した K の零戦、飛行、カメラ、入力設定、描画ライフサイクルを取り込み、独立した60Hz戦役を接続した。7軍・7陣地・7砲台、兵科・竜・地形衝突、予告攻撃、実弾、占領、有限補充、救援、復活、裁定、有限得点、モード別記録を実装。由来と保持ファイルは [FANTASIA_PROVENANCE.md](FANTASIA_PROVENANCE.md) と import manifest を参照。

本番出力はローカル JS/CSS と third-party notices のみ。開発用観測 API は読み取り専用で、本番ビルドから除去する。Pages workflow は手動起動かつ全 F 条件・実機・独立レビューの合格を確認してから公開する。

## 証拠の扱い

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
