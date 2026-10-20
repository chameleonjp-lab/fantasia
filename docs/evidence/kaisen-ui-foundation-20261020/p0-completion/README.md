# P0：4版の実画面比較

対象は Kaisen `6118b786`、Fantasia main `f8264c53`、Draft #20 `e60c7a0a`、Draft #21 `69d70a55`。製品コードの変更前を比較する資料です。旧P1候補の画像はこの一覧へ混ぜていません。

Linux / Chromium 154.0.8037.57 / 実WebGL2（SwiftShader）/ DPR 1。同じ寸法・モード・DOM文字倍率で撮影し、132画像IDを目視比較しました。Canvas内の文字は既存の描画実寸です。実機や通常時計の性能、全文スクロールの合格証明ではありません。

## 飛行中：64画像

| 寸法・文字・モード | Kaisen | Fantasia main | Draft #20 | Draft #21 |
| --- | --- | --- | --- | --- |
| 393×852 / 100% / normal | [kaisen](../playing/kaisen-393x852-normal-100.png) | [main](../playing/main-393x852-normal-100.png) | [pr20](../playing/pr20-393x852-normal-100.png) | [pr21](../playing/pr21-393x852-normal-100.png) |
| 393×852 / 100% / easy | [kaisen](../playing/kaisen-393x852-easy-100.png) | [main](../playing/main-393x852-easy-100.png) | [pr20](../playing/pr20-393x852-easy-100.png) | [pr21](../playing/pr21-393x852-easy-100.png) |
| 393×852 / 200% / normal | [kaisen](../playing/kaisen-393x852-normal-200.png) | [main](../playing/main-393x852-normal-200.png) | [pr20](../playing/pr20-393x852-normal-200.png) | [pr21](../playing/pr21-393x852-normal-200.png) |
| 393×852 / 200% / easy | [kaisen](../playing/kaisen-393x852-easy-200.png) | [main](../playing/main-393x852-easy-200.png) | [pr20](../playing/pr20-393x852-easy-200.png) | [pr21](../playing/pr21-393x852-easy-200.png) |
| 852×393 / 100% / normal | [kaisen](../playing/kaisen-852x393-normal-100.png) | [main](../playing/main-852x393-normal-100.png) | [pr20](../playing/pr20-852x393-normal-100.png) | [pr21](../playing/pr21-852x393-normal-100.png) |
| 852×393 / 100% / easy | [kaisen](../playing/kaisen-852x393-easy-100.png) | [main](../playing/main-852x393-easy-100.png) | [pr20](../playing/pr20-852x393-easy-100.png) | [pr21](../playing/pr21-852x393-easy-100.png) |
| 852×393 / 200% / normal | [kaisen](../playing/kaisen-852x393-normal-200.png) | [main](../playing/main-852x393-normal-200.png) | [pr20](../playing/pr20-852x393-normal-200.png) | [pr21](../playing/pr21-852x393-normal-200.png) |
| 852×393 / 200% / easy | [kaisen](../playing/kaisen-852x393-easy-200.png) | [main](../playing/main-852x393-easy-200.png) | [pr20](../playing/pr20-852x393-easy-200.png) | [pr21](../playing/pr21-852x393-easy-200.png) |
| 320×568 / 100% / normal | [kaisen](../playing/kaisen-320x568-normal-100.png) | [main](../playing/main-320x568-normal-100.png) | [pr20](../playing/pr20-320x568-normal-100.png) | [pr21](../playing/pr21-320x568-normal-100.png) |
| 320×568 / 100% / easy | [kaisen](../playing/kaisen-320x568-easy-100.png) | [main](../playing/main-320x568-easy-100.png) | [pr20](../playing/pr20-320x568-easy-100.png) | [pr21](../playing/pr21-320x568-easy-100.png) |
| 320×568 / 200% / normal | [kaisen](../playing/kaisen-320x568-normal-200.png) | [main](../playing/main-320x568-normal-200.png) | [pr20](../playing/pr20-320x568-normal-200.png) | [pr21](../playing/pr21-320x568-normal-200.png) |
| 320×568 / 200% / easy | [kaisen](../playing/kaisen-320x568-easy-200.png) | [main](../playing/main-320x568-easy-200.png) | [pr20](../playing/pr20-320x568-easy-200.png) | [pr21](../playing/pr21-320x568-easy-200.png) |
| 568×320 / 100% / normal | [kaisen](../playing/kaisen-568x320-normal-100.png) | [main](../playing/main-568x320-normal-100.png) | [pr20](../playing/pr20-568x320-normal-100.png) | [pr21](../playing/pr21-568x320-normal-100.png) |
| 568×320 / 100% / easy | [kaisen](../playing/kaisen-568x320-easy-100.png) | [main](../playing/main-568x320-easy-100.png) | [pr20](../playing/pr20-568x320-easy-100.png) | [pr21](../playing/pr21-568x320-easy-100.png) |
| 568×320 / 200% / normal | [kaisen](../playing/kaisen-568x320-normal-200.png) | [main](../playing/main-568x320-normal-200.png) | [pr20](../playing/pr20-568x320-normal-200.png) | [pr21](../playing/pr21-568x320-normal-200.png) |
| 568×320 / 200% / easy | [kaisen](../playing/kaisen-568x320-easy-200.png) | [main](../playing/main-568x320-easy-200.png) | [pr20](../playing/pr20-568x320-easy-200.png) | [pr21](../playing/pr21-568x320-easy-200.png) |

全64件の元JSONは[初回撮影メタデータ](../playing/metadata.json.gz)に保持しています。これはK／main／#20／#21と未採用P1の全80件を含む履歴で、候補16件はP0の64件に数えません。

## 代表8画面：32画像

393×852 / 100%。ホーム、ルール、設定は初期選択Easy、飛行は各モード、停止はNormal、結果は実際のEasy降下による敗北です。背景・敵・結果の値は作品の実状態で、同じ値を注入していません。

| 画面 | Kaisen | Fantasia main | Draft #20 | Draft #21 | 差分の扱い |
| --- | --- | --- | --- | --- | --- |
| home | [kaisen](../screens/kaisen-393x852-home-100.png) | [main](../screens/main-393x852-home-100.png) | [pr20](./pr20-393x852-home-100.png) | [pr21](./pr21-393x852-home-100.png) | 共通の見出し・出撃・設定導線。作品名、戦役説明、記録説明は本作差分。 |
| rules | [kaisen](../screens/kaisen-393x852-rules-100.png) | [main](../screens/main-393x852-rules-100.png) | [pr20](./pr20-393x852-rules-100.png) | [pr21](./pr21-393x852-rules-100.png) | 共通パネルと閲覧導線。説明内容は本作ルール。 |
| touch-settings | [kaisen](../screens/kaisen-393x852-touch-settings-100.png) | [main](../screens/main-393x852-touch-settings-100.png) | [pr20](./pr20-393x852-touch-settings-100.png) | [pr21](./pr21-393x852-touch-settings-100.png) | 共通の配置編集・保存／破棄。#20/#21に非搭載の魚雷を案内する誤説明が残る。 |
| keyboard-settings | [kaisen](../screens/kaisen-393x852-keyboard-settings-100.png) | [main](../screens/main-393x852-keyboard-settings-100.png) | [pr20](./pr20-393x852-keyboard-settings-100.png) | [pr21](./pr21-393x852-keyboard-settings-100.png) | 共通のキー編集・保存／破棄。魚雷の割当がないのは本作差分。 |
| normal | [kaisen](../screens/kaisen-393x852-normal-100.png) | [main](../screens/main-393x852-normal-100.png) | [pr20](./pr20-393x852-normal-100.png) | [pr21](./pr21-393x852-normal-100.png) | 4操作の位置・寸法、上部HUD、計器、レーダーの差異は修正対象。 |
| pause | [kaisen](../screens/kaisen-393x852-pause-100.png) | [main](../screens/main-393x852-pause-100.png) | [pr20](./pr20-393x852-pause-100.png) | [pr21](./pr21-393x852-pause-100.png) | 共通の停止パネルに7方面詳細を追加。Kの停止中に残る作戦案内は基準側の問題として別記。 |
| easy | [kaisen](../screens/kaisen-393x852-easy-100.png) | [main](../screens/main-393x852-easy-100.png) | [pr20](./pr20-393x852-easy-100.png) | [pr21](./pr21-393x852-easy-100.png) | 射撃・速度レバーを出さない共通モード。HUDの独自配置は修正対象。 |
| result | [kaisen](../screens/kaisen-393x852-result-100.png) | [main](../screens/main-393x852-result-100.png) | [pr20](./pr20-393x852-result-100.png) | [pr21](./pr21-393x852-result-100.png) | 共通の結果・得点パネル。敗北理由、残機、得点項目は本作差分。 |

## 境界条件の停止・設定・結果：16画像

停止・設定はNormal、結果は実際のEasy敗北。画面回転後の停止理由が変わることは実状態の差です。結果画像はスクロール先頭で、下端到達は別の受入検査が必要です。

| 条件 | Kaisen | Fantasia main | Draft #20 | Draft #21 |
| --- | --- | --- | --- | --- |
| 320×568 / 200% / pause | [kaisen](./kaisen-320x568-pause-200.png) | [main](./main-320x568-pause-200.png) | [pr20](./pr20-320x568-pause-200.png) | [pr21](./pr21-320x568-pause-200.png) |
| 320×568 / 200% / touch-settings | [kaisen](./kaisen-320x568-touch-settings-200.png) | [main](./main-320x568-touch-settings-200.png) | [pr20](./pr20-320x568-touch-settings-200.png) | [pr21](./pr21-320x568-touch-settings-200.png) |
| 568×320 / 200% / keyboard-settings | [kaisen](./kaisen-568x320-keyboard-settings-200.png) | [main](./main-568x320-keyboard-settings-200.png) | [pr20](./pr20-568x320-keyboard-settings-200.png) | [pr21](./pr21-568x320-keyboard-settings-200.png) |
| 568×320 / 200% / result | [kaisen](./kaisen-568x320-result-200.png) | [main](./main-568x320-result-200.png) | [pr20](./pr20-568x320-result-200.png) | [pr21](./pr21-568x320-result-200.png) |

## 実際の低空警告：4画像

Normal / 393×852 / 100%。実キー入力で降下し、製品の低空警告が発生した時点を撮影。Kはtick135、Fの3版はtick180です。地形・初期高度が異なるため、同じtick・海抜高度を警告条件とみなしません。

| Kaisen | Fantasia main | Draft #20 | Draft #21 |
| --- | --- | --- | --- |
| [kaisen](./kaisen-393x852-low-warning-100.png) | [main](./main-393x852-low-warning-100.png) | [pr20](./pr20-393x852-low-warning-100.png) | [pr21](./pr21-393x852-low-warning-100.png) |

Kの上部の警告に対し、Fの3版は操作ボタン付近の下部へ表示しています。これを本作データの正当な差し替えとは分類しません。

## 4姿勢：16画像

Normal / 393×852 / 100%。水平、左旋回、上昇、宙返りはいずれも実入力。カメラ・機体を差し替えて比較していません。

| 姿勢 | Kaisen | Fantasia main | Draft #20 | Draft #21 |
| --- | --- | --- | --- | --- |
| level | [kaisen](../screens/kaisen-393x852-pose-level-100.png) | [main](../screens/main-393x852-pose-level-100.png) | [pr20](./pr20-393x852-pose-level-100.png) | [pr21](./pr21-393x852-pose-level-100.png) |
| bank-left | [kaisen](../screens/kaisen-393x852-pose-bank-left-100.png) | [main](../screens/main-393x852-pose-bank-left-100.png) | [pr20](./pr20-393x852-pose-bank-left-100.png) | [pr21](./pr21-393x852-pose-bank-left-100.png) |
| climb | [kaisen](../screens/kaisen-393x852-pose-climb-100.png) | [main](../screens/main-393x852-pose-climb-100.png) | [pr20](./pr20-393x852-pose-climb-100.png) | [pr21](./pr21-393x852-pose-climb-100.png) |
| loop | [kaisen](../screens/kaisen-393x852-pose-loop-100.png) | [main](../screens/main-393x852-pose-loop-100.png) | [pr20](./pr20-393x852-pose-loop-100.png) | [pr21](./pr21-393x852-pose-loop-100.png) |

## 原本と再現

今回補完した44画像の[全メタデータ](metadata.json.gz)には対象SHA、未変更確認、画面・文字倍率、実状態の投影、DOM寸法、撮影前後tick、PNG bytes／SHA-256、page errorを省略せず保存しています。44件ともtickは撮影前後で同じ、参照worktreeに差分なし、page errorなしです。[撮影スクリプト](capture.mjs)は読取専用の参照サーバー4180〜4183を使います。文字倍率だけを変更し、ゲーム状態・警告・結果は注入しません。

K／mainの既存24枚の代表画面・姿勢は[元メタデータ](../screens/metadata.json.gz)に保持。新しい#20/#21の24枚と合わせて4版の比較を補完しています。

未採用の実装差分、CI #129の原artifact、以後の成功・失敗・中断記録と画像は[保存アーカイブ](../unaccepted-attempts-20261020.tar.gz)へ収録。内部manifestの全105ファイルを展開後のbyte数・SHA-256で照合済みです。

このP0の提出範囲は比較と差異分析です。全警告の同時発生、全画面×全寸法×全倍率、勝利画面、物理端末、保存設定・詳細の全文到達の最終受入は未完了です。

P0の再検査は単体487/487、build成功、source integrity 3/3、カメラ2/2。mainと同一製品コードのUI-onlyは7成功・1失敗（元の12秒上限）で、失敗を残します。完全なlog／JSON／画像・contextとローカル実行configは、上記メタデータの `p0Verification.files` に原本byte数・SHA-256・base64で可逆保存しています。
