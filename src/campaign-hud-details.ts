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
  private readonly typography = new Map<HTMLElement, Array<{ name: string; originalValue: string; originalPriority: string; appliedValue: string; priorAppliedValue?: string }>>();
  private compact = false;
  private reparentRevision = 0;
  private typographyViewport = '';
  get layoutRevision() { return this.reparentRevision; }
  private readonly hud: HTMLElement;
  constructor(private readonly app: HTMLElement) {
    const doc = app.ownerDocument;
    this.typographyViewport = this.viewportKey();
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
    add('.flight-data .campaign-limit', 'campaign-limit'); add('.flight-data .ammo', 'ammo');
    add('#campaign-threat', 'campaign-threat'); add('#reload-status', 'reload-status');
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
      this.typography.set(element, names.map((name, i) => ({ name, originalValue: element.style.getPropertyValue(name),
        originalPriority: element.style.getPropertyPriority(name), appliedValue: values[i] })));
      names.forEach((name, i) => element.style.setProperty(name, values[i]));
    }
    parent.insertBefore(node, before);
    this.reparentRevision++;
  }
  private viewportKey() {
    const win = this.app?.ownerDocument?.defaultView;
    return win ? `${win.innerWidth}x${win.innerHeight}` : '';
  }
  /** Refresh only the CSS snapshots owned by reparenting. Active important
   * text-size overrides stay in place; their prior inline baseline is repaired
   * on the next sync after the override is removed. */
  private refreshTypographyForViewport() {
    const nextViewport = this.viewportKey();
    const viewportChanged = nextViewport !== this.typographyViewport;
    this.typographyViewport = nextViewport;
    const pending: Array<{
      element: HTMLElement;
      declarations: Array<{ name: string; originalValue: string; originalPriority: string; appliedValue: string; priorAppliedValue?: string }>;
      current: Array<{ value: string; priority: string }>;
      eligible: boolean[];
      baselines?: string[];
    }> = [];
    const roots = new Set<HTMLElement>();
    for (const [element, declarations] of this.typography) {
      if (!element.isConnected) continue;
      const current = declarations.map(declaration => ({
        value: element.style.getPropertyValue(declaration.name),
        priority: element.style.getPropertyPriority(declaration.name),
      }));
      const eligible = declarations.map((declaration, index) => viewportChanged
        && (current[index].value === declaration.appliedValue || current[index].value === declaration.priorAppliedValue
          || current[index].priority === 'important')
        || !viewportChanged && current[index].value === declaration.priorAppliedValue);
      if (!eligible.some(Boolean)) continue;
      pending.push({ element, declarations, current, eligible });
      let root: HTMLElement | null = element;
      while (root && !this.anchors.has(root)) root = root.parentElement;
      if (root) roots.add(root);
    }
    if (!pending.length) return;

    // A moved node must be measured under its original ancestors so responsive
    // selectors and inherited sizes still describe the source HUD at this
    // viewport. Comment markers preserve the exact current positions while the
    // live nodes are sampled; the nodes are returned before sync can yield.
    const depthAmong = (node: HTMLElement | null, candidates: Set<HTMLElement>) => {
      let depth = 0;
      for (let parent = node; parent; parent = parent.parentElement) if (candidates.has(parent)) depth++;
      return depth;
    };
    const orderedRoots = [...roots].map((root, order) => ({
      root, order,
      originalDepth: depthAmong(this.anchors.get(root)?.parentElement ?? null, roots),
      currentDepth: depthAmong(root.parentElement, roots),
    })).sort((a, b) => a.originalDepth - b.originalDepth || a.order - b.order);
    const placements: Array<{
      root: HTMLElement; marker: Comment; currentAttributes: Array<[string, string | null]>; currentDepth: number;
    }> = [];
    const scrollPositions = new Map<HTMLElement, { top: number; left: number }>();
    const rememberScrollAncestors = (node: Node | null) => {
      let parent = node instanceof HTMLElement ? node : node?.parentElement ?? null;
      while (parent) {
        if (!scrollPositions.has(parent)) scrollPositions.set(parent, { top: parent.scrollTop, left: parent.scrollLeft });
        parent = parent.parentElement;
      }
    };
    const active = this.app.ownerDocument.activeElement as HTMLElement | null;
    rememberScrollAncestors(this.viewport);
    for (const { root, currentDepth } of orderedRoots) {
      const anchor = this.anchors.get(root);
      const originalParent = anchor?.parentNode;
      if (!anchor || !originalParent) continue;
      rememberScrollAncestors(root.parentNode);
      rememberScrollAncestors(originalParent);
      const attributes = this.attributes.get(root) ?? [];
      const currentAttributes = attributes.map(([name]) => [name, root.getAttribute(name)] as [string, string | null]);
      const needsRestore = root.parentNode !== originalParent || anchor.nextSibling !== root
        || attributes.some(([name, value]) => root.getAttribute(name) !== value);
      if (!needsRestore) continue;
      const marker = root.ownerDocument.createComment('campaign typography position');
      root.parentNode?.insertBefore(marker, root);
      for (const [name, value] of attributes) {
        if (value === null) root.removeAttribute(name); else root.setAttribute(name, value);
      }
      anchor.after(root);
      placements.push({ root, marker, currentAttributes, currentDepth });
    }

    // Clear every owned declaration before reading any computed value. This
    // lets descendants inherit the new source-context baseline from parents.
    for (const item of pending) item.eligible.forEach((canSample, index) => {
      if (canSample) item.element.style.removeProperty(item.declarations[index].name);
    });
    for (const item of pending) {
      const computed = item.element.ownerDocument.defaultView!.getComputedStyle(item.element);
      item.baselines = item.declarations.map(declaration => computed.getPropertyValue(declaration.name));
    }
    for (const item of pending) item.eligible.forEach((canSample, index) => {
      const declaration = item.declarations[index], previousApplied = declaration.appliedValue;
      if (!canSample) return;
      const current = item.current[index];
      item.element.style.setProperty(declaration.name, current.value, current.priority);
      if (current.priority === 'important' && current.value !== previousApplied) {
        declaration.priorAppliedValue = previousApplied;
        declaration.appliedValue = item.baselines![index];
        return;
      }
      if (current.value === declaration.priorAppliedValue || current.value === previousApplied) {
        item.element.style.setProperty(declaration.name, item.baselines![index]);
        declaration.appliedValue = item.baselines![index];
        declaration.priorAppliedValue = undefined;
      }
    });

    placements.sort((a, b) => a.currentDepth - b.currentDepth);
    for (const placement of placements) {
      placement.marker.replaceWith(placement.root);
      for (const [name, value] of placement.currentAttributes) {
        if (value === null) placement.root.removeAttribute(name); else placement.root.setAttribute(name, value);
      }
    }
    for (const [element, position] of scrollPositions) {
      if (element.scrollTop !== position.top) element.scrollTop = position.top;
      if (element.scrollLeft !== position.left) element.scrollLeft = position.left;
    }
    if (active?.isConnected && this.app.ownerDocument.activeElement !== active) active.focus({ preventScroll: true });
  }
  private hasExternalTypographyOverride() {
    for (const [element, declarations] of this.typography) for (const declaration of declarations) {
      const value = element.style.getPropertyValue(declaration.name);
      const priority = element.style.getPropertyPriority(declaration.name);
      if (value !== declaration.appliedValue || priority === 'important') return true;
    }
    return false;
  }
  private restoreTypography() {
    for (const [element, declarations] of this.typography) for (const declaration of declarations) {
      if (element.style.getPropertyValue(declaration.name) !== declaration.appliedValue
        || element.style.getPropertyPriority(declaration.name) === 'important') continue;
      if (declaration.originalValue) element.style.setProperty(declaration.name, declaration.originalValue, declaration.originalPriority);
      else element.style.removeProperty(declaration.name);
    }
    this.typography.clear();
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
    this.refreshTypographyForViewport();
    // Viewport/mode review can probe full mode, then immediately return to
    // compact. Keep the original snapshots while a caller-owned important
    // text override is active; clearing them here would make that 200% size
    // become the next viewport's CSS baseline. Stable unmodified full mode is
    // still restored and released immediately.
    if (!compact && !this.hasExternalTypographyOverride()) this.restoreTypography();
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
    this.restoreTypography();
    for (const [node, anchor] of this.anchors) { this.restore(node); anchor.remove(); }
    this.viewport.remove(); this.mode.remove();
  }
}
