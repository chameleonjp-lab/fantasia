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
interface PlacementInput { bounds: HudRect; size: Pick<HudRect, 'width' | 'height'>; preferred: Pick<HudRect, 'x' | 'y'>; obstacles: readonly HudRect[]; gap?: number }
function candidates({ bounds, size, preferred, obstacles, gap = 4 }: PlacementInput): HudRect[] | null {
  if (!valid(bounds) || !valid({ x: preferred.x, y: preferred.y, width: size.width, height: size.height }) || !Number.isFinite(gap) || gap < 0 || !obstacles.every(valid)) return null;
  const xs = new Set([preferred.x, bounds.x, bounds.x + bounds.width - size.width]);
  const ys = new Set([preferred.y, bounds.y, bounds.y + bounds.height - size.height]);
  for (const o of obstacles) { xs.add(o.x - size.width - gap); xs.add(o.x + o.width + gap); ys.add(o.y - size.height - gap); ys.add(o.y + o.height + gap); }
  const out: HudRect[] = [];
  for (const x of xs) for (const y of ys) {
    const r = { x, y, width: size.width, height: size.height };
    if (x < bounds.x || y < bounds.y || x + size.width > bounds.x + bounds.width || y + size.height > bounds.y + bounds.height) continue;
    if (!obstacles.some(o => intersects(r, o, gap))) out.push(r);
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
}
export interface HudLayout {
  status: 'placed' | 'blocked' | 'invalid';
  canvas: HudRect; bounds: HudRect; obstacles: HudObstacle[];
  radar: { status: Placement['status']; rect: HudRect; radius: number; center: { x: number; y: number } };
  threat: { status: Placement['status']; rect: HudRect } | null;
}
function fullSizeFallback(rect: HudRect, bounds: HudRect): HudRect {
  if (!valid(rect) || !valid(bounds)) return rect;
  // Keep failed placements on-screen when the complete box fits the viewport.
  // Oversized boxes remain full-sized/blocked, never clipped by this adapter.
  return { ...rect, x: Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - rect.width)),
    y: Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - rect.height)) };
}
export function layoutCampaignHud(measurement: HudMeasurement, sight: HudRect): HudLayout {
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
export interface HudLayoutHost {
  measure(): HudMeasurement;
  observe(invalidate: () => void): () => void;
  flush?(): void;
  applyThreat(rect: HudRect | null, canvas: HudRect): void;
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
    if (this.dirty || !this.measurement) { this.measurement = this.host.measure(); this.measurements++; this.dirty = false; }
    this.sightKey = key;
    this.layout = layoutCampaignHud(this.measurement, sight);
    // A blocked result keeps every item at its full size and remains a failure.
    this.host.applyThreat(this.layout.threat?.rect ?? null, this.layout.canvas);
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
  const selectors = '.hud-top, #campaign-sites .campaign-site[data-site], .flight-data, #payload-status, #reload-status, #warning, #announcement, #respawn-status, #flight-tip, #hud button';
  const probe = doc.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  app.append(probe);
  const original = threat ? ['--campaign-threat-left', '--campaign-threat-top'].map(name => [name, threat.style.getPropertyValue(name), threat.style.getPropertyPriority(name)]) : [];
  let mutation: MutationObserver | undefined;
  let handleRecords: (records: MutationRecord[]) => void = () => {};
  let ownThreatStyle = threat?.getAttribute('style');
  let containingOrigin: { x: number; y: number } | null = null;
  const visibleRect = (node: Element): HudRect | null => {
    if (node.closest('[hidden]') || !node.getClientRects().length) return null;
    const style = win.getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') return null;
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  };
  return new CampaignHudLayout({
    observe(invalidate) {
      const nodes = [...app.querySelectorAll<HTMLElement>(selectors), ...app.querySelectorAll<HTMLElement>('#campaign-sites'), ...(threat ? [threat] : [])];
      const resize = new ResizeObserver(invalidate);
      for (const node of [canvas, app, probe, ...nodes]) resize.observe(node);
      handleRecords = records => {
        if (records.some(record => {
          if (record.type !== 'attributes') return true;
          const node = record.target as Element, value = node.getAttribute(record.attributeName!);
          if (record.oldValue === value) return false;
          return !(node === threat && record.attributeName === 'style' && value === ownThreatStyle);
        })) invalidate();
      };
      mutation = new MutationObserver(handleRecords);
      for (const node of new Set<Element>([doc.documentElement, doc.body, app, ...nodes,
        ...app.querySelectorAll('#hud, #normal-controls, .bottom-controls')])) {
        mutation.observe(node, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style', 'data-mode', 'data-input'] });
      }
      // Site initialization and threat text affect geometry; steady instrument
      // text writes are handled by ResizeObserver only when their size changes.
      const sites = app.querySelector('#campaign-sites');
      if (sites) mutation.observe(sites, { childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style'] });
      if (threat) mutation.observe(threat, { childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style'] });
      win.addEventListener('resize', invalidate);
      doc.fonts?.addEventListener('loadingdone', invalidate);
      return () => {
        resize.disconnect(); mutation?.disconnect(); win.removeEventListener('resize', invalidate); doc.fonts?.removeEventListener('loadingdone', invalidate);
        probe.remove();
        for (const [name, value, priority] of original) { if (value) threat!.style.setProperty(name, value, priority); else threat!.style.removeProperty(name); }
      };
    },
    flush() { if (mutation) handleRecords(mutation.takeRecords()); },
    measure() {
      const c = canvas.getBoundingClientRect(), canvasRect = { x: c.x, y: c.y, width: c.width, height: c.height };
      const parent = threat?.offsetParent as HTMLElement | null;
      if (parent) {
        const p = parent.getBoundingClientRect();
        containingOrigin = { x: p.x + parent.clientLeft - parent.scrollLeft, y: p.y + parent.clientTop - parent.scrollTop };
      } else containingOrigin = null;
      const safe = win.getComputedStyle(probe);
      const inset = (value: string) => Math.max(8, Number.parseFloat(value) || 0);
      const left = inset(safe.paddingLeft), right = inset(safe.paddingRight), top = inset(safe.paddingTop), bottom = inset(safe.paddingBottom);
      const obstacles: HudObstacle[] = [];
      for (const node of app.querySelectorAll<HTMLElement>(selectors)) {
        const r = visibleRect(node); if (r) obstacles.push({ ...toCanvasRect(r, canvasRect), id: node.id || node.className });
      }
      const data = app.querySelector('.flight-data'), dataRect = data && visibleRect(data), threatRect = threat && visibleRect(threat);
      return { canvas: canvasRect, bounds: { x: left, y: top, width: c.width - left - right, height: c.height - top - bottom }, obstacles,
        flightData: dataRect ? toCanvasRect(dataRect, canvasRect) : null, threat: threatRect ? toCanvasRect(threatRect, canvasRect) : null };
    },
    applyThreat(rect, c) {
      if (!rect || !threat || !containingOrigin) return;
      const values = { '--campaign-threat-left': `${rect.x + c.x - containingOrigin.x}px`,
        '--campaign-threat-top': `${rect.y + c.y - containingOrigin.y}px` };
      for (const [name, value] of Object.entries(values)) if (threat.style.getPropertyValue(name) !== value) threat.style.setProperty(name, value);
      ownThreatStyle = threat.getAttribute('style');
    },
  });
}
