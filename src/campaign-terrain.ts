import type { Vec } from './campaign-types';

export interface TerrainObstacle { id: number; position: Vec; halfSize: Vec; yaw: number; kind: 'rock' }
export function laneBasis(laneId: number): { u: Vec; v: Vec } {
  const a = laneId * Math.PI * 2 / 7, x = Math.cos(a), z = Math.sin(a);
  return { u: { x, y: 0, z }, v: { x: -z, y: 0, z: x } };
}
/** Sevenfold symmetric height field, 10..32 m; roads remain continuous. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z), a = r === 0 ? 0 : Math.atan2(z, x);
  // C1 envelope joins at r=650; its seventh-order origin also makes the
  // angular term smooth at the center without a visible mesh crease.
  const s = Math.min(1, r / 650), envelope = s ** 7 * (8 - 7 * s);
  const sideHill = (1 - Math.cos(7 * a)) * .5 * envelope;
  return 10 + 10 * Math.sin(r / 650) ** 2 + 12 * sideHill * Math.exp(-(((r - 1000) / 320) ** 2));
}
export const heightAt = terrainHeight;
export function radialPosition(laneId: number, radius: number, extraY = 0): Vec {
  const { u } = laneBasis(laneId); const x = u.x * radius, z = u.z * radius;
  return { x, y: terrainHeight(x, z) + extraY, z };
}
export const TERRAIN_OBSTACLES: readonly TerrainObstacle[] = Object.freeze(Array.from({ length: 14 }, (_, index) => {
  const lane = Math.floor(index / 2), side = index % 2 === 0 ? -1 : 1;
  const { u, v } = laneBasis(lane), x = u.x * 930 + v.x * side * 85, z = u.z * 930 + v.z * side * 85;
  return { id: index, kind: 'rock' as const, position: { x, y: terrainHeight(x, z) + 8, z }, halfSize: { x: 18, y: 8, z: 12 }, yaw: lane * Math.PI * 2 / 7 };
}));
const COLLISION_OBSTACLES = TERRAIN_OBSTACLES.map(box => {
  const cosine = Math.cos(box.yaw), sine = Math.sin(box.yaw);
  return { box, cosine, sine, extentX: Math.abs(cosine) * box.halfSize.x + Math.abs(sine) * box.halfSize.z,
    extentZ: Math.abs(sine) * box.halfSize.x + Math.abs(cosine) * box.halfSize.z };
});
export const TERRAIN_MAX_HEIGHT = 32;
export function copyVec(v: Vec): Vec { return { x: v.x, y: v.y, z: v.z }; }
export function addVec(a: Vec, b: Vec): Vec { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function scaleVec(a: Vec, s: number): Vec { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function subtractVec(a: Vec, b: Vec): Vec { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function lerpVec(a: Vec, b: Vec, t: number): Vec { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; }
export function distanceSquared(a: Vec, b: Vec): number { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2; }
export function xzDistanceSquared(a: Vec, b: Vec): number { return (a.x - b.x) ** 2 + (a.z - b.z) ** 2; }
export function normalized(v: Vec): Vec { const n = Math.hypot(v.x, v.y, v.z); return n > 1e-12 ? scaleVec(v, 1 / n) : { x: 1, y: 0, z: 0 }; }
/** One micrometre in the rotational lane frame is authoritative precision.
 * This removes accumulated rotation-dependent floating point contact drift;
 * hit radii and eligibility boundaries are unchanged.
 */
export function quantizeLanePosition(v: Vec, laneId: number): Vec {
  const { u, v: tangent } = laneBasis(laneId), radial = Math.round((v.x * u.x + v.z * u.z) * 1e6) / 1e6;
  const across = Math.round((v.x * tangent.x + v.z * tangent.z) * 1e6) / 1e6;
  return { x: radial * u.x + across * tangent.x, y: Math.round(v.y * 1e6) / 1e6, z: radial * u.z + across * tangent.z };
}
/** Earliest relative segment entry into a sphere, including initial overlap. */
export function segmentSphereEntry(from: Vec, to: Vec, radius: number): number | null {
  const d = subtractVec(to, from), a = d.x * d.x + d.y * d.y + d.z * d.z;
  const c = from.x * from.x + from.y * from.y + from.z * from.z - radius * radius;
  if (c <= 0) return 0;
  if (a < 1e-20) return null;
  const b = 2 * (from.x * d.x + from.y * d.y + from.z * d.z), q = b * b - 4 * a * c;
  if (q < 0) return null;
  const t = (-b - Math.sqrt(q)) / (2 * a); return t >= 0 && t <= 1 ? t : null;
}
function boxEntry(from: Vec, to: Vec, data: (typeof COLLISION_OBSTACLES)[number], radius = 0): number | null {
  const box = data.box, c = data.cosine, s = data.sine, center = box.position;
  if (Math.max(from.x, to.x) < center.x - data.extentX - radius || Math.min(from.x, to.x) > center.x + data.extentX + radius
    || Math.max(from.z, to.z) < center.z - data.extentZ - radius || Math.min(from.z, to.z) > center.z + data.extentZ + radius
    || Math.max(from.y, to.y) < center.y - box.halfSize.y - radius || Math.min(from.y, to.y) > center.y + box.halfSize.y + radius) return null;
  const ax = (from.x - center.x) * c + (from.z - center.z) * s, ay = from.y - center.y, az = -(from.x - center.x) * s + (from.z - center.z) * c;
  const bx = (to.x - center.x) * c + (to.z - center.z) * s, by = to.y - center.y, bz = -(to.x - center.x) * s + (to.z - center.z) * c;
  let enter = 0, leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const a = axis === 0 ? ax : axis === 1 ? ay : az, b = axis === 0 ? bx : axis === 1 ? by : bz;
    const d = b - a, half = (axis === 0 ? box.halfSize.x : axis === 1 ? box.halfSize.y : box.halfSize.z) + radius;
    if (Math.abs(d) < 1e-12) { if (Math.abs(a) > half) return null; continue; }
    let p = (-half - a) / d, q = (half - a) / d;
    if (p > q) [p, q] = [q, p]; enter = Math.max(enter, p); leave = Math.min(leave, q);
    if (enter > leave) return null;
  }
  return enter >= 0 && enter <= 1 ? enter : null;
}
/** Height-field crossing with a conservative curvature bound and bisection. */
export function segmentTerrainEntry(from: Vec, to: Vec, radius = 0): number | null {
  const gap = (t: number) => { const p = lerpVec(from, to, t); return p.y - radius - terrainHeight(p.x, p.z); };
  if (Math.min(from.y, to.y) - radius > TERRAIN_MAX_HEIGHT) return null;
  const lengthSquared = (to.x - from.x) ** 2 + (to.z - from.z) ** 2;
  // .02 bounds the height field Hessian, including the smooth center and
  // r=650 join. Its chord-error bound prevents grazing tunneling between
  // samples; most projectile segments reject after just the two endpoints.
  const curvature = .02 * lengthSquared;
  const search = (a: number, first: number, b: number, last: number, depth: number): number | null => {
    if (first <= 0) return a;
    if (Math.min(first, last) - curvature * (b - a) ** 2 / 8 > 0) return null;
    if (depth === 24) return first < last ? a : b;
    const mid = (a + b) / 2, middle = gap(mid);
    return search(a, first, mid, middle, depth + 1) ?? search(mid, middle, b, last, depth + 1);
  };
  return search(0, gap(0), 1, gap(1), 0);
}
export function sweepSphere(from: Vec, to: Vec, radius: number): { fraction: number; point: Vec; obstacleId: number | null } | null {
  let fraction = segmentTerrainEntry(from, to, radius), obstacleId: number | null = null;
  for (const data of COLLISION_OBSTACLES) { const t = boxEntry(from, to, data, radius); if (t !== null && (fraction === null || t < fraction)) { fraction = t; obstacleId = data.box.id; } }
  return fraction === null ? null : { fraction, point: lerpVec(from, to, fraction), obstacleId };
}
/** Ground-following units overlap terrain by design; query solids separately. */
export function sweepObstacles(from: Vec, to: Vec, radius = 0): { fraction: number; point: Vec; obstacleId: number } | null {
  let fraction: number | null = null, obstacleId = -1;
  for (const data of COLLISION_OBSTACLES) { const t = boxEntry(from, to, data, radius); if (t !== null && (fraction === null || t < fraction)) { fraction = t; obstacleId = data.box.id; } }
  return fraction === null ? null : { fraction, point: lerpVec(from, to, fraction), obstacleId };
}
export function segmentTerrainBlocked(from: Vec, to: Vec): boolean { return sweepSphere(from, to, 0) !== null; }
export const blockedSegment = segmentTerrainBlocked;
export function route(fromSite: number, toSite: number): Vec[] {
  if (fromSite === toSite) return [radialPosition(toSite, 1000)];
  let delta = (toSite - fromSite + 7) % 7; if (delta > 3) delta -= 7;
  const steps = Math.abs(delta) * 16, points: Vec[] = [];
  for (let i = 0; i <= steps; i++) { const angle = (fromSite + delta * i / steps) * 2 * Math.PI / 7; const x = 1080 * Math.cos(angle), z = 1080 * Math.sin(angle); points.push({ x, y: terrainHeight(x, z), z }); }
  points.push(radialPosition(toSite, 1000)); return points;
}
