/** HUD geometry is in canvas CSS pixels, never device/backing-store pixels. */
export interface HudRect { x: number; y: number; width: number; height: number }
export interface HudObstacle extends HudRect { id: string }
export type Placement = { status: 'placed'; rect: HudRect } | { status: 'blocked' | 'invalid'; reason: string };
export function intersects(a: HudRect, b: HudRect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
const valid = (r: HudRect) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
export function toCanvasRect(rect: HudRect, canvas: HudRect): HudRect {
  return { x: rect.x - canvas.x, y: rect.y - canvas.y, width: rect.width, height: rect.height };
}
/** Header height is measured, including enlarged text. */
export function campaignSiteStripTop(canvas: HudRect, bounds: HudRect, header: HudRect): number {
  const gap = canvas.width <= 360 && canvas.height > canvas.width ? 0 : 2;
  return Math.max(bounds.y, header.y + header.height + gap);
}
/** Keep portrait's 4+3 rows together; in landscape move only conflicting cards.
 * All dimensions are measured. No card, label or control is scaled. */
export function layoutCampaignSites(canvas: HudRect, bounds: HudRect, header: HudRect, cards: readonly HudRect[], sight: HudRect, controls: readonly HudRect[]): HudRect[] {
  if (!cards.length) return [];
  const rows: Array<{ y: number; cards: number[]; height: number }> = [];
  for (const [index, card] of cards.entries()) {
    let row = rows.find(row => Math.abs(row.y - card.y) < .5);
    if (!row) { row = { y: card.y, cards: [], height: 0 }; rows.push(row); }
    row.cards.push(index); row.height = Math.max(row.height, card.height);
  }
  rows.sort((a, b) => a.y - b.y);
  const base = Math.max(bounds.y, header.y + header.height + 2);
  let top = campaignSiteStripTop(canvas, bounds, header);
  if (rows[0].cards.some(index => intersects({ ...cards[index], y: top }, sight))) top = base;
  const center = { x: canvas.width / 2 - 42, y: canvas.height / 2 - 42, width: 84, height: 84 };
  const fixed = [header, sight, center, ...controls], result = cards.map(card => ({ ...card }));
  const occupied: HudRect[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const naturalGap = rowIndex ? Math.max(0, row.y - (rows[rowIndex - 1].y + rows[rowIndex - 1].height)) : 0;
    if (rowIndex) top = Math.max(...rows[rowIndex - 1].cards.map(index => result[index].y + result[index].height)) + naturalGap;
    if (canvas.height > canvas.width && canvas.width <= 393) {
      for (let attempts = 0; attempts <= fixed.length + occupied.length; attempts++) {
        const collisions = [...fixed, ...occupied].filter(obstacle => row.cards.some(index => intersects({ ...cards[index], y: top }, obstacle)));
        if (!collisions.length) break;
        top = Math.max(top, ...collisions.map(obstacle => obstacle.y + obstacle.height + 2));
      }
      for (const index of row.cards) { result[index].y = top; occupied.push(result[index]); }
    } else {
      const deferred: number[] = [];
      for (const index of row.cards) {
        const preferred = { ...cards[index], y: top };
        if ([...fixed, ...occupied].some(obstacle => intersects(preferred, obstacle))) deferred.push(index);
        else { result[index] = preferred; occupied.push(preferred); }
      }
      for (const index of deferred) {
        const preferred = { ...cards[index], y: top };
        const placement = placeRectangle({ bounds, size: preferred, preferred, obstacles: [...fixed, ...occupied], gap: 2 });
        result[index] = placement.status === 'placed' ? placement.rect : preferred;
        occupied.push(result[index]);
      }
    }
  }
  return result;
}
interface PlacementInput { bounds: HudRect; size: Pick<HudRect, 'width' | 'height'>; preferred: Pick<HudRect, 'x' | 'y'>; obstacles: readonly HudRect[]; gap?: number }
function candidates({ bounds, size, preferred, obstacles, gap = 4 }: PlacementInput, work?: { remaining: number }): HudRect[] | null {
  if (!valid(bounds) || !valid({ x: preferred.x, y: preferred.y, width: size.width, height: size.height }) || !Number.isFinite(gap) || gap < 0 || !obstacles.every(valid)) return null;
  const xs = new Set([preferred.x, bounds.x, bounds.x + bounds.width - size.width]);
  const ys = new Set([preferred.y, bounds.y, bounds.y + bounds.height - size.height]);
  for (const o of obstacles) { xs.add(o.x - size.width - gap); xs.add(o.x + o.width + gap); ys.add(o.y - size.height - gap); ys.add(o.y + o.height + gap); }
  const out: HudRect[] = [];
  for (const x of xs) for (const y of ys) {
    if (work && --work.remaining < 0) return [];
    const r = { x, y, width: size.width, height: size.height };
    if (x < bounds.x || y < bounds.y || x + size.width > bounds.x + bounds.width || y + size.height > bounds.y + bounds.height) continue;
    if (!obstacles.some(o => {
      if (work && --work.remaining < 0) return true;
      return intersects(r, o, gap);
    })) out.push(r);
    if (work && work.remaining < 0) return [];
  }
  return out.sort((a, b) => Math.hypot(a.x - preferred.x, a.y - preferred.y) - Math.hypot(b.x - preferred.x, b.y - preferred.y) || a.y - b.y || a.x - b.x);
}
export function placeRectangle(input: PlacementInput): Placement {
  const choices = candidates(input);
  return choices === null ? { status: 'invalid', reason: 'non-finite or invalid geometry' }
    : choices.length ? { status: 'placed', rect: choices[0] } : { status: 'blocked', reason: 'no full-size non-overlapping rectangle' };
}
export interface HudMeasurement {
  canvas: HudRect; bounds: HudRect; obstacles: HudObstacle[];
  flightData: HudRect | null; threat: HudRect | null;
  panels?: HudObstacle[];
}
export interface HudLayout {
  status: 'placed' | 'blocked' | 'invalid';
  canvas: HudRect; bounds: HudRect; obstacles: HudObstacle[];
  radar: { status: Placement['status']; rect: HudRect; radius: number; center: { x: number; y: number } };
  threat: { status: Placement['status']; rect: HudRect } | null;
  panels?: Array<{ id: string; status: Placement['status']; rect: HudRect }>;
  searchChecks?: number;
  fixedConflicts?: Array<{ first: string; second: string }>;
}
function fullSizeFallback(rect: HudRect, bounds: HudRect): HudRect {
  if (!valid(rect) || !valid(bounds)) return rect;
  // Keep failed placements on-screen when the complete box fits the viewport.
  // Oversized boxes remain full-sized/blocked, never clipped by this adapter.
  return { ...rect, x: Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - rect.width)),
    y: Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - rect.height)) };
}
export function layoutCampaignHud(measurement: HudMeasurement, sight: HudRect): HudLayout {
  if (measurement.panels) return layoutCampaignPanels(measurement, sight);
  const { canvas, bounds, flightData, threat } = measurement;
  const radius = canvas.width < 360 ? 42 : 49;
  // Keep the old circle and 16px caption budget, plus the 1px stroke fringe.
  const original = { x: canvas.width - radius * 2 - 19, y: Math.min(canvas.height * .33, 180) - radius - 1,
    width: radius * 2 + 2, height: radius * 2 + 18 };
  const obstacles = [...measurement.obstacles, { ...sight, id: 'aim-and-reload-ring' }];
  const radarChoices = candidates({ bounds, size: original, preferred: original, obstacles });
  const preferred = flightData ? { x: flightData.x, y: flightData.y + flightData.height + 8 } : threat;
  const threatChoices = threat && preferred ? candidates({ bounds, size: threat, preferred, obstacles }) : [];
  let radarRect = radarChoices?.[0] ?? fullSizeFallback(original, bounds);
  let threatRect = threatChoices?.[0] ?? (threat ? fullSizeFallback(threat, bounds) : null);
  let radarStatus: Placement['status'] = radarChoices === null ? 'invalid' : radarChoices.length ? 'placed' : 'blocked';
  let threatStatus: Placement['status'] = threatChoices === null ? 'invalid' : threat && !threatChoices.length ? 'blocked' : 'placed';
  if (threat && radarChoices?.length && threatChoices?.length) {
    // Consider both full-sized rectangles together: a greedy notification must
    // not consume the radar's only space when another legal pairing exists.
    let pair = false;
    for (const t of threatChoices) {
      const r = radarChoices.find(candidate => !intersects(candidate, t, 4));
      if (r) { radarRect = r; threatRect = t; pair = true; break; }
    }
    if (!pair) radarStatus = threatStatus = 'blocked';
  }
  const statuses = [radarStatus, threatStatus];
  return { status: statuses.includes('invalid') ? 'invalid' : statuses.includes('blocked') ? 'blocked' : 'placed',
    canvas, bounds, obstacles,
    radar: { status: radarStatus, rect: radarRect, radius, center: { x: radarRect.x + radius + 1, y: radarRect.y + radius + 1 } },
    threat: threatRect ? { status: threatStatus, rect: threatRect } : null };
}

/** Pack the full measured readouts, preserving controls and the actual sight.
 * The bounded search can report blocked; it never shrinks or drops a panel. */
function layoutCampaignPanels(measurement: HudMeasurement, sight: HudRect): HudLayout {
  const { canvas, bounds } = measurement, radius = canvas.width < 360 ? 42 : 49;
  const radar = { id: 'radar', x: canvas.width - radius * 2 - 19,
    y: Math.min(canvas.height * .33, 180) - radius - 1, width: radius * 2 + 2, height: radius * 2 + 18 };
  if (canvas.width <= 360 && canvas.height > canvas.width) { radar.x = bounds.x; radar.y = bounds.y; }
  const obstacles = [...measurement.obstacles,
    { id: 'central-flight-lane', x: canvas.width / 2 - 42, y: canvas.height / 2 - 42, width: 84, height: 84 },
    { ...sight, id: 'aim-and-reload-ring' }];
  const items = [radar, ...measurement.panels!].sort((a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id));
  const work = { remaining: 120_000 };
  let invalid = !valid(canvas) || !valid(bounds) || !items.every(valid) || !obstacles.every(valid);
  const sites = obstacles.filter(item => item.id.includes('campaign-site') || item.id.startsWith('site-'));
  const fixedConflicts = sites.flatMap(site => obstacles.filter(other => other !== site && intersects(site, other))
    .map(other => ({ first: site.id, second: other.id })));
  for (const site of sites) if (site.x < bounds.x || site.y < bounds.y || site.x + site.width > bounds.x + bounds.width || site.y + site.height > bounds.y + bounds.height) {
    fixedConflicts.push({ first: site.id, second: 'safe-bounds' });
  }
  const placed = new Map<string, HudRect>();
  const search = (index: number): boolean => {
    if (invalid) return false;
    if (index === items.length) return true;
    if (work.remaining <= 0) return false;
    const item = items[index], occupied = [...obstacles, ...placed.values()];
    // Most wide-screen readouts already fit. Try that position before spending
    // the bounded budget building every possible edge-coordinate combination.
    const preferredFits = item.x >= bounds.x && item.y >= bounds.y
      && item.x + item.width <= bounds.x + bounds.width && item.y + item.height <= bounds.y + bounds.height
      && occupied.every(obstacle => --work.remaining >= 0 && !intersects(item, obstacle, 4));
    if (preferredFits) {
      placed.set(item.id, item);
      if (search(index + 1)) return true;
      placed.delete(item.id);
    }
    const choices = candidates({ bounds, size: item, preferred: item, obstacles: occupied }, work);
    if (!choices) { invalid = true; return false; }
    for (const rect of choices) {
      if (preferredFits && rect.x === item.x && rect.y === item.y) continue;
      placed.set(item.id, rect);
      if (search(index + 1)) return true;
      placed.delete(item.id);
      if (work.remaining <= 0 || invalid) break;
    }
    return false;
  };
  const found = search(0);
  const status: Placement['status'] = invalid ? 'invalid' : found && !fixedConflicts.length ? 'placed' : 'blocked';
  const rectFor = (item: HudObstacle) => found ? placed.get(item.id)! : fullSizeFallback(item, bounds);
  const radarRect = rectFor(radar);
  const panels = measurement.panels!.map(item => ({ id: item.id, status, rect: rectFor(item) }));
  const threat = panels.find(panel => panel.id === 'campaign-threat');
  return { status, canvas, bounds, obstacles, panels, fixedConflicts, searchChecks: 120_000 - Math.max(0, work.remaining),
    radar: { status, rect: radarRect, radius, center: { x: radarRect.x + radius + 1, y: radarRect.y + radius + 1 } },
    threat: threat ? { status, rect: threat.rect } : null };
}
export interface HudLayoutHost {
  measure(sight: HudRect): HudMeasurement;
  observe(invalidate: () => void): () => void;
  flush?(): void;
  applyThreat(rect: HudRect | null, canvas: HudRect): void;
  applyPanels?(panels: NonNullable<HudLayout['panels']>): void;
}
/** Cached DOM measurement and a pure per-sight check; diagnostics never measure. */
export class CampaignHudLayout {
  private dirty = true;
  private disposed = false;
  private measurement: HudMeasurement | null = null;
  private layout: HudLayout | null = null;
  private sightKey = '';
  private measurements = 0;
  private readonly disconnect: () => void;
  constructor(private readonly host: HudLayoutHost) { this.disconnect = host.observe(() => this.invalidate()); }
  invalidate() { if (!this.disposed) this.dirty = true; }
  update(sight: HudRect): HudLayout | null {
    if (this.disposed) return this.layout;
    this.host.flush?.();
    // Projection round-off below a millionth of a CSS pixel is not a UI move.
    const key = [sight.x, sight.y, sight.width, sight.height].map(value => value.toFixed(6)).join(',');
    if (!this.dirty && key === this.sightKey) return this.layout;
    if (!this.dirty && valid(sight) && this.layout?.status === 'placed' && this.layout.panels
      && [this.layout.radar.rect, ...this.layout.panels.map(panel => panel.rect)].every(rect => !intersects(rect, sight, 4))
      && this.measurement!.obstacles.filter(item => item.id.includes('campaign-site') || item.id.startsWith('site-')).every(rect => !intersects(rect, sight))) {
      // A moving sight need not repack unchanged DOM. Keep stable labels until
      // its real footprint reaches one, while updating the diagnostic reserve.
      this.sightKey = key;
      this.layout = { ...this.layout, obstacles: [...this.layout.obstacles.filter(item => item.id !== 'aim-and-reload-ring'), { ...sight, id: 'aim-and-reload-ring' }] };
      return this.layout;
    }
    if (this.measurement?.panels && this.measurement.obstacles.some(item => item.id.includes('campaign-site') && intersects(item, sight))) this.dirty = true;
    if (this.dirty || !this.measurement) { this.measurement = this.host.measure(sight); this.measurements++; this.dirty = false; }
    this.sightKey = key;
    this.layout = layoutCampaignHud(this.measurement, sight);
    // A blocked result keeps every item at its full size and remains a failure.
    if (this.layout.panels) this.host.applyPanels?.(this.layout.panels);
    else this.host.applyThreat(this.layout.threat?.rect ?? null, this.layout.canvas);
    return this.layout;
  }
  diagnostics() { return { ...this.layout, measurements: this.measurements, disposed: this.disposed }; }
  dispose() { if (this.disposed) return; this.disposed = true; this.disconnect(); }
}

/** Scene-owned adapter. Observe geometry owners, not every changing HUD text. */
export function createCampaignHudLayout(canvas: HTMLCanvasElement): CampaignHudLayout {
  const doc = canvas.ownerDocument, win = doc.defaultView!;
  const app = canvas.closest<HTMLElement>('.fantasia-shell') ?? canvas.parentElement!;
  const threat = app.querySelector<HTMLElement>('#campaign-threat');
  const selectors = '.hud-top, #campaign-sites .campaign-site[data-site], #hud button';
  const panelSelectors = '.flight-data > *, .hud-top .time-block, #campaign-threat, #payload-status, #reload-status, #warning, #announcement, #respawn-status, #flight-tip';
  const panelNodes = [...app.querySelectorAll<HTMLElement>(panelSelectors)];
  const header = app.querySelector<HTMLElement>('.hud-top'), sites = app.querySelector<HTMLElement>('#campaign-sites');
  const time = app.querySelector<HTMLElement>('.hud-top .time-block');
  const panelId = (node: HTMLElement) => node.id || node.className;
  const properties = ['--campaign-hud-x', '--campaign-hud-y'];
  const original = new Map(panelNodes.map(node => [node, properties.map(name => [name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)])]));
  const ownStyles = new Map<Element, string | null>();
  const textContent = new Map(panelNodes.map(node => [node, node.textContent]));
  const natural = new Map<string, HudRect>();
  let compactTime = false;
  const probe = doc.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  app.append(probe);
  let mutation: MutationObserver | undefined;
  let handleRecords: (records: MutationRecord[]) => void = () => {};
  const visibleRect = (node: Element): HudRect | null => {
    if (node.closest('[hidden]') || !node.getClientRects().length) return null;
    const style = win.getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') return null;
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  };
  return new CampaignHudLayout({
    observe(invalidate) {
      const nodes = [...app.querySelectorAll<HTMLElement>(selectors), ...app.querySelectorAll<HTMLElement>('#campaign-sites'), ...panelNodes];
      const resize = new ResizeObserver(invalidate);
      for (const node of [canvas, app, probe, ...nodes]) resize.observe(node);
      handleRecords = records => {
        let changed = false;
        for (const record of records) {
          if (record.type !== 'attributes') {
            const panel = panelNodes.find(node => node === record.target || node.contains(record.target));
            if (!panel) { changed = true; continue; }
            const current = panel.textContent;
            if (textContent.get(panel) === current) continue;
            textContent.set(panel, current);
            // Outside compact portrait this clock stays in the fixed header.
            // Its numeric updates cannot invalidate an unmanaged panel; the
            // header ResizeObserver still detects actual geometry changes.
            if (panel === time && !compactTime) continue;
            // Numeric instruments change in flight without changing their box.
            // Inspect only the changed owner; do not repack every readout for
            // equal-size text, and process all signatures in this record batch.
            const rect = visibleRect(panel), before = natural.get(panelId(panel));
            if (Boolean(rect) !== Boolean(before) || (rect && before && (rect.width !== before.width || rect.height !== before.height))) changed = true;
            continue;
          }
          const node = record.target as Element, value = node.getAttribute(record.attributeName!);
          if (record.oldValue === value) continue;
          if (!(record.attributeName === 'style' && ownStyles.has(node) && value === ownStyles.get(node))) changed = true;
        }
        if (changed) invalidate();
      };
      mutation = new MutationObserver(handleRecords);
      for (const node of new Set<Element>([doc.documentElement, doc.body, app, ...nodes,
        ...app.querySelectorAll('#hud, #normal-controls, .bottom-controls')])) {
        mutation.observe(node, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style', 'data-mode', 'data-input'] });
      }
      // Site initialization and threat text affect geometry; steady instrument
      // text writes are handled by ResizeObserver only when their size changes.
      if (header) mutation.observe(header, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style'] });
      if (sites) mutation.observe(sites, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style'] });
      for (const panel of panelNodes) mutation.observe(panel, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style'] });
      win.addEventListener('resize', invalidate);
      doc.fonts?.addEventListener('loadingdone', invalidate);
      return () => {
        resize.disconnect(); mutation?.disconnect(); win.removeEventListener('resize', invalidate); doc.fonts?.removeEventListener('loadingdone', invalidate);
        probe.remove();
        for (const [node, values] of original) for (const [name, value, priority] of values) {
          if (value) node.style.setProperty(name, value, priority); else node.style.removeProperty(name);
        }
      };
    },
    flush() { if (mutation) handleRecords(mutation.takeRecords()); },
    measure(sight) {
      // Read natural CSS positions afresh on geometry changes. Individual
      // translate offsets preserve normal flow, wrapping and containing blocks.
      for (const node of panelNodes) {
        for (const name of properties) node.style.removeProperty(name);
        ownStyles.set(node, node.getAttribute('style'));
      }
      const siteNodes = [...app.querySelectorAll<HTMLElement>('#campaign-sites .campaign-site[data-site]')];
      for (const node of siteNodes) {
        const names = ['--campaign-site-x', '--campaign-site-y'];
        if (!original.has(node)) original.set(node, names.map(name => [name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]));
        for (const name of names) node.style.removeProperty(name);
        ownStyles.set(node, node.getAttribute('style'));
      }
      const c = canvas.getBoundingClientRect(), canvasRect = { x: c.x, y: c.y, width: c.width, height: c.height };
      compactTime = c.width <= 360 && c.height > c.width;
      const safe = win.getComputedStyle(probe);
      const inset = (value: string) => Math.max(8, Number.parseFloat(value) || 0);
      const left = inset(safe.paddingLeft), right = inset(safe.paddingRight), top = inset(safe.paddingTop), bottom = inset(safe.paddingBottom);
      const bounds = { x: left, y: top, width: c.width - left - right, height: c.height - top - bottom };
      const headerRect = header && visibleRect(header);
      if (headerRect && siteNodes.length) {
        const cards = siteNodes.map(node => toCanvasRect(node.getBoundingClientRect(), canvasRect));
        const controls = [...app.querySelectorAll<HTMLElement>('#hud button')].map(visibleRect).filter((rect): rect is HudRect => Boolean(rect)).map(rect => toCanvasRect(rect, canvasRect));
        const positions = layoutCampaignSites(canvasRect, bounds, toCanvasRect(headerRect, canvasRect), cards, sight, controls);
        for (const [index, node] of siteNodes.entries()) {
          node.style.setProperty('--campaign-site-x', `${positions[index].x - cards[index].x}px`);
          node.style.setProperty('--campaign-site-y', `${positions[index].y - cards[index].y}px`);
          ownStyles.set(node, node.getAttribute('style'));
        }
      }
      const obstacles: HudObstacle[] = [];
      for (const node of app.querySelectorAll<HTMLElement>(selectors)) {
        const r = visibleRect(node); if (r) obstacles.push({ ...toCanvasRect(r, canvasRect), id: node.id || node.className });
      }
      const panels: HudObstacle[] = [];
      natural.clear();
      for (const node of panelNodes) {
        if (node === time && !compactTime) continue;
        const r = visibleRect(node); if (!r) continue;
        const local = toCanvasRect(r, canvasRect), id = panelId(node);
        natural.set(id, local); panels.push({ ...local, id });
      }
      // Narrow portrait reflows individual readouts without changing their text.
      // Its ammo box remains the preferred notification anchor when the parent
      // is display:contents and therefore has no client rectangle of its own.
      const data = app.querySelector('.flight-data'), ammo = app.querySelector('.flight-data .ammo');
      const dataRect = (data && visibleRect(data)) || (ammo && visibleRect(ammo)), threatRect = threat && visibleRect(threat);
      return { canvas: canvasRect, bounds, obstacles,
        panels, flightData: dataRect ? toCanvasRect(dataRect, canvasRect) : null, threat: threatRect ? toCanvasRect(threatRect, canvasRect) : null };
    },
    applyThreat() {},
    applyPanels(panels) {
      for (const node of panelNodes) {
        const id = panelId(node), from = natural.get(id), to = panels.find(panel => panel.id === id)?.rect;
        if (!from || !to) continue;
        const values = { '--campaign-hud-x': `${to.x - from.x}px`, '--campaign-hud-y': `${to.y - from.y}px` };
        for (const [name, value] of Object.entries(values)) if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
        ownStyles.set(node, node.getAttribute('style'));
      }
    },
  });
}
