# 8画面・4姿勢の実画像比較

393×852、DPR 1、100%文字。同じ行を比較します。KaisenとFantasiaは同じseed体系・地上状況ではないため背景・標的は一致しません。結果は自然な機体喪失で到達した敗北です。[全36件のメタデータ](metadata.json.gz)に画像IDごとの実状態と画像hashを省略せず保持しています。

| 画面 | Kaisen | Fantasia main | 操作修正 P1 | 差分の理由・限界 |
| --- | --- | --- | --- | --- |
| ホーム | [K](kaisen-393x852-home-100.png) | [main](main-393x852-home-100.png) | [P1](candidate-393x852-home-100.png) | 共通のタイトル・出撃・操作設定導線。作品名、戦役データ、暫定版の記録説明を差し替え。 |
| ルール | [K](kaisen-393x852-rules-100.png) | [main](main-393x852-rules-100.png) | [P1](candidate-393x852-rules-100.png) | 共通の閲覧パネル。7陣地・地上軍・誤射等の本作ルールへ差し替え。 |
| タッチ設定 | [K](kaisen-393x852-touch-settings-100.png) | [main](main-393x852-touch-settings-100.png) | [P1](candidate-393x852-touch-settings-100.png) | 共通のプレビュー・位置／寸法・保存／破棄。魚雷のない選択肢だけが作品差分。 |
| キー設定 | [K](kaisen-393x852-keyboard-settings-100.png) | [main](main-393x852-keyboard-settings-100.png) | [P1](candidate-393x852-keyboard-settings-100.png) | 共通のキー割当・保存／破棄。魚雷の割当を持たない。 |
| Normal飛行 | [K](kaisen-393x852-normal-100.png) | [main](main-393x852-normal-100.png) | [P1](candidate-393x852-normal-100.png) | 保存操作の形・位置を復元。7陣地等は追加情報。小画面の計器のまとまりは未復元。 |
| 停止（実描画受領後） | [K](kaisen-393x852-pause-100.png) | [main](main-393x852-pause-100.png) | [P1](candidate-393x852-pause-100.png) | 共通の停止パネル・再開・設定導線に7方面の既存詳細を追加。復活待機等は別検査。 |
| Easy飛行 | [K](kaisen-393x852-easy-100.png) | [main](main-393x852-easy-100.png) | [P1](candidate-393x852-easy-100.png) | 共通同様に射撃・速度レバーを省く。7陣地等のデータ差分と未解決HUD配置が残る。 |
| 結果 | [K](kaisen-393x852-result-100.png) | [main](main-393x852-result-100.png) | [P1](candidate-393x852-result-100.png) | 共通のスクロール可能な結果パネル。戦役の損失・残機・時間等を表示。この画像だけでは下端到達の証明にならない。 |

| 姿勢（実入力） | Kaisen | Fantasia main | 操作修正 P1 |
| --- | --- | --- | --- |
| 水平 | [K](kaisen-393x852-pose-level-100.png) | [main](main-393x852-pose-level-100.png) | [P1](candidate-393x852-pose-level-100.png) |
| 左旋回 | [K](kaisen-393x852-pose-bank-left-100.png) | [main](main-393x852-pose-bank-left-100.png) | [P1](candidate-393x852-pose-bank-left-100.png) |
| 上昇 | [K](kaisen-393x852-pose-climb-100.png) | [main](main-393x852-pose-climb-100.png) | [P1](candidate-393x852-pose-climb-100.png) |
| 宙返り | [K](kaisen-393x852-pose-loop-100.png) | [main](main-393x852-pose-loop-100.png) | [P1](candidate-393x852-pose-loop-100.png) |

設定パネルの共通構成を保持しています。ホーム等の作品名・説明・集計値の差は本作データへの差し替えです。停止には7方面の詳細、結果には戦役の時間・残機・得点を加えています。飛行HUDの位置・警告・200%可読性は未合格です。

最初の停止画像はGPU受領待ちで再開が無効なものを含んだため、[元画像・JSON](pause-pending-attempt-1/)を保存し、受領後の比較画像へ撮り直しました。
