# 検査結果

**HUD全体は未合格です。** 個別の成功を視覚比較・実機受入・公開可否へ読み替えません。[全ケースの索引](summary.json) と、各 `*-results.json.gz` の完全なPlaywright JSONに、全assertionエラー・証跡添付を保持しています。本文に入る画像もJSON内のbase64から復元できます。path形式の画像・コンテキストは各検査名のディレクトリにも保存しています。ログと生成された `error-context.md` は原文をgzipで保持し、空白も含めて変更していません。

| 実行 | 成功 | 失敗 | skip | 完全な結果 |
| --- | ---: | ---: | ---: | --- |
| 保存したKaisen操作配置4件 | 4 | 0 | 0 | [JSON](controls4-results.json.gz)／[log](controls4.log.gz) |
| main基点のUI-only 8件 | 7 | 1 | 0 | [JSON](ui8-results.json.gz)／[log](ui8.log.gz) |
| 正式34件・初回 | 13 | 21 | 0 | [JSON](acceptance34-attempt1-results.json.gz)／[log](acceptance34-attempt1.log.gz) |
| 正式34件・出力先を分けた最終実行 | 14 | 20 | 0 | [JSON](acceptance34-final-results.json.gz)／[log](acceptance34-final.log.gz)／[失敗20件の原寸画像](acceptance34-final/attachments/) |
| 速度レバー4件 | 2 | 2 | 0 | [JSON](throttle4-results.json.gz)／[log](throttle4.log.gz) |
| active-critical 12件 | 0 | 12 | 0 | [JSON](critical12-results.json.gz)／[log](critical12.log.gz) |
| カメラ2件・初回 | 1 | 1 | 0 | [JSON](camera2-attempt1-results.json.gz)／[log](camera2-attempt1.log.gz) |
| カメラ2件・単独再実行 | 2 | 0 | 0 | [JSON](camera2-final-results.json.gz)／[log](camera2-final.log.gz) |

`npm test` は [488 passed](unit.log.gz)、`npm run build` は [成功](build.log.gz)、`npm run test:ui-integrity` は [成功](integrity.log.gz) です。ローカル独立レビューは修正した操作配置・状態解除について具体的な実装問題を指摘しませんでした。HUD全体を視覚合格としたレビューではありません。

## 失敗と未実施

- 最終34件の失敗は、通常のHUD 12件と200%文字8件です。元の全文・clip・遮蔽・44px・詳細閲覧のassertionを維持しています。これらの検査は初めの失敗で止まるため、その後のassertionまで成功したとは扱いません。
- UI-onlyのHUD集約ケースは文字overflow／配置と12秒上限で失敗しました。既存34件や実レンダラー比較の代用ではありません。#20側の追加7件はmain基点のこの修正へ移植しておらず、#20の検査ファイルは変更していません。
- active-criticalは12件とも失敗しました。取得状態・表示・詳細スクロールのどこで止まったかは索引の `failureStage`／`failureClass` と完全JSONに保持しています。現在の重要情報を詳細外で読めるという受入は未達です。
- 速度レバーの通常ケースは全文geometryで、Easyケースはload上限で失敗しました。保存とストレージ復旧の2件は成功しました。
- 初回のnative capabilityは他のGPU取得と同時に実行したときに再停止し、34件の単独再実行では成功しました。最初の失敗も保持しています。カメラ初回Normalのload上限も保持し、他のGPU取得を終えてから同じ条件で2件を再実行しました。
- 初回34件のJSONは完全に保持していますが、後続カメラ検査が同じ出力先を使い、初回の21失敗画像を消してしまいました。出力先を分離して正式34件全体を再実行し、最終20失敗の画像・コンテキストをすべて保存しました。この欠損を隠して、初回の画像が残っているとは記載しません。
- GitHub CIはこのローカル記録とは別です。実機、Safari、全警告同時表示、全8画面の全寸法／200%、性能・公開条件は未検証です。

## 再現時の差分

`local-*.config.ts.txt` は取得時のローカル設定です。元の設定を継承して、配信URL、system Chromium、出力先だけを検査環境に合わせています。テスト本文・assertion・時間上限・再試行回数は変えていません。通常の製品スクリプト・GitHub CIはそのままです。

```sh
npm test
npm run build
npm run test:ui-integrity
npx playwright test --config=test-results/local-kaisen.config.ts
npx playwright test --config=test-results/local-ui-p1.config.ts
npx playwright test --config=test-results/local-acceptance-p1.config.ts
npx playwright test --config=test-results/local-throttle-p1.config.ts
npx playwright test --config=test-results/local-critical-p1.config.ts
FANTASIA_CAMERA_CONTRACT=1 npx playwright test --config=test-results/local-camera-p1.config.ts --grep camera-contract
```

新規の通常実行コマンドは `npm run test:browser:kaisen-ui` です。これは保存配置の4件を追加するもので、元の34件や追加16件を置き換えません。

## 保存配置4件の実画像

これらは文字200%適用後です。成功判定は保存した中心・寸法と実ブラウザの中央hit-testです。文字の重なりやHUD全体の可読性は未合格です。

- [normal saved Kaisen control centres and sizes survive enlarged text at 320x568](controls4/control-settings-01.png)
- [normal saved Kaisen control centres and sizes survive enlarged text at 568x320](controls4/control-settings-02.png)
- [easy saved Kaisen control centres and sizes survive enlarged text at 320x568](controls4/control-settings-03.png)
- [easy saved Kaisen control centres and sizes survive enlarged text at 568x320](controls4/control-settings-04.png)
