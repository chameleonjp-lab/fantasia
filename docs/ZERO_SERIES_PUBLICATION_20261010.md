# 2026-11-07 公開確認版の許可と範囲

本人の「全て公開」という依頼に基づき、既存の確認用公開workflowで現在のmainを検査し、ファンタジアの配信内容を更新する。公開対象の製品sourceと、公開workflow変更を載せるmainの基準commitは、どちらも `425f1311e0d0210670fe960f0fda7b1cdf75f51f` に固定する。このcommitは [修正PR #25](https://github.com/chameleonjp-lab/fantasia/pull/25) を取り込んだ版で、製品tree `70f3f141d952f838177058cb00716c43f600e4ee` は検査した候補と一致する。候補の [CI run 42279215961](https://github.com/chameleonjp-lab/fantasia/actions/runs/42279215961) は成功している。今回、ゲーム実装の追加変更は行わない。

workflowは公開runのHEADがpushされたmainの先端であり、clean checkoutであることを確認する。HEADの最初の親は上記の基準commitと一致し、基準sourceからHEADまでの変更pathはこのworkflowと本文書の2つだけでなければならない。基準commit直後の単一親commit、squash commit、または基準commitを最初の親とするmerge commitではこの検査が成立する。mainが先に進んだ場合、最初の親や2 pathの条件が崩れた場合は公開を停止する。既存の検査条件は広げない。

公開前に `npm test`、`npm run build`、既存の範囲に限ったUI-only browser checksを実行し、配布ファイルとmanifestを検証する。配信するのは検証済みの製品HTML・スクリプト・CSS・NOTICEと配布manifestだけで、テスト成果物は別artifactに残す。公開manifestには今回の日付 `2026-11-07`、採用されたmain commit、source tree、workflow commit、配布対象の各asset hashを記録する。

これは確認用の更新公開であり、ゲームプレイの正式受入や物理iPhoneでの検査が完了したという意味ではない。正式受入と実機検証は未完了として扱い、`docs/RELEASE_GATE.json` と通常のrelease gateは変更しない。確認用公開では既存のPages設定 `enablement: false` を保つ。2026-10-13の同じ確認用公開経路と同様、公開の許可と正式受入の成否を区別する。

mainへの直接pushは行わず、変更はPRで提出する。今回は本人の全作品公開の指示に基づき、この2 pathだけの公開PRを独立レビューとCI成功の後にマージし、既存workflowを起動する。公開後はCI成功だけで公開完了と判断せず、公開先の `deployment.json` が今回のcommitを示すことと、公開先assetのhashがmanifestおよび生成物と一致することを確認する。

復元が必要な場合は、別途承認された配備で以前の成果物を再公開する。履歴の書換え、force push、データ削除は行わない。
