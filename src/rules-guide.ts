import type { GameMode } from './types';
import { containDialogTabFocus } from './dialog-focus';

export type GuideInput = 'touch' | 'keyboard';
export interface RulesContext { mode: GameMode; input: GuideInput; keyboardDescription: string; }
export interface RuleSection { heading: string; paragraphs: string[]; }

export function ruleSections({ mode, input, keyboardDescription }: RulesContext): RuleSection[] {
  return [
    { heading: 'ゲーム概要', paragraphs: [
      '剣と魔法の世界で、ゼロシリーズの戦闘機が味方7軍を空から支援します。7方面は出撃直後から同時に動き、画面の外でも戦いは続きます。',
      '魔法砲台や竜を倒して地上軍の突破口を作り、危険な方面を助けながら、7つの旗を味方でそろえるまでの時間を競います。味方軍は自動で進軍し、直接の命令や自動操縦はありません。',
      '上端の7陣地は番号・現在の所有者・占領進捗・交戦状態・味方兵と予備兵・次の敵増援を表示します。大きな「味方の旗」は現在の所有数です。詳しい戦況は一時停止画面で確認できます。',
    ] },
    { heading: '勝利と敗北', paragraphs: [
      '全7陣地を同時に味方が所有した瞬間に勝利です。砲台の破壊だけでは旗は変わりません。占領できるのは生存している地上兵で、自機や竜は占領人数に入りません。敵の全滅を待つ必要もありません。',
      '敵の旗を中立化してから味方の旗へ変えます。味方だけなら4人以上で各段階10秒、1人なら40秒です。敵味方が占領円にいる間は進捗が止まり、敵兵は味方の旗を奪い返すことができます。',
      '自機HPは100、残機は現在機を含む3機。HP0・地形への衝突・作戦圏外で10秒経過すると1機を失います。残機0、味方地上軍が予備兵も含めて再建不能、または作戦時間20分で敗北です。',
      '残機があれば戦況を凍結して3秒後に復活し、記録タイムへ10秒を加算します。復活後2秒は保護され、保護中は自機も攻撃できません。機体・弾数は回復しますが、自機喪失の減点と時間加算は残ります。',
      '一時停止中は作戦時間、敵、弾、占領や再装填も止まります。説明や設定を閉じても自動では再開しません。描画の遅れが0.25秒を超えた出撃は明示的に停止し、通常の最速記録へは保存しません。',
    ] },
    { heading: '7軍と敵の補填', paragraphs: [
      '各軍は剣兵12・弓兵5・魔法兵3・騎馬4の24体で出発します。騎馬も乗り手と馬を合わせて1体です。味方兵は担当陣地を占領し、占領後は守備に入ります。',
      '味方は30秒ごとに不足分から最大8体を予約し、5秒後に出発点から補充します。各軍の有限予備兵はノーマル24体、イージー48体。軍が全滅しても予備兵があれば再編できます。条件を満たした隣接陣地から6体の救援隊も出発します。',
      '敵地上兵は45秒ごとに各方面へ最大8体、竜は90秒ごとに不足分を予約し、5秒後に中央側の門から進軍します。旗を奪っても敵補填は続きます。各方面の地上兵は敵味方それぞれ最大32体、敵竜は各方面最大2体です。',
      '陣地ごとの魔法砲台は合計7基。自機が射程内なら優先して狙います。砲台は破壊すると復活せず、味方占領には砲台破壊が必要です。竜の火球と砲台の魔法は発射前に予告され、発射後はまっすぐ飛びます。予告を見て進路を変えてください。',
    ] },
    { heading: 'スコア', paragraphs: [
      '主記録は成功した出撃の「作戦時間＋復活加算」です。同タイムならスコアを比べます。イージーとノーマル、ルール・地図・seed・出撃方向ごとに別の記録として、この端末に保存します。敗北はクリア記録に保存しません。',
      '各陣地の初めての味方占領に1,000点、初期魔法砲台の破壊に300点。味方軍の攻撃でもチーム成果として加点します。敵兵・竜・増援の撃破や旗の再占領には加点しません。',
      '成功ボーナスは5,000点。速さボーナスは12,000点から記録時間の整数秒ごとに10点を引き、最低0点です。自機喪失は1回につき−500点。',
      mode === 'normal' ? 'ノーマルの自機による誤射は、味方へ実際に与えた損傷1HPにつき−2点、味方兵の撃破はさらに−100点です。' : 'イージーでは自機の攻撃による味方の損傷と誤射減点はありません。',
      '内訳は整数で表示し、合計がマイナスなら0点にします。スコア上限は26,100点です。記録や操作設定を外部へ送信する機能はありません。',
    ] },
    { heading: input === 'touch' ? 'スマートフォンの操作' : 'PCの操作', paragraphs: input === 'touch' ? [
      'ボタンのない場所に触れ、その位置からドラッグして操縦します。指を離すと操縦入力が戻ります。操縦しながら別の指でボタンを押せます。',
      mode === 'easy' ? 'イージーは照準円内・1.2km以内へ自動射撃します。弾道を見ながら相手の少し先へ向けてください。宙返りは「宙返り」ボタンです。' : 'ノーマルは「射撃」を長押しして撃ちます。「加速」「減速」も長押し、宙返りは「宙返り」ボタンです。弾の照準補助はありません。',
      '「宙返り」「爆弾」は押して指を離すと1回動作します。指が外れたり操作が中断された場合は動作しません。操作設定でボタンの配置・大きさ・不透明度をモード別に調整できます。',
    ] : [
      keyboardDescription,
      mode === 'easy' ? 'イージーは照準円内・1.2km以内へ自動射撃します。弾道を見ながら相手の少し先へ向けてください。' : 'ノーマルは射撃キーを押している間だけ撃ちます。加速・減速も長押しです。弾の照準補助はありません。',
      'マウスで画面をドラッグしても操縦できます。操作設定で各操作のキーを変更できます。宙返り・爆弾は1回のキー押下で1回だけ動作し、押し直すと次の操作になります。',
    ] },
    { heading: '空からの支援', paragraphs: [
      '1つの射撃操作で機銃と機関砲を残弾に応じて撃ちます。機銃288発、機関砲96発。両方を撃ち切ると6秒で再装填します。竜には機関砲、地上の集団には爆弾が有効です。',
      '爆弾は2発。自機の速度を引き継いで落下し、地形や障害物に触れると半径45mへ最大240損傷の爆風を起こします。爆弾の落下目安は現在の速度から計算した予測で、未来の敵の位置や命中を保証しません。2発を使い切ると作戦時間30秒で補給します。',
      '弓・魔法兵の対空攻撃は地形から120m以下です。低空では地形への衝突にも注意してください。砲台と竜の予告線・警報は音をオフにしても表示されます。',
      mode === 'normal' ? '味方兵は青緑の目印、敵は暖色の目印です。ノーマルの銃と爆風は味方兵へ通常の25%の損傷を与えるので、近くに味方がいる場所では投下位置を確認してください。' : '味方兵は青緑の目印、敵は暖色の目印です。イージーでは自機の銃と爆風で味方兵は傷つきません。',
    ] },
  ];
}

/** Native modal keeps focus and Escape inside the guide without resuming the mission. */
export class RulesGuide {
  private readonly dialog: HTMLDialogElement;
  private readonly content: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private readonly abort = new AbortController();
  get isOpen() { return this.dialog.open; }
  constructor(private readonly context: () => RulesContext, private readonly clearInput: () => void) {
    this.dialog = document.createElement('dialog'); this.dialog.id = 'rules-guide';
    this.dialog.className = 'rules-dialog'; this.dialog.setAttribute('aria-labelledby', 'rules-title');
    this.dialog.innerHTML = '<header class="rules-header"><div><p class="eyebrow">HOW TO PLAY</p><h2 id="rules-title">ルールと操作方法</h2></div><button type="button" id="rules-close" aria-label="説明を閉じる">×</button></header><div id="rules-content" class="rules-content" tabindex="0" role="region" aria-label="ルール説明の内容"></div><footer><button type="button" id="rules-back" class="primary">元の画面へ戻る</button></footer>';
    document.getElementById('app')!.append(this.dialog);
    this.content = this.dialog.querySelector('#rules-content')!;
    for (const id of ['rules-close', 'rules-back']) this.dialog.querySelector('#' + id)!.addEventListener('click', () => this.close(), { signal: this.abort.signal });
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); }, { signal: this.abort.signal });
    this.dialog.addEventListener('keydown', event => containDialogTabFocus(this.dialog, event), { signal: this.abort.signal });
    this.dialog.addEventListener('close', () => { this.clearInput(); this.returnFocus?.focus({ preventScroll: true }); }, { signal: this.abort.signal });
  }
  open(button: HTMLElement) {
    if (this.isOpen) return;
    this.returnFocus = button; this.clearInput(); this.content.replaceChildren();
    for (const section of ruleSections(this.context())) {
      const element = document.createElement('section'), heading = document.createElement('h3');
      heading.textContent = section.heading; element.append(heading);
      for (const text of section.paragraphs) { const p = document.createElement('p'); p.textContent = text; element.append(p); }
      this.content.append(element);
    }
    this.dialog.showModal(); this.content.scrollTop = 0;
    this.dialog.querySelector<HTMLButtonElement>('#rules-close')!.focus({ preventScroll: true });
  }
  close() { if (this.isOpen) this.dialog.close(); }
  dispose() { this.close(); this.abort.abort(); this.dialog.remove(); }
}
