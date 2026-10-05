# ファンタジア: Codex向け厳密仕様設計 v1

シリーズ基準: [カイセン / chameleonjp-lab/kaisen](https://github.com/chameleonjp-lab/kaisen)  
対象: [ファンタジア / chameleonjp-lab/fantasia](https://github.com/chameleonjp-lab/fantasia)  
文書日: 2026-10-05。状態: 設計案。ゲームの実装・ビルド・実行・配備・視覚検証は未着手。

## 0. 契約、優先順位、範囲

本書の MUST / MUST NOT は受入必須条件、SHOULD は理由付きで例外を記録できる推奨条件である。数値は「ユーザー指定」「シリーズ継承」「本作の初期設計値」を混同しない。

### 0.1 ユーザー指定

- ゼロシリーズの新作「ファンタジア」。剣と魔法の世界で、7つの陣地を取り合う占領戦
- 同時に7方面を攻める味方7軍を、自機で支援するタイムアタック
- 敵: 歩兵（剣・弓・魔法）、騎馬軍、竜軍。竜は火球で地上と自機を攻撃
- 各陣地に魔法砲台1基、合計7基。地上の敵対軍と自機を攻撃し、自機を優先
- 敵は一定時間ごとに増援・補填を派遣し続ける
- 味方: 剣・弓・魔法の歩兵、騎馬軍からなる7軍
- 未指定の細部を補い、Codexが判断を取り違えず実装できる仕様と実装計画を作る

「次期」は文脈上「自機」と解釈する。「魔法の砲台7箇所」は各陣地7基・合計49基ではない。ユーザー未指定の残機・軍人数・補填間隔などは本書の初期設計値であり、ユーザーが指定した数字とは扱わない。

### 0.2 優先順位と非目標

優先順位は、ユーザー指定 → シリーズ共通の外観・入力保全 → 本書のルール → 調整可能な初期値。矛盾は実装前に文書差分で解決し、黙って別仕様にしない。

今回の成果物は文書だけ。実装、コード生成、依存関係インストール、CI基盤作成・実行、配備、mergeを実施しない。将来の実装段階でも、既存READMEやユーザー変更を破壊せず、変更対象と根拠を分離する。

v1の非目標: マルチプレイ、オンラインランキング、アカウント、外部送信、課金、ネットワークAI、キャンペーン、操作可能な地上兵、RTS指揮コマンド、味方竜、陣地増設、海戦・魚雷、ロケット。自機を竜・箒・ファンタジー騎乗へ置換しない。ゼロシリーズの戦闘機が異世界の地上戦を支援する。

## 1. 固定参照とシリーズ継承

### 1.1 ソースを固定する

- 主基準K: [kaisen@3d751051dc6212482a129e8da596ddd349b2f9f5](https://github.com/chameleonjp-lab/kaisen/tree/3d751051dc6212482a129e8da596ddd349b2f9f5)
- 系譜確認F: [faitofuraito@c2b313d37875b93458032d98636fcf5b5d30a138](https://github.com/chameleonjp-lab/faitofuraito/tree/c2b313d37875b93458032d98636fcf5b5d30a138)
- 対象main調査時: `321ab82585d583b5f985494b082a08368753e915`。README.mdのみ。ゲームソース、テスト、CIはまだ存在しない

Kの固定treeと取得ファイルのGit blob SHAを照合し、以下のHTML/CSS・入力・設定・機体・カメラ・scene共通部をソースで確認した。これは静的調査であり、ブラウザを実行して視覚同一性を確認したという意味ではない。移植時は基準をlatestへ勝手に変更せず、由来と変更理由をファイル単位で記録する。

### 1.2 ファイル単位の移植・保持契約

| Kのファイルと固定blob | MUST保持 | 本作で許される差分 |
| --- | --- | --- |
| [index.html](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/index.html) `de945a10417a2f883b3cfd3d79fadbfe3c7a4afc` | home/HUD/pause/resultのDOM骨格、設定・ヘルプ導線、ボタン階層 | 作品名、世界説明、7陣地/7軍の数値・文言、海戦固有要素の置換 |
| [src/style.css](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/style.css) `66f33fdd090157f27d8c4661d0f6d42a486c6ed7` | 書体、色、背景、余白、明朝タイトル、円形操作、レスポンシブ規則 | 本作追加HUDの局所スタイルだけ。共通セレクタの全面書換不可 |
| [src/control-settings.css](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/control-settings.css) `1235392f369ac27ef3056852512319fe6994300b` | dialog、スクロール領域、固定footer、安全域、44px以上の操作対象 | 魚雷項目をなくした場合の空き行のみ |
| [src/control-settings.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/control-settings.ts) `5208c4da8ebe014552cae855d84c2574ab152292` | 2編集タブ、モード別配置、4調整項目、draft→保存/破棄、失敗時保全 | fantasia専用storage、魚雷除外、型名 |
| [src/keyboard-settings.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/keyboard-settings.ts) `eb143ac27b3f65b66912d10b89ec17d0efc581b2` | KeyboardEvent.code、重複/予約キー拒否、入力方式切替と保存 | 専用キー名、魚雷KeyX除外 |
| [src/input.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/input.ts) `0edbd1c5f9f07a2d1088539e188bab0329ab53f0` | 相対ドラッグ、pointer所有、押下/単発差、解除、native操作保全 | 魚雷受付除外、型名。操縦感を作り直さない |
| [src/aircraft.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/aircraft.ts) `e4e3009464bb8c4ae473b7cfc46d010198c27149` | hero零戦モデル、翼断面、胴体、3枚プロペラ、キャノピー、銃口、塗装、舵面、資源解放 | 原則なし。簡略モデルへの置換禁止 |
| [src/flight-view.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/flight-view.ts) `87f83928a00092338391442ec2d7e87e3b4e33da` | FOV64、追従offset(0,11,29)、bank係数0.45、Normal/Easy視線、投影と照準判定 | 原則なし。別カメラにしない |
| [src/scene.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/scene.ts) `2611a6e6a7b57fe6f94c1d75593aa8da51d33726` | renderer、tone mapping、機体表示/カメラ適用、照準、共通marker、lifecycle | 海・船を地形/陣地/兵/竜へ接続し直す。海戦依存を残して完成扱い不可 |
| [src/main.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/main.ts) `af73f3ae5b0bdcecb1b8e10d86b9342e2663d983` | 画面遷移、設定を閉じても停止維持、非表示/blur/文脈喪失、安全な再開 | 戦役時計、占領HUD、結果・専用保存のadapter |

`flight.ts`、`flight-assist.ts`、`gun-sight.ts`、`dialog-focus.ts`、audio、render-queue等の依存も固定treeから必要範囲を実装前に読む。未読ファイルを「確認済み」と記録しない。Kの海上追尾や海面高度を新作地形へそのまま適用しない。Fは共通設計の系譜確認用であり、Kを飛ばして別UIへ戻す根拠にはしない。

### 1.3 見た目と入力の具体契約

- 共通UI: 背景 `#071e2b`、文字 `#eff4ed`、金 `#e4c88b`。本文はKのsystem-ui等の書体順、タイトルは `Hiragino Mincho ProN` / `Yu Mincho` / serif。新フォント・紫色のファンタジーUI・別ボタンデザインへ交換しない
- KのrendererはsRGB、ACESFilmicToneMapping、exposure1.1、DPR上限1.5。比較時はブラウザDPRと内部描画DPRの両方を記録。地形色は変更可、共通UIや自機の材質は保持
- Kの機体は自機heroを保持。敵竜・地上兵だけを新規形状にする。機体正面/側面/背面/旋回中の実画像と追従カメラを比較する
- 相対ドラッグ半径36px、dead zone8%、上ドラッグが上昇。fire/加速/減速は長押し。宙返り/爆弾は1回の正常releaseにつき1発、cancel/lost captureでは発火しない。キーは初回keydown、repeat除外
- blur/pagehide/visibilitychange/resize/モード変更/設定/停止/復活/再出撃で入力をclear。戻っても爆弾や長押しが持ち越されない。mouse/pen/touchの同時利用、pointer ID再利用を壊さない
- Kには機銃mg・機関砲cannon・爆弾bomb・魚雷torpedoがある。読み取った型/入力/発射処理にrocketはない。「継承ロケット」と書かない
- 本作初期案は爆弾を地上支援用に残し、魚雷を外す。Normalはタッチ5操作、Easyは宙返り/爆弾の2操作。キーボードは10操作、Easyではfire/加速/減速を受け付けないため有効7操作
- 既定キー: 矢印4方向、Space射撃、L宙返り、W加速、S減速、Z爆弾、Esc停止/再開。Normal/Easyの操縦差、銃の自動/手動差を維持。1射撃操作で機銃と機関砲を残弾に応じ発射し、別武器キーを増やさない
- タッチ既定(x,y,径,opacity): fire(.83,.84,96,.90)、loop(.83,.66,72,.78)、accelerate(.17,.84,76,.82)、brake(.17,.66,76,.82)、bomb(.39,.94,52,.88)。safe areaと8px余白でclampし、横長の径はKの規則を使用
- 操作設定は「タッチ配置」「キーボード」の2タブ。ボタンごとの横/縦/大きさ/不透明度、Normal/Easy別配置、共通キー割当、初期化、保存、破棄、「今回だけ使う」を保持。保存失敗でactive値を変更しない
- storageは `fantasia-controls-v1`、`fantasia-controls-easy-v1`、`fantasia-keyboard-v1`、`fantasia-records-v1`。他作品のstorageを読まない/書かない。未来versionを旧tabが上書きしない。エラー時はプレイ可能で明示的なsession-only選択を出す

## 2. プレイ体験と画面

### 2.1 核となるループ

7軍が自動進軍 → 自機で危険方面を読む → 砲台/竜/魔法兵を排除し突破口を作る → 味方地上軍が陣地を中立化・占領 → 別方面へ移動 → 奪還危機には防衛支援 → 7陣地同時所有で勝利。自機単独の全滅戦ではなく、地上軍が生きて前進できる時間を作るゲーム。

- 7方面は開始tickから同時に動く。画面外も同一tick、同一AI、同一ダメージ/占領規則で更新
- 最初の方面を選ぶ自由を守るため、基本地形・戦力・敵増援の時刻は7回対称とする。ID1だけ常に早く得をする逐次計算は禁止
- 陣地所有と砲台生死は独立。砲台を壊しても旗は変わらない。生存地上兵だけが占領でき、自機/竜/弾丸は占領人数に数えない
- 敵の全滅は勝利条件でない。増援全滅待ちを要求しない

### 2.2 8画面状態とHUD

1. ホーム: 7陣地・7軍・敵補填・勝敗条件、モード、出撃、設定、ヘルプ、音
2. Normal飛行HUD: 共通計器とタッチ5操作
3. Easy飛行HUD: 共通計器とタッチ2操作、照準円/自動射撃
4. 一時停止: 時計停止の説明、再開、再出撃、ホーム、設定、ヘルプ
5. タッチ配置設定: Normal/Easy切替、4項目、プレビュー、保存/破棄
6. キーボード設定: 割当、競合、取消、保存/破棄
7. 勝利結果: 記録タイム、加算ペナルティ、7陣地、スコア内訳、再出撃
8. 敗北結果: 理由、占領数、参考タイム、損失、再出撃。クリア記録へ保存しない

7陣地ストリップは上端の既存集計枠へ追加。各項目は番号、味方/敵/中立の文字または形、占領進捗、交戦警報、味方兵数/予備兵、次波までを表示。色のみで識別しない。狭い画面では2行(4+3)に折返し、中央照準領域へ被せない。操作ボタン追加や全面的な新ミニマップはv1では不要。既存radar様式へ陣地番号・敵竜・危険方向を追加し、詳細は停止画面で読む。

陣地を選ぶUIは情報注目だけに限定し、軍へ命令する機能や自動操縦を暗黙に追加しない。脅威警報は方向と予告を短く示し、同種通知を集約する。最重要の「自機狙い魔法」「竜火球」「陣地喪失」「軍壊滅」を優先。音OFFでも避けられる予告を必須とする。

## 3. 戦場・初期配置・データ単位

以下はv1初期設計値。後述のバランス受入で検証し、変える場合はconfigとテスト期待値を一緒に改版する。

- 座標: Kと同じm、+Y上、地上はXZ。固定論理60Hz、整数tick。ワールド中心(0,0)、プレイ境界はXZ半径2100m
- 陣地 `site-1..7`: 角度 `2π(i-1)/7`、半径1000m。中心yは地形高。占領円半径55m、敵増援門は同角度半径650m、味方出発点は半径1320m
- 基本道路は同角度の放射状3点（味方出発点→陣地→敵増援門）。7方面の経路長は同じ。装飾の城壁/森/丘は通路を塞がず、初期地形高は0..40m。射線遮蔽を持つ岩/壁は左右対称の固定配置
- 自機初期位置は中心上空y=300m、向きは出撃時固定でsite-1向き。機体姿勢/飛行モデルはKを保持。方面の初期向きによる差は回転比較で測る。ランキング比較時はmap/seed/start headingが一致すること
- 初期: 全7陣地owner=enemy、challenger=null、captureProgress=0、contested=false、砲台HP600が各1基。各方面enemy地上24体、friendly地上24体、enemy竜1体（計7体）
- 1軍地上24体の内訳: 剣12、弓5、魔法3、騎馬4。騎馬も1体は乗り手＋馬の一戦闘単位でHPを二重計上しない
- 地上の1体=独立HP/位置/target/cooldownを持つ論理ユニット。見た目の兵人数を論理人数より多く見せて計数しない。インスタンシングしても論理体数は変えない
- allyArmyIdは7つで固定。別方面へ救援しても元の軍IDを保持。敵はlaneIdとwaveOrdinalを持つ。IDはrun内で単調増加、死体やプール再利用で同じentity generationを再使用しない

### 3.1 最小状態契約

- Campaign: runId, rulesVersion, seed, mode, status, simTick, activeTicks, respawnPenaltyTicks, livesRemaining, sites[7], armies[7], reinforcementTickets, rngState, resultSnapshot
- Site: id, owner(enemy/friendly/neutral), ownerGeneration, challenger(null/enemy/friendly), captureProgress(0..100), turretId, contested, firstFriendlyCaptureTick, lastOwnerChangeTick
- Unit: entityId/generation, team, class(sword/bow/mage/cavalry/dragon), armyIdまたはlaneId, assignedSiteId, rescueMissionId, hp/maxHp, position, velocity, targetRef, attackReadyTick, movementState, origin(initial/reinforcement/rescue)
- Turret: siteId, hp, lifeState(active/destroyed), targetRef, phase(idle/telegraph/recovery), fireAtTick, lockedAim, cooldownUntilTick
- ReinforcementTicket: ticketId, sourceId, sourceGeneration, team, laneId, classCounts, reserveCost, scheduledTick, reservedCapacity, status(reserved/spawned/cancelled)
- RescueMission: missionId, donorSiteId, recipientSiteId, memberRefs（各armyIdを保持）, status(enroute/completed/failed), startedTick。1siteへのenroute任務は最大1件
- CombatEvent: eventId, tick, sourceRef, sourceTeamAtFire, targetRef, weapon, rawDamage, effectiveDamage, killCredit。二重適用を防ぐ

描画object、DOM参照、実時間、音状態を論理stateへ混ぜない。セーブデータへ私的な通信/運用情報を入れない。v1は途中セーブ無し、結果と操作設定のみローカル保存。

### 3.2 配置と衝突の固定データ

各laneは放射方向u、時計回り接線vを持つ。地上24体は剣12→弓5→魔法3→騎馬4の配列順、index jで6列4行、位置=anchor+v×((j%6)-2.5)×8m+u×(floor(j/6)-1.5)×10m。friendly anchorは半径1320m、enemy anchorはsite中心から内側30m。敵砲台はsite中心。歩兵は中心が地形+1mの半径0.8m球、騎馬は地形+1.5mの半径1.8m球、竜は位置中心の半径8m球、砲台は地形+6mの半径6m球を論理hit形状とする。自機は固定Kのcollision形状をP0で読み同じまま保持する。球より大きい装飾はdamage対象外と分かるよう過大にしない。

同team地上体の重なり回避は半径和+0.2m、敵対体は半径和まで。移動候補を同時計算し、対ごとの対称押戻しをstable pair順で適用する。砲台との初期重なりがあれば同lane接線方向の近い空き点へ8m刻みでずらし、その生成結果を固定fixtureに保存する。増援は同じ6列gridの若い空きslotから、5秒出現時の既存体との重なりを確認する。空きがないticketは最大120tick待機して再検査し、まだ不可ならcancel（味方予備兵/予約容量を返却、敵は次周期待ち）。ワープして占領円内へ出さない。

地上移動の目的点はassignedSite中心。陣地円へ入った後は6列gridの生存体slotに対応するsite内目標へ分散する。自軍の通常守備と同時攻撃には新しい乱数を使わない。初期爆弾1発の効果が配置順で変わらないよう配置/衝突fixtureも7回転比較する。

## 4. 兵科と戦闘

### 4.1 地上兵・竜の初期値

| 兵科 | HP | 速度m/s | 射程m | 基礎damage / 発射後回復 | 対象 |
| --- | ---: | ---: | ---: | --- | --- |
| 剣兵 | 40 | 5.5 | 3 | 10 / 0.8s | 地上兵のみ |
| 弓兵 | 30 | 5 | 95 | 8 / 1.4s | 地上兵、低空の竜/自機 |
| 魔法兵 | 32 | 4.5 | 115 | 14 / 2.4s | 地上兵、竜/自機 |
| 騎馬 | 100 | 12 | 4 | 20 / 1.2s | 地上兵のみ |
| 竜 | 180 | 巡航38、上限50 | 450 | 火球22 / 3s | 地上兵、自機 |
| 魔法砲台 | 600 | 固定 | 自機850、地上500 | 魔法弾30 / 4s | 敵対する自機/地上軍 |

遠距離射程は発射点と標的中心の3D距離。剣/騎馬の近接射程はmax(0,中心間3D距離−双方hit球半径)であり、大きな砲台へ接触しても攻撃不能にならない。地上占領距離だけXZ距離。弓/魔法兵の対空対象は地形からの高度120m以下、かつ3D射程内。射線は地形/固体障害物が遮断し、味方の視覚モデルは遮蔽物にしない。剣/騎馬が遠い空中目標へ攻撃しない。

- 基礎damageへの兵科倍率: 剣→弓1.25、弓→魔法1.25、魔法→騎馬1.5、騎馬→剣1.25、弓→騎馬0.7、その他1。同条件で両team同一。damageは非負整数、倍率適用後roundHalfUp、HPを0でclamp
- 騎馬は経路上を走り、瞬間移動や味方すり抜けワープをしない。v1では突撃の追加ボーナス/転倒/士気/クリティカルはなし
- 弓は速度90m/s、魔法兵弾は75m/s、火球は95m/s、砲台弾は160m/s。全て発射時の予測方向に直進、発射後の誘導無し。弓は見た目の弧と命中判定を一致させるためv1では直線の魔法補助矢と説明する
- 正確な予告tickは剣12、弓12、魔法兵36、騎馬18、竜54、砲台72。表の間隔は発射後の回復であり、最短周期は予告＋回復（剣60、弓96、魔法兵180、騎馬90、竜234tick）。地上兵の不発回復は30tick、竜60tick、砲台60tick。予告中は移動停止（竜は巡航継続）、対象死亡/射程外/遮蔽なら不発。弓は末尾6tick、魔法兵は末尾12tickで照準位置を固定し以後狙い直さない。近接は発効tickの距離を再確認
- 地上unit選敵は敵対・生存・射程・射線の適格者から、自己防衛（直近180tickの攻撃者）→兵科優先→距離→entityId。自己防衛候補が複数なら最後の被弾tickが新しい順、その後距離/ID。兵科優先は剣=弓/魔法/剣/騎馬/砲台、弓=魔法/空中（竜または自機）/剣/弓/騎馬/砲台、魔法=騎馬/空中/剣/弓/魔法/砲台、騎馬=剣/弓/魔法/騎馬/砲台。teamで存在しない対象は飛ばす。砲台/自機/竜の独自選敵は各節を優先。選敵は全地上兵共通のtick%12=0で行い、無効時は即時。ID順の処理で戦況を先に更新しない
- 近接攻撃は射程確認を発効tickで再実施。飛翔弾はswept collisionで手前の交差対象/障害物へ1回だけ当たり、TTLまたは地形/固体への衝突で消滅
- 同tick命中は対象ごとに合計して同時反映する。対象のtick開始HPをH、個々の防御適用後整数damageをd、合計Dとし、合計有効damage E=min(H,D)。各eventへfloor(E×d/D)を配賦、余りは小数剰余の大きい順、同値は低eventIdへ1ずつ配る（D=0は全0）。撃破クレジットは最大effectiveDamage、同値は低eventId。friendly撃破−100はこのcreditが自機の場合だけ。例: HP10の味方へ防御適用後自機30/敵10なら自機8・敵2、自機がkill creditを持ち誤射HP16点＋撃破100点の減点。勝利に撃破クレジットは不要
- 矢TTL120tick、魔法兵弾120tick。地上射撃は同team actorを通過、砲台/竜弾も同team actorを通過。自機弾はNormalで味方に命中して消滅、Easyで味方を通過。爆弾は物理接触した地形/固体で起爆し、味方actor自体では早期起爆しない。爆風は着弾点からtarget中心への固体/地形遮蔽があればdamage0。地面自己遮蔽を避け判定始点だけ地形法線へ0.1mずらす

### 4.2 魔法砲台の自機優先

砲台は初期敵専用で、破壊後は戦役中復活せず、味方兵に自動修理・乗っ取りさせない。friendly占領には砲台destroyedが必須。したがってfriendly所有の生きた敵砲台という状態は生成しない。

自機優先とは「砲台active、自機alive、同一run、自機が射程850m以内、射線あり、復活保護外」のとき、地上標的より必ず先に自機を選ぶこと。範囲外/遮蔽中/復活中の自機を追い続けて地上攻撃が永久停止するのは不正。

- 自機不適格なら射程500m内のfriendly地上兵。占領円内→砲台へ近い→IDの順
- idleで選択後telegraphを72tick。残り18tick時点で予測照準位置を固定し、予告線/着弾予測を表示。以後は狙い直さない
- 発射tickに発射主体生存、標的生存/同team関係、射程/射線を再確認。遮蔽などで無効なら不発、60tick回復。成功なら発射後240tick待機。telegraph込みの最短周期は5.2秒であり「4秒ごとに必ず命中」ではない
- 砲台弾は直撃30、爆風なし。地面/障害物で消滅、TTL6秒。複数砲台が同時に狙っても発射をカメラ外で省略しない
- 砲台HP0のtickで予告予約をcancel。既に出た弾は発射時teamを保持して通常継続。HP0が占領条件の一部になるが自動占領ではない

### 4.3 竜軍

- 7体初期、各lane最大2体、全体最大14体。巡回中心は担当陣地、高度はterrain+100..260m、旋回半径120..230m。飛行経路と火球originを同じ3D座標にする
- 自機が3D距離450m以内かつ射線ありなら自機を優先し、他は担当laneのfriendly地上兵を選ぶ。砲台と同じく不適格な自機に固執しない
- 予告54tick、末尾12tickで照準固定。直撃22、爆風半径10m・中心12→外縁0の線形減衰。直撃対象は22と爆風を重ねず大きい方だけ。自teamにはdamage0（自機の誤射は別規則）
- 火球は非誘導、TTL5秒。terrain・壁へ衝突した点で爆発。高速自機との判定は双方の移動線分を使いトンネルを防止
- 地上軍は遮蔽物へ退避するが、竜だけを追って占領路を永遠に離れない。自機が竜を優先撃墜して地上の損耗を減らす意味を持たせる
- 竜は占領、砲台修理、兵輸送をしない。敵拠点から無限発生して上限を破らない

### 4.4 自機武装・友軍被害・復活

- 機銃/機関砲の飛行中の発射挙動、弾数mg288/cannon96、双方空時の6秒再装填はKの方式を初期採用。地上兵/砲台/竜へのhit adapterを新設し、機体の銃口と一致させる。固定Kの実コード値としてmgは左右2発/5tick、cannonは左右2発/15tick、銃弾TTL90tick（1.5秒）。発射速度は自機速度+mg820m/s、cannon700m/s。両銃口分を同時確保して片側だけ残弾消費しない
- 地上兵/竜へのdamageはmg=4、cannon=12を初期案とする。砲台へのmg倍率0.25、cannon1。原型Kの対航空機damageと本作の設定を混同しない
- 爆弾2発、残弾0から30秒で2発補給、sim時計のみ進行。重力9.81m/s²、投下速度は自機速度を継承、TTL1800tick（30秒、期限時は不発で消滅し爆風なし）、爆風半径45m、最大damage240から外縁0へ線形減衰。直撃と爆風は同じ対象に二重適用しない。terrain heightと固体遮蔽を使用
- 爆弾ガイドは実際の弾道・最初の地形接触・爆風と同じ関数を使う。未来の敵位置を保証しない。魚雷/海面判定を残さない
- Normal: 自機の銃/爆弾はfriendly地上兵へ通常damageの25%（整数切上げ）。Easy: friendly damage0。どちらも味方色と危険爆風を表示。地上味方同士/敵同士の誤射は無し
- 自機HP100、初期残機3（現在機を含む）。撃墜/地形衝突で1減、0で敗北。別作品の50残機を本作指定扱いしない
- 残機ありなら3秒の復活演出に入り、全論理・戦役時計・増援・弾・占領を凍結。残機が1以上残る自機喪失が確定した時点で、respawnPenaltyTicksへ固定600tick（10秒）を一度だけ加算（そのtickで勝利し復活演出をしない場合も含む）。残機0の最終喪失は敗北のみで復活加算なし。復活演出で待った実時間は加算しない
- 復活候補は半径250m、角度2π(i-1)/7の7点、y=max(300,terrain+200)。候補と全敵弾の3D距離の最小値を求め、100m以上の候補のうち最大離隔を選ぶ。同値はrunのstart headingから時計回りの候補順。全候補が100m未満でも最大離隔を使い、下記2秒保護を必ず適用する。敵弾が無い場合は全候補の離隔を∞として候補順を使う。初期弾数/HPに復帰、爆弾も2発、2秒の保護（自機へのdamage0、砲台/竜の選敵対象外）。保護中は自機も攻撃不可、戦役は通常進行
- 自機がXZ半径2100mを越えると「作戦圏へ戻って」と600tickの帰還猶予を表示し、圏内へ戻ると猶予を600へreset。圏外の連続running tickだけ減少し0で1機喪失（復活/penaltyは撃墜と同じ）。強制旋回・カメラ切替・瞬間warpは行わず、pause/復活中は猶予を減らさない。地形衝突/HP0/圏外失敗が同tickならselfLoss eventは一つにまとめ残機/penaltyを一度だけ処理する（表示理由は地形衝突→HP0→圏外の順）。復活完了時は圏内なので猶予600へreset。地上/竜は経路制約で境界を越えず、弾は境界外でもTTL/地形接触まで存在する
- 自滅による補給が最速解にならないことを受入で測る。無敵表示を出し、pause等で保護残りtickを稼げない

## 5. 7軍の進軍・補充・救援

### 5.1 初期AI

各軍24体が独立行動するが、主目的地は担当陣地。開始時全7軍march状態。経路上に敵があれば交戦、倒せば前進。遮蔽・射程維持は道路から100m以内、追跡はassignedSiteIdの陣地から160m以内に制限し、遊兵化を防ぐ。陣地へ到達後は占領円内を優先し、弓/魔法も占領が必要なら円内へ入る。

敵地上兵にも同じ経路/追跡制限/選敵を適用する。enemy所有の担当siteではgarrison、neutral/friendlyならcapture/recaptureへ進む。enemyも味方兵が占領円内なら排除を優先し、その後旗へ戻る。経路閉塞が120tick続けば固定道路上の次の有効waypointへ再計画し、ワープせず移動する。

占領後はgarrisonで円内/周辺80mを防御。全軍を自機の後ろへ集めない。プレイヤーによる兵の直接操作・陣地指定命令は無い。

### 5.2 味方補充

各軍は初期24、通常上限32、初期予備兵24（剣12/弓5/魔法3/騎馬4）を持つ。Easyのみ予備兵48（剣24/弓10/魔法6/騎馬8）、戦場同時上限32は同じ。予備兵は有限で自動回復しない。

- 30秒=1800tickごと、armyId一致の生存+予約数（救援中/他site駐屯中も含む）が24未満なら不足数から最大8体を補充予約。class目標Tは剣12/弓5/魔法3/騎馬4、現数Cは同armyIdのalive+reserved。予備兵在庫>0かつC<Tのclassから不足率(T-C)/T最大を選び、同率は剣→弓→魔法→騎馬。1体ごとにCを増やして再計算し、候補がなくなれば8未満で止める。例: 全滅/全在庫ありの最初の8体は剣→弓→魔法→騎馬→剣→剣→弓→剣。予備兵の実在数以上は予約不可
- 予約から5秒後に味方出発点へ出現し自軍へ合流。予約時に予備兵と容量を確保し、cancel時は1回だけ戻す。残数が少ないclassで他classを捏造しない
- 軍全滅でも予備兵/予約があればregrouping。次回30秒周期を待ち、同じルールで再出現。HUDに「再編まで」を表示
- 自軍担当陣地がenemyへ戻っても味方の外縁出発点は独立であり補充は続く。敵基地ownerのコピーを使わない

### 5.3 隣軍救援と壊滅救済

armyIdは補充台帳の所属、assignedSiteIdは現在任務先である。地上unitは必ず双方を持つ。各方面はそのsiteへ割り当てられた生存friendly数（他軍からの救援を含む）、有効incoming rescue、元担当軍の予備兵/予約の有無で状態を求める。全て0ならdepleted。元軍が0でも救援到着後はdepletedではない。

- 未所有depleted方面へ、隣接するfriendly所有・非争奪のsiteに生存friendlyが12体以上いて、敵地上が160m内にいなければ6体派遣。各siteでassignedSiteId一致かつsiteから80m内の、rescue任務に参加中でない地上兵だけをeligible donorとする
- 救援先はdepleted開始tickが古い順。同時ならrunのstart headingを起点に時計回りsite順。支援元は経路長、同距離なら救援先から時計回りの隣接siteを優先。絶対ID1を優先する追加ルールを作らない
- 支援元のeligible donorはarmyId→entityId順で6体選び、最低6体を現地へ残す。rescueMissionIdを付与し、assignedSiteIdを受援先へ更新。兵を複製せずarmyIdと補充在庫の所属は変えない
- 全案件は同tick snapshotから割当候補を作り、確保済み兵を除外してcommitする。1支援元siteから1回6体、1受援siteに活動中(enroute)任務最大1件。派遣済み兵は他案件へ再選出しない。支援元の再派遣cooldown1800tick
- 救援隊は固定環状道路を移動し、到着後通常capture/garrison。到着前に6体全滅ならmission=failed、受援状態を再計算して再派遣を許す。到着後に全滅した場合も同じ。味方に自然消滅/転向を起こさない
- 救援任務の生存memberが1体以上で、その全員が受援site80m内へ到着したらmission=completed。元担当軍の復帰は要求しない。到着兵はassignedSiteIdとarmyIdを保持し、rescueMissionIdだけ外して通常のcapture/garrisonへ移る。到着兵が1体でもassignedSiteに生存すれば受援方面はdepletedでないため、補充の重複派遣は起きない。将来の救援選出は同じ12体/最低6体基準で、余剰兵がなければ再派遣しない
- 救援先が移動中にfriendlyになればそこを守備、支援元が奪還されても瞬間帰還しない。軍の補充はarmyId基準なので救援による新規無料兵を作らない
- 生存軍はいるが救援条件を満たせない場合は即敗北せず、自機支援で条件を作れる。永続膠着は20分期限で敗北とする

## 6. 占領状態機械

### 6.1 所有・争奪・中立化

ownerはenemy/friendly/neutral。captureProgressは「現在challengerが現ownerを中立化する進捗」または「neutralを確保する進捗」。0..100固定小数点（内部60000単位）で管理。

tick末の同時damage解決後、生存地上兵の中心が占領円XZ55m以内であれば各1人分。騎馬も1。自機・竜・砲台は人数0。毎tick最初にcontested=(両teamが1体以上)を再計算する。内部1点=600単位なので1人時25単位/tick、4人100、無人減衰50、owner回復100となり端数無し。下限0/上限60000でclamp、状態切替時に余りを持ち越さない。

- 両teamが1体以上: contested=true、進捗凍結。数の多い方が押し切るルールではない
- どちらも0: contested=false、既存進捗は毎秒5点で0へ戻る。ownerは保持し、0でchallenger=null
- owner側だけ: 敵challengerの進捗を毎秒10点で0へ戻し、0でchallenger=null。ownerだけで100へ自動回復する別メーターは作らない
- owner以外だけ: challengerをそのteamとし、毎秒 `2.5×min(人数,4)` 点進む（1人40秒、4人以上10秒）。ただしfriendly側は砲台active中は進捗を増やせない。砲台攻撃には別の兵AIを使う
- neutralの一方teamだけ: 同じ速度で確保。前challengerと逆teamなら既存進捗をまず同速度で0へ戻し、0到達時にchallengerを新teamへ替え、次tickから進める。敵が99まで進めた旗を味方が1秒で取れない
- enemy/friendly所有から100到達: owner=neutral、ownerGeneration++、progress=0、challengerを保持。次tickから確保を始める。1tickで二段階を飛び越えず余剰progressは捨てる
- neutralから100到達: owner=challenger、ownerGeneration++、progress=0、challenger=null。所有変化イベントを1回発行

砲台が生きたenemy陣地へfriendly地上だけが入ると「砲台制圧待ち」で停止。地上兵は射程/射線があれば砲台を敵targetとして攻撃可能（剣/騎馬も近接可、魔法→騎馬倍率など対兵科倍率は砲台に適用しない）。空爆だけで旗を動かすことはできない。

### 6.2 再占領

敵地上兵がfriendly陣地を中立化→enemy再占領できる。壊れた砲台は壊れたまま。占領数は現在owner=friendlyの個数であり、累計初占領回数ではない。初占領得点は各siteで一度だけ、奪還を繰返して稼げない。

占領地点に残った敵がゼロでも、外部から進行中の敵はそのまま存在する。owner変化で敵兵を消したり、味方へ転向させない。

## 7. 敵増援・容量・所有権変更

### 7.1 敵の継続補填

敵増援は壊せないマップ中央側の派遣門7箇所から来る。本部/門はv1の攻撃・占領対象ではなく、勝利条件を増やさない。陣地のownerが変わっても敵中央本部の圧力は止まらず、各laneへ奪還隊を派遣する。陣地内に突然湧かせず、必ず道路を移動させる。

- 全lane共通で45秒=2700tick周期。初回45秒。各laneのenemy地上生存+予約が32未満なら最大8体（剣4/弓2/魔法1/騎馬1）を予約
- 空きが8未満なら上記順の固定8スロット列から空き数を採用。0ならその波はskip。満員だった波を無限に蓄積せず、次の周期へ。これはゲームルール上限であり、性能に応じて変動させない
- 予約は300tick後に派遣門で出現。敵地上上限32×7=224。ownerを問わず同じ補填速度。初期24と上限32の差8を越えて出ない
- 竜は90秒=5400tick周期、各laneに最大1体、lane生存+予約<2の場合だけ予約し、300tick後に空中門terrain+180mへ出現。全体14上限。生存数分だけ補填し、無限累積しない
- モードでenemy波時刻/上限/HPは変えない。Easy差は操縦補助、友軍被害なし、予備兵増加に限定

### 7.2 所有権と予約の安全性

敵派遣門sourceは敵本部でowner不変。Site.ownerは派遣先の役割（防衛/奪還）を決めるだけで、予約teamを書き換えない。将来「陣地所有による現地補充」を追加する場合でも本書v1の予約契約を緩めない。

- 全ticketはsourceGenerationとrunIdを固定。dispatch直前にcampaign running、source有効、generation一致、reservedCapacityありを確認
- 目的地owner変化時、敵ticketはそのままenemyの奪還任務へ、味方ticketは自軍再編任務のまま。発生地点も変えない。旧ownerの現地spawnを行わない
- ownerGenerationはSiteの占領イベント/古いAI命令の無効化に使う。以前のsite命令を再処理して進捗/得点/予備兵を二重付与しない
- run終了/restartでは未出現ticketをcancelして資源/容量を一度だけ解放。古いtimer callbackが新runへ兵を追加できない設計にする。ブラウザsetTimeoutを出現の根拠にしない
- 同tickで出現予定と勝敗成立が衝突したら、§8の順序により勝敗確定を先に行い、terminalなら出現しない。生存上限の検査は予約数を含み、同時wave/救援で超過しない

### 7.3 最大論理負荷

- friendly地上: 7軍×32=224（救援は移動なので増えない）
- enemy地上: 7lane×32=224、enemy竜14、砲台7、自機1。最大戦闘actor470
- projectile論理poolは4096固定。保守見積りは全地上448体が最短遠距離周期96tick/TTL120tickで撃つ極端条件として448×(ceil(120/96)+1)=1344、竜14×(ceil(300/234)+1)=42、砲台7×(ceil(360/312)+1)=21、自機銃2×(ceil(90/5)+1)+2×(ceil(90/15)+1)=52、爆弾4、合計1463。銃定数の出典は固定Kの[mission.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/mission.ts#L10-L25)と[simulation.ts](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/src/simulation.ts#L241-L274)。これは論理容量の上限見積りであり、性能実測の合格ではない。実際の剣/騎馬は飛翔弾を持たないためさらに小さい。+1は同tick集中/出生順の余裕。実装で上限を越えたら明示的な仕様違反として停止/診断し、既発弾を黙って消したり残弾だけ消費しない
- 純演出particle/debrisだけは減らせる。論理兵・弾・射線・占領更新をカメラ外/低FPSで減らして性能合格にしない

## 8. 時計・tick順序・勝敗・得点

### 8.1 時計

- 初回の入力受付可能tickを0とする。loading、home、pause、settings、hidden、WebGL context lost、復活演出は論理停止。ready before startを守る
- activeTicksはrunningのtickだけ増加。recordTicks=activeTicks+respawnPenaltyTicks。表示は整数tick由来のmm:ss.cc（百分秒は切捨て）、比較は丸め前の整数tick
- pause後はaccumulatorをリセットし実時間の追いつき処理をしない。低FPS時のrunning中はtickを捨てず処理し、未処理accumulatorが0.25秒（15tick）を超えた時点で明示停止して性能失敗と記録する。残った未処理dtは凍結境界として破棄し、再開時に時計/敵の追いつき処理をしない。このrunは性能停止ありと明記し通常の最速記録には保存しない。時計だけ進める/敵だけ止めるを禁止
- 手動pauseは許容、戦況閲覧と設定可。オンライン競技の不正対策は非目標。pause回数を結果へ参考表示するが時間減点はしない
- 20分=72000activeTicksが作戦期限。復活加算はランキング用で期限判定に含めない。残り時間をHUDへ出し、残り120/30秒で通知

### 8.2 1tickの確定順序

1. running確認、入力を1回消費、tick開始snapshot（HP、cooldown、既存projectile）を取る
2. 自機/兵/竜とtick開始時に存在した弾を移動。地形/固体衝突、swept hit候補を計算し、移動後・damage前のcombat snapshotを固定する
3. tick番号tは開始時simTickとする。combat snapshotからidleかつt>=cooldownUntilの主体の選敵/予告開始を処理し、fireAt=t+予告tickを固定する。lockはt=fireAt−末尾lock tickで1回だけ記録する（近接はlock無し）。予告中に別targetへ替えない。適格射程/射線/targetを再確認し、予告満了の近接damageと既存弾hitを集める。近接の主体がこのtickの他攻撃で死亡しても最後の一撃は有効（相打ち可）。近接発効/不発もこのtでcooldownUntilを同じ規則により設定する。新規遠距離弾はまだ出さない
4. 対象ごとにdamageを同時配賦・反映、死亡/残機/砲台破壊/喪失penaltyを確定。dead主体の未発射予約をcancelする
5. 生存地上兵で7陣地を同時更新。activeTicksを1増加し、終局判定: (a)残機0または全地上再建不能の敗北、(b)全7friendly勝利、(c)期限敗北
6. terminalでなければ、生き残った主体の予告満了遠距離弾/自機入力射撃をcommit。標的の生存/適格性を再確認して不発判定。発射成功ならcooldownUntil=t+表の発射後回復tick、不発ならt+不発回復tickとし、以後はtとの比較で更新する。新規弾は次tickから移動・命中判定し、出生tickで移動距離を二重消費しない。砲台が同tick死亡なら発射0、前tick発射済み弾は残る
7. 同じくterminalでなければ補充予約・救援割当・due ticket出現を処理する。schedulerTickは手順5で加算後のactiveTicksとし、0では予約せず、最初の地上敵予約は2700、出現3000、味方予約1800/出現2100。予約時刻+300をscheduledTickへ記録し同じschedulerTick基準でdispatchする。残機あり自機喪失ならこのtick全ての確定後にrespawningへ遷移し、次tickから凍結。予約/出現もこのtickまで有効
8. simTick=t+1を確定し、immutable snapshot/eventをHUD/描画/音へ渡す。音や描画失敗で論理を巻戻さない。pause等の凍結中は1へ入らず、accumulatorを溜めない

遠距離予告満了と標的の射程離脱が同tickなら移動後combat snapshotで不発。近接は相打ち可、砲台/竜/弓/魔法の新規飛翔弾は死後発射不可という差をテストで明示する。発射点が固体内部なら不発（通常の不発回復）とし、出生時に複数敵を巻込む不定な即時hitを作らない。

同tickの相打ちで自機残機0なら敗北。最後の旗を取っても全地上軍が再建不能なら敗北。全7所有と期限が同tickなら勝利。残機あり撃墜と全7所有が同tickなら勝利（復活は開始せず、撃墜による10秒ペナルティは加える）。裁定はテストで固定する。

「全地上軍の再建不能」はfriendly生存0、全軍予備兵0、有効friendly ticket0をすべて満たすこと。救援は生存兵の移動なので0から作れない。1軍だけdepletedでも敗北しない。敵竜だけ残っていても全7所有で勝利。争奪中でもowner=friendlyなら所有と数えるが、最終tickでneutral化した地点は数えない。

### 8.3 タイムアタックと有限スコア

主記録は成功runのrecordTicks昇順。Normal/Easy、rulesVersion、mapVersion、seed、startHeadingで別記録。通常出撃seedは固定の20261005、startHeadingはsite-1向き。異なる検証seedは別記録として本番最速へ混ぜない。scoreは副指標でありタイムの順位を覆さない。同タイムならscore降順、その後は同順位。

スコア初期案:

- 各陣地の初friendly占領: 1000×最大7。誰が最後に旗へ入ったかによらずチーム成果
- 各初期砲台破壊: 300×最大7。再破壊はない
- 成功ボーナス: 5000。敗北は0
- 速さ: 成功時のみ `max(0, 12000 - floor(recordTicks / 60) × 10)`
- 味方へのeffectiveDamage: 自機起因の累計HP1ごとに−2。friendly撃破はさらに−100/体
- 自機喪失: −500/回（時間加算とは別）
- 最終値: max(0,上記整数合計)。v1上限26100。全て整数で明示内訳を表示

敵歩兵/騎馬/竜の撃破、増援撃破、再占領、防衛待機時間、HP回復、弾命中には加点しない。撃破統計は表示するが点数を混同しない。無限増援を待って稼ぐほど得になる設計を禁止。プレイヤーだけのlast-hit横取りを誘発しない。旧Kaisenの艦体HP貢献式は移植せず、本作の有限目的式を明記する。

## 9. 論理・描画・性能・品質

### 9.1 決定性と公平性

- 全戦場は60Hz。地上AI選敵は全軍共通12tick間隔、移動/弾/占領は毎tick。phaseをID順にずらして特定軍が先に交戦する優位を作らない。画面内外で同じ
- seed付きPRNGは論理用と描画用で分離。stable ID、安定ソート、同tick集計でリプレイ可能。日時、Math.random、非同期描画順が戦闘結果を変えない
- 空間hashは検索最適化だけ。全探索oracleと命中/占領/近傍結果が一致すること。高速弾は通過セルを全部走査
- 7方面回転置換試験では全position/heading/terrain/経路とtie起点を同じ角度回転し、IDは同じentityの対応として保持する。siteを循環改番する試験はID対応表も同時に置換する。同距離tieは絶対IDの大小ではなく変換後の相対順を用い、同一条件の無介入結果が同型になること。wave予約や同時captureのsite配列順による優遇を禁止
- start headingの有利はルールに固定し、同じ操縦リプレイを7回回転したとき戦果と時間が一致すること

### 9.2 性能予算（未測定の受入目標）

- 最低測定条件はdesktop=4物理core/8GB RAM/WebGL2、phone=4GB RAM/WebGL2。実装P0で利用可能な実機名とOS/browserを試験計画へ固定し、その端末の達成だけを主張する。これより古い/低性能端末の合格へ一般化しない
- 代表desktop: 1440×900、DPR1、60fps目標、p95 frame≤20ms、1論理tickのp95 simulation≤6ms
- 代表phone: 393×852/852×393、DPR3（内部上限1.5）、30fps最低、p95 frame≤33.3ms、1論理tickのp95 simulation≤10ms
- actor470と全lane最大発射状態を最低120秒計測、実機名/OS/browser/version/電源設定/描画DPR/論理数/弾数/frame分布を残す。エミュレーションだけなら実機合格を主張しない
- mesh instancing、共有geometry/material、object pool、粗密描画LOD、particle上限は可。自機heroモデル/カメラを簡略化しない。弾消去、敵数低下、画面外停止、AI難易度低下で性能達成しない
- 20分長期run、10連続restartでlistener/timer/mesh/texture/stateを漏らさず、初回安定後のメモリが単調増大しない。判定用dead actorは即active集合から除くが、統計の有限累計値を保持
- WebGL2非対応/文脈喪失/音声拒否/storage拒否/低メモリで空白画面にせず、Kのエラー導線を維持。音は明示操作後に開始し、ミュートは保存失敗してもsession反映可能

### 9.3 アセットと表示品質

陣地は旗・防壁・魔法砲台、剣/弓/杖/騎馬はsilhouetteと小さな役割マーク、竜は翼・首・尾で見分ける。敵味方はKの青緑/暖色marker＋形/ラベル。血液/残虐表現は不要。魔法の予告と本弾を別表現にし、火球を背景色へ埋没させない。

第三者素材は出典/ライセンスを確認して記録する。未確認素材のコピーや無断外部画像依存をしない。Kの著作権/third-party noticesは保持し、地形化の都合で削除しない。

## 10. 受入条件と証拠

全行は現在「未実装・未実行」。設計レビュー合格と、ゲーム受入合格を混同しない。テスト名は将来追加する案であり、存在済みのファイルとは扱わない。初期progress=0、予告満了と主体死亡/射程離脱、同tickoverkill配賦、救援中の再選出防止、Easy在庫、1人40秒厳密一致、勝利同tick喪失penaltyを必須境界ケースに含める。

| ID | 試験 | 合格条件 |
| --- | --- | --- |
| F-01 | 初期化/要求 | 7site、7turret、7army、初期地上168対168、竜7、自機1。型と画面が一致 |
| F-02 | K移植provenance | 固定SHA、ファイル別差分、許可差分台帳、ライセンス保持。独自UI置換なし |
| F-03 | 入力回帰 | Normal5/Easy2、キー10/7、cancel/blur/resize/同時pointer/設定復帰/連打/再出撃で持越し0 |
| F-04 | 設定保存 | 2タブ×4項目、競合拒否、保存失敗、未来version、session-only、専用storage |
| F-05 | 8画面実画像 | 旧新同一browser/version、viewport、DPR、文字倍率、mode/state/入力方式、保存値。共通UI比較と本作差分領域を別記録 |
| F-06 | 機体/カメラ実画像 | 正面/側面/背面/旋回、同姿勢・速度・時刻・光条件。heroモデル・塗装・投影を保持 |
| F-07 | スマホ/200% | 393×852、852×393、320×568、568×320、desktop。100/200%文字で操作/保存/破棄/閉じる到達、中心照準の遮蔽なし |
| F-08 | 兵科 | 全倍率、射程境界±epsilon、高度境界、遮蔽、最短cooldown、同tick相打ちを表駆動で検査 |
| F-09 | 砲台 | 適格自機優先、遮蔽/圏外fallback、予告72tick/lock18tick、破壊cancel、既発弾保持 |
| F-10 | 竜/火球 | 7→最大14、地上/自機target、予告/非誘導/地形接触/TTL/直撃爆風重複なし |
| F-11 | 占領 | 砲台破壊だけで旗変化なし、1/4人速度、双方凍結、無人減衰、二段階、逆team進捗相殺、再占領 |
| F-12 | 増援 | 45/90秒周期、5秒遅延、予約込み上限、満員skip、owner変更時にteam/出現点不変、restartで旧ticket0 |
| F-13 | 7軍 | 同時出発、有限補充、全滅再編、予備兵返却の冪等、6体救援/守備残し/二重割当なし |
| F-14 | 時計/勝敗 | pause/hidden/context lost/復活凍結、10秒加算、同tick優先順位、7同時所有、再建不能、20分期限 |
| F-15 | 得点 | 上限26100、初占領一度、増援/奪還稼ぎ0、誤射/自機損失減点、記録分離、storage拒否 |
| F-16 | 決定性 | 同seed/入力で10回同hash、30/60/120描画fps同hash、画面方向と表示LOD変更で同hash |
| F-17 | 回転公平性 | 7回転のstate同型、初動方面で予約/処理順有利がない。地形遮蔽と初期向きとrunの時計回りtie起点も回転 |
| F-18 | 性能/耐久 | 最大470actor、全弾負荷、120秒性能、20分run、10restart。論理削減なし |
| F-19 | 通しプレイ | 両modeで実入力経由の出撃→7方面支援→勝利、敗北→再出撃。state書換で勝利した映像は不可 |
| F-20 | 支援の価値 | 無介入、砲台先行、竜優先、危機防衛、1方面固執を同seed集合で比較。空爆のみ勝利不能、補充待ち稼ぎ無益 |

### 10.1 視覚証拠の必須記録

比較画像は基準Kと本作を同じ実行環境で生成し、固定baseline SHA、本作head SHA、状態、viewport、DPR、文字倍率、フォント解決結果、OS、browserを対応させる。8画面に加え、機体4方向/姿勢とNormal/Easy追従視界を保存。pause/resultは同等のUI状態、スコア内訳等は対応するゲーム固有データに置換したことを差分台帳へ記載する。

画面全体の差分率だけで合格しない。共通DOM/style領域と中央機体を人が実画像で確認し、許可差分（題名、地形、兵、竜、占領HUD、得点）以外のfont/色/余白/モデル/カメラ変化を拒否する。200%は文字拡大を実施し、単なるスクリーンショットの拡大で代用しない。環境が足りない、画像を見ていない、片側だけしか無い場合は未検証として残す。

### 10.2 バランス判定と改版

数値は面白さを保証する実測値ではない。固定seed最低10本で、各modeの初心者/熟練者リプレイを分けて検査する。初期目標は熟練Normalで4〜10分、初心者Easyで8〜16分。最初に選ばなかった6方面が30秒以内に自動壊滅する設計は不合格。無介入だけで全7占領が安定成立する設計も不合格。

砲台先行・竜優先・危機防衛の複数戦術に成功例を作り、1方面だけに居続ける戦術は他方面救援より安定最速にならないことを示す。全滅救援不能、永遠の補填による進捗0、復活補給の時間利益が見つかったら原因と修正値を記録する。未達を「調整で何とかする」と合格扱いせず、数値表/テスト/比較結果を更新した設計改版としてレビューする。

## 11. 実装着手時の停止条件

- 仕様の固定headと実装計画の固定参照が不一致
- K共通UI/機体/カメラを維持できず、別デザインでしか成立しない
- 7方面・470actorを論理削減しないと性能目標へ届かない
- 新たな外部送信、公開範囲、アカウント、権限、第三者有料素材が必要
- 既存内容の削除/損失上書きが必要、または未知のユーザー変更と競合

この場合は未達内容、影響、代替案を示して仕様判断へ戻る。未承認の実装・公開・配備・mergeへ進まない。
