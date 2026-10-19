import { CampaignHudDetails } from './campaign-hud-details';
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
/** Compact cards stay permanently visible, but may move around the actual
 * sight. Unlike the full header layout, there is no enclosing header rectangle
 * to anchor them to. Keep every already-safe card at its natural position. */
export function layoutCompactCampaignSites(canvas: HudRect, bounds: HudRect, cards: readonly HudRect[], sight: HudRect): HudRect[] {
  const fixed = [sight, { x: canvas.width / 2 - 42, y: canvas.height / 2 - 42, width: 84, height: 84 }];
  const result = cards.map(card => ({ ...card }));
  const deferred: number[] = [], occupied: HudRect[] = [...fixed];
  for (const [index, card] of cards.entries()) {
    if (card.x < bounds.x || card.y < bounds.y || card.x + card.width > bounds.x + bounds.width || card.y + card.height > bounds.y + bounds.height
      || occupied.some(obstacle => intersects(card, obstacle))) deferred.push(index);
    else occupied.push(card);
  }
  for (const index of deferred) {
    const placement = placeRectangle({ bounds, size: cards[index], preferred: cards[index], obstacles: occupied, gap: 2 });
    if (placement.status === 'placed') result[index] = placement.rect;
    occupied.push(result[index]);
  }
  return result;
}
interface PlacementInput { bounds: HudRect; size: Pick<HudRect, 'width' | 'height'>; preferred: Pick<HudRect, 'x' | 'y'>; obstacles: readonly HudRect[]; gap?: number }
/** Enumerate edge-aligned positions in preference order, then inspect collisions
 * lazily. Eagerly testing the entire coordinate grid exhausted the bounded
 * search even when its first candidate led directly to a complete packing. */
function candidatePositions({ bounds, size, preferred, obstacles, gap = 4 }: PlacementInput): HudRect[] | null {
  if (!valid(bounds) || !valid({ x: preferred.x, y: preferred.y, width: size.width, height: size.height }) || !Number.isFinite(gap) || gap < 0 || !obstacles.every(valid)) return null;
  const xs = new Set([preferred.x, bounds.x, bounds.x + bounds.width - size.width]);
  const ys = new Set([preferred.y, bounds.y, bounds.y + bounds.height - size.height]);
  for (const o of obstacles) { xs.add(o.x - size.width - gap); xs.add(o.x + o.width + gap); ys.add(o.y - size.height - gap); ys.add(o.y + o.height + gap); }
  const out: HudRect[] = [];
  for (const x of xs) for (const y of ys) {
    if (x < bounds.x || y < bounds.y || x + size.width > bounds.x + bounds.width || y + size.height > bounds.y + bounds.height) continue;
    out.push({ x, y, width: size.width, height: size.height });
  }
  return out.sort((a, b) => Math.hypot(a.x - preferred.x, a.y - preferred.y) - Math.hypot(b.x - preferred.x, b.y - preferred.y) || a.y - b.y || a.x - b.x);
}
function candidates(input: PlacementInput): HudRect[] | null {
  return candidatePositions(input)?.filter(rect => !input.obstacles.some(obstacle => intersects(rect, obstacle, input.gap ?? 4))) ?? null;
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
  movableControls?: HudObstacle[];
  canvasLabels?: HudObstacle[];
}
export interface HudLayout {
  status: 'placed' | 'blocked' | 'invalid';
  canvas: HudRect; bounds: HudRect; obstacles: HudObstacle[];
  radar: { status: Placement['status']; rect: HudRect; radius: number; center: { x: number; y: number } };
  threat: { status: Placement['status']; rect: HudRect } | null;
  panels?: Array<{ id: string; status: Placement['status']; rect: HudRect }>;
  controls?: Array<{ id: string; rect: HudRect }>;
  canvasLabels?: Array<{ id: string; status: Placement['status']; rect: HudRect }>;
  compact?: boolean;
  searchChecks?: number;
  searchLimit?: number;
  primarySearchChecks?: number;
  recoverySearchChecks?: number;
  fixedConflicts?: Array<{ first: string; second: string }>;
}
function fullSizeFallback(rect: HudRect, bounds: HudRect): HudRect {
  if (!valid(rect) || !valid(bounds)) return rect;
  // Keep failed placements on-screen when the complete box fits the viewport.
  // Oversized boxes remain full-sized/blocked, never clipped by this adapter.
  return { ...rect, x: Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - rect.width)),
    y: Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - rect.height)) };
}
export function layoutCampaignCanvasLabel(layout: HudLayout | null, preferred: HudRect): { status: Placement['status']; rect: HudRect } {
  if (!layout) return { status: 'blocked', rect: preferred };
  const obstacles = [...layout.obstacles, layout.radar.rect, ...(layout.panels?.map(panel => panel.rect) ?? []),
    ...(layout.threat && !layout.panels ? [layout.threat.rect] : [])];
  const { bounds } = layout;
  if (!valid(bounds) || !valid(preferred) || !obstacles.every(valid)) return { status: 'invalid', rect: fullSizeFallback(preferred, bounds) };
  if (valid(preferred) && preferred.x >= bounds.x && preferred.y >= bounds.y
    && preferred.x + preferred.width <= bounds.x + bounds.width && preferred.y + preferred.height <= bounds.y + bounds.height
    && !obstacles.some(rect => intersects(preferred, rect, 4))) return { status: 'placed', rect: preferred };
  const placed = placeRectangle({ bounds, size: preferred, preferred, obstacles });
  return placed.status === 'placed' ? placed : { status: placed.status, rect: fullSizeFallback(preferred, bounds) };
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
const isFixedControl = (id: string) => ['game-sound', 'pause', 'bomb', 'loop', 'fire', 'throttle'].includes(id);
/** Relative semantic regions; no stored screen coordinates or item sizes.
 * This optional schema is not a complete rectangle packer. Every proposal
 * remains subject to the same exact gaps, bounds and shared recovery budget. */
export function packSemanticRegions(bounds: HudRect, obstacles: readonly HudObstacle[], items: readonly HudObstacle[], work: { remaining: number }): Map<string, HudRect> | null {
  if (!Number.isSafeInteger(work.remaining) || work.remaining < 0 || work.remaining > 6_000) return null;
  const roles: string[] = ["health-label", "health-track", "instrument", "campaign-limit", "ammo", "campaign-threat", "reload-status", "warning", "announcement", "campaign-hud-details", "campaign-mode-status", "target-tally", "game-sound", "pause", "bomb", "loop", "fire", "throttle", "radar"];
  const fixedRoles: string[] = ["central-flight-lane", "aim-and-reload-ring"];
  const horizontal: [string, string][] = [["health-label", "radar"], ["instrument", "announcement"], ["instrument", "game-sound"], ["campaign-limit", "bomb"], ["reload-status", "pause"], ["reload-status", "loop"], ["warning", "throttle"], ["announcement", "campaign-mode-status"], ["game-sound", "warning"], ["pause", "campaign-limit"], ["bomb", "target-tally"], ["loop", "health-track"], ["fire", "instrument"], ["central-flight-lane", "campaign-hud-details"], ["aim-and-reload-ring", "health-label"]];
  const vertical: [string, string][] = [["health-label", "campaign-hud-details"], ["health-track", "health-label"], ["campaign-limit", "game-sound"], ["ammo", "instrument"], ["ammo", "fire"], ["campaign-threat", "reload-status"], ["reload-status", "ammo"], ["warning", "campaign-mode-status"], ["campaign-hud-details", "bomb"], ["target-tally", "warning"], ["game-sound", "announcement"], ["loop", "pause"], ["radar", "target-tally"], ["radar", "throttle"], ["central-flight-lane", "campaign-limit"]];
  if (bounds.width <= bounds.height || items.length !== roles.length || obstacles.length !== 9) return null;
  const movable = new Map(items.map(item => [item.id, { ...item }]));
  const fixedItems = obstacles.filter(item => item.id !== 'campaign-site');
  const fixed = new Map(fixedItems.map(item => [item.id, item]));
  if (movable.size !== roles.length || fixedItems.length !== fixedRoles.length || fixed.size !== fixedRoles.length
    || roles.some(id => !movable.has(id)) || fixedRoles.some(id => !fixed.has(id))) return null;
  const spend = () => work.remaining > 0 && (--work.remaining, true);
  for (const rect of [bounds, ...items, ...obstacles]) {
    if (!spend() || !valid(rect)) return null;
  }
  let top = bounds.y;
  for (const item of obstacles) {
    if (!spend()) return null;
    if (item.id === 'campaign-site') top = Math.max(top, item.y + item.height + 4);
  }
  const all = new Map([...movable, ...fixed]);
  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'width' : 'height';
    const edges = axis === 'x' ? horizontal : vertical;
    const lower = axis === 'x' ? bounds.x : top, upper = bounds[axis] + bounds[size];
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
    const outgoing = new Map<string, string[]>(), degree = new Map<string, number>(), value = new Map<string, number>();
    for (const [id, item] of all) {
      if (!spend()) return null;
      outgoing.set(id, []); degree.set(id, 0); value.set(id, fixed.has(id) ? item[axis] : lower);
    }
    for (const [from, to] of edges) {
      if (!spend()) return null;
      outgoing.get(from)!.push(to); degree.set(to, degree.get(to)! + 1);
    }
    const queue = [...all.keys()].filter(id => degree.get(id) === 0);
    let seen = 0;
    while (queue.length) {
      if (!spend()) return null;
      const from = queue.shift()!; seen++;
      for (const to of outgoing.get(from)!) {
        if (!spend()) return null;
        const need = value.get(from)! + all.get(from)![size] + 4;
        if (fixed.has(to)) { if (need > value.get(to)!) return null; }
        else value.set(to, Math.max(value.get(to)!, Math.ceil(need * 64) / 64));
        degree.set(to, degree.get(to)! - 1);
        if (degree.get(to) === 0) queue.push(to);
      }
    }
    if (seen !== all.size) return null;
    for (const [id, item] of movable) {
      if (!spend()) return null;
      const position = value.get(id)!;
      if (!Number.isFinite(position) || position < lower || position + item[size] > upper) return null;
      item[axis] = position;
    }
  }
  const result = [...movable.values()];
  for (let i = 0; i < result.length; i++) {
    for (const other of [...obstacles, ...result.slice(0, i)]) {
      if (!spend()) return null;
      if (intersects(result[i], other, 4)) return null;
    }
  }
  return movable;
}

/** Two deterministic MaxRects passes on measured dimensions. Expanding every
 * rectangle by half the clearance represents fixed and mutual gaps uniformly.
 * Recovery has its own explicit 6000-check cap; exhaustion is not a fit. */
function packFreeSpace(bounds: HudRect, obstacles: readonly HudRect[], items: readonly HudObstacle[], work: { remaining: number }): Map<string, HudRect> | null {
  const semantic = packSemanticRegions(bounds, obstacles as readonly HudObstacle[], items, work);
  if (semantic) return semantic;
  const floor = Math.max(0, work.remaining - 6_000);
  const spend = () => work.remaining > floor && (--work.remaining, true);
  const expand = (r: HudRect): HudRect => ({ x: r.x - 2, y: r.y - 2, width: r.width + 4, height: r.height + 4 });
  const subtract = (free: HudRect[], used: HudRect): HudRect[] | null => {
    const pieces: HudRect[] = [];
    for (const f of free) {
      if (!spend()) return null;
      if (!intersects(f, used)) { pieces.push(f); continue; }
      if (used.x > f.x) pieces.push({ ...f, width: used.x - f.x });
      if (used.x + used.width < f.x + f.width) pieces.push({ ...f, x: used.x + used.width, width: f.x + f.width - used.x - used.width });
      if (used.y > f.y) pieces.push({ ...f, height: used.y - f.y });
      if (used.y + used.height < f.y + f.height) pieces.push({ ...f, y: used.y + used.height, height: f.y + f.height - used.y - used.height });
    }
    if (pieces.length > 256) return null;
    const kept: HudRect[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]; let contained = false;
      for (let j = 0; j < pieces.length; j++) {
        if (i === j) continue;
        if (!spend()) return null;
        const q = pieces[j];
        if (q.x <= p.x && q.y <= p.y && q.x + q.width >= p.x + p.width && q.y + q.height >= p.y + p.height
          && (q.x !== p.x || q.y !== p.y || q.width !== p.width || q.height !== p.height || j < i)) { contained = true; break; }
      }
      if (!contained && valid(p)) kept.push(p);
    }
    return kept;
  };
  let reserved = [expand(bounds)];
  for (const obstacle of obstacles) { const next = subtract(reserved, expand(obstacle)); if (!next) return null; reserved = next; }
  // Short-wide bounds benefit from reserving broad readouts before tall ones.
  // Multiple bands wider than two thirds of portrait bounds cannot share a
  // row; reserve them by width first. This is a bounded geometric heuristic,
  // not an existence proof. No lifecycle, control ID or fixture name is used.
  // All choices retain two passes and the same total 6000-check cap.
  const broadBands = items.filter(item => item.width > bounds.width * 2 / 3).length;
  // A leading tall rectangle needs a side column before wide readouts split
  // it. Reserve that column from the top; broad leaders retain width-biased
  // packing. The deterministic area tie uses the same ID ordering as packing.
  // This heuristic can be discontinuous at shape ties; blocked still means
  // unresolved, never an impossibility proof.
  const areaOrder = [...items].sort((a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id));
  const largest = areaOrder[0];
  // Two tall leading blocks in portrait need upper slots before smaller bands
  // divide the height. Pack by the lowest candidate bottom edge in that case.
  // This shape-based branch shares the same bounded recovery budget.
  const tallLeaders = areaOrder.length >= 2 && areaOrder.slice(0, 2).every(item => item.width <= item.height);
  const passes = bounds.width > bounds.height
    ? tallLeaders ? [6, 4] : largest && largest.height > largest.width ? [4, 2] : [2, 0]
    : broadBands >= 2 ? [3, 0] : tallLeaders ? [5, 0] : [0, 1];
  for (const pass of passes) {
    const order = [...items].sort((a, b) => (pass === 6 ? b.height - a.height : pass === 3 ? b.width - a.width : pass === 2 ? b.width * b.width * b.height - a.width * a.width * a.height
      : (pass === 0 || pass === 4 || pass === 5) ? b.width * b.height - a.width * a.height : b.width + b.height - a.width - a.height) || a.id.localeCompare(b.id));
    let free = [...reserved]; const placed = new Map<string, HudRect>();
    for (const item of order) {
      const width = item.width + 4, height = item.height + 4;
      let best: { x: number; y: number; short: number; long: number } | null = null;
      for (const f of free) {
        if (!spend()) return null;
        if (width > f.width || height > f.height) continue;
        const candidate = { x: (pass === 2 || pass === 6) ? f.x + f.width - width : f.x, y: (pass === 1 || pass === 4 || pass === 5 || pass === 6) ? f.y : f.y + f.height - height,
          short: Math.round(((pass === 5 || pass === 6) ? f.y + height : pass === 2 ? f.x + f.width : Math.min(f.width - width, f.height - height)) * 1e7) / 1e7,
          long: Math.round((pass === 6 ? f.x + f.width - width : pass === 5 ? f.x : pass === 2 ? f.y + f.height - height : Math.max(f.width - width, f.height - height)) * 1e7) / 1e7 };
        if (!best || candidate.short < best.short || candidate.short === best.short && (candidate.long < best.long
          || candidate.long === best.long && (candidate.y < best.y || candidate.y === best.y && candidate.x < best.x))) best = candidate;
      }
      if (!best) break;
      const rect = { x: best.x + 2, y: best.y + 2, width: item.width, height: item.height };
      // Final exact predicates match the product; never certify rounded gaps.
      if (rect.x < bounds.x || rect.y < bounds.y || rect.x + rect.width > bounds.x + bounds.width || rect.y + rect.height > bounds.y + bounds.height) break;
      let safe = true;
      for (const other of [...obstacles, ...placed.values()]) {
        if (!spend()) return null;
        if (intersects(rect, other, 4)) { safe = false; break; }
      }
      if (!safe) break;
      placed.set(item.id, rect);
      if (placed.size === items.length) return placed;
      const next = subtract(free, expand(rect)); if (!next) return null; free = next;
    }
    if (placed.size === items.length) return placed;
  }
  return null;
}

function layoutCampaignPanels(measurement: HudMeasurement, sight: HudRect): HudLayout {
  const { canvas, bounds } = measurement, radius = canvas.width < 360 ? 42 : 49;
  const radar = { id: 'radar', x: canvas.width - radius * 2 - 19,
    y: Math.min(canvas.height * .33, 180) - radius - 1, width: radius * 2 + 2, height: radius * 2 + 18 };
  if (canvas.width <= 360 && canvas.height > canvas.width) { radar.x = bounds.x; radar.y = bounds.y; }
  const obstacles = [...measurement.obstacles,
    { id: 'central-flight-lane', x: canvas.width / 2 - 42, y: canvas.height / 2 - 42, width: 84, height: 84 },
    { ...sight, id: 'aim-and-reload-ring' }];
  // Short wide warnings otherwise come last by area and lose every full-width
  // slot to tall controls. Reserve their actual rectangle before area packing.
  // The long throttle travel needs a continuous vertical slot. Place it before
  // other readouts divide those slots, then keep the existing area order.
  // A landscape detail panel displaced by the fixed site cards has very few
  // legal slots. Portrait retains the throttle's continuous vertical priority.
  const displacedDetails = (item: HudObstacle) => canvas.width > canvas.height && item.id === 'campaign-hud-details'
    && obstacles.some(obstacle => intersects(item, obstacle, 4));
  // During portrait respawn try the constrained radar slot first for 15k
  // checks, then the usual throttle order with the remaining shared budget.
  const portraitRespawn = canvas.height > canvas.width && measurement.panels!.some(panel => panel.id === 'respawn-status');
  const readouts = [radar, ...measurement.panels!, ...(measurement.movableControls ?? [])]
    .sort((a, b) => Number(displacedDetails(b)) - Number(displacedDetails(a))
      || Number(b.id === 'throttle') - Number(a.id === 'throttle')
      || b.width * b.height - a.width * a.height || a.id.localeCompare(b.id));
  const originalItems = [...(measurement.canvasLabels ?? []), ...readouts];
  const items = portraitRespawn ? [...(measurement.canvasLabels ?? []), radar, ...readouts.filter(item => item.id !== 'radar')] : [...originalItems];
  const work = { remaining: 120_000 };
  let searchFloor = portraitRespawn ? 105_000 : 0;
  let invalid = !valid(canvas) || !valid(bounds) || !items.every(valid) || !obstacles.every(valid);
  const sites = obstacles.filter(item => item.id.includes('campaign-site') || item.id.startsWith('site-'));
  const fixedConflicts = sites.flatMap(site => obstacles.filter(other => other !== site && intersects(site, other))
    .map(other => ({ first: site.id, second: other.id })));
  // Utility buttons may be children of the header, so their overlap with that
  // containing box is intentional. Distinct button targets are not: enlarged
  // text can grow a full-mode control into its neighbour or past a safe edge.
  const fixedControls = obstacles.filter(item => isFixedControl(item.id));
  for (let i = 0; i < fixedControls.length; i++) for (let j = i + 1; j < fixedControls.length; j++) {
    if (intersects(fixedControls[i], fixedControls[j])) fixedConflicts.push({ first: fixedControls[i].id, second: fixedControls[j].id });
  }
  for (const control of fixedControls) for (const reserve of obstacles.filter(item => ['central-flight-lane', 'aim-and-reload-ring'].includes(item.id))) {
    if (intersects(control, reserve)) fixedConflicts.push({ first: control.id, second: reserve.id });
  }
  for (const site of [...sites, ...fixedControls]) if (site.x < bounds.x || site.y < bounds.y || site.x + site.width > bounds.x + bounds.width || site.y + site.height > bounds.y + bounds.height) {
    fixedConflicts.push({ first: site.id, second: 'safe-bounds' });
  }
  const placed = new Map<string, HudRect>();
  const search = (index: number): boolean => {
    if (invalid) return false;
    if (index === items.length) return true;
    if (work.remaining <= searchFloor) return false;
    const item = items[index], occupied = [...obstacles, ...placed.values()];
    // Most wide-screen readouts already fit. Try that position before spending
    // the bounded budget building every possible edge-coordinate combination.
    const preferredFits = item.x >= bounds.x && item.y >= bounds.y
      && item.x + item.width <= bounds.x + bounds.width && item.y + item.height <= bounds.y + bounds.height
      && occupied.every(obstacle => --work.remaining >= searchFloor && !intersects(item, obstacle, 4));
    if (preferredFits) {
      placed.set(item.id, item);
      if (search(index + 1)) return true;
      placed.delete(item.id);
    }
    const choices = candidatePositions({ bounds, size: item, preferred: item, obstacles: occupied });
    if (!choices) { invalid = true; return false; }
    for (const rect of choices) {
      if (preferredFits && rect.x === item.x && rect.y === item.y) continue;
      if (--work.remaining < searchFloor) break;
      if (occupied.some(obstacle => --work.remaining < searchFloor || intersects(rect, obstacle, 4))) continue;
      placed.set(item.id, rect);
      if (search(index + 1)) return true;
      placed.delete(item.id);
      if (work.remaining <= searchFloor || invalid) break;
    }
    return false;
  };
  // Run the original search and its original 120k budget unchanged. Only a
  // failed compact search may use the separately measured 6k recovery budget.
  // Thus every successful original placement (including preferences used by
  // subsequent canvas labels) returns without entering the new algorithm.
  let found = search(0);
  if (!found && !invalid && portraitRespawn) {
    searchFloor = 0; placed.clear(); items.splice(0, items.length, ...originalItems);
    found = search(0);
  }
  const recovery = { remaining: 6_000 };
  const useRecovery = !found && !invalid && !fixedConflicts.length && !measurement.canvasLabels?.length && measurement.movableControls && canvas.width <= 600;
  if (useRecovery) {
    placed.clear();
    const packed = packFreeSpace(bounds, obstacles, items, recovery);
    if (packed) { for (const [id, rect] of packed) placed.set(id, rect); found = true; }
  }
  const primarySearchChecks = 120_000 - Math.max(0, work.remaining);
  const recoverySearchChecks = 6_000 - recovery.remaining;
  const status: Placement['status'] = invalid ? 'invalid' : found && !fixedConflicts.length ? 'placed' : 'blocked';
  const rectFor = (item: HudObstacle) => found ? placed.get(item.id)! : fullSizeFallback(item, bounds);
  const radarRect = rectFor(radar);
  const panels = measurement.panels!.map(item => ({ id: item.id, status, rect: rectFor(item) }));
  const controls = measurement.movableControls?.map(item => ({ id: item.id, rect: rectFor(item) }));
  const canvasLabels = measurement.canvasLabels?.map(item => ({ id: item.id, status, rect: rectFor(item) }));
  const finalObstacles = controls ? [...obstacles, ...controls.map(item => ({ ...item.rect, id: item.id }))] : obstacles;
  const threat = panels.find(panel => panel.id === 'campaign-threat');
  return { status, canvas, bounds, obstacles: finalObstacles, panels, controls, canvasLabels, compact: Boolean(controls), fixedConflicts, searchChecks: primarySearchChecks + recoverySearchChecks,
    searchLimit: useRecovery ? 126_000 : 120_000, primarySearchChecks, recoverySearchChecks,
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
      && [this.layout.radar.rect, ...this.layout.panels.map(panel => panel.rect), ...(this.layout.canvasLabels ?? []).map(label => label.rect), ...(this.layout.controls ?? []).map(control => control.rect)].every(rect => !intersects(rect, sight, 4))
      && this.measurement!.obstacles.filter(item => item.id.includes('campaign-site') || item.id.startsWith('site-') || isFixedControl(item.id)).every(rect => !intersects(rect, sight))) {
      // A moving sight need not repack unchanged DOM. Keep stable labels until
      // its real footprint reaches one, while updating the diagnostic reserve.
      this.sightKey = key;
      this.layout = { ...this.layout, obstacles: [...this.layout.obstacles.filter(item => item.id !== 'aim-and-reload-ring'), { ...sight, id: 'aim-and-reload-ring' }] };
      return this.layout;
    }
    if (this.measurement?.panels && this.measurement.obstacles.some(item => (item.id.includes('campaign-site') || item.id.startsWith('site-') || isFixedControl(item.id)) && intersects(item, sight))) this.dirty = true;
    if (this.dirty || !this.measurement) { this.measurement = this.host.measure(sight); this.measurements++; this.dirty = false; }
    this.sightKey = key;
    this.layout = layoutCampaignHud(this.measurement, sight);
    // A blocked result keeps every item at its full size and remains a failure.
    if (this.layout.panels) this.host.applyPanels?.([...this.layout.panels, ...(this.layout.controls ?? []).map(control => ({ ...control, status: this.layout!.status }))]);
    else this.host.applyThreat(this.layout.threat?.rect ?? null, this.layout.canvas);
    return this.layout;
  }
  /** A canvas warning is part of the packing, not an afterthought in whatever
   * slivers the DOM panels leave behind. Keep the cheap independent placement
   * when it fits; otherwise repack all measured full-size items together. */
  placeCanvasLabel(id: string, preferred: HudRect): { status: Placement['status']; rect: HudRect } {
    const initial = layoutCampaignCanvasLabel(this.layout, preferred);
    if (initial.status === 'invalid' || !this.measurement?.panels || !this.layout || this.disposed) return initial;
    if (initial.status === 'placed') { this.layout.canvasLabels = [{ id, ...initial }]; return initial; }
    const sight = this.layout.obstacles.find(item => item.id === 'aim-and-reload-ring');
    if (!sight) return initial;
    // A broad, short label belongs just below the measured fixed site strip
    // when its projected point has no free slot. Start at the safe left edge;
    // a center preference fragments that narrow band around the actual sight.
    const sites = this.measurement.obstacles.filter(item => item.id.includes('campaign-site') || item.id.startsWith('site-'));
    const labelTop = sites.length ? Math.max(...sites.map(site => site.y + site.height)) + 4 : this.layout.bounds.y;
    const joint = layoutCampaignHud({ ...this.measurement,
      // Keep existing placements as preferences while making room for the label.
      panels: this.layout.panels!.map(panel => ({ ...panel.rect, id: panel.id })),
      movableControls: this.layout.controls?.map(control => ({ ...control.rect, id: control.id })),
      canvasLabels: [{ ...preferred, id, x: this.layout.bounds.x, y: labelTop }],
    }, sight);
    const label = joint.canvasLabels?.find(panel => panel.id === id);
    if (joint.status !== 'placed' || !label) return initial;
    this.layout = joint;
    this.host.applyPanels?.([...joint.panels!, ...(joint.controls ?? []).map(control => ({ ...control, status: joint.status }))]);
    return { status: label.status, rect: label.rect };
  }
  diagnostics() { return { ...this.layout, measurements: this.measurements, disposed: this.disposed }; }
  dispose() { if (this.disposed) return; this.disposed = true; this.disconnect(); }
}

/** Live HP/progress widths and reload positions are not typography changes.
 * Compare only context properties, preserving ordinary live remeasurement. */
export function campaignHudContextStyleChanged(before: string | null, after: string | null): boolean {
  const context = (value: string | null) => (value ?? '').split(';').map(part => {
    const colon = part.indexOf(':');
    return [part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()];
  }).filter(([name]) => /^(font($|-)|line-height$|letter-spacing$|--control-(x|y|size|height)$|--safe-)/.test(name))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(context(before)) !== JSON.stringify(context(after));
}

/** Re-measure live reservations in their current mode. A late ResizeObserver
 * delivery is not permission to hide/reparent an active native scroll region.
 * Only explicit viewport/typography/mode changes reconsider full-detail mode. */
export function measureCampaignHudMode(compact: boolean, reviewFull: boolean, sight: HudRect,
  measureMode: (compact: boolean) => HudMeasurement, clipped: () => boolean): HudMeasurement {
  if (compact && !reviewFull) return measureMode(true);
  const full = measureMode(false);
  return layoutCampaignHud(full, sight).status === 'placed' && !clipped() ? full : measureMode(true);
}

/** Scene-owned adapter. Observe geometry owners, not every changing HUD text. */
export function createCampaignHudLayout(canvas: HTMLCanvasElement): CampaignHudLayout {
  const doc = canvas.ownerDocument, win = doc.defaultView!;
  const app = canvas.closest<HTMLElement>('.fantasia-shell') ?? canvas.parentElement!;
  const threat = app.querySelector<HTMLElement>('#campaign-threat');
  const details = new CampaignHudDetails(app);
  let compact = false;
  let reviewFull = true;
  let viewportKey = '';
  const selectors = '.hud-top, #campaign-sites .campaign-site[data-site], #hud button, #hud [role="slider"]';
  const panelSelectors = '.flight-data > *, .hud-top .time-block, #campaign-threat, #payload-status, #reload-status, #warning, #announcement, #respawn-status, #flight-tip, #throttle-layout-note';
  const panelNodes = [...app.querySelectorAll<HTMLElement>(panelSelectors), details.viewport, details.mode,
    ...(details.lives ? [details.lives] : []), ...app.querySelectorAll<HTMLElement>('#bomb-hint, #hud button, #hud [role="slider"]')];
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
      // Panel-size notifications still refresh every critical reservation, but
      // never trigger a full→compact round trip merely because they arrived late.
      const resize = new ResizeObserver(invalidate);
      const reviewContext = () => { reviewFull = true; invalidate(); };
      for (const node of [canvas, app, probe, ...nodes]) resize.observe(node);
      handleRecords = records => {
        let changed = false;
        for (const record of records) {
          if (record.type !== 'attributes') {
            const panel = panelNodes.find(node => node === record.target || node.contains(record.target));
            if (!panel) { changed = true; continue; }
            if (details.contains(panel) && panel !== details.viewport) continue;
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
          if (record.attributeName === 'style' && ownStyles.has(node) && value === ownStyles.get(node)) continue;
          changed = true;
          // Text enlargement/custom control styles, mode/input and root theme
          // changes can make full mode viable again. Live visibility, warning
          // flags and site state classes only require current-mode measurement.
          if (record.attributeName === 'style' && campaignHudContextStyleChanged(record.oldValue, value)
            || ['data-mode', 'data-input'].includes(record.attributeName!)
            || record.attributeName === 'class' && [doc.documentElement, doc.body, app].includes(node as HTMLElement)) reviewFull = true;
        }
        if (changed) invalidate();
      };
      mutation = new MutationObserver(handleRecords);
      for (const node of new Set<Element>([doc.documentElement, doc.body, app, ...nodes,
        ...app.querySelectorAll('#hud, #normal-controls, .bottom-controls')])) {
        mutation.observe(node, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style', 'data-mode', 'data-input', 'data-campaign-critical'] });
      }
      // Site initialization and threat text affect geometry; steady instrument
      // text writes are handled by ResizeObserver only when their size changes.
      if (header) mutation.observe(header, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style', 'data-campaign-critical'] });
      if (sites) mutation.observe(sites, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style', 'data-campaign-critical'] });
      for (const panel of panelNodes) mutation.observe(panel, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style', 'data-campaign-critical'] });
      win.addEventListener('resize', reviewContext);
      doc.fonts?.addEventListener('loadingdone', reviewContext);
      return () => {
        resize.disconnect(); mutation?.disconnect(); win.removeEventListener('resize', reviewContext); doc.fonts?.removeEventListener('loadingdone', reviewContext);
        probe.remove(); details.dispose();
        for (const [node, values] of original) for (const [name, value, priority] of values) {
          if (value) node.style.setProperty(name, value, priority); else node.style.removeProperty(name);
        }
      };
    },
    flush() { if (mutation) handleRecords(mutation.takeRecords()); },
    measure(sight) {
      const active = doc.activeElement as HTMLElement | null;
      const wasReading = Boolean(active && details.contains(active));
      const scrollTop = details.viewport.scrollTop;
      const beforeRevision = details.layoutRevision;
      const view = canvas.getBoundingClientRect(), safeContext = win.getComputedStyle(probe);
      const nextViewportKey = [view.width, view.height, safeContext.paddingTop, safeContext.paddingRight, safeContext.paddingBottom, safeContext.paddingLeft].join(',');
      if (nextViewportKey !== viewportKey) reviewFull = true;
      viewportKey = nextViewportKey;
      const measureMode = (useCompact: boolean): HudMeasurement => {
      compact = useCompact;
      details.sync(compact);
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
      if (siteNodes.length && (compact || headerRect)) {
        const cards = siteNodes.map(node => toCanvasRect(node.getBoundingClientRect(), canvasRect));
        const controls = [...app.querySelectorAll<HTMLElement>('#hud button, #hud [role="slider"]')].map(visibleRect).filter((rect): rect is HudRect => Boolean(rect)).map(rect => toCanvasRect(rect, canvasRect));
        const positions = compact ? layoutCompactCampaignSites(canvasRect, bounds, cards, sight)
          : layoutCampaignSites(canvasRect, bounds, toCanvasRect(headerRect!, canvasRect), cards, sight, controls);
        for (const [index, node] of siteNodes.entries()) {
          node.style.setProperty('--campaign-site-x', `${positions[index].x - cards[index].x}px`);
          node.style.setProperty('--campaign-site-y', `${positions[index].y - cards[index].y}px`);
          ownStyles.set(node, node.getAttribute('style'));
        }
      }
      const obstacles: HudObstacle[] = [];
      for (const node of app.querySelectorAll<HTMLElement>(selectors)) {
        if (compact && ((node.tagName === 'BUTTON' || node.getAttribute('role') === 'slider') || details.contains(node))) continue;
        const r = visibleRect(node); if (r) obstacles.push({ ...toCanvasRect(r, canvasRect), id: node.id || node.className });
      }
      const panels: HudObstacle[] = [], movableControls: HudObstacle[] = [];
      natural.clear();
      for (const node of panelNodes) {
        if (details.contains(node) && node !== details.viewport) continue;
        if (!compact && ((node.tagName === 'BUTTON' || node.getAttribute('role') === 'slider') || node === details.lives || node.id === 'bomb-hint')) continue;
        if (node === time && !compactTime && !compact) continue;
        const r = visibleRect(node); if (!r) continue;
        const local = toCanvasRect(r, canvasRect), id = panelId(node);
        natural.set(id, local);
        if (compact && (node.tagName === 'BUTTON' || node.getAttribute('role') === 'slider')) movableControls.push({ ...local, id });
        else panels.push({ ...local, id });
      }
      // Narrow portrait reflows individual readouts without changing their text.
      // Its ammo box remains the preferred notification anchor when the parent
      // is display:contents and therefore has no client rectangle of its own.
      const data = app.querySelector('.flight-data'), ammo = app.querySelector('.flight-data .ammo');
      const dataRect = (data && visibleRect(data)) || (ammo && visibleRect(ammo)), threatRect = threat && visibleRect(threat);
      return { canvas: canvasRect, bounds, obstacles,
        panels, ...(compact ? { movableControls } : {}), flightData: dataRect ? toCanvasRect(dataRect, canvasRect) : null, threat: threatRect ? toCanvasRect(threatRect, canvasRect) : null };
      };
      const measured = measureCampaignHudMode(compact, reviewFull, sight, measureMode, () =>
        [...app.querySelectorAll<HTMLElement>('.campaign-site-force, .campaign-site-wave')]
          .some(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1));
      reviewFull = false;
      // Reparenting and our own translations are synchronous layout writes,
      // not a new external change requiring another measure on the next frame.
      details.restoreReading(beforeRevision, scrollTop, wasReading ? active : null);
      mutation?.takeRecords();
      return measured;
    },
    applyThreat() {},
    applyPanels(panels) {
      for (const node of panelNodes) {
        if (details.contains(node) && node !== details.viewport) continue;
        const id = panelId(node), from = natural.get(id), to = panels.find(panel => panel.id === id)?.rect;
        if (!from || !to) continue;
        const values = { '--campaign-hud-x': `${to.x - from.x}px`, '--campaign-hud-y': `${to.y - from.y}px` };
        for (const [name, value] of Object.entries(values)) if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
        ownStyles.set(node, node.getAttribute('style'));
      }
    },
  });
}
