# ファンタジア: Codex向け実装計画 v1

シリーズ基準: [カイセン / chameleonjp-lab/kaisen](https://github.com/chameleonjp-lab/kaisen)  
対象: [chameleonjp-lab/fantasia](https://github.com/chameleonjp-lab/fantasia)  
文書日: 2026-10-05。文書のみ。実装・コード生成・テスト実行・CI基盤作成・配備・mergeは未着手。

## 0. 固定仕様と着手条件

本計画は仕様PRの固定head `c2f0e61b850e6fd49823484775c27a73c965087d` にある [FANTASIA_SPEC.md](https://github.com/chameleonjp-lab/fantasia/blob/c2f0e61b850e6fd49823484775c27a73c965087d/docs/FANTASIA_SPEC.md) だけを実装契約とする。仕様PR: [仕様PR #1](https://github.com/chameleonjp-lab/fantasia/pull/1)。動くブランチ名やmainの将来状態を「同じ仕様」とみなさない。

- 主シリーズ基準: [kaisen@3d751051dc6212482a129e8da596ddd349b2f9f5](https://github.com/chameleonjp-lab/kaisen/tree/3d751051dc6212482a129e8da596ddd349b2f9f5)
- 系譜確認: [faitofuraito@c2b313d37875b93458032d98636fcf5b5d30a138](https://github.com/chameleonjp-lab/faitofuraito/tree/c2b313d37875b93458032d98636fcf5b5d30a138)
- 調査時の本作main: `321ab82585d583b5f985494b082a08368753e915`、README.mdのみ

仕様PRと本計画PRは別々にmainを向くDraft PR。計画PRは仕様文書のコピーを同梱せず、上記固定ファイルへ依存する。仕様が更新されたら新headとの差分をレビューし、計画の参照と影響箇所を追補するまで実装しない。main未mergeのDraft文書を「承認済み仕様」「実装完了」と呼ばない。

今回の作業はここまでの文書準備で止める。下記は将来の実装が依頼・承認された時の工程であり、今すぐ実行する指示ではない。公開や配備、権限、課金、データ損失の確認要件をこの計画で省略しない。

## 1. 作業原則と成果物台帳

### 1.1 変更境界

1. 実装着手前にREADME、AGENTS.md、関連skill、license/notices、package/lock、既存branch/PR、ユーザー変更を確認する
2. mainへ直接pushせず、対象を絞ったbranchとDraft PR。既存内容削除・損失上書き・一括変更は対象/件数/影響/復元策を示して承認済み範囲で行う
3. 新規ゲームファイルは本作repositoryにだけ置く。K/Fは参照元であり、同時に改変しない。他作品の作業branchへ混入させない
4. Kのファイルを最初に保持して移植し、認識できる小差分で本作adapterを接続する。「似たUIを新規作成」は不可
5. 私的な運用文書、会話、アカウント情報、非公開制御情報をゲームrepo/PRへ転載しない。公開成果物にはゲーム設計とその根拠だけを書く
6. 公開・配備・mergeは別ゲート。コードPRが承認されても自動で進めない。外部送信/オンラインサービスはv1非目標

### 1.2 予定成果物（未作成）

| 分類 | 予定内容 | 境界 |
| --- | --- | --- |
| 共通移植 | index.html、style.css、control-settings、keyboard-settings、input、aircraft、flight-view、scene共通部 | 固定Kの保持対象。差分台帳が必須 |
| 純論理 | campaign/config/types、terrain-query、ground-unit、ground-ai、dragon、magic-turret、capture、reinforcement、army-support、combat、scoring | DOM/Three.js/音へ依存させない |
| 表示adapter | terrain-view、unit-view、dragon-view、site-view、campaign-hud、projectile-view | snapshotを描画。論理stateを変更しない |
| 統合 | main、simulation adapter、rules-guide、result/record | 画面遷移・時計・入力とcampaignを接続 |
| テスト | unit、integration、property、browser、visual、performance fixtures | 仕様F-01..F-20へ追跡 |
| 証拠 | provenance、差分allowlist、test-report、visual pairs、performance、balance、release-checklist | 実行環境/head/実測を明記 |

ファイル名は設計案。実装段階でcheckoutの構造に合わせ最小調整できるが、責務をmain.tsひとつへ押し込まない。予定ファイルを既存ファイルとして説明しない。

## 2. フェーズ依存関係と品質ゲート

進行順: P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8。P3の戦闘、P4の占領/増援、P5の地上表示はインターフェース固定後に並行作業可。同じ共通ファイルへ同時編集を入れない。各フェーズを完成と言う前に、そのフェーズの変更headで証拠を読み戻す。

### P0: 仕様・ソース・作業範囲を固定

入力: 本計画の固定仕様、K/F固定commit、本作現在main。

実施:
- 指定仕様全文と現在treeを読み、7陣地/7砲台/7軍/竜/占領タイムアタックをrequirement IDへ対応
- Kの移植候補全ファイルと依存を取得し、Git blob SHA、取得元commit、licenseをmanifestへ記録
- 仕様で静的確認済みの主ファイルに加え、flight.ts、flight-assist.ts、gun-sight.ts、dialog-focus.ts、audio、render-queue、ordnance/bomb-guide/bomb-blast、ammunition、mission、types、テストを実読
- Kの飛行・銃・カメラ単位と本作地形高さの接続点を確認。原型の海面/船/海上追尾、F固有ランキング・終了条件の持込みを防ぐ
- 既存main/READMEのhashを控え、今回の新規追加とユーザー既存変更を区別

出力: 移植manifest、requirement trace、変更allowlist、未読/未検証一覧。

ゲート: 固定仕様への参照有効、コード/asset取得権限・由来が確認済み、K共通部を保持できる見通し。矛盾を理由無く実装者判断へ送らない。

### P1: シリーズ共通シェルを移植

実施:
- KのHTML/CSS/設定/入力/零戦/flight-viewをファイル単位で保持。初回commitで由来を分かるようにし、以後の本作差分を別commitへ
- 作品名・説明・storage namespace変更、魚雷UI/KeyXの本作除外、爆弾を残す。5/2タッチ・10/7キーを契約化
- Kのsceneから海/船の依存を外すadapter設計。カメラ姿勢/FOV/offset、hero機体、renderer色管理、入力寿命管理は保持
- 8画面の仮データを本作文言で作る。ゲーム論理が未接続であることを表示し、勝利済みデモを実装成功と扱わない
- K基準を同じbrowser/viewport/DPR/文字倍率で起動して比較基盤の画像を採る。基準の実行ができなければ画面比較ゲートは未達

検証:
- 既定操作、pointer/keyboard/native button、cancel/lost capture、blur/resize、モード切替、再出撃の入力残り0
- draft設定の保存/破棄、Storage例外、未来version、session-only、focus復帰、2タブ、4項目
- K→本作の8画面と機体比較の第一回。Kに無い占領HUD部分はallowlistへ限定し、共通UIまで無視領域にしない

ゲート: F-02..F-07の共通部分合格。新フォント/新配色/自機簡略/別カメラがあればP1へ戻す。200%の到達性不良をゲーム開発の後へ押し流さない。

### P2: 純論理campaignと戦場を構築

実施:
- 60Hz整数tick、PRNG分離、runId/entityId/generation/eventId、status、tick順序を実装
- 7回対称のsite/派遣門/味方出発点/道路/遮蔽物をデータ化。heightAt/lineOfSight/sweep/route契約を共有
- 6列4行配置とhit球、初期敵味方地上各168、竜7、砲台7、自機1、上限/予備兵/予約をvalidate
- コピー可能snapshotとhash、入力record/replay、30/60/120fpsレンダリング駆動adapterを準備
- 描画無しの地上移動とcollisionを実装。空間hash最適化前に全探索oracleを作る

検証: F-01、F-16、F-17の土台。7回転の同型、同seed10回同hash、NaN/不正classCount/重複ID/負の予備兵を拒否。

ゲート: 画面を見る向きで論理が変わらず、7方面がtick0から等しく進む。P2はゲームが面白いことの証明ではない。

### P3: 兵科・魔法砲台・竜・自機武器

実施:
- 兵科HP/速度/射程/damage/間隔/対空条件をconfigから読む。倍率の対象外を明示
- 射線/高度/距離で適格targetを選び、予告→照準lock→発射→回復を状態機械にする
- 砲台適格自機優先、地上fallback、72tick予告/末尾18ticklock、破壊時cancel
- 竜巡回/地上と自機選敵/火球54tick予告/非誘導、直撃爆風の重複防止
- 銃・矢・魔法・火球のswept collision、terrain/壁への先着、TTL、発射時team、同tickdamageの比例整数配賦・剰余順位、近接相打ちと生存後飛翔弾commit
- K機銃/機関砲の銃口・発射間隔・残弾・6秒再装填を移植し、本作target adapterを足す
- 爆弾terrain弾道/30秒TTL/45m爆風/同じ予測関数のガイド、Normal25%誤射/Easy0、HP有効damageのclampと整数配賦
- actor/weapon別最大発射率とTTLを積算し、projectile pool4096と仕様の保守見積り1463が足りる根拠を再確認する。収まらない場合は必要数を再見積り、既発弾を消さない

検証: F-08..F-10、P5の最終表示より前に最小の予告表示adapterを用意し、砲台/竜の予告が音無しでも読めるブラウザ確認。境界ちょうど/直前/直後、標的死亡/遮蔽/復活保護、同tick相打ち、二重event、プール再利用、idle→予告開始→lock→fireAt→cooldownUntilの境界を検査。

ゲート: 見えた弾と命中位置が一致、画面外でも同damage、砲台や竜が自機を射程外で追い続けない。画面用fake projectileだけで攻撃判定を済ませない。

### P4: 占領・継続補填・7軍AIと救援

実施:
- owner/challenger/progress/contestedを仕様通り構築（初期progress0、内部60000単位）。砲台破壊と占領は別event
- 占領円の生存兵を死亡処理後に集計し、contestedを毎tick再代入。中立化と確保は別tick、余剰を繰越さない
- 敵45秒地上/90秒竜の予約、5秒派遣、上限込み予約、満員skip、7lane同時予約
- 味方30秒ごと不足最大8の有限補充、Normal/Easyの予備兵class在庫と不足率再計算、5秒派遣、全滅再編、1回だけ資源返却
- owner変更とticket/sourceGeneration/runIdの契約。敵中央門は不変、目的地だけ防衛→奪還へ
- depleted方面へ6体の隣軍救援、armyIdとassignedSiteIdの分離、rescueMission状態（donorSiteId正本、到着でcompleted）、守備最低6体、同tick snapshotと活動中任務による二重割当拒否
- 軍はmarch/engage/capture/garrison/regrouping/depleted/rescueを明示し、追跡制限/帰路/閉塞復帰を実装

検証: F-11..F-13。全占領遷移を表駆動、0/1/4/5人、両軍、砲台生存、砲台破壊とcapture同tick、49→50秒の予約owner変更、予約寸前の終了/restart、予備兵枯渇、救援到着でcompleted/守備継続/再選出可能条件、隣軍全員が援軍申請を同tickで行うfixture。

ゲート: ownerが変わっても旧owner兵が瞬間出現せず、敵兵が消えず、味方兵が複製されず、予備兵/容量が負にならない。1軍壊滅で即失敗にしない。全7に支援の意味が残る。

### P5: 地形・兵・竜・占領HUDを表示

実施:
- 共有geometry/materialとinstancingで地上兵、騎馬、陣地、砲台を描く。竜は飛翔姿勢/火球予告が分かる形にする
- 地形はheight/queryと見た目を一致。見えない壁/通れる見た目の障害物を作らない
- HUDへ7陣地のowner/争奪/進捗/兵数/予備兵/次波を接続。狭幅4+3段、共通計器と中心照準を保持
- 既存radarへ番号/形/危険方向を追加。入力コマンドを暗黙に増やさず、詳細は停止画面へ
- 警報の優先度/集約、予告と着弾、色以外の識別、音OFF時の情報、reduce motionに配慮
- 使うasset/licenseを台帳へ記録。外部CDN必須にしない

検証: 実stateと画面countの一致、砲台destroyed/capture/unoccupied/contest/recapture/army-depleted表示。100/200%文字、縦横、小画面で全7番号・保存/破棄・操作が到達可能。

ゲート: 遠い6方面が「見えないので状況不明」にならず、操作や零戦の可視領域を7陣地HUDで埋めない。F-05..F-07を新しいheadで再評価。

### P6: 時計・復活・勝敗・結果・保存を統合

実施:
- activeTicks、respawnPenaltyTicks、recordTicksを分け、pause/hidden/settings/context lost/3秒復活は凍結、復活10秒加算、保護2秒を接続
- 作戦圏外10秒猶予→機体喪失、自機3残機、固定7座標と100m安全条件不成立時のfallbackによる復活候補選択、保護中発射不可、弾/HP復帰
- 判定順: 残機0/全地上再建不能 → 全7friendly → 20分期限。最後の旗/撃墜/期限同tickの裁定を仕様通り固定
- 初占領・初期砲台・成功・速さ・誤射・喪失の有限スコア。上限26100、増援/再占領稼ぎ0
- mode/rulesVersion/mapVersion/seed/startHeading別ローカル成功記録。敗北は参考結果のみ、途中セーブ無し、送信無し
- 未処理dt>0.25秒は明示停止し通常記録対象外とする。再出撃/ホームで旧runを無効化し、timer/listener/描画資源を解放。モード変更は出撃前のみ

検証: F-14、F-15、F-19。時計を待機の実時間で進めない、復活penalty二重加算なし、600連続active tickの越境失敗/途中帰還/同tick二重喪失禁止、結果snapshotを後続eventで書換えない、storage例外でも結果は読める。

ゲート: 正式入力だけで出撃から勝利/敗北まで完走。テストhookでHP/ownerを書換えた結果はゲーム通しプレイ証拠に使わない。

### P7: 回帰・公平性・性能・バランス

実施:
- F-01..F-20を最終candidate headで実行し、失敗/未実行を一覧化
- 比較8画面×基準/本作、phone縦横・小画面・200%文字、機体4姿勢/追従視界を実画像でレビュー
- 最低条件以上の具体的実機を固定し、最大470actor、全lane最大射撃を最低120秒。1tick p95とframe累積を区別してdesktop/phone予算、全20分run、10restartを測定
- 30/60/120fps、画面外、LOD変更、tie起点/ID対応を含む7回転、same seed10回、空間hash vs全探索oracleを検証
- 最低10seed、Normal/Easy、熟練/初心者で複数支援戦術を比較。初期目標Normal4〜10分、Easy8〜16分
- 無介入で安定自動勝利しない、未選択6方面が30秒以内に自動壊滅しない、1方面固執/自滅補給/増援稼ぎが最速最良にならないことを確認
- 数値変更は理由→仕様改版→config→テスト→再測定の順。プレイ回数だけを合格根拠にしない

ゲート: 全必須行の証拠が揃う。未達のスマホ実機をエミュレーション結果で埋めない。平均fpsだけ、画面内敵だけ、敵数を減らした負荷だけで性能合格しない。

### P8: レビュー可能な引渡し

実施:
- 文書/実装/テスト/evidenceの対応を最終headで揃える
- 変更ファイル一覧、基準との差分、正常/失敗/未実行の結果、残課題、復元策をPR本文に書く
- remote headとローカル検証headの一致、required statusがそのheadを対象とするかをread-onlyで確認
- CIを将来導入する場合は依頼範囲を確認し、公開/配備workflowと検証workflowを分ける。勝手にCI基盤や配備を有効化しない
- merge/配備の承認が無ければDraft PRと証拠を渡して止める

完了条件: 「実装着手可能な計画」と「完成ゲーム」を分けて報告。今回の文書PR完了は将来P0..P8の実行完了を意味しない。

## 3. インターフェース設計の拘束

### 3.1 純論理側

- campaign.stepは固定dtと入力だけで1tick進め、snapshot/eventを返す。wall clock/DOM/renderer/音を参照しない
- terrain API: heightAt(x,z)、blockedSegment(from,to)、sweepSphere(from,to,radius)、route(fromSite,toSite)。表示meshと一致する単一データ源
- capture API: 全siteに同tick snapshotの生存地上位置を渡す。damage前の人数や画面に描けた人数を使わない
- reinforcement API: reserve/dispatch/cancelの全てをticketIdで冪等化。資源/容量/兵在庫の確保と返却を一つのtransactionにする
- combat API: actorとprojectileの双方generationを照合、同tickdamagesを集計、effectiveDamageとdeadを一度だけ確定
- score API: 初占領siteIdと初期turretIdの有限ledger、friendlyDamage/kill/selfLoss累計、terminal snapshotを入力にする

### 3.2 表示と入力側

- 既存FlightControlsのsampleから得た入力を1tickに一度だけ消費。loop/bomb edgeを複数catch-up tickへ複写しない
- rendererは最新snapshotを補間し、eventIdから新規演出だけ消費。描画欠落で弾の命中/得点を取り消さない
- hud presenterは状態から文字/ariaを生成。settingsや結果画面の操作がFlightControlsへ流れない
- dispose/restartはrunIdを切替え、古いcallbackの通信/音/兵出現を拒否する。v1には外部通信を実装しない

## 4. テスト設計と追跡表

| 仕様ID | 主テスト層 | 代表ケース | 証拠 |
| --- | --- | --- | --- |
| F-01 | unit/integration | 初期数、重複ID、7軍同時進軍 | state JSON/hash |
| F-02 | provenance/diff | 固定blob、許可差分、notice保持 | manifestとファイルdiff |
| F-03..04 | unit/browser | 全キー/タッチ、cancel、保存失敗、focus | テスト結果＋必要画像 |
| F-05..07 | browser/visual | 8状態、4姿勢、縦横/200% | old/new画像対＋人の所見 |
| F-08..10 | unit/integration/browser | 倍率/距離/遮蔽/予告/移動sweep | 表駆動結果＋予告映像 |
| F-11 | unit/property | owner×presence×turret×progress境界 | 全遷移表のcoverage |
| F-12..13 | unit/property | 予約上限/owner-change/cancel/救援 | before/after JSON |
| F-14..15 | unit/browser | 同tick裁定、時計、penalty、score | 期待整数値と結果画面 |
| F-16..17 | deterministic/property | seed/fps/回転/全探索oracle | state hash比較 |
| F-18 | performance/soak | 470actor、120s、20分、10restart | frame分布・論理数・memory |
| F-19..20 | browser/gameplay | 正式入力完走、複数戦術、無介入 | consumed-input replay＋結果 |

Propertyの不変条件:
- 0≤HP≤maxHP、owner/challenger有効、0≤progress≤60000、site/armyは常に7
- alive+reserved≤team/lane/army capacity、reserve count非負、予約はexactly one terminal status
- activeTickはrunning以外で不変、recordTickはactiveTick+respawnPenaltyTicks（残機が残る喪失確定時だけ600加算、勝利同tickを含む）
- 敵/味方の兵がteamを勝手に変えず、救援で総兵数が増えない
- terminal後は所有/score/lives/兵/弾/ticketが変わらない
- score≤26100、増援だけの撃破でscore増0、同site再占領で初占領加点0
- カメラ方向/描画LOD/描画fpsだけの変更でstate hash不変

境界fixtureは成功だけでなく失敗を含む。浮動小数点の微小差を許す場合は対象/許容誤差/理由を明記し、判定境界を広くマスクしない。

## 5. 実画像比較チェックシート

基準と本作それぞれに以下を記録する。

- repository、commit SHA、build手順/依存lock、起動URL、日時
- 実機またはemulation、OS/browser/version、viewport CSS px、device DPR、内部renderer DPR、文字倍率100/200%、解決font
- Normal/Easy、keyboard/touch、設定保存状態、camera/player position/quaternion/速度、乱数seed、snapshot tick
- 8画面の画面全体画像、共通領域の比較、許可差分（作品名/内容/占領HUD/世界/得点）
- hero機体4姿勢、操縦中視界、照準位置、翼/塗装/3枚propeller/canopy/銃口/舵面の確認
- 実際に見た人の所見、崩れ/未達、修正後の再撮影head

旧基準が動かない場合はそのblockerを明記して止め、似たスクリーンショットを生成して比較の代用にしない。実画像が無ければF-05/F-06は未実行。DOMテストが全passでも視覚比較合格とはしない。

## 6. リスクと切り戻し

| リスク | 検出時期 | 対応 |
| --- | --- | --- |
| ファンタジー化がUI/機体まで別物になる | P1と各視覚回帰 | Kの保持ファイルへ戻し、本作差分を局所adapterへ |
| 敵増援で旗を永遠に取れない | P4/P7 | 波/経路/兵科/進捗を実測。仕様改版で調整、勝利条件を全滅へ変更しない |
| 最初に行かない6軍が即壊滅 | P4/P7 | 7回転/30秒無介入fixtureで検出。予備兵と初期戦力調整を記録 |
| 一軍depletedで永久進行不能 | P4 | 救援到達/余剰守備/再編の通し試験。20分終了を救済の代わりにしない |
| owner変更/同tick波で兵が複製 | P4 | generation/ticket冪等/capacity不変条件で拒否 |
| projectile容量不足/描画依存 | P3/P7 | 発射率×TTLを再計算し、純演出のみ削減 |
| 200%/横向きでUI操作不能 | P1/P5 | scroll/safe area/折返しを維持して再撮影。全体縮小で回避しない |
| 性能が470actorで未達 | P7 | 空間hash/pool/instancing最適化、論理数・自機品質を減らさず未達を開示 |
| 他作品storageを汚す | P1/P6 | prefix隔離とstorage snapshotテスト。既存データ削除をしない |
| 相打ち/復活時計で記録が不公平 | P6 | 整数tickと優先順位fixtureで固定 |

切り戻しは最終合格commitへ戻す候補diffを作り、未承認の既存データ削除/強制push/損失上書きをしない。新規コードの修正でもユーザー変更と競合したら一旦止めて範囲を整理する。

## 7. 文書PRの確認と現在の状態

この計画で定義したこと:
- 固定仕様から段階的に実装する順序、責務、依存、停止条件
- Kaisenのファイル移植と見た目/操作保全をゲーム固有実装より先に確認するゲート
- 7方面同時論理、占領/補填/救援/勝敗/有限得点のunit・property・通しプレイ試験
- 未計測の性能/バランス目標と、その合否を偽らない証拠要件

現在行っていないこと:
- ゲーム実装、ゲーム用コード生成、依存導入、テスト実行、CI基盤実行
- ブラウザ上のK/本作8画面比較、スマホ実機テスト、ゲームバランス測定
- 配備、merge、オンライン接続、ランキング送信

文書の独立レビューは論理の矛盾と実装手順を検査する。将来の動作品の検証結果を先取りするものではない。

