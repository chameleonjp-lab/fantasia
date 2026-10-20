# カイセン操作配置の復元候補：証跡

[修正範囲・未解決事項](../../KAISEN_UI_FOUNDATION_20261020.md) を先に参照してください。画面全体の受入は未完了です。

- [飛行画面80枚](playing/README.md)：4参照版＋P1、4寸法、100/200%、Normal/Easy。PNGは原寸・未加工。
- [代表8画面・4姿勢](screens/README.md)：Kaisen／main／P1、393×852、100%。各画面に差分理由を記載。
- [検査記録](tests/README.md)：成功・失敗・初回と再実行を区別し、全件JSONを保存。
- [実フォント](environment/)：実ページの `CSS.getPlatformFontsForNode` による記録。共通6要素は3版とも同じフォントで、時計はNoto Sans Mono CJK JP、宙返り文字はNoto Sans CJK JP、矢印はDejaVu Sansです。
- [ファイル台帳](manifest.json)：自己参照を避けて台帳自身以外の全ファイルのSHA256とバイト数、およびコードのfingerprintを保存。

画像の実状態・tick・ソースSHA・GPU情報・画像hashを含むメタデータは `playing/metadata.json.gz` と `screens/metadata.json.gz` に全件保存しています。gzipは格納形式だけの変更で、取得情報は省略していません。

## 取得・実行条件

Linux、Node v24.19.0、Chromium 154.0.8037.57、`/usr/bin/chromium`、実WebGL2／ANGLE SwiftShader。比較画像のDPRは1。正式な受入検査では既存のDPR・文字条件・時間上限を維持しています。iPhone実機・Safari・性能受入は未検証です。

`capture-playing.mjs`／`capture-screens.mjs` は取得時のスクリプトです。`/workspace/kaisen-reference`、`fantasia-main-reference`、`fantasia-pr20-reference`、`fantasia-pr21-reference`、`fantasia-kaisen-ui` の固定worktreeを、それぞれ4180〜4184で配信して取得しました。Viteのキャッシュはworktreeごとに分け、P1はHMRを無効にしました。製品のVite設定には加えていません。これらのパス・ポートは証跡取得環境のものです。

```sh
node capture-playing.mjs --full
node capture-playing.mjs --candidate --full
node capture-screens.mjs
node capture-screens.mjs --poses
node capture-screens.mjs --pause-only
node capture-screens.mjs --fonts-only
```

画像は制御時計下の実レンダラーから取得し、ゲーム状態・GPU queue・結果を注入していません。ネイティブのStart・キー・設定・停止経路を使用しています。自然な機体喪失で得た結果は敗北のみです。制御時計・GPU待機を使った画像と機能検査から、無中断性能や実機の操作感を合格とは判定していません。

P1のコード・追加検査コミットは `601df7804b1cb8a6b339b7d30ac1ed76ca8c2090`、そのtreeは `96f21c000ccb7f743fafadd45a20769133d822f3`。後続はこの証跡・文書だけです。単体検査とbuildは同じソースバイトをコミット前に検査し、browserの最終34件・カメラ2件はこのコミットで実行しました。

## 取得時の失敗・再取得

- P1の852×393・Normal・100%の最初のnavigationは10秒で失敗しました。`playing/attempt-1/` に元のJSONと画像を保持し、同じ上限でこの1条件だけ再取得しました。
- 最初の停止画像にはGPU受領待ちで再開ボタンが無効なものがあったため、`screens/pause-pending-attempt-1/` に保持し、実受領後を撮り直しました。
- 正式検査の失敗と出力先の問題は [検査記録](tests/README.md) に記載しています。再実行を元の結果へ上書きしていません。
