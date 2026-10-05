# 保存先と公開停止状態

実装・検証記録は [Draft PR #4](https://github.com/chameleonjp-lab/fantasia/pull/4) に保存。計画元は [PR #2](https://github.com/chameleonjp-lab/fantasia/pull/2)。作業中の [PR #3](https://github.com/chameleonjp-lab/fantasia/pull/3) 追補は文書とREADMEを保持し、追補自身の指定により速度レバー実装はこの先行PRへ混ぜていない。

独立レビュー済みruntime候補は `fe7e03935dd4ff4c59a14a6f35511f50aaf7e9e2`。後続はテスト・検証スクリプト・証跡・文書の変更で、src/public/index/依存lock/型・Vite設定の差分なしを確認。126件の自動検査、本番ビルド、公開内容検査は成功。ブラウザ全受入は失敗・未実行があり、GitHub CIも合格未宣言。

詳細は [FANTASIA_VERIFICATION.md](FANTASIA_VERIFICATION.md)、[INDEPENDENT_REVIEW.md](INDEPENDENT_REVIEW.md)、[RELEASE_GATE.json](RELEASE_GATE.json)。公開条件は未達で `ready:false`。mainへのmerge、Pages設定変更・workflow起動・公開は行っていない。Pages APIは404で公開URL未取得。

残作業はGPU/フレーム性能と正式入力ブラウザ受入、実機スマートフォン、8状態・4姿勢と200%の全比較、両モードの勝利、10seed・複数戦術、20分WebGL耐久と10再出撃の資源確認、および速度レバー追補の統合。その結果に基づいて最終候補を固定し、独立レビューとP7/P8を全合格にしてから公開する。今回の停止は公開の追加承認待ちではない。

通常git pushはHTTP401になったため、GitHub GitDB APIでblob/tree/unsigned commitのSHAを照合し、feature branchを強制更新なしで進めた。元import commit `8aec6b33085b347588307babab63c5125bd515a1` も保持。ローカルには同じ履歴のGit bundleを別途保存する。
