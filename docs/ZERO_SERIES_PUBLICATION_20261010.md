# 2026-10-13 公開確認版の許可と範囲

本人の「ファンタジアのページ最新化して」という依頼に基づき、既存の確認用公開workflowで現在のmainを検査し、配信内容を更新する。公開対象の製品sourceと、公開workflow変更を載せるmainの基準commitは、どちらも `3d5cc4674e9bb30c63d171e76edc172e28ba1439` に固定する。このcommitには、採用済みPR #15の変更（NPCのcamera追従停止、7拠点、砲台1.5倍）が含まれる。今回、ゲーム実装の追加変更は行わない。

workflowは公開runのHEADがpushされたmainの先端であり、clean checkoutであることを確認する。HEADの最初の親は上記の基準commitと一致し、基準sourceからHEADまでの変更pathはこのworkflowと本文書の2つだけでなければならない。基準commit直後の単一親commit、squash commit、または基準commitを最初の親とするmerge commitではこの検査が成立する。mainが先に進んだ場合、最初の親や2 pathの条件が崩れた場合は公開を停止する。既存の検査条件は広げない。

公開前に `npm test`、`npm run build`、既存の範囲に限ったUI-only browser checksを実行し、配布ファイルとmanifestを検証する。配信するのは検証済みの製品HTML・スクリプト・CSS・NOTICEと配布manifestだけで、テスト成果物は別artifactに残す。公開manifestには今回の日付 `2026-10-13`、採用されたmain commit、source tree、workflow commit、配布対象の各asset hashを記録する。

これは確認用の更新公開であり、ゲームプレイの正式受入や物理iPhoneでの検査が完了したという意味ではない。正式受入と実機検証は未完了として扱い、`docs/RELEASE_GATE.json` と通常のrelease gateは変更しない。確認用公開では既存のPages設定 `enablement: false` を保つ。

mainへの直接pushは行わず、変更はPRで提出する。PRを作成した担当者が本人に代わってmergeすることはない。公開後はCI成功だけで公開完了と判断せず、公開先の `deployment.json` が今回のcommitを示すことと、公開先assetのhashがmanifestおよび生成物と一致することを確認する。

復元が必要な場合は、別途承認された配備で以前の成果物を再公開する。履歴の書換え、force push、データ削除は行わない。
