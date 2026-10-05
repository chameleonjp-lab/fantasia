# ファンタジア移植の由来

実装契約は `c2f0e61b850e6fd49823484775c27a73c965087d` の
`docs/FANTASIA_SPEC.md`。計画は PR #2 の
`f1d21da58a5b5e02ca51468ac06bc49850ce6fe2` を基準とする。

## 取得元と変更境界

カイセンは `3d751051dc6212482a129e8da596ddd349b2f9f5`、
系譜確認のファイトフライトは `c2b313d37875b93458032d98636fcf5b5d30a138`。
両参照元のソースは変更しない。ゲーム実装は本リポジトリだけに置く。
本作初期 README は保持する。移植前の本作 main は
`1ac3b6e766011c831407eebcac1e0509e607d160`。

カイセンの src/public と検査用ファイルを変更前の状態で移植したコミットは
`8aec6b3`。取得ファイルごとの Git blob と SHA-256 は
[KAISEN_IMPORT_MANIFEST.json](KAISEN_IMPORT_MANIFEST.json) に記録した。
原作者が同一のシリーズ内移植として依頼されたソースを使い、別のオープンソース
ライセンスを付与したとは扱わない。Three.js の MIT 表示は
`public/third-party-notices.txt` に保持する。新しい第三者画像・音源・有料素材は使わない。

## 差分の許容範囲

| 対象 | 許容差分 |
| --- | --- |
| index.html | 題名、説明、戦役集計、魚雷操作除外、結果のタイム・有限得点 |
| style.css | 7陣地 HUD と戦役詳細に限定した追加スタイル |
| control-settings / keyboard-settings / input | 専用保存キーと魚雷操作除外、5/2タッチ・10/7キー |
| aircraft.ts / flight-view.ts / flight.ts | 固定ソースを保持 |
| main.ts | 海戦を campaign adapter に置換、停止・入力寿命・設定導線を保持 |
| campaign-scene.ts | K の renderer、hero 機体・追従視界を使用、地形・地上兵・竜を描画 |
| campaign*.ts | 本作の純論理、描画と入力の adapter、専用保存を新設 |

旧海戦ファイルと旧検査は由来確認用に残るが、本作の合格証拠には数えない。
`npm test` は本作 campaign と実際に使用する共通モジュールを検査し、
`test:legacy` は元作の検査一式を別に実行する。

## 自機の保持点

K の hero は3枚プロペラ、翼断面、塗装、キャノピー、銃口、舵面を保持する。
カメラは FOV64、offset(0,11,29)、bank0.45。renderer は sRGB、
ACESFilmicToneMapping、exposure1.1、内部 DPR 上限1.5。
自機の衝突は K の5球（鼻3m、胴4.6m、尾2.7m、左右翼各2.1m）を使用する。
MG銃口は(±0.3,0.52,-4.25)、機関砲は(±2.5,0,-2.4)。
これらはソース確認の記録であり、実画像・性能・通しプレイの合格宣言ではない。
