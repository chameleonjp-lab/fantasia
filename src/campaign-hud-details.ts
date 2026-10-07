/** Responsive details keep the original live nodes, so updates and accessibility
 * names cannot diverge from a hidden clone. Only secondary information scrolls. */
export class CampaignHudDetails {
  readonly viewport: HTMLElement;
  readonly mode: HTMLElement;
  readonly lives: HTMLElement | null;
  private readonly anchors = new Map<HTMLElement, Comment>();
  private readonly attributes = new Map<HTMLElement, Array<[string, string | null]>>();
  private readonly entries = new Map<HTMLElement, string>();
  private readonly siteGroups: HTMLElement[] = [];
  private readonly typography = new Map<HTMLElement, Array<[string, string, string, string]>>();
  private compact = false;
  private reparentRevision = 0;
  get layoutRevision() { return this.reparentRevision; }
  private readonly hud: HTMLElement;
  constructor(private readonly app: HTMLElement) {
    const doc = app.ownerDocument;
    this.hud = app.querySelector<HTMLElement>('#hud')!;
    this.viewport = doc.createElement('div');
    this.viewport.id = 'campaign-hud-details';
    this.viewport.hidden = true;
    this.viewport.tabIndex = 0;
    this.viewport.setAttribute('role', 'region');
    this.viewport.setAttribute('aria-label', '飛行・戦況の詳細（スクロール）');
    this.hud.append(this.viewport);
    this.mode = doc.createElement('div');
    this.mode.id = 'campaign-mode-status'; this.mode.hidden = true;
    this.hud.append(this.mode);
    this.lives = app.querySelector<HTMLElement>('#lives-count')?.parentElement ?? null;
    if (this.lives) this.remember(this.lives);
    const add = (selector: string, key: string) => {
      const node = app.querySelector<HTMLElement>(selector);
      if (node) { this.remember(node); this.entries.set(node, key); }
    };
    add('.time-block', 'timer'); add('.targets .target-tally', 'tallies');
    add('.flight-data .wingmen', 'wingmen'); add('.score-readout', 'score');
    add('#announcement', 'announcement-secondary'); add('#flight-tip', 'flight-tip');
    add('#loop-status', 'loop-status'); add('#bomb-hint', 'bomb-hint-secondary');
    const mode = app.querySelector<HTMLElement>('#hud-mode'); if (mode) this.remember(mode);
    const note = this.lives?.querySelector<HTMLElement>('small');
    if (note) { this.remember(note); this.entries.set(note, 'lives-note'); }
    // These seven headings exist before text-enlargement tests/OS font changes.
    // The original force/wave nodes join them when compact mode is activated.
    for (let i = 1; i <= 7; i++) {
      const group = doc.createElement('section');
      group.dataset.siteDetail = String(i); group.dataset.campaignDetail = `site-${i}`;
      group.tabIndex = 0; group.setAttribute('aria-label', `陣地${i}の詳細`);
      const heading = doc.createElement('b'); heading.textContent = `陣地${i}`;
      group.append(heading); this.viewport.append(group); this.siteGroups.push(group);
    }
  }
  private remember(node: HTMLElement) {
    if (this.anchors.has(node)) return;
    const anchor = node.ownerDocument.createComment('campaign detail position');
    node.before(anchor); this.anchors.set(node, anchor);
    this.attributes.set(node, ['tabindex', 'data-campaign-detail'].map(name => [name, node.getAttribute(name)]));
  }
  private move(node: HTMLElement, parent: HTMLElement, before: Node | null = null) {
    if (node.parentElement === parent) return;
    // Reparenting must not change inherited text sizes or selector-scoped fonts.
    for (const element of [node, ...node.querySelectorAll<HTMLElement>('*')]) {
      if (this.typography.has(element)) continue;
      const names = ['font-size', 'line-height', 'letter-spacing'];
      const style = element.ownerDocument.defaultView!.getComputedStyle(element);
      const values = names.map(name => style.getPropertyValue(name));
      this.typography.set(element, names.map((name, i) => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name), values[i]]));
      names.forEach((name, i) => element.style.setProperty(name, values[i]));
    }
    parent.insertBefore(node, before);
    this.reparentRevision++;
  }
  private restore(node: HTMLElement) {
    const anchor = this.anchors.get(node);
    if (anchor?.parentNode && anchor.nextSibling !== node) { anchor.after(node); this.reparentRevision++; }
    for (const [name, value] of this.attributes.get(node) ?? []) {
      if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
    }
  }
  sync(compact: boolean) {
    const changed = this.compact !== compact;
    if (changed) this.reparentRevision++;
    this.compact = compact;
    if (compact) this.app.dataset.campaignHud = 'compact'; else delete this.app.dataset.campaignHud;
    if (changed) { this.viewport.hidden = !compact; this.mode.hidden = !compact; }
    const mode = this.app.querySelector<HTMLElement>('#hud-mode');
    if (mode) { if (compact) { if (mode.parentElement !== this.mode) this.move(mode, this.mode); } else this.restore(mode); }
    if (this.lives) { if (compact) { if (this.lives.parentElement !== this.hud) this.move(this.lives, this.hud); } else this.restore(this.lives); }
    for (const [node, key] of this.entries) {
      const critical = node.dataset.campaignCritical === 'true';
      if (!compact) { this.restore(node); continue; }
      if (critical) {
        node.removeAttribute('data-campaign-detail'); node.removeAttribute('tabindex');
        if (node.parentElement !== this.hud) this.move(node, this.hud);
      } else {
        node.dataset.campaignDetail = key; node.tabIndex = 0;
        if (node.parentElement !== this.viewport) this.move(node, this.viewport, this.siteGroups[0]);
      }
    }
    for (const site of this.app.querySelectorAll<HTMLElement>('#campaign-sites [data-site]')) {
      const group = this.siteGroups[Number(site.dataset.site) - 1]; if (!group) continue;
      const status = site.querySelector<HTMLElement>('.campaign-site-state') ?? group.querySelector<HTMLElement>('.campaign-site-state');
      if (status) {
        this.remember(status);
        if (compact) this.move(status, site); else this.restore(status);
      }
      // Find them at their original site, or in the corresponding detail group.
      for (const selector of ['.campaign-site-force', '.campaign-site-wave']) {
        const node = site.querySelector<HTMLElement>(selector) ?? group.querySelector<HTMLElement>(selector);
        if (!node) continue;
        this.remember(node);
        if (compact) { if (node.parentElement !== group) this.move(node, group); } else this.restore(node);
      }
    }
    if (!compact) {
      for (const [element, styles] of this.typography) for (const [name, value, priority, applied] of styles) {
        // A user text-size update while compact owns its newer inline value.
        if (element.style.getPropertyValue(name) !== applied) continue;
        if (value) element.style.setProperty(name, value, priority); else element.style.removeProperty(name);
      }
      this.typography.clear();
    }
  }
  /** Assigning even the same scrollTop can cancel the browser's in-flight
   * native scroll. Repair reading state only after a real structural change. */
  restoreReading(beforeRevision: number, scrollTop: number, active: HTMLElement | null) {
    if (this.reparentRevision === beforeRevision) return;
    if (this.compact) {
      this.viewport.scrollTop = scrollTop;
      if (active) (this.contains(active) ? active : this.viewport).focus({ preventScroll: true });
    } else if (active) {
      // Full details are visible again; keyboard ownership stays on a HUD
      // operation instead of silently returning movement keys to the aircraft.
      this.app.querySelector<HTMLElement>('#pause')?.focus({ preventScroll: true });
    }
  }
  contains(node: Node) { return this.compact && this.viewport.contains(node); }
  dispose() {
    this.sync(false);
    for (const [node, anchor] of this.anchors) { this.restore(node); anchor.remove(); }
    this.viewport.remove(); this.mode.remove();
  }
}
