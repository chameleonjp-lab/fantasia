import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, BufferAttribute, BufferGeometry,
  CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight,
  DoubleSide, DynamicDrawUsage, Fog, Frustum, Group, HemisphereLight, InstancedMesh,
  LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OctahedronGeometry, PerspectiveCamera, PlaneGeometry,
  Points, Quaternion, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace,
  TorusGeometry, Vector3, WebGLRenderer, type Material, type Sphere,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AircraftFactory, type AircraftVisual } from './aircraft';
import { AircraftBatchFactory } from './aircraft-batch';
import { AircraftTracers } from './aircraft-tracers';
import { skyFragment, skyVertex } from './atmosphere';
import { aimRadius, AIM_COLORS } from './aim-indicator';
import { FLIGHT_FOV, getFlightCameraPose, projectFlightTarget } from './flight-view';
import { projectGunSight } from './gun-sight';
import { RenderQueue } from './render-queue';
import { createCampaignHudLayout, layoutCampaignCanvasLabel, type CampaignHudLayout } from './campaign-hud-layout';
import type { Aircraft, Bullet, Team } from './types';
import type { CampaignActor, CampaignState, Vec } from './campaign-types';
import { heightAt, radialPosition, route, sweepSphere, TERRAIN_OBSTACLES } from './campaign-terrain';
import { ACTOR_STATS } from './campaign-config';
import { predictAim, predictBombImpact, resolveTarget } from './campaign-combat';

const GROUND_CAPACITY = 224;
const DRAGON_CAPACITY = 14;
const PROJECTILE_CAPACITY = 4096;
const EFFECT_CAPACITY = 200;
const TELEGRAPH_CAPACITY = 480;
const GROUND_CLASSES = ['sword', 'bow', 'mage', 'cavalry'] as const;
type GroundClass = typeof GROUND_CLASSES[number];
const TEAM_COLORS = { friendly: 0x27aaa4, enemy: 0xe29b55 };
const UNIT_NAMES = { sword: '剣', bow: '弓', mage: '魔', cavalry: '騎', dragon: '竜' };

/** All geometry here is generated locally; it has no external texture dependency. */
export class GeometryBuilder {
  private pieces: BufferGeometry[] = [];
  add(geometry: BufferGeometry, color: number, position: readonly number[] = [0, 0, 0],
    scale: readonly number[] = [1, 1, 1], rotation: readonly number[] = [0, 0, 0]) {
    const part = geometry.clone();
    geometry.dispose();
    // Preserve the authored vertex sharing and every triangle/attribute. All
    // pieces must be indexed to merge; an unindexed fan only needs an identity
    // index, not welding, simplification, or recomputed normals.
    if (!part.index) {
      const count = part.getAttribute('position').count;
      part.setIndex(Array.from({ length: count }, (_, vertex) => vertex));
    }
    part.deleteAttribute('uv');
    part.scale(scale[0], scale[1], scale[2]);
    part.rotateX(rotation[0]); part.rotateY(rotation[1]); part.rotateZ(rotation[2]);
    part.translate(position[0], position[1], position[2]);
    const tint = new Color(color), colors = new Float32Array(part.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([tint.r, tint.g, tint.b], i);
    part.setAttribute('color', new BufferAttribute(colors, 3));
    this.pieces.push(part);
    return this;
  }
  finish() {
    const geometry = mergeGeometries(this.pieces, false)!;
    this.pieces.forEach(piece => piece.dispose());
    this.pieces = [];
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function unitGeometry(kind: GroundClass, team: Team): BufferGeometry {
  const b = new GeometryBuilder(), fabric = TEAM_COLORS[team], steel = 0x9bada9;
  const skin = 0xd7ba91, leather = 0x4f4940, dark = 0x34434a;
  const bodyY = kind === 'cavalry' ? 1.12 : -.08;
  if (kind === 'cavalry') {
    b.add(new SphereGeometry(1, 8, 6), 0x725448, [0, -.16, .12], [.68, .62, 1.55]);
    b.add(new CylinderGeometry(.29, .46, 1.5, 7), 0x725448, [0, .39, -1.03], [1, 1, 1], [-.5, 0, 0]);
    b.add(new SphereGeometry(1, 7, 5), 0x725448, [0, .96, -1.58], [.35, .36, .65]);
    b.add(new ConeGeometry(.12, .34, 5), dark, [-.18, 1.36, -1.36]);
    b.add(new ConeGeometry(.12, .34, 5), dark, [.18, 1.36, -1.36]);
    for (const x of [-.44, .44]) for (const z of [-.82, 1.1]) {
      b.add(new CylinderGeometry(.1, .12, .88, 5), dark, [x, -.94, z]);
      b.add(new BoxGeometry(.23, .16, .33), dark, [x, -1.39, z]);
    }
    b.add(new CylinderGeometry(.08, .14, 1.2, 5), dark, [0, -.29, 1.96], [1, 1, 1], [-.65, 0, 0]);
    b.add(new BoxGeometry(1.1, .12, 1.25), fabric, [0, .45, .23]);
    b.add(new CylinderGeometry(.045, .045, 3.8, 5), leather, [.7, 1.12, -.15], [1, 1, 1], [-.22, 0, -.12]);
    b.add(new ConeGeometry(.12, .4, 4), steel, [.98, 3.14, -.58], [1, 1, 1], [-.22, 0, -.12]);
  } else {
    for (const x of [-.22, .22]) {
      b.add(new CylinderGeometry(.14, .12, .76, 5), dark, [x, -.6, 0]);
      b.add(new BoxGeometry(.27, .18, .4), leather, [x, -.95, -.06]);
    }
  }
  b.add(new CylinderGeometry(.31, .38, .79, 7), kind === 'mage' ? fabric : steel, [0, bodyY + .08, 0]);
  b.add(new BoxGeometry(.71, .31, .34), fabric, [0, bodyY + .16, .22]);
  b.add(new SphereGeometry(.22, 7, 5), skin, [0, bodyY + .73, -.04]);
  if (kind === 'mage') {
    b.add(new CylinderGeometry(.34, .58, 1, 8), fabric, [0, -.29, .1]);
    b.add(new ConeGeometry(.32, .69, 7), fabric, [0, bodyY + 1.06, .01]);
    b.add(new CylinderGeometry(.045, .06, 2.22, 5), leather, [.54, .16, -.23]);
    b.add(new OctahedronGeometry(.22), 0xbde3c9, [.54, 1.34, -.23]);
  } else {
    b.add(new SphereGeometry(.26, 8, 5), steel, [0, bodyY + .8, .02], [1, .65, 1]);
    b.add(new BoxGeometry(.28, .07, .08), dark, [0, bodyY + .73, -.245]);
  }
  b.add(new CylinderGeometry(.12, .11, .56, 5), fabric, [-.39, bodyY + .04, -.04], [1, 1, 1], [0, 0, -.3]);
  b.add(new CylinderGeometry(.12, .11, .56, 5), fabric, [.39, bodyY + .04, -.04], [1, 1, 1], [0, 0, .3]);
  if (kind === 'sword') {
    b.add(new BoxGeometry(.07, 1.08, .1), steel, [.63, .52, -.15], [1, 1, 1], [0, 0, -.25]);
    b.add(new BoxGeometry(.4, .08, .11), leather, [.5, .02, -.15]);
    b.add(new CylinderGeometry(.41, .41, .11, 8), fabric, [-.57, .13, -.34], [1, 1, 1], [Math.PI / 2, 0, 0]);
    b.add(new CylinderGeometry(.12, .12, .14, 8), steel, [-.57, .13, -.42], [1, 1, 1], [Math.PI / 2, 0, 0]);
  } else if (kind === 'bow') {
    b.add(new TorusGeometry(.64, .045, 4, 12, Math.PI), leather, [-.52, .3, -.36], [1, 1, 1], [0, 0, -Math.PI / 2]);
    b.add(new CylinderGeometry(.015, .015, 1.27, 3), 0xe4d7ba, [-.52, .3, -.36]);
    b.add(new CylinderGeometry(.023, .023, .95, 3), leather, [-.45, .28, -.62], [1, 1, 1], [Math.PI / 2, 0, 0]);
    b.add(new CylinderGeometry(.12, .17, .65, 6), leather, [.2, .31, .36], [1, 1, 1], [0, 0, -.25]);
  }
  return b.finish();
}

function dragonBodyGeometry(): BufferGeometry {
  const b = new GeometryBuilder(), skin = 0x895b43, crest = 0xc2a16b, dark = 0x51473e;
  b.add(new SphereGeometry(1, 12, 8), skin, [0, 0, 0], [2.1, 1.7, 4.3]);
  b.add(new SphereGeometry(1, 10, 7), skin, [0, 1.05, -3.7], [1.24, 1.08, 2.4]);
  b.add(new SphereGeometry(1, 10, 7), skin, [0, 1.88, -5.85], [1.02, .8, 1.9]);
  b.add(new BoxGeometry(1.7, .55, 1.55), dark, [0, 1.28, -6.83]);
  for (const side of [-1, 1]) {
    b.add(new ConeGeometry(.28, 1.6, 6), crest, [side * .72, 2.93, -5.51], [1, 1, 1], [.42, 0, side * -.25]);
    b.add(new SphereGeometry(.17, 7, 5), 0xffd57b, [side * .87, 2.02, -6.28]);
    for (const z of [-1.7, 2.2]) {
      b.add(new CylinderGeometry(.28, .42, 2.1, 6), skin, [side * 1.83, -1.21, z], [1, 1, 1], [.5, 0, side * .2]);
      for (const x of [-.25, .25]) b.add(new ConeGeometry(.13, .6, 5), crest,
        [side * 2.1 + x, -2.16, z - .74], [1, 1, 1], [-Math.PI / 2, 0, 0]);
    }
  }
  for (let i = 0; i < 6; i++) {
    b.add(new CylinderGeometry(.85 - i * .13, .7 - i * .115, 1.65, 7), skin,
      [Math.sin(i * .48) * 1.2, -.05 - i * .17, 4 + i * 1.28], [1, 1, 1], [Math.PI / 2, 0, -.12]);
    b.add(new ConeGeometry(.31 - i * .03, .9 - i * .08, 5), crest,
      [0, 1.75 - i * .1, -2.3 + i * 1.35], [1, 1, 1], [.23, 0, 0]);
  }
  const geometry = b.finish();
  // The authoritative dragon position is its fire origin. Place the mouth there.
  geometry.translate(0, -1.8, 6.8); return geometry;
}

function dragonWingGeometry(): BufferGeometry {
  const b = new GeometryBuilder();
  const points = [[0, 0, 0], [4, .5, -2.5], [12.8, 0, -1.5], [9.5, -.6, 2.9], [7.2, -.4, 5.4], [3.8, -.4, 6.3], [.8, 0, 3.7]];
  const fan = new BufferGeometry(), positions: number[] = [];
  for (let i = 1; i < points.length - 1; i++) positions.push(...points[0], ...points[i], ...points[i + 1]);
  fan.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3)); fan.computeVertexNormals();
  b.add(fan, 0xb08559);
  for (const end of [points[1], points[2], points[4], points[5]]) {
    const direction = new Vector3(...end as [number, number, number]);
    const bone = new CylinderGeometry(.1, .25, direction.length(), 5);
    bone.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()));
    bone.translate(direction.x / 2, direction.y / 2, direction.z / 2);
    b.add(bone, 0x76533e);
  }
  return b.finish();
}

/** Sample the shared field at 10 m in play, and 40 m beyond play.
 * Measured interpolation error is below 1 cm in play.
 * Triangle interpolation is a presentation approximation, not a new collision query.
 */
export function createCampaignTerrainGeometry(): BufferGeometry {
  const axis: number[] = [];
  for (let value = -6000; value < -2100; value += 40) axis.push(value);
  for (let value = -2100; value <= 2100; value += 10) axis.push(value);
  for (let value = 2140; value < 6000; value += 40) axis.push(value);
  axis.push(6000);
  const vertices = axis.length * axis.length, coordinates = new Float32Array(vertices * 3);
  const colors = new Float32Array(coordinates.length), geometry = new BufferGeometry();
  const indices = new Uint32Array((axis.length - 1) ** 2 * 6); let offset = 0;
  for (let z = 0; z < axis.length; z++) for (let x = 0; x < axis.length; x++) {
    const index = z * axis.length + x; coordinates.set([axis[x], heightAt(axis[x], axis[z]), axis[z]], index * 3);
    if (x < axis.length - 1 && z < axis.length - 1) {
      indices.set([index, index + axis.length, index + 1, index + 1, index + axis.length, index + axis.length + 1], offset); offset += 6;
    }
  }
  const positions = new BufferAttribute(coordinates, 3);
  geometry.setAttribute('position', positions); geometry.setIndex(new BufferAttribute(indices, 1));
  const grass = new Color(0x64785a), dry = new Color(0x8b8968), rock = new Color(0x8b9390);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), y = heightAt(x, z);
    positions.setY(i, y);
    const slope = Math.hypot(heightAt(x + 4, z) - heightAt(x - 4, z), heightAt(x, z + 4) - heightAt(x, z - 4)) / 8;
    const grain = Math.sin(x * .013 + z * .006) * Math.sin(z * .018 - x * .007);
    const color = grass.clone().lerp(dry, Math.max(0, Math.min(.6, .19 + y / 100 + grain * .09)))
      .lerp(rock, Math.max(0, Math.min(.7, slope - .2)));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  return geometry;
}

/** Split without changing vertices, normals or triangles; Three can cull each tile. */
function terrainChunks(source: BufferGeometry): BufferGeometry[] {
  const groups = new Map<number, number[]>(), positions = source.getAttribute('position'), index = source.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const x = (positions.getX(a) + positions.getX(b) + positions.getX(c)) / 3;
    const z = (positions.getZ(a) + positions.getZ(b) + positions.getZ(c)) / 3;
    const key = Math.floor((x + 6000) / 600) + Math.floor((z + 6000) / 600) * 20;
    const group = groups.get(key); if (group) group.push(a, b, c); else groups.set(key, [a, b, c]);
  }
  const chunks: BufferGeometry[] = [];
  for (const triangles of groups.values()) {
    const geometry = new BufferGeometry(), vertexMap = new Map<number, number>(), indices: number[] = [];
    const attributes: Record<string, number[]> = { position: [], normal: [], color: [] };
    for (const sourceId of triangles) {
      let id = vertexMap.get(sourceId);
      if (id === undefined) {
        id = vertexMap.size; vertexMap.set(sourceId, id);
        for (const name of Object.keys(attributes)) {
          const attribute = source.getAttribute(name); attributes[name].push(attribute.getX(sourceId), attribute.getY(sourceId), attribute.getZ(sourceId));
        }
      }
      indices.push(id);
    }
    for (const [name, values] of Object.entries(attributes)) geometry.setAttribute(name, new BufferAttribute(new Float32Array(values), 3));
    geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); chunks.push(geometry);
  }
  source.dispose(); return chunks;
}

function roadGeometry(points: readonly { x: number; z: number }[], width = 11): BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  const samples: { x: number; z: number }[] = [];
  for (let j = 0; j < points.length - 1; j++) {
    const a = points[j], b = points[j + 1], segments = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 14));
    for (let i = 0; i < segments; i++) samples.push({ x: a.x + (b.x - a.x) * i / segments, z: a.z + (b.z - a.z) * i / segments });
  }
  samples.push(points.at(-1)!);
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)], point = samples[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    for (const side of [-1, 1]) {
      const x = point.x + (b.z - a.z) / length * width * .5 * side;
      const z = point.z - (b.x - a.x) / length * width * .5 * side;
      positions.push(x, heightAt(x, z) + .17, z);
    }
    if (i > 0) { const p = i * 2; indices.push(p - 2, p - 1, p, p, p - 1, p + 1); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

interface SiteVisual { root: Group; flag: Mesh; turret: Group; crystal: Mesh; }
interface Particle { position: Vector3; velocity: Vector3; born: number; life: number; color: Color; size: number; }

/** Reject only a rigid ground model whose entire bound is outside a side clip plane.
 * The Frobenius norm bounds any affine scale/shear/reflection conservatively.
 * Unknown inputs and a scale-relative boundary margin always retain the model.
 * Depth-only exclusions are retained: Float32 projection can shift the far
 * clip boundary substantially when the near/far ratio is very small.
 */
export function groundInstanceOutsideView(bounds: Sphere | null, matrix: Matrix4, view: Frustum): boolean {
  if (!bounds || !Number.isFinite(bounds.radius) || bounds.radius < 0
    || !Number.isFinite(bounds.center.x) || !Number.isFinite(bounds.center.y) || !Number.isFinite(bounds.center.z)) return false;
  const e = matrix.elements;
  if (e.length !== 16 || e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || e[15] !== 1 || view.planes.length !== 6) return false;
  for (const value of e) if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) return false;
  const x = e[0] * bounds.center.x + e[4] * bounds.center.y + e[8] * bounds.center.z + e[12];
  const y = e[1] * bounds.center.x + e[5] * bounds.center.y + e[9] * bounds.center.z + e[13];
  const z = e[2] * bounds.center.x + e[6] * bounds.center.y + e[10] * bounds.center.z + e[14];
  const radius = bounds.radius * Math.hypot(e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(radius)) return false;
  // Also covers rounding the submitted instance matrix to Float32 attributes.
  // Include uncancelled terms: a large local offset and opposite translation
  // can lose precision even if the final world-space center is near zero.
  const margin = 1e-6 * Math.max(1, radius,
    Math.abs(e[0] * bounds.center.x) + Math.abs(e[4] * bounds.center.y) + Math.abs(e[8] * bounds.center.z) + Math.abs(e[12]),
    Math.abs(e[1] * bounds.center.x) + Math.abs(e[5] * bounds.center.y) + Math.abs(e[9] * bounds.center.z) + Math.abs(e[13]),
    Math.abs(e[2] * bounds.center.x) + Math.abs(e[6] * bounds.center.y) + Math.abs(e[10] * bounds.center.z) + Math.abs(e[14]));
  let outside = false;
  for (let index = 0; index < view.planes.length; index++) {
    const plane = view.planes[index];
    const n = plane.normal, length = Math.hypot(n.x, n.y, n.z);
    if (!Number.isFinite(length) || length === 0 || !Number.isFinite(plane.constant)) return false;
    const distance = n.x * x + n.y * y + n.z * z + plane.constant;
    if (!Number.isFinite(distance)) return false;
    // Three's first four planes are right/left/bottom/top. Validate near/far
    // too, but never reject using their numerically sensitive depth boundary.
    if (index < 4) outside ||= distance < -(radius + margin) * length;
  }
  return outside;
}

/** Presentation adapter. Neither a frame nor a diagnostics read advances the campaign. */
export class CampaignScene {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(FLIGHT_FOV, 1, .5, 22000);
  private readonly scene = new Scene();
  private readonly renderQueue: RenderQueue;
  private readonly hudLayout: CampaignHudLayout;
  private bombGuideLabel: (ReturnType<typeof layoutCampaignCanvasLabel> & { id: 'bomb-guide'; text: string }) | null = null;
  private readonly aircraftFactory = new AircraftFactory();
  private readonly aircraftBatches = new AircraftBatchFactory();
  private readonly aircraftTracers = new AircraftTracers();
  private readonly hero: AircraftVisual;
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();
  private readonly ground = new Map<string, InstancedMesh>();
  private readonly shadows: InstancedMesh;
  private readonly dragonBodies: InstancedMesh;
  private readonly dragonWings: InstancedMesh;
  private readonly siteVisuals = new Map<number, SiteVisual>();
  private readonly projectileBodies = new Map<string, InstancedMesh>();
  private readonly trailPositions = new Float32Array(PROJECTILE_CAPACITY * 6);
  private readonly trailColors = new Float32Array(PROJECTILE_CAPACITY * 6);
  private readonly trailGeometry: BufferGeometry;
  private readonly telegraphPositions = new Float32Array(TELEGRAPH_CAPACITY * 6);
  private readonly telegraphColors = new Float32Array(TELEGRAPH_CAPACITY * 6);
  private readonly telegraphGeometry: BufferGeometry;
  private readonly pointPositions = new Float32Array((EFFECT_CAPACITY + PROJECTILE_CAPACITY) * 3);
  private readonly pointColors = new Float32Array((EFFECT_CAPACITY + PROJECTILE_CAPACITY) * 3);
  private readonly pointSizes = new Float32Array(EFFECT_CAPACITY + PROJECTILE_CAPACITY);
  private readonly pointOpacity = new Float32Array(EFFECT_CAPACITY + PROJECTILE_CAPACITY);
  private readonly pointGeometry: BufferGeometry;
  private readonly sky: Mesh;
  private readonly groundView = new Frustum();
  private readonly viewProjection = new Matrix4();
  private readonly tempMatrix = new Matrix4();
  private readonly tempRotation = new Quaternion();
  private readonly tempPosition = new Vector3();
  private readonly tempScale = new Vector3(1, 1, 1);
  private readonly up = new Vector3(0, 1, 0);
  private readonly forward = new Vector3(0, 0, -1);
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  private particles: Particle[] = [];
  private runId: string | null = null;
  private lastEvent = 0;
  private lastTick = -1;
  private visualTime = 0;
  private width = 1;
  private height = 1;
  private disposed = false;
  private prepared = false;
  private overlayVisible = true;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly overlay?: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    if (!('fenceSync' in gl)) throw new Error('WebGL2 is required');
    this.renderQueue = new RenderQueue(gl);
    // Kaisen renderer, lighting, hero geometry, paint and camera contract.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene.background = new Color(0xaecbd0);
    this.scene.fog = new Fog(0xaecbd0, 1400, 6000);
    this.scene.add(new HemisphereLight(0xc6e5ec, 0x23424e, 2.3));
    const sun = new DirectionalLight(0xffe9b5, 3.1); sun.position.set(-600, 700, -350); this.scene.add(sun);
    this.hero = this.aircraftBatches.optimize(this.aircraftFactory.create('hero'), 'hero');
    this.scene.add(this.hero.root, this.aircraftTracers.root);
    this.ctx = overlay?.getContext('2d') ?? null;
    this.hudLayout = createCampaignHudLayout(canvas);

    const solid = this.material(new MeshStandardMaterial({ vertexColors: true, roughness: .84, metalness: .06 }));
    for (const geometry of terrainChunks(createCampaignTerrainGeometry())) this.scene.add(new Mesh(this.geometry(geometry), solid));
    this.buildRoadsAndRocks();
    for (const team of ['friendly', 'enemy'] as const) for (const kind of GROUND_CLASSES) {
      this.ground.set(`${team}:${kind}`, this.batch(this.geometry(unitGeometry(kind, team)), solid, GROUND_CAPACITY, `${team}-${kind}`));
    }
    const shadowGeometry = this.geometry(new CircleGeometry(1, 10)); shadowGeometry.rotateX(-Math.PI / 2);
    this.shadows = this.batch(shadowGeometry,
      this.material(new MeshBasicMaterial({ color: 0x193630, transparent: true, opacity: .22, depthWrite: false })), GROUND_CAPACITY * 2, 'ground shadows');
    this.dragonBodies = this.batch(this.geometry(dragonBodyGeometry()), solid, DRAGON_CAPACITY, 'live dragons');
    this.dragonWings = this.batch(this.geometry(dragonWingGeometry()),
      this.material(new MeshStandardMaterial({ vertexColors: true, roughness: .82, side: DoubleSide })), DRAGON_CAPACITY * 2, 'dragon wings');

    const missileMaterial = this.material(new MeshStandardMaterial({ color: 0xdec697, roughness: .55, metalness: .25 }));
    this.projectileBodies.set('arrow', this.batch(this.geometry(new CylinderGeometry(.04, .04, 1.3, 4)), missileMaterial, PROJECTILE_CAPACITY, 'live arrows'));
    const bomb = new GeometryBuilder().add(new CylinderGeometry(.07, .22, 1.5, 8), 0x667982);
    for (const yaw of [0, Math.PI / 2]) bomb.add(new BoxGeometry(.8, .24, .04), 0x667982, [0, -.58, 0], [1, 1, 1], [0, yaw, 0]);
    this.projectileBodies.set('bomb', this.batch(this.geometry(bomb.finish()), solid, 4, 'live bombs'));
    const glowGeometry = this.geometry(new SphereGeometry(1, 9, 6));
    for (const [kind, color] of [['magic', 0x92e9d5], ['turret', 0xffed8f], ['fireball', 0xff842b]] as const) {
      this.projectileBodies.set(kind, this.batch(glowGeometry,
        this.material(new MeshBasicMaterial({ color })), PROJECTILE_CAPACITY, `live ${kind}`));
    }
    this.trailGeometry = this.lineBatch(this.trailPositions, this.trailColors, .9);
    this.telegraphGeometry = this.lineBatch(this.telegraphPositions, this.telegraphColors, .62);
    this.pointGeometry = this.geometry(new BufferGeometry());
    this.pointGeometry.setAttribute('position', new BufferAttribute(this.pointPositions, 3));
    this.pointGeometry.setAttribute('color', new BufferAttribute(this.pointColors, 3));
    this.pointGeometry.setAttribute('size', new BufferAttribute(this.pointSizes, 1));
    this.pointGeometry.setAttribute('opacity', new BufferAttribute(this.pointOpacity, 1));
    this.pointGeometry.setDrawRange(0, 0);
    const particles = new Points(this.pointGeometry, this.material(new ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      vertexShader: 'attribute float size;attribute float opacity;varying vec3 vColor;varying float vAlpha;void main(){vColor=color;vAlpha=opacity;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=size<0.?-size:clamp(size*450./max(1.,-p.z),1.,80.);gl_Position=projectionMatrix*p;}',
      fragmentShader: 'varying vec3 vColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;gl_FragColor=vec4(vColor,pow(1.-d,1.7)*.8*vAlpha);}',
    }))); particles.frustumCulled = false; this.scene.add(particles);
    this.sky = new Mesh(this.geometry(new SphereGeometry(21000, 32, 20)),
      this.material(new ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, side: BackSide, depthWrite: false })));
    this.scene.add(this.sky);
    this.resize();
  }

  private geometry<T extends BufferGeometry>(geometry: T): T { this.geometries.add(geometry); return geometry; }
  private material<T extends Material>(material: T): T { this.materials.add(material); return material; }
  private batch(geometry: BufferGeometry, material: Material, capacity: number, name: string) {
    const mesh = new InstancedMesh(geometry, material, capacity); mesh.name = name;
    mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(DynamicDrawUsage); this.scene.add(mesh); return mesh;
  }
  private lineBatch(positions: Float32Array, colors: Float32Array, opacity: number) {
    const geometry = this.geometry(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(positions, 3)); geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);
    const lines = new LineSegments(geometry, this.material(new LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false })));
    lines.frustumCulled = false; this.scene.add(lines); return geometry;
  }
  private buildRoadsAndRocks() {
    const roadMaterial = this.material(new MeshStandardMaterial({ color: 0x9b9375, roughness: .94, polygonOffset: true, polygonOffsetFactor: -1 }));
    for (let lane = 0; lane < 7; lane++) {
      this.scene.add(new Mesh(this.geometry(roadGeometry([radialPosition(lane, 600), radialPosition(lane, 1360)])), roadMaterial));
      this.scene.add(new Mesh(this.geometry(roadGeometry(route(lane, (lane + 1) % 7), 8)), roadMaterial));
    }
    const rockMaterial = this.material(new MeshStandardMaterial({ color: 0x879083, roughness: .97, flatShading: true }));
    const rockGeometry = this.geometry(new BoxGeometry(2, 2, 2));
    for (const obstacle of TERRAIN_OBSTACLES) {
      // The solid silhouette is exactly the collision OBB, including its yaw.
      const rock = new Mesh(rockGeometry, rockMaterial);
      rock.position.set(obstacle.position.x, obstacle.position.y, obstacle.position.z);
      rock.scale.set(obstacle.halfSize.x, obstacle.halfSize.y, obstacle.halfSize.z);
      rock.rotation.y = -obstacle.yaw; this.scene.add(rock);
    }
  }
  private createSite(id: number, position: Vec): SiteVisual {
    const root = new Group(); root.position.set(position.x, position.y, position.z);
    const stone = this.material(new MeshStandardMaterial({ color: 0xaaa68b, roughness: .89 }));
    const flagMaterial = this.material(new MeshStandardMaterial({ color: TEAM_COLORS.enemy, roughness: .92, side: DoubleSide }));
    const pole = new Mesh(this.geometry(new CylinderGeometry(.18, .22, 15, 8)), stone); pole.position.set(13, 7.5, 8); root.add(pole);
    const flagGeometry = this.geometry(new PlaneGeometry(5.2, 3.2, 5, 1)); flagGeometry.translate(2.6, -1.6, 0);
    const flag = new Mesh(flagGeometry, flagMaterial); flag.position.set(13, 14.6, 8); flag.rotation.y = id * Math.PI * 2 / 7; root.add(flag);
    const courtyard = new Mesh(this.geometry(new CylinderGeometry(10, 12, .6, 12)), stone); courtyard.position.y = .1; root.add(courtyard);
    // Open, low curb stones communicate the site without adding unseen blockers.
    const curbGeometry = this.geometry(new BoxGeometry(7, .45, 1.4));
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI * 2 / 12, x = Math.cos(angle) * 31, z = Math.sin(angle) * 31;
      const curb = new Mesh(curbGeometry, stone); curb.position.set(x, heightAt(position.x + x, position.z + z) - position.y + .18, z);
      curb.rotation.y = -angle + Math.PI / 2; root.add(curb);
    }
    const turret = new Group();
    const pedestal = new Mesh(this.geometry(new CylinderGeometry(3.6, 4.6, 4.7, 8)), stone); pedestal.position.y = 2.6; turret.add(pedestal);
    const collar = new Mesh(this.geometry(new TorusGeometry(3.4, .25, 5, 12)), stone); collar.rotation.x = Math.PI / 2; collar.position.y = 5.2; turret.add(collar);
    const crystal = new Mesh(this.geometry(new OctahedronGeometry(2)), this.material(new MeshBasicMaterial({ color: 0xefda8d }))); crystal.position.y = 6; turret.add(crystal);
    const ribGeometry = this.geometry(new CylinderGeometry(.22, .37, 4.6, 6));
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, rib = new Mesh(ribGeometry, stone); rib.position.set(Math.cos(a) * 3.1, 4.1, Math.sin(a) * 3.1); rib.rotation.z = Math.cos(a) * .26; rib.rotation.x = -Math.sin(a) * .26; turret.add(rib);
    }
    root.add(turret); this.scene.add(root);
    const visual = { root, flag, turret, crystal }; this.siteVisuals.set(id, visual); return visual;
  }

  resize() {
    if (this.disposed) return;
    const bounds = this.canvas.getBoundingClientRect(); if (bounds.width <= 0 || bounds.height <= 0) return;
    this.width = bounds.width; this.height = bounds.height; this.hudLayout.invalidate();
    this.renderer.setSize(bounds.width, bounds.height, false);
    this.camera.aspect = bounds.width / bounds.height; this.camera.updateProjectionMatrix();
    if (this.overlay) { this.overlay.width = Math.round(bounds.width); this.overlay.height = Math.round(bounds.height); }
  }
  async prepare(): Promise<void> {
    if (this.disposed) return;
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed) return;
    const sample = new Vector3(0, 0, -80).applyQuaternion(this.camera.quaternion).add(this.camera.position);
    this.trailPositions.set([sample.x - 1, sample.y, sample.z, sample.x + 1, sample.y, sample.z]);
    this.trailColors.set([1, .8, .4, 1, .8, .4]);
    this.pointPositions.set([sample.x, sample.y, sample.z]); this.pointColors.set([1, .6, .2]); this.pointSizes[0] = 8; this.pointOpacity[0] = 1;
    for (const geometry of [this.trailGeometry, this.pointGeometry]) for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
    this.trailGeometry.setDrawRange(0, 2); this.pointGeometry.setDrawRange(0, 1); this.aircraftTracers.prime(sample);
    this.renderer.render(this.scene, this.camera);
    this.trailGeometry.setDrawRange(0, 0); this.pointGeometry.setDrawRange(0, 0); this.aircraftTracers.update([]);
    this.renderer.render(this.scene, this.camera); this.renderQueue.submit(performance.now());
    while (!this.disposed) {
      const status = this.renderQueue.poll(performance.now());
      if (status === 'ready') break;
      if (status === 'failed') throw new Error('Initial GPU frame failed');
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    if (!this.disposed) this.prepared = true;
  }
  pollRender(now = performance.now()) { return this.prepared ? this.renderQueue.poll(now) : 'ready'; }
  resetRenderQueue() { this.renderQueue.reset(); }
  setOverlayVisible(visible: boolean) { this.overlayVisible = visible; if (!visible) this.ctx?.clearRect(0, 0, this.width, this.height); }
  gunSight(player: Aircraft) { return projectGunSight(player, [], this.width, this.height); }

  render(state: CampaignState, player: Aircraft, mode: 'normal' | 'easy', presentationDt = 0): boolean {
    if (this.disposed) return false;
    // Bind event ownership before checking the previous frame's GPU fence.
    if (this.runId !== state.runId || state.simTick < this.lastTick) {
      this.runId = state.runId; this.lastEvent = 0; this.lastTick = -1;
      this.particles = []; this.visualTime = state.simTick / 60;
    }
    if (this.pollRender() !== 'ready') return false;
    const dt = this.lastTick < 0 ? 0 : Math.max(0, Math.min(.1, (state.simTick - this.lastTick) / 60));
    this.lastTick = state.simTick;
    if (state.status === 'victory' || state.status === 'defeat') this.visualTime += Math.max(0, Math.min(.1, presentationDt));
    else this.visualTime = state.simTick / 60;
    this.hero.root.visible = player.health > 0;
    this.hero.root.position.copy(player.position); this.hero.root.quaternion.copy(player.quaternion);
    this.hero.propeller.rotation.z = (this.hero.propeller.rotation.z + dt * (34 + Math.min(8, player.speed * .035))) % (Math.PI * 2);
    const bank = Math.max(-.3, Math.min(.3, player.bank * .34));
    this.hero.ailerons[0].rotation.x = bank; this.hero.ailerons[1].rotation.x = -bank;
    this.hero.elevator.rotation.x = Math.max(-.26, Math.min(.26, -player.pitch * .32));
    getFlightCameraPose(player, mode, this.camera.position, this.camera.quaternion);
    this.camera.updateMatrixWorld(); this.sky.position.copy(this.camera.position);
    this.groundView.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.updateActors(state);
    this.updateProjectiles(state);
    this.updateTelegraphs(state);
    this.updateEffects(state);
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(state, player, mode);
    if (this.prepared) this.renderQueue.submit(performance.now());
    return true;
  }

  private targetPosition(state: CampaignState, actor: CampaignActor): Vec | null {
    if (actor.lockedAim) return actor.lockedAim;
    const target = resolveTarget(state, actor.targetRef); if (!target) return null;
    return actor.phase === 'telegraph' && ACTOR_STATS[actor.class].projectileSpeed > 0
      ? predictAim(actor.position, target, ACTOR_STATS[actor.class].projectileSpeed) : target.position;
  }
  private updateActors(state: CampaignState) {
    const counts = new Map<string, number>(), admitted = new Map<string, number>(); let shadowCount = 0, dragons = 0;
    const actorsById = new Map(state.actors.map(actor => [actor.id, actor]));
    for (const site of state.sites) {
      const visual = this.siteVisuals.get(site.id) ?? this.createSite(site.id, site.position);
      (visual.flag.material as MeshStandardMaterial).color.setHex(site.owner === 'neutral' ? 0xd0c6a2 : TEAM_COLORS[site.owner]);
      const turret = actorsById.get(site.turretId), alive = !!turret && turret.hp > 0;
      visual.crystal.visible = alive;
      visual.crystal.rotation.y = this.visualTime * .45;
      visual.turret.scale.y = alive ? 1 : .35;
      (visual.crystal.material as MeshBasicMaterial).color.setHex(turret?.phase === 'telegraph' ? turret.lockedAim ? 0xfff0bb : 0xff8e51 : 0xefda8d);
    }
    for (const actor of state.actors) {
      if (actor.hp <= 0 || actor.kind === 'turret') continue;
      this.tempPosition.set(actor.position.x, actor.position.y, actor.position.z);
      this.tempScale.set(1, 1, 1);
      if (actor.kind === 'dragon') {
        if (dragons >= DRAGON_CAPACITY) continue;
        const direction = new Vector3(actor.velocity.x, actor.velocity.y, actor.velocity.z);
        if (direction.lengthSq() < .001) direction.set(0, 0, -1); else direction.normalize();
        this.tempRotation.setFromUnitVectors(this.forward, direction);
        this.tempMatrix.compose(this.tempPosition, this.tempRotation, this.tempScale);
        this.dragonBodies.setMatrixAt(dragons, this.tempMatrix);
        const flap = Math.sin(this.visualTime * 4.4 + actor.id * 1.71) * (this.reducedMotion?.matches ? .12 : .38) + .12;
        for (let side = 0; side < 2; side++) {
          const sign = side === 0 ? -1 : 1;
          const position = new Vector3(sign * 1.3, -1.2, 6.9).applyQuaternion(this.tempRotation).add(this.tempPosition);
          const rotation = this.tempRotation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sign * flap));
          this.tempMatrix.compose(position, rotation, new Vector3(sign, 1, 1));
          this.dragonWings.setMatrixAt(dragons * 2 + side, this.tempMatrix);
        }
        dragons++; continue;
      }
      const key = `${actor.team}:${actor.class}`, mesh = this.ground.get(key);
      if (!mesh) continue;
      // Keep the original capacity-limited actor prefix, before view rejection.
      const admission = admitted.get(key) ?? 0; if (admission >= GROUND_CAPACITY) continue;
      admitted.set(key, admission + 1);
      const target = this.targetPosition(state, actor);
      let dx = actor.velocity.x, dz = actor.velocity.z;
      if (dx * dx + dz * dz < .01 && target) { dx = target.x - actor.position.x; dz = target.z - actor.position.z; }
      if (dx * dx + dz * dz < .01) { const site = state.sites[actor.assignedSiteId]; dx = site.position.x - actor.position.x; dz = site.position.z - actor.position.z; }
      this.tempRotation.setFromAxisAngle(this.up, Math.atan2(-dx, -dz));
      this.tempMatrix.compose(this.tempPosition, this.tempRotation, this.tempScale);
      // Ground models are rigid opaque geometry, without shader deformation,
      // reflection passes or shadow maps. Their separate circle shadows below
      // remain submitted even when the body is wholly outside the camera.
      if (!groundInstanceOutsideView(mesh.geometry.boundingSphere, this.tempMatrix, this.groundView)) {
        const count = counts.get(key) ?? 0;
        mesh.setMatrixAt(count, this.tempMatrix); counts.set(key, count + 1);
      }
      this.tempPosition.y = heightAt(actor.position.x, actor.position.z) + .14;
      this.tempScale.set(actor.class === 'cavalry' ? 2 : .82, 1, actor.class === 'cavalry' ? 2.5 : .82);
      this.tempMatrix.compose(this.tempPosition, this.tempRotation, this.tempScale); this.shadows.setMatrixAt(shadowCount++, this.tempMatrix);
    }
    for (const [key, mesh] of this.ground) { mesh.count = counts.get(key) ?? 0; mesh.instanceMatrix.needsUpdate = true; }
    for (const [mesh, count] of [[this.shadows, shadowCount], [this.dragonBodies, dragons], [this.dragonWings, dragons * 2]] as const) {
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updateProjectiles(state: CampaignState) {
    const bullets: Bullet[] = [], counts = new Map<string, number>(); let trails = 0;
    for (const projectile of state.projectiles) {
      if (projectile.ttl <= 0) continue;
      if (projectile.kind === 'mg' || projectile.kind === 'cannon') {
        bullets.push({ id: projectile.id, owner: projectile.sourceRef.id, team: projectile.team, kind: projectile.kind,
          position: new Vector3(projectile.position.x, projectile.position.y, projectile.position.z),
          previous: new Vector3(projectile.previous.x, projectile.previous.y, projectile.previous.z),
          velocity: new Vector3(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z),
          life: projectile.ttl / 60, damage: projectile.damage });
        continue;
      }
      const mesh = this.projectileBodies.get(projectile.kind), count = counts.get(projectile.kind) ?? 0;
      if (!mesh || count >= mesh.instanceMatrix.count) continue;
      const direction = new Vector3(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z).normalize();
      if (direction.lengthSq() < .1) direction.set(0, -1, 0);
      this.tempRotation.setFromUnitVectors(this.up, direction);
      this.tempPosition.set(projectile.position.x, projectile.position.y, projectile.position.z);
      const scale = projectile.kind === 'bomb' || projectile.kind === 'arrow' ? 1 : projectile.radius;
      this.tempScale.setScalar(scale); this.tempMatrix.compose(this.tempPosition, this.tempRotation, this.tempScale);
      mesh.setMatrixAt(count, this.tempMatrix); counts.set(projectile.kind, count + 1);
      if (projectile.kind !== 'bomb' && trails < PROJECTILE_CAPACITY) {
        // The tail follows the authoritative straight trajectory, never a visual arc.
        const tail = Math.min(.065, Math.max(0, (state.simTick - projectile.bornTick) / 60));
        this.trailPositions.set([projectile.position.x - projectile.velocity.x * tail,
          projectile.position.y - projectile.velocity.y * tail, projectile.position.z - projectile.velocity.z * tail,
          projectile.position.x, projectile.position.y, projectile.position.z], trails * 6);
        const color = projectile.kind === 'fireball' ? [1, .38, .075] : projectile.team === 'friendly' ? [.46, .94, .84] : [1, .76, .33];
        this.trailColors.set([...color, ...color], trails++ * 6);
      }
    }
    this.aircraftTracers.update(bullets);
    for (const [kind, mesh] of this.projectileBodies) { mesh.count = counts.get(kind) ?? 0; mesh.instanceMatrix.needsUpdate = true; }
    this.trailGeometry.setDrawRange(0, trails * 2); this.trailGeometry.attributes.position.needsUpdate = true; this.trailGeometry.attributes.color.needsUpdate = true;
  }

  private updateTelegraphs(state: CampaignState) {
    let count = 0;
    for (const actor of state.actors) {
      if (actor.hp <= 0 || actor.phase !== 'telegraph' || actor.class === 'sword' || actor.class === 'cavalry' || count >= TELEGRAPH_CAPACITY) continue;
      const aim = this.targetPosition(state, actor); if (!aim) continue;
      this.telegraphPositions.set([actor.position.x, actor.position.y, actor.position.z, aim.x, aim.y, aim.z], count * 6);
      const color = actor.lockedAim ? [1, .87, .63] : actor.team === 'friendly' ? [.28, .75, .71] : [1, .48, .27];
      this.telegraphColors.set([...color, ...color], count++ * 6);
    }
    this.telegraphGeometry.setDrawRange(0, count * 2); this.telegraphGeometry.attributes.position.needsUpdate = true; this.telegraphGeometry.attributes.color.needsUpdate = true;
  }

  private updateEffects(state: CampaignState) {
    const previouslySeen = this.lastEvent; let newestEvent = previouslySeen;
    for (const event of state.events) {
      if (event.id <= previouslySeen) continue;
      newestEvent = Math.max(newestEvent, event.id);
      if (!event.position || !['hit', 'kill', 'explosion', 'selfLoss'].includes(event.kind)) continue;
      const born = event.tick / 60;
      if (this.visualTime - born > 2.5) continue;
      const heavy = event.kind !== 'hit', count = heavy ? this.reducedMotion?.matches ? 6 : 12 : 3;
      for (let i = 0; i < count; i++) {
        const angle = (event.id * 31 + i * 17) * 2.399963;
        this.particles.push({ position: new Vector3(event.position.x, event.position.y, event.position.z),
          velocity: new Vector3(Math.cos(angle) * (heavy ? 15 : 4), 5 + i % 9, Math.sin(angle) * (heavy ? 15 : 4)),
          born, life: heavy ? 2.2 : .65, color: new Color(heavy && i % 2 === 0 ? 0x495347 : i % 3 === 0 ? 0xffd993 : 0xed7a28), size: heavy ? 19 : 5 });
      }
    }
    this.lastEvent = newestEvent;
    this.particles = this.particles.filter(p => this.visualTime - p.born < p.life).slice(-EFFECT_CAPACITY);
    let count = 0;
    for (const particle of this.particles) {
      const age = this.visualTime - particle.born, position = particle.position.clone().addScaledVector(particle.velocity, age); position.y -= age * age * 4;
      this.pointPositions.set([position.x, position.y, position.z], count * 3); this.pointColors.set([particle.color.r, particle.color.g, particle.color.b], count * 3);
      this.pointSizes[count] = particle.size * (1 + age * .4); this.pointOpacity[count++] = Math.max(0, 1 - age / particle.life);
    }
    for (const projectile of state.projectiles) {
      if (!['magic', 'turret', 'fireball'].includes(projectile.kind) || projectile.ttl <= 0 || count >= EFFECT_CAPACITY + PROJECTILE_CAPACITY) continue;
      this.pointPositions.set([projectile.position.x, projectile.position.y, projectile.position.z], count * 3);
      this.pointColors.set(projectile.kind === 'fireball' ? [1, .4, .08] : projectile.team === 'friendly' ? [.4, 1, .83] : [1, .86, .4], count * 3);
      this.pointSizes[count] = Math.max(4, projectile.radius * 10); this.pointOpacity[count++] = .88;
    }
    this.pointGeometry.setDrawRange(0, count); for (const attribute of Object.values(this.pointGeometry.attributes)) attribute.needsUpdate = true;
  }

  private projection(position: Vec) {
    const world = new Vector3(position.x, position.y, position.z), p = world.clone().project(this.camera);
    const depth = world.sub(this.camera.position).dot(new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion));
    return { x: (p.x * .5 + .5) * this.width, y: (.5 - p.y * .5) * this.height, depth, nx: p.x, ny: p.y, z: p.z };
  }
  private drawOverlay(state: CampaignState, player: Aircraft, mode: 'normal' | 'easy') {
    this.bombGuideLabel = null;
    const c = this.ctx, w = this.width, h = this.height; if (!c) return;
    c.shadowBlur = 0; c.clearRect(0, 0, w, h); if (!this.overlayVisible) return;
    const sight = mode === 'normal' ? this.gunSight(player) : { x: w / 2, y: h / 2 };
    const radius = aimRadius(mode, w, h);
    // Reserve the actual sight, crosshair and reload-ring fringe without changing them.
    const sightExtent = radius + 10;
    this.hudLayout.update({ x: sight.x - sightExtent, y: sight.y - sightExtent, width: sightExtent * 2, height: sightExtent * 2 });
    let indicator: keyof typeof AIM_COLORS = 'clear';
    for (const actor of state.actors) {
      if (actor.hp <= 0) continue;
      const world = new Vector3(actor.position.x, actor.position.y, actor.position.z);
      const p = projectFlightTarget(player, world, w / h, mode);
      if (p.depth <= 0 || p.distance > 1500 || Math.hypot((p.x * .5 + .5) * w - sight.x, (.5 - p.y * .5) * h - sight.y) > radius) continue;
      if (actor.team === 'friendly') { indicator = 'friendly'; break; }
      indicator = 'enemy';
    }
    const aimColor = AIM_COLORS[indicator];
    c.strokeStyle = aimColor; c.lineWidth = 1; c.beginPath(); c.arc(sight.x, sight.y, radius, 0, Math.PI * 2);
    if (mode === 'normal') {
      c.moveTo(sight.x - radius - 6, sight.y); c.lineTo(sight.x - radius + 5, sight.y);
      c.moveTo(sight.x + radius - 5, sight.y); c.lineTo(sight.x + radius + 6, sight.y);
      c.moveTo(sight.x, sight.y - radius - 6); c.lineTo(sight.x, sight.y - radius + 5);
      c.moveTo(sight.x, sight.y + radius - 5); c.lineTo(sight.x, sight.y + radius + 6);
      c.strokeStyle = 'rgba(3,25,39,.65)'; c.lineWidth = 2; c.stroke(); c.strokeStyle = aimColor; c.lineWidth = 1;
    }
    c.stroke(); c.fillStyle = aimColor; c.fillRect(sight.x - 1, sight.y - 1, 2, 2);
    if (state.player.reloadUntilTick !== null) {
      const progress = Math.max(0, Math.min(1, 1 - (state.player.reloadUntilTick - state.simTick) / 360));
      c.strokeStyle = 'rgba(7,30,43,.8)'; c.lineWidth = 5; c.beginPath(); c.arc(sight.x, sight.y, radius + 7, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#ffd27a'; c.lineWidth = 3; c.beginPath(); c.arc(sight.x, sight.y, radius + 7, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); c.stroke();
    }
    this.drawBombGuide(state);
    c.shadowColor = 'rgba(0,20,30,.9)'; c.shadowBlur = 3; c.font = '600 11px system-ui'; c.textAlign = 'center';
    for (const site of state.sites) {
      const marker = this.projection({ x: site.position.x + 13, y: site.position.y + 22, z: site.position.z + 8 });
      if (marker.depth <= 0 || Math.abs(marker.nx) > .92 || Math.abs(marker.ny) > .76) continue;
      c.fillStyle = site.owner === 'friendly' ? '#77dacb' : site.owner === 'enemy' ? '#ffb28b' : '#e5dcc2';
      c.strokeStyle = c.fillStyle; c.lineWidth = 1;
      c.beginPath(); c.arc(marker.x, marker.y, 9, 0, Math.PI * 2); c.stroke();
      c.fillText(String(site.id + 1), marker.x, marker.y + 4);
      c.fillText(`${site.owner === 'friendly' ? '味方' : site.owner === 'enemy' ? '敵' : '中立'}${site.contested ? ' · 争奪' : ''}`, marker.x, marker.y - 16);
    }
    let groundLabels = 0;
    const actors = state.actors.filter(actor => actor.hp > 0).sort((a, b) => {
      const da = (a.position.x - player.position.x) ** 2 + (a.position.y - player.position.y) ** 2 + (a.position.z - player.position.z) ** 2;
      const db = (b.position.x - player.position.x) ** 2 + (b.position.y - player.position.y) ** 2 + (b.position.z - player.position.z) ** 2; return da - db;
    });
    for (const actor of actors) {
      const distance = Math.hypot(actor.position.x - player.position.x, actor.position.y - player.position.y, actor.position.z - player.position.z);
      if (distance > 1500 || actor.kind === 'ground' && (distance > 320 || groundLabels >= 16)) continue;
      const marker = this.projection(actor.position);
      if (marker.depth <= 0 || Math.abs(marker.nx) > .94 || Math.abs(marker.ny) > .82) continue;
      const x = marker.x, y = marker.y, friendly = actor.team === 'friendly';
      c.strokeStyle = friendly ? '#77dacb' : '#ffb28b'; c.fillStyle = c.strokeStyle; c.lineWidth = 1.25;
      c.beginPath();
      if (friendly) c.arc(x, y, 4, 0, Math.PI * 2);
      else if (actor.kind === 'turret') c.rect(x - 8, y - 4, 16, 8);
      else if (actor.kind === 'dragon') {
        c.moveTo(x, y - 6); c.lineTo(x + 5, y); c.lineTo(x, y + 6); c.lineTo(x - 5, y); c.closePath();
        c.moveTo(x - 5, y); c.lineTo(x - 11, y - 4); c.moveTo(x + 5, y); c.lineTo(x + 11, y - 4);
      } else { c.moveTo(x, y - 3); c.lineTo(x + 3, y + 3); c.lineTo(x - 3, y + 3); c.closePath(); }
      c.stroke();
      if (actor.kind === 'ground') { c.fillText(UNIT_NAMES[actor.class as GroundClass], x, y - 8); groundLabels++; }
      else {
        c.fillStyle = 'rgba(7,24,32,.8)'; c.fillRect(x - 19, y + 12, 38, 3);
        c.fillStyle = '#ffc69b'; c.fillRect(x - 19, y + 12, 38 * actor.hp / actor.maxHp, 3);
        c.fillStyle = '#f4e3c8'; c.fillText(`${actor.kind === 'turret' ? '砲台' : '竜'} ${Math.round(distance)}m`, x, y + 28);
      }
    }
    this.drawThreats(state);
    c.shadowBlur = 0; this.drawRadar(state, player);
  }
  private drawBombGuide(state: CampaignState) {
    this.bombGuideLabel = null;
    const c = this.ctx!; if (state.player.bombs <= 0 || state.player.hp <= 0) return;
    const guide = predictBombImpact(state.player.position, state.player.velocity, state.player.quaternion); if (!guide) return;
    const point = this.projection(guide.position);
    if (point.depth <= 0 || point.z <= -1 || point.z >= 1 || Math.abs(point.nx) >= .94 || Math.abs(point.ny) >= .82) return;
    const blastStart = { ...guide.position, y: Math.max(guide.position.y, heightAt(guide.position.x, guide.position.z)) + .1 };
    const affected = state.actors.filter(actor => {
      if (actor.hp <= 0) return false;
      const distance = Math.hypot(actor.position.x - guide.position.x, actor.position.y - guide.position.y, actor.position.z - guide.position.z);
      return Math.floor(Math.max(0, 240 * (1 - distance / guide.radius)) + .5) > 0 && sweepSphere(blastStart, actor.position, 0) === null;
    });
    const friendlyRisk = state.mode === 'normal' && affected.some(actor => actor.team === 'friendly');
    c.save(); c.strokeStyle = friendlyRisk ? '#79bfff' : affected.some(actor => actor.team === 'enemy') ? '#88ffad' : '#eef5ee'; c.fillStyle = c.strokeStyle; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(point.x - 8, point.y); c.lineTo(point.x + 8, point.y); c.moveTo(point.x, point.y - 8); c.lineTo(point.x, point.y + 8); c.stroke();
    c.globalAlpha = .65; c.setLineDash([3, 3]); c.lineWidth = 1; c.beginPath();
    for (let i = 0; i <= 32; i++) {
      const angle = i / 32 * Math.PI * 2, x = guide.position.x + Math.cos(angle) * guide.radius, z = guide.position.z + Math.sin(angle) * guide.radius;
      const edge = this.projection({ x, y: heightAt(x, z) + .2, z });
      if (edge.depth <= 0) continue; if (i === 0) c.moveTo(edge.x, edge.y); else c.lineTo(edge.x, edge.y);
    }
    c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    const label = `${friendlyRisk ? '味方爆風注意' : '爆弾の落下目安'} · ${(guide.flightTicks / 60).toFixed(1)}秒`;
    c.font = '600 10px system-ui'; c.textAlign = 'left';
    const labelWidth = c.measureText(label).width + 12;
    const labelX = point.x + 32 + labelWidth < this.width - 12 ? point.x + 32 : Math.max(12, point.x - 32 - labelWidth);
    const labelY = Math.max(76, Math.min(this.height - 60, point.y - 36));
    const placed = this.hudLayout.placeCanvasLabel('bomb-guide', { x: labelX, y: labelY, width: labelWidth, height: 20 });
    this.bombGuideLabel = { id: 'bomb-guide', text: label, ...placed };
    c.fillStyle = 'rgba(4,24,34,.78)'; c.fillRect(placed.rect.x, placed.rect.y, labelWidth, 20);
    c.fillStyle = friendlyRisk ? '#b2d8ff' : '#d1ffe3'; c.fillText(label, placed.rect.x + 6, placed.rect.y + 14); c.restore();
  }
  private drawThreats(state: CampaignState) {
    const c = this.ctx!, w = this.width, h = this.height;
    const threats = state.actors.filter(actor => actor.hp > 0 && actor.team === 'enemy' && actor.phase === 'telegraph' && actor.targetRef?.id === state.player.id)
      .sort((a, b) => (a.fireAtTick ?? Infinity) - (b.fireAtTick ?? Infinity)).slice(0, 3);
    for (const actor of threats) {
      const p = this.projection(actor.position), locked = actor.lockedAim !== null;
      c.save(); c.strokeStyle = locked ? '#fff0bb' : '#ff9d69'; c.fillStyle = c.strokeStyle; c.lineWidth = locked ? 2 : 1.2;
      if (p.depth > 0 && Math.abs(p.nx) < .88 && Math.abs(p.ny) < .7) {
        c.beginPath(); c.arc(p.x, p.y, locked ? 16 : 13, 0, Math.PI * 2); c.stroke();
        c.font = '600 10px system-ui'; c.textAlign = 'center';
        c.fillText(`${actor.class === 'turret' ? '砲台' : actor.class === 'dragon' ? '竜火球' : actor.class === 'bow' ? '矢' : '魔法'} ${locked ? '固定' : '予告'} ${Math.max(0, ((actor.fireAtTick ?? state.simTick) - state.simTick) / 60).toFixed(1)}秒`, p.x, p.y - 23);
      } else {
        let dx = p.nx * (p.depth > 0 ? 1 : -1), dy = -p.ny * (p.depth > 0 ? 1 : -1);
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < .01) { dx = 0; dy = 1; }
        const scale = Math.min((w / 2 - 30) / Math.max(.01, Math.abs(dx)), (h / 2 - Math.min(140, h * .28)) / Math.max(.01, Math.abs(dy)));
        const x = w / 2 + dx * scale, y = h / 2 + dy * scale;
        c.translate(x, y); c.rotate(Math.atan2(dy, dx)); c.beginPath(); c.moveTo(6, 0); c.lineTo(-5, -5); c.lineTo(-5, 5); c.closePath(); c.fill();
        c.rotate(-Math.atan2(dy, dx)); c.font = '600 10px system-ui'; c.textAlign = 'center'; c.fillText(actor.class === 'turret' ? '砲' : actor.class === 'dragon' ? '竜' : actor.class === 'bow' ? '矢' : '魔', 0, 19);
      }
      c.restore();
    }
  }
  private drawRadar(state: CampaignState, player: Aircraft) {
    const c = this.ctx!, r = this.width < 360 ? 42 : 49;
    const layout = this.hudLayout.diagnostics();
    const x = layout.radar?.center.x ?? this.width - r - 18, y = layout.radar?.center.y ?? Math.min(this.height * .33, 180), range = 2400;
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const point = (position: Vec) => {
      const dx = position.x - player.position.x, dz = position.z - player.position.z;
      let px = (dx * cy - dz * sy) / range * r, py = (dx * sy + dz * cy) / range * r;
      const distance = Math.hypot(px, py); if (distance > r - 5) { px *= (r - 5) / distance; py *= (r - 5) / distance; }
      return { x: px, y: py, outside: distance > r - 5 };
    };
    c.save(); c.translate(x, y); c.fillStyle = 'rgba(4,24,34,.66)'; c.strokeStyle = 'rgba(150,212,211,.36)'; c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.arc(0, 0, r / 2, 0, Math.PI * 2); c.moveTo(-r, 0); c.lineTo(r, 0); c.moveTo(0, -r); c.lineTo(0, r); c.stroke();
    for (const actor of state.actors) {
      if (actor.hp <= 0 || actor.kind === 'turret') continue;
      const p = point(actor.position); c.fillStyle = actor.team === 'friendly' ? '#70d8c7' : '#ffb78c'; c.strokeStyle = c.fillStyle; c.beginPath();
      if (actor.kind === 'dragon') {
        c.moveTo(p.x, p.y - 3); c.lineTo(p.x + 4, p.y + 1); c.lineTo(p.x, p.y + 3); c.lineTo(p.x - 4, p.y + 1); c.closePath();
      } else c.arc(p.x, p.y, 1.05, 0, Math.PI * 2);
      if (p.outside) c.stroke(); else c.fill();
      if (actor.phase === 'telegraph' && actor.targetRef?.id === state.player.id) { c.lineWidth = 1.2; c.beginPath(); c.arc(p.x, p.y, 5, 0, Math.PI * 2); c.stroke(); }
    }
    c.font = '600 9px system-ui'; c.textAlign = 'center';
    for (const site of state.sites) {
      const p = point(site.position); c.fillStyle = 'rgba(4,24,34,.92)'; c.fillRect(p.x - 5, p.y - 6, 10, 11);
      c.fillStyle = site.owner === 'friendly' ? '#8ce5d3' : site.owner === 'enemy' ? '#ffba90' : '#e7ddbd';
      c.fillText(String(site.id + 1), p.x, p.y + 3);
      if (site.contested) { c.strokeStyle = '#fff2c9'; c.strokeRect(p.x - 5, p.y - 6, 10, 11); }
    }
    c.fillStyle = '#fff4ce'; c.beginPath(); c.moveTo(0, -5); c.lineTo(3, 4); c.lineTo(0, 2); c.lineTo(-3, 4); c.closePath(); c.fill();
    c.fillStyle = '#b8cfce'; c.font = '9px system-ui'; c.fillText('2.4km · 陣地1–7', 0, r + 13); c.restore();
  }

  diagnostics() {
    const hud = this.hudLayout.diagnostics();
    const hudStatus = hud.status === 'placed' && this.bombGuideLabel && this.bombGuideLabel.status !== 'placed' ? this.bombGuideLabel.status : hud.status;
    return { queue: this.renderQueue.diagnostics(performance.now()), calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures, particles: this.particles.length,
      ground: this.shadows.count, groundSubmitted: [...this.ground.values()].reduce((n, mesh) => n + mesh.count, 0), dragons: this.dragonBodies.count,
      sites: this.siteVisuals.size, width: this.width, height: this.height, pixelRatio: this.renderer.getPixelRatio(),
      aircraftTracers: this.aircraftTracers.diagnostics(), hudLayout: { ...hud, status: hudStatus, canvasLabels: this.bombGuideLabel ? [this.bombGuideLabel] : [] } };
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.hudLayout.dispose(); this.renderQueue.dispose(); this.scene.remove(this.hero.root); this.aircraftBatches.dispose(); this.aircraftTracers.dispose(); this.aircraftFactory.dispose();
    this.scene.traverse(object => { if (object instanceof InstancedMesh) object.dispose(); });
    for (const geometry of this.geometries) geometry.dispose(); for (const material of this.materials) material.dispose();
    this.geometries.clear(); this.materials.clear(); this.ground.clear(); this.projectileBodies.clear(); this.siteVisuals.clear(); this.particles = [];
    this.scene.clear(); this.ctx?.clearRect(0, 0, this.width, this.height); this.renderer.dispose();
  }
}
