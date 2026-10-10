# 2026-10-10 共通操作・UIの確認と一時停止表示の修正

本人の「ゼロシリーズの未公開ゲームを公開し、カイセン・ファイトフライトの操作・UIを反映する」依頼に対応する。基準はファンタジア main `08f2c98582a627992e3c375ceb71f77cf0fbdc23`。Home・設定・Rules・Pause・Resultの共通shellを既存のUI-only画像で確認した。

公開候補 run `38018570005` の元添付 `pause-details-text-200.png` (SHA256 `73feb6597b509003b8d127b81d88e6a215d2740139ba063daa1361929eb6434d`) で、陣地詳細に戦闘中のDOM告知が重なる問題を確認した。Pauseより高い告知の層が原因だったため、`#app.fantasia-shell[data-screen="paused"] #announcement` に `visibility: hidden` を1規則追加する。再開時は元の告知を再表示する。告知の本文・優先度・有効期限、Canvas、戦闘ルール、武器、simulator、入力実装は変更しない。

既存の短時間UI-only Pause検査に、告知ありの固定fixtureからPauseを開くと非表示、200%文字で陣地詳細を読む間も非表示、設定から戻り実際の再開ボタンで同じ告知が再表示、tick/activeTicksが不変、再度PauseからHomeに戻れることを追加する。本編進行は行わない。厳密なUI-only source検査は、このCSS差分のSHA256だけを `ee3b1a6ab9556ac1347061a01bf44bda19fe47a7ee46cd22cad1dcfd9dc1f3f8` へ更新し、他のsource hash・anchors・不正差分の拒否・時間制限を維持する。

単体・build・短時間UI-only CIと元の添付画像を再確認してから採用する。物理iPhone、本編の正式受入、全ゲーム品質承認は未検証。`docs/RELEASE_GATE.json` の `ready:false` は変更しない。ゲームプレイ、得点送信、ランキング再開、Codex Cloud environmentsの操作は行わない。復元は通常のrevertで行い、mainへの直接pushやforce pushは行わない。
