# fantasia
ファンタジア

戦闘機で剣と魔法の地上戦へ介入し、味方7軍による7陣地の同時占領を支援するブラウザゲームの実装候補です。飛行・戦役・操作設定・検査コードはありますが、公開受入は未完了です。

## 起動と検査

```sh
npm ci
npm run dev
```

開発サーバーは `http://127.0.0.1:4176`。`npm test` で本作の論理・継承モジュールを検査し、`npm run build` で型検査と本番ビルドを行います。ブラウザ検査は Chromium 導入後の `npm run test:browser` です。単体検査・ビルド成功は、全ブラウザ検査や実機受入の合格を意味しません。

2026-10-07にマージされた[PR #8](https://github.com/chameleonjp-lab/fantasia/pull/8)から、ブラウザ検査は[機能・安全復帰・画面表示を確かめる34ケース](browser-acceptance/README.md)を使用します。[検査対象の実行記録](https://github.com/chameleonjp-lab/fantasia/actions/runs/37576571830)では34件が成功し、失敗・skip・flakyはいずれも0でした。これは制御した時計を使う機能検査の結果です。通常の時間で動かした場合の性能、全編の勝利条件、iPhone実機での動作は別途確認が必要です。

実装範囲と不足する F 条件は [検証記録](docs/FANTASIA_VERIFICATION.md)、由来は [移植記録](docs/FANTASIA_PROVENANCE.md) を参照してください。[公開ゲート](docs/RELEASE_GATE.json) は `ready: false` です。手動 Pages workflow があっても、受入条件が満たされるまで公開しません。

## 速度調整レバー（共通UI候補）

Normalのタッチ加速/減速2ボタンを上下1本の速度レバーへ統合し、実装済みの飛行入力・戦役へ接続しています。Easyの自動巡航、PCの加速/減速キー、作品固有の兵装と7陣地は維持します。作品専用v2設定は旧v1 rawを保持し、保存失敗時の復元控えを備えています。

[共通契約](docs/THROTTLE_LEVER_CONTRACT.md)、[本作への適用](docs/THROTTLE_LEVER_ADAPTER.md)、[統合内容と検査の境界](docs/COMMON_UI_THROTTLE_INTEGRATION.md)を参照してください。上記PR #8の34ケース成功は基点の証拠です。この候補の34件・レバー4件・重要表示12件のCI結果は別に確認し、実機や公開受入の成功には読み替えません。
