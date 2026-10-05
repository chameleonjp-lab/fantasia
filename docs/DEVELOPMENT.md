# 起動と検査

Node.js 24 を使用する。

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

開発 URL は `http://127.0.0.1:4176/`。配布物は `dist/` の静的ファイルで、
Three.js もビルドに含む。プレイ中に CDN やランキング API は使用しない。

操作・記録はこのブラウザの本作専用 localStorage に保存する。途中セーブはない。
Normal は矢印・Space・L・W・S・Z・Esc、Easy は矢印・L・Z・Esc。
魚雷キーはない。再出撃は新しい戦役を開始する。

カイセンから保持した旧海戦検査は `npm run test:legacy` で実行できるが、
ファンタジアの受入合格の根拠には数えない。

## 公開の手順

公開前に [FANTASIA_IMPLEMENTATION_PLAN.md](FANTASIA_IMPLEMENTATION_PLAN.md) の
P7/P8 と [FANTASIA_SPEC.md](FANTASIA_SPEC.md) の F-01〜20 を照合する。
受入状況は `FANTASIA_VERIFICATION.md` と `RELEASE_GATE.json` に記録する。
必須行に未達があれば、公開 workflow の実行・Pages 設定変更を行わない。

`Publish Fantasia Pages` は手動実行専用で、公開判定、単体検査、ビルド、配布物の
allowlist/ライセンス/開発用 hook 除外検査を経て GitHub Pages artifact を配備する。
通常の PR 検査は別の `Verify Fantasia`。ソース、検査、配備スクリプトが受入候補から
変わったら、その候補の証拠を再取得する。

公開後は Pages の `deployment.json` にある commit、JS/CSS の SHA-256、実際の
出撃・停止・設定・再出撃を照合する。公開済みとは配備成功と URL の実動確認後にだけ報告する。
