# カイセン基準の共通UIと速度レバー統合

2026-10-07。利用者が承認した「派生作品の共通UIはカイセン基準」「マチマモレ・ウチオトセ・ファンタジアをレバー操作へ統一」のうち、最初のファンタジア候補です。

## 固定基点と変更範囲

- 製品基点: fantasia `a8bc9175f6b690d008ef716fe10735b0a64fde6d`、tree `1e7c2096845fba7621005e05ff48d389e56865cb`。PR #8で受け入れた詳細限定スクロールと既存34ケースを保持
- 共通入力参照: kaisen `519fd0d50dfb2ce9a1145c0b58a1301b5c74d032`
- 既存採用ハーネス参照: `2accbc6f062c6b7932777c61051df56a02302339`。参照するカイセン自身の採用版へ無断移行しない
- 共通契約v1 SHA-256: `cd0e7db83c54cf349fb6a178a8abcd22bf09f78376cb4b836784faa2ae721864`
- 共通35fixture SHA-256: `416c5ac01d4d14d1f45d94385e07233090740db04382e468db1f0c64689df8ca`
- 共通純関数 `src/throttle-lever.ts` SHA-256: `e83fe3c570581d16cb76e08ef9a039bbe9d4a50da6575366ac7e126bf3f30cf0`
- DOM制御の移植元 `src/throttle-control.ts` SHA-256: `99b45ef5b506ee7a051f80152bf3ce1dcf7a5f521a7c446f6021e76a67163466`

## 実装した接続

Normalの加速・減速2ボタンを速度レバー1本へ置換。射撃・宙返り・爆弾と合わせ4操作です。Easyは宙返り・爆弾の2操作、巡航と入力制限を維持します。PCの10操作とEasy有効7操作、キー再割当は維持します。

Input sample → FlightInput.throttle → CampaignFlightController → advanceThrottle → 既存空力へ接続します。明示0を優先し、値が未指定の旧入力だけaccelerate/brakeへ戻ります。範囲65〜141 m/s、最大変化18 m/s毎秒、8%deadzone、解放後の目標速度保持を変更しません。短いfocusキー入力は実際に消費する固定tickで一度だけ読み、ゼロtickのframeでは失わず、追付きで再生しません。

設定は作品専用v2キーへ明示Save時だけ保存します。v1 rawとキーボード形式、記録キーを保持します。未来版preflight、複数キーの失敗rollback、残存journalからの読取、Cancel、今回だけ使うを接続します。独立レビューで見つかった「失敗後Cancel→再open→未変更Saveでも復元再試行」と「terminal欠落後のprimary同ID再利用」を修正し、回帰検査を追加しました。

全幅シェル・明朝見出し・色・Home/ルール/設定/Pause/Result導線は既存カイセン系構造を維持します。ファイトフライトの620px profileは変更しません。7陣地・地上軍・竜・砲台・爆弾・勝敗・得点、現行暫定版の竜火球停止を保持します。魚雷を追加しません。

## 検査境界

既存34ケースを別の検査へ置き換えません。DOM inventoryと200%文字検査にsliderを追加し、詳細スクロール中のthrottle=0、操縦/射撃入力の中立を検査します。旧レイアウトfixtureは承認済み4操作とレバー長方形の実寸へ更新し、flight.tsの許可された2箇所の差分を逆変換して旧固定hashと照合します。

追加の実DOMレバー検査は独立configで実行します。複数pointerの通常操作はnative touch、短押しはnative Tab/keyboard、設定は実画面とStorageを使います。rollback拒否は明示したStorage故障注入です。stale-primaryのterminal欠落・同ID再利用は合成イベントの単体回帰であり、物理端末で再現したものではありません。

従来34の合格記録は基点の証拠です。候補の合否は同一headの新しいCI結果で判定します。通常時計の性能、自然な全編勝敗、物理iPhone、公開到達は別ゲートで、releaseReady=falseを保持します。ローカルブラウザーはsocket権限制限により起動前blockedでした。

## 復元

旧v1設定は読取のみ。移行後の設定が保存途中で失敗した場合、作品専用 `fantasia-controls-recovery-v1` の控えを維持し、不完全復元を成功扱いしません。ソースは固定基点と本候補の差分を保存し、必要時に専用branchの差分を戻せます。main/merge/本番公開は本作業に含みません。

## 同一head CIと証拠保全

既存workflowの標準ubuntu-latestを使います。verify jobは既存34件とレバー4件、active-critical jobは警告12件・39状態を別実行します。警告suiteは25分、個別case12分の上限、jobは35分です。verify jobは40分上限です。新しい有料runner・サービスは使いません。

既存34のartifact経路は維持します。追加4/12の原JSON・画像等は `supplemental-results` に分離します。レバー4件はjob logへgzipによる可逆圧縮後のbase64チャンクで記録します。警告12件は大容量logの接続取得失敗に対応して `fantasia-active-critical-verification` artifactに全記録を保存し、logには圧縮ファイルの復元参照と短い結果を出します。原本と圧縮後それぞれのbyte数・SHA-256、原JSON-pointer参照を持ち、同じ内容hashの重複だけを参照化します。取得後に圧縮後のhashとgzip展開した原本のhashを両方照合するまで、回収済み証拠とは呼びません。欠落・打切りは失敗として残します。PR #9の最初の警告結果が223MBとなり、無圧縮ログの記録が長引いたため、原本bytesを変えず転送量を減らしました。

追加reportは4件/12件のregistryを別集計し、retry/skip/重複/欠落/壊れた添付/誤ったoutcome/欠けた観測値を合格にしません。警告はbefore/afterの実状態と文字geometryも再判定します。復活待機はcallerが明示した時だけ別phaseを許可し、既存34のplaying既定は変更しません。

## 提出前の確認

2026-10-07の候補で、ローカル単体441件（失敗0・skip0）、production typecheck/build、追加browser/reportのstrict型検査、34件/4件/12件のcollectionを確認しました。実ブラウザーの新候補受入はCI前のため未確認です。固定基点から40path（追加19・変更21・削除0）。package.json/lock、戦役ルール・戦闘・CampaignFlightController・CampaignScene・機体・cameraの本体bytesは保持しています。独立レビューで見つけた所有/復元および検査接続の問題は修正し、最終レビューを別に記録します。


次版では、Easy設定説明に残っていた非搭載の魚雷文言を除き、宙返り・爆弾だけを案内します。非搭載操作の説明混入を防ぐ回帰を既存の設定テストへ追加しました。旧固定候補と保存ZIPは保持しています。


次の入力修正版では、W/S・再割当キー・短いタッチレバーも、実tickを消費するまで保留し、一度だけ速度へ反映します。解放した表示は中央へ戻り、clear/blur/mode/設定/世代交代、cancel/lostcaptureでは未消費調整を破棄します。すでに実tickで消費したholdは、解放で再生しません。共通純関数と35fixtureは同一bytesを保持し、DOM helperはこの契約補完を含む派生差分として識別します。44px高でhandle中心の移動長が0になるレバーは配置不可とし、入力可能と案内しません。

入力修正版のDOM制御 SHA-256: `90ab345e800df435f236abf7fb8e014c7b471f65fe04640d3f4d36be518bdefe`。

## PR #9の失敗修正（2026-10-08）

READMEの統合済み見出しと由来検査の期待値を一致させました。run `37695023486` の320×568・文字200%・Normalでは、実寸64×128のレバーが配置探索の最後に残り、120,000回上限に達していました。レバーの縦の場所を先に確保する順序へ修正し、原寸・隙間・探索上限を維持した実測fixtureの回帰検査を追加しています。

設定を保存してreloadした後の検査は、Homeのphaseだけでなく実rendererの準備完了を待ちます。キャンバスのmouse pointerdownで既定処理を止めた結果、詳細欄にkeyboard focusが残る問題は、受理したmouse操縦開始時にscrollを動かさずfocusを戻します。生きている別pointerやtouch/penからfocusを奪わない所有権検査を維持します。

復活待機中は作戦tickが止まるため、自機喪失の優先度5の案内が残り、復活保護の優先度4の案内を遮っていました。復活保護も優先度5にし、自然な墜落から実mainの3秒待機を経た表示交代を検査しています。活動警告の取得は実状態の必要な値をbrowser内で投影してから転送し、350actor全体と配置探索診断を毎frame転送する負担を減らしました。実native step、120秒/1,800frameの取得上限、45秒/120stepの表示上限、GPU fence、安全中断、期待文字・geometry判定は維持しています。同一headのCIで実画面の合否を確認します。

run `37697697512` は既存34/34・レバー4/4・単体445/445と各reportが成功しました。警告suiteは25分4秒で失敗終了し、25分の全体上限への到達が疑われます。記録ログの取得もTransport closedで繰り返し失敗したため、JSON添付自体も原本bytesをgzipで可逆圧縮し、reportで展開・元の全項目を検証します。圧縮データ破損・不正JSON・失敗outcomeの否定検査を追加しました。

自然な状態取得だけは実animation frameを4frame（64ms）ずつ進め、全frameを既存1,800frame上限に数えます。GPU完了をnative fenceで待ち、持続する条件の取得後は実16msの1frameを描画してから元の表示検査へ引き渡します。1tickの爆弾event取得は従来の16msのままです。120秒、1,800frame、25分、45秒/120step、39状態のoracleと表示検査、アプリのGPU queue、安全中断条件を緩めません。通常時計の性能測定とは扱いません。2frame版のrun `37701082485` でも全体上限付近で失敗し大容量logの取得ができなかったため、4frame版とダウンロード可能な記録経路へ進めています。
