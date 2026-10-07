import type { Aircraft } from './types';
import type { CampaignState, SiteOwner } from './campaign-types';
import { CAPTURE_MAX, countClasses } from './campaign-config';

const OWNER_LABELS: Record<SiteOwner, string> = { friendly: '味方', enemy: '敵', neutral: '中立' };

export interface CampaignSiteReadout {
  id: number; number: number; owner: SiteOwner; ownerLabel: string; progress: number;
  friendly: number; enemy: number; reserves: number; turretHp: number; turretMaxHp: number;
  contested: boolean; depleted: boolean; stateLabel: string;
  friendlyWaveSeconds: number; enemyWaveSeconds: number; dragonWaveSeconds: number;
  friendlyDispatch: boolean; enemyDispatch: boolean; incomingRescue: number; ariaLabel: string;
}

function nextWave(state: CampaignState, laneId: number, team: 'friendly' | 'enemy', dragon = false) {
  const tickets = state.reinforcementTickets.filter(ticket => ticket.status === 'reserved' && ticket.team === team && ticket.laneId === laneId && (dragon ? ticket.dragonCount > 0 : countClasses(ticket.classCounts) > 0));
  if (tickets.length) return { seconds: Math.max(0, Math.ceil((Math.min(...tickets.map(ticket => ticket.scheduledTick)) - state.activeTicks) / 60)), dispatch: true };
  const period = team === 'friendly' ? 1800 : dragon ? 5400 : 2700;
  return { seconds: Math.ceil((period - state.activeTicks % period) / 60), dispatch: false };
}

/** Pure readout used by the DOM presenter and observation tests. */
export function campaignSiteReadouts(state: CampaignState): CampaignSiteReadout[] {
  const friendly = new Map<number, number>(), enemy = new Map<number, number>();
  for (const actor of state.actors) if (actor.hp > 0 && actor.kind === 'ground') {
    const counts = actor.team === 'friendly' ? friendly : enemy;
    counts.set(actor.assignedSiteId, (counts.get(actor.assignedSiteId) ?? 0) + 1);
  }
  return state.sites.map(site => {
    const army = state.armies.find(candidate => candidate.siteId === site.id);
    const turret = state.actors.find(actor => actor.id === site.turretId);
    const allied = friendly.get(site.id) ?? 0, hostile = enemy.get(site.id) ?? 0;
    const reserves = army?.reserveCount ?? 0, turretHp = Math.max(0, turret?.hp ?? 0);
    const incomingRescue = state.rescueMissions.filter(mission => mission.status === 'enroute' && mission.recipientSiteId === site.id)
      .reduce((count, mission) => count + mission.memberRefs.filter(ref => state.actors.some(actor => actor.id === ref.id && actor.generation === ref.generation && actor.hp > 0)).length, 0);
    const regrouping = allied === 0 && (reserves > 0 || (army?.reservedCapacity ?? 0) > 0);
    const depleted = allied === 0 && !regrouping && incomingRescue === 0;
    const stateLabel = site.contested ? '争奪' : incomingRescue > 0 ? '救援中' : depleted ? '軍壊滅' : regrouping ? '再編中'
      : turretHp > 0 ? '砲台あり' : site.challenger ? '占領中' : site.owner === 'friendly' ? '守備' : '砲台破壊';
    const wave = nextWave(state, site.id, 'friendly'), enemyWave = nextWave(state, site.id, 'enemy'), dragonWave = nextWave(state, site.id, 'enemy', true);
    const progress = Math.max(0, Math.min(100, Math.floor(site.progress / CAPTURE_MAX * 100)));
    const number = site.id + 1, ownerLabel = OWNER_LABELS[site.owner];
    return { id: site.id, number, owner: site.owner, ownerLabel, progress, friendly: allied, enemy: hostile, reserves,
      turretHp, turretMaxHp: turret?.maxHp ?? 600, contested: site.contested, depleted, stateLabel,
      friendlyWaveSeconds: wave.seconds, enemyWaveSeconds: enemyWave.seconds, dragonWaveSeconds: dragonWave.seconds,
      friendlyDispatch: wave.dispatch, enemyDispatch: enemyWave.dispatch, incomingRescue,
      ariaLabel: `陣地${number}、${ownerLabel}所有、${stateLabel}、占領進捗${progress}%、味方地上兵${allied}、敵地上兵${hostile}、予備兵${reserves}、砲台${turretHp > 0 ? `HP${turretHp}` : '破壊済み'}、味方${wave.dispatch ? '派遣' : '次の補充周期'}まで${wave.seconds}秒、敵${enemyWave.dispatch ? '派遣' : '次の補充周期'}まで${enemyWave.seconds}秒` };
  });
}

export function campaignThreatReadout(state: CampaignState): string {
  if (state.status === 'respawning') return '復活待機 · 戦役時計は停止中';
  if (state.player.protectionTicks > 0) return `復活保護 · 発砲できません · ${(state.player.protectionTicks / 60).toFixed(1)}秒`;
  const threats = state.actors.filter(actor => actor.hp > 0 && actor.team === 'enemy' && actor.phase === 'telegraph' && actor.targetRef?.id === state.player.id)
    .sort((a, b) => (a.class === 'turret' ? 0 : a.class === 'dragon' ? 1 : 2) - (b.class === 'turret' ? 0 : b.class === 'dragon' ? 1 : 2) || (a.fireAtTick ?? Infinity) - (b.fireAtTick ?? Infinity));
  if (threats.length) {
    const actor = threats[0], remaining = Math.max(0, ((actor.fireAtTick ?? state.simTick) - state.simTick) / 60);
    const name = actor.class === 'turret' ? '砲台の魔法' : actor.class === 'dragon' ? '竜の火球' : actor.class === 'bow' ? '弓兵の矢' : '地上の魔法';
    return `${name} · 自機を${actor.lockedAim ? '照準固定' : '照準中'} · 陣地${actor.laneId + 1} · ${remaining.toFixed(1)}秒${threats.length > 1 ? ` · ほか${threats.length - 1}` : ''}`;
  }
  const recaptured = state.sites.filter(site => site.owner === 'enemy' && site.firstFriendlyCaptureTick !== null && state.simTick - site.lastOwnerChangeTick <= 180);
  if (recaptured.length) return `陣地${recaptured.map(site => site.id + 1).join('・')}を喪失 · 地上軍を支援`;
  const depleted = campaignSiteReadouts(state).filter(site => site.depleted && site.owner !== 'friendly');
  if (depleted.length) return `陣地${depleted.map(site => site.number).join('・')}の軍が壊滅 · 隣軍の救援が必要`;
  return '';
}

interface SiteElements { root: HTMLElement; owner: HTMLElement; progress: HTMLElement; force: HTMLElement; wave: HTMLElement; state: HTMLElement; timing: HTMLElement }
const stripElements = new WeakMap<HTMLElement, Map<number, SiteElements>>();
const detailElements = new WeakMap<HTMLElement, Map<number, HTMLElement>>();

function setText(element: HTMLElement | null, value: string) { if (element && element.textContent !== value) element.textContent = value; }
function createStrip(container: HTMLElement, sites: readonly CampaignSiteReadout[]) {
  const elements = new Map<number, SiteElements>(), fragment = document.createDocumentFragment();
  for (const site of sites) {
    const root = document.createElement('div'); root.className = 'campaign-site'; root.dataset.site = String(site.number); root.setAttribute('role', 'listitem');
    const heading = document.createElement('div'); heading.className = 'campaign-site-heading';
    const number = document.createElement('b'); number.className = 'campaign-site-number'; number.textContent = String(site.number);
    const owner = document.createElement('span'); owner.className = 'campaign-site-owner'; heading.append(number, owner);
    const track = document.createElement('div'); track.className = 'campaign-site-progress'; track.setAttribute('aria-hidden', 'true');
    const progress = document.createElement('i'); track.append(progress);
    const force = document.createElement('span'); force.className = 'campaign-site-force';
    const wave = document.createElement('span'); wave.className = 'campaign-site-wave';
    const status = document.createElement('span'); status.className = 'campaign-site-state';
    const timing = document.createElement('span'); timing.className = 'campaign-site-timing';
    wave.append(status, timing);
    root.append(heading, track, force, wave); fragment.append(root); elements.set(site.id, { root, owner, progress, force, wave, state: status, timing });
  }
  container.replaceChildren(fragment); stripElements.set(container, elements); return elements;
}

/** Only campaign additions are owned here; main retains K's instruments and clock. */
export function updateCampaignHud(state: CampaignState, _player: Aircraft): void {
  const sites = campaignSiteReadouts(state), container = document.getElementById('campaign-sites');
  if (container) {
    const elements = stripElements.get(container) ?? createStrip(container, sites);
    for (const site of sites) {
      const entry = elements.get(site.id); if (!entry) continue;
      entry.root.dataset.owner = site.owner; entry.root.dataset.alert = site.contested ? 'contested' : site.depleted ? 'depleted' : 'normal';
      if (entry.root.getAttribute('aria-label') !== site.ariaLabel) entry.root.setAttribute('aria-label', site.ariaLabel);
      entry.root.title = site.ariaLabel;
      setText(entry.owner, `${site.ownerLabel}${site.contested ? ' ⚔' : site.depleted ? ' !' : ''}`);
      const width = `${site.progress}%`; if (entry.progress.style.width !== width) entry.progress.style.width = width;
      setText(entry.force, `友${site.friendly} / 予${site.reserves}`);
      setText(entry.state, site.stateLabel);
      setText(entry.timing, ` · ${site.friendlyDispatch ? '派' : '補'}${site.friendlyWaveSeconds}s`);
    }
  }
  const details = document.getElementById('pause-site-details');
  if (details) {
    let entries = detailElements.get(details);
    if (!entries) {
      entries = new Map(); const fragment = document.createDocumentFragment();
      for (const site of sites) { const row = document.createElement('p'); row.className = 'campaign-site-detail'; fragment.append(row); entries.set(site.id, row); }
      details.replaceChildren(fragment); detailElements.set(details, entries);
    }
    for (const site of sites) setText(entries.get(site.id) ?? null,
      `${site.number} ${site.ownerLabel} · ${site.stateLabel} · 占領${site.progress}%\n味方${site.friendly} / 敵${site.enemy} / 予備${site.reserves}${site.incomingRescue ? ` / 救援${site.incomingRescue}` : ''} · 砲台${site.turretHp > 0 ? `${site.turretHp}/${site.turretMaxHp}` : '破壊済み'}\n味方${site.friendlyDispatch ? '派遣' : '補充周期'}${site.friendlyWaveSeconds}秒 · 敵${site.enemyDispatch ? '派遣' : '補充周期'}${site.enemyWaveSeconds}秒 · 竜補充${site.dragonWaveSeconds}秒`);
  }
  setText(document.getElementById('reserves-count'), String(state.armies.reduce((count, army) => count + army.reserveCount, 0)));
  const threat = document.getElementById('campaign-threat');
  if (threat) { const message = campaignThreatReadout(state); setText(threat, message); threat.hidden = message === ''; }
}
