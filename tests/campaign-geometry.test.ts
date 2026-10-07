import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry,
  CylinderGeometry, Euler, Frustum, InstancedMesh, Matrix4, MeshStandardMaterial,
  OctahedronGeometry, PerspectiveCamera, Plane, Quaternion, Sphere, SphereGeometry,
  TorusGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CampaignScene, GeometryBuilder, groundInstanceOutsideView } from '../src/campaign-scene';
import { makeCampaignActor } from '../src/campaign';
import { heightAt } from '../src/campaign-terrain';
import { layoutCampaignCanvasLabel, type HudLayout, type HudRect } from '../src/campaign-hud-layout';

interface Part {
  geometry: BufferGeometry;
  color: number;
  position: readonly number[];
  scale: readonly number[];
  rotation: readonly number[];
}

// The pre-optimization builder is the oracle. Expanding its triangles and the
// indexed result must produce identical attribute bytes, including normal seams.
function previousGeometry(parts: readonly Part[]): BufferGeometry {
  const pieces = parts.map(({ geometry, color, position, scale, rotation }) => {
    const part = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    part.deleteAttribute('uv');
    part.scale(scale[0], scale[1], scale[2]);
    part.rotateX(rotation[0]); part.rotateY(rotation[1]); part.rotateZ(rotation[2]);
    part.translate(position[0], position[1], position[2]);
    const tint = new Color(color), colors = new Float32Array(part.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([tint.r, tint.g, tint.b], i);
    part.setAttribute('color', new BufferAttribute(colors, 3));
    return part;
  });
  const geometry = mergeGeometries(pieces, false)!;
  for (const piece of pieces) piece.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}

function indexedGeometry(parts: readonly Part[]): BufferGeometry {
  const builder = new GeometryBuilder();
  for (const part of parts) builder.add(part.geometry.clone(), part.color, part.position, part.scale, part.rotation);
  return builder.finish();
}

function bytes(array: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function assertSameTriangles(actual: BufferGeometry, expected: BufferGeometry): void {
  assert.ok(actual.index, 'the merged geometry retains an index');
  assert.equal(actual.index.count, expected.getAttribute('position').count, 'triangle count and ordering are unchanged');
  const count = actual.getAttribute('position').count;
  for (const index of actual.index.array) {
    assert.ok(Number.isInteger(index) && index >= 0 && index < count, `valid vertex index ${index}/${count}`);
  }
  const expanded = actual.toNonIndexed();
  try {
    assert.deepEqual(Object.keys(expanded.attributes).sort(), Object.keys(expected.attributes).sort());
    for (const name of Object.keys(expected.attributes)) {
      const left = expanded.getAttribute(name) as BufferAttribute, right = expected.getAttribute(name) as BufferAttribute;
      assert.equal(left.itemSize, right.itemSize, name);
      assert.equal(left.normalized, right.normalized, name);
      assert.equal(left.array.constructor, right.array.constructor, name);
      assert.deepEqual(bytes(left.array), bytes(right.array), `${name}: every triangle attribute is byte-identical`);
    }
    assert.deepEqual(actual.boundingSphere, expected.boundingSphere, 'unchanged culling bounds');
    assert.deepEqual(actual.drawRange, expected.drawRange, 'unchanged draw range');
    assert.deepEqual(actual.groups, expected.groups, 'unchanged single-material grouping');
  } finally {
    expanded.dispose();
  }
}

const primitives = [
  ['box', () => new BoxGeometry(1.7, .55, 1.55)],
  ['sphere', () => new SphereGeometry(1, 12, 8)],
  ['cylinder', () => new CylinderGeometry(.29, .46, 1.5, 7)],
  ['cone', () => new ConeGeometry(.28, 1.6, 6)],
  ['torus', () => new TorusGeometry(.64, .045, 4, 12, Math.PI)],
  ['octahedron', () => new OctahedronGeometry(.22)],
] as const;

for (const [name, make] of primitives) {
  test(`campaign ${name} keeps identical transformed triangles and authored normals`, () => {
    const geometry = make(), parts: Part[] = [{ geometry, color: 0x27aaa4,
      position: [13, -.18, -5.85], scale: [2.1, .65, 4.3], rotation: [.42, -.25, Math.PI / 2] }];
    const expected = previousGeometry(parts), actual = indexedGeometry(parts);
    try {
      assertSameTriangles(actual, expected);
      assert.equal(actual.getAttribute('position').count, geometry.getAttribute('position').count, 'no vertex duplication or welding');
      if (geometry.index) assert.ok(actual.getAttribute('position').count < expected.getAttribute('position').count);
    } finally { geometry.dispose(); expected.dispose(); actual.dispose(); }
  });
}

test('campaign mixed primitive and unindexed wing fan preserves order, winding, colors and index offsets', () => {
  const fan = new BufferGeometry();
  fan.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, 4, .5, -2.5, 12.8, 0, -1.5,
    0, 0, 0, 12.8, 0, -1.5, 9.5, -.6, 2.9,
  ]), 3));
  fan.computeVertexNormals();
  const parts: Part[] = primitives.map(([, make], i) => ({ geometry: make(), color: i % 2 ? 0xe29b55 : 0x27aaa4,
    position: [i * .7, i * -.3, i * 1.1], scale: [1 + i * .1, .8, 1.2], rotation: [i * .2, i * -.4, i * .1] }));
  parts.splice(2, 0, { geometry: fan, color: 0xb08559, position: [0, 0, 0], scale: [-1, 1, 1], rotation: [0, 0, .38] });
  const expected = previousGeometry(parts), actual = indexedGeometry(parts);
  try {
    assertSameTriangles(actual, expected);
    assert.equal(actual.getAttribute('position').count, parts.reduce((sum, part) => sum + part.geometry.getAttribute('position').count, 0));
    let offset = 0;
    const expectedIndices: number[] = [];
    for (const part of parts) {
      const count = part.geometry.getAttribute('position').count;
      expectedIndices.push(...Array.from(part.geometry.index?.array ?? Array.from({ length: count }, (_, vertex) => vertex), index => index + offset));
      offset += count;
    }
    assert.deepEqual(Array.from(actual.index!.array), expectedIndices, 'original triangle sequence with exact per-part index offsets');
    assert.ok(actual.getAttribute('position').count < expected.getAttribute('position').count, 'merged geometry reduces the vertex buffer without removing triangles');
  } finally {
    for (const part of parts) part.geometry.dispose();
    expected.dispose(); actual.dispose();
  }
});

test('campaign builder retains source disposal and can start a fresh geometry after finish', () => {
  const builder = new GeometryBuilder(), first = new BoxGeometry(1, 2, 3), second = new SphereGeometry(1, 8, 6);
  let disposed = 0;
  first.addEventListener('dispose', () => disposed++);
  second.addEventListener('dispose', () => disposed++);
  const firstCount = first.getAttribute('position').count, secondCount = second.getAttribute('position').count;
  builder.add(first, 0xffffff);
  const a = builder.finish();
  builder.add(second, 0x000000);
  const b = builder.finish();
  try {
    assert.equal(disposed, 2, 'each consumed source is disposed once');
    assert.equal(a.getAttribute('position').count, firstCount);
    assert.equal(b.getAttribute('position').count, secondCount, 'finish clears the earlier pieces');
  } finally { a.dispose(); b.dispose(); }
});

function cubeView(): Frustum {
  return new Frustum(
    new Plane(new Vector3(1, 0, 0), 1), new Plane(new Vector3(-1, 0, 0), 1),
    new Plane(new Vector3(0, 1, 0), 1), new Plane(new Vector3(0, -1, 0), 1),
    new Plane(new Vector3(0, 0, 1), 1), new Plane(new Vector3(0, 0, -1), 1),
  );
}

test('ground view rejection retains intersections, tangencies, boundary epsilon and depth-only exclusions', () => {
  const view = cubeView(), bounds = new Sphere(new Vector3(), .1), matrix = new Matrix4();
  assert.equal(groundInstanceOutsideView(bounds, matrix, view), false);
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
    const position = new Vector3();
    for (const distance of [1.05, 1 + Math.sqrt(3) * .1, 1 + Math.sqrt(3) * .1 + 1e-7]) {
      position.setComponent(axis, sign * distance); matrix.makeTranslation(position);
      assert.equal(groundInstanceOutsideView(bounds, matrix, view), false, 'keep a crossing/tangent/epsilon-near sphere');
    }
    position.setComponent(axis, sign * (1 + Math.sqrt(3) * .1 + .001)); matrix.makeTranslation(position);
    assert.equal(groundInstanceOutsideView(bounds, matrix, view), axis < 2,
      'reject only beyond a side plane; retain depth-only exclusions');
  }
  const offset = new Sphere(new Vector3(40, 0, 0), .1);
  assert.equal(groundInstanceOutsideView(offset, new Matrix4().makeTranslation(-40, 0, 0), view), false, 'transform the authored center, not just the actor origin');
  assert.equal(groundInstanceOutsideView(offset, new Matrix4(), view), true);
  assert.equal(groundInstanceOutsideView(new Sphere(new Vector3(1e8 + 1.1, 0, 0), .01),
    new Matrix4().makeTranslation(-1e8, 0, 0), view), false, 'cancellation uncertainty retains the model');
});

function shaderClip(camera: PerspectiveCamera, matrix: Matrix4, vertex: Vector3): number[] {
  // Model the uploaded Float32 uniforms/attributes and shader arithmetic,
  // separately multiplying instance, model-view and projection matrices.
  const multiply = (transform: Matrix4, input: readonly number[]) => [0, 1, 2, 3].map(row => {
    let value = 0;
    for (let column = 0; column < 4; column++) value = Math.fround(value
      + Math.fround(Math.fround(transform.elements[column * 4 + row]) * input[column]));
    return value;
  });
  return multiply(camera.projectionMatrix, multiply(camera.matrixWorldInverse,
    multiply(matrix, [Math.fround(vertex.x), Math.fround(vertex.y), Math.fround(vertex.z), 1])));
}

test('Float32 near/far clip uncertainty never removes depth-only ground models', () => {
  const camera = new PerspectiveCamera(64, 1440 / 900, .5, 22000); camera.updateMatrixWorld();
  const view = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const bounds = new Sphere(new Vector3(), .001);
  for (const z of [-.49999999, -.5, -.50000001, -21999, -22000, -22010, -22020, -24000]) {
    assert.equal(groundInstanceOutsideView(bounds, new Matrix4().makeTranslation(0, 0, z), view), false,
      `retain uncertain or fully depth-clipped model at ${z}`);
  }
  const matrix = new Matrix4().makeTranslation(0, 0, -22010), clip = shaderClip(camera, matrix, new Vector3());
  assert.ok(view.planes[4].distanceToPoint(new Vector3(0, 0, -22010)) < 0, 'CPU far plane says outside');
  assert.ok(clip[2] <= clip[3], 'Float32 shader retains a point beyond the CPU far plane');
  assert.equal(groundInstanceOutsideView(bounds, matrix, view), false);
});

test('unknown ground bounds, matrices and clip planes fail open', () => {
  const outside = new Matrix4().makeTranslation(100, 0, 0), valid = new Sphere(new Vector3(), 1);
  for (const bounds of [null, new Sphere(new Vector3(), NaN), new Sphere(new Vector3(), Infinity),
    new Sphere(new Vector3(), -1), new Sphere(new Vector3(NaN, 0, 0), 1)]) {
    assert.equal(groundInstanceOutsideView(bounds, outside, cubeView()), false);
  }
  for (const bad of [NaN, Infinity, -Infinity, 1e40]) {
    const matrix = outside.clone(); matrix.elements[5] = bad;
    assert.equal(groundInstanceOutsideView(valid, matrix, cubeView()), false);
  }
  const projective = outside.clone(); projective.elements[3] = .01;
  assert.equal(groundInstanceOutsideView(valid, projective, cubeView()), false);
  for (const bad of [NaN, Infinity]) {
    const view = cubeView(); view.planes[5].constant = bad;
    assert.equal(groundInstanceOutsideView(valid, outside, view), false, 'a later invalid plane overrides an earlier outside result');
  }
  const noNormal = cubeView(); noNormal.planes[5].normal.set(0, 0, 0);
  assert.equal(groundInstanceOutsideView(valid, outside, noNormal), false);
});

test('every rejected transformed primitive is wholly beyond one clip plane, including the uploaded Float32 matrix', () => {
  let rejected = 0, retained = 0;
  const poses = [new Euler(), new Euler(.4, .8, .9), new Euler(Math.PI, -.7, -.6)];
  const positions = [[0, 0, -20], [1000, 0, -20], [-1000, 0, -20], [0, 1000, -20],
    [0, -1000, -20], [0, 0, 20], [0, 0, -.1], [0, 0, -24000], [0, 0, -21999]];
  for (const aspect of [320 / 568, 393 / 852, 852 / 393, 1440 / 900]) for (const pose of poses) {
    const camera = new PerspectiveCamera(64, aspect, .5, 22000);
    camera.position.set(12, 311, -57); camera.quaternion.setFromEuler(pose); camera.updateMatrixWorld();
    const view = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const [, make] of primitives) {
      const geometry = make(); geometry.translate(7, 2, -3); geometry.computeBoundingSphere();
      const attribute = geometry.getAttribute('position');
      for (const [i, position] of positions.entries()) {
        const local = new Matrix4().compose(new Vector3(...position),
          new Quaternion().setFromEuler(new Euler(i * .13, i * -.17, i * .11)), new Vector3(i % 2 ? -2 : 1, .6, 1.4));
        // Include affine shear: the norm bound must still enclose every vertex.
        if (i % 3 === 0) local.elements[4] += .45;
        const matrix = new Matrix4().multiplyMatrices(camera.matrixWorld, local);
        if (!groundInstanceOutsideView(geometry.boundingSphere, matrix, view)) { retained++; continue; }
        rejected++;
        for (const transform of [matrix, new Matrix4().fromArray(Float32Array.from(matrix.elements))]) {
          const vertices = Array.from({ length: attribute.count }, (_, vertex) =>
            new Vector3().fromBufferAttribute(attribute, vertex).applyMatrix4(transform));
          assert.ok(view.planes.slice(0, 4).some(plane => vertices.every(vertex => plane.distanceToPoint(vertex) < 0)),
            'every original vertex and hence every triangle is beyond the same clip plane');
        }
        const clips = Array.from({ length: attribute.count }, (_, vertex) =>
          shaderClip(camera, matrix, new Vector3().fromBufferAttribute(attribute, vertex)));
        const sideDistances = clips.map(([x, y, , w]) => [w - x, w + x, w + y, w - y]);
        assert.ok([0, 1, 2, 3].some(side => sideDistances.every(distances => distances[side] < 0)),
          'all original vertices remain outside one common side plane under Float32 shader projection');
      }
      geometry.dispose();
    }
  }
  assert.ok(rejected > 0); assert.ok(retained > 0, 'the fixtures exercise both branches');
});

test('ground compaction preserves original capacity admission, visible matrix order, shadows and campaign state', () => {
  const geometry = new BoxGeometry(1.7, 2.1, 3.2); geometry.translate(.7, 1.5, -.2); geometry.computeBoundingSphere();
  const material = new MeshStandardMaterial({ vertexColors: true });
  const ground = new Map(['friendly:sword', 'friendly:bow'].map(key => [key, new InstancedMesh(geometry, material, 224)]));
  const shadows = new InstancedMesh(geometry, material, 448);
  const camera = new PerspectiveCamera(64, 1440 / 900, .5, 22000); camera.updateMatrixWorld();
  const view = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const actors = Array.from({ length: 260 }, (_, id) => {
    const actor = makeCampaignActor(id + 1, 'friendly', 'sword', 0, 0, { x: 0, y: 0, z: id < 200 ? 100 : -100 - id * .01 });
    actor.velocity.z = -1; return actor;
  });
  for (let i = 0; i < 3; i++) {
    const bow = makeCampaignActor(300 + i, 'friendly', 'bow', 0, 0, { x: i, y: 0, z: -100 }); bow.velocity.z = -1;
    actors.splice(i * 51, 0, bow);
  }
  const dead = makeCampaignActor(400, 'friendly', 'sword', 0, 0, { x: 0, y: 0, z: -100 }); dead.hp = 0; actors.unshift(dead);
  const state = { actors, sites: [] }, before = JSON.stringify(state);
  for (const actor of actors) {
    Object.freeze(actor.position); Object.freeze(actor.previous); Object.freeze(actor.velocity); Object.freeze(actor);
  }
  Object.freeze(actors); Object.freeze(state.sites); Object.freeze(state);
  // Exercise the actual adapter method without constructing a browser/renderer.
  const scene = Object.assign(Object.create(CampaignScene.prototype), {
    ground, shadows, groundView: view, siteVisuals: new Map(), dragonBodies: { count: 0, instanceMatrix: {} },
    dragonWings: { count: 0, instanceMatrix: {} }, tempMatrix: new Matrix4(), tempRotation: new Quaternion(),
    tempPosition: new Vector3(), tempScale: new Vector3(), up: new Vector3(0, 1, 0),
  });
  const admitted = new Map<string, number>(), expected = new Map<string, number[][]>(), expectedShadows: number[][] = [];
  for (const actor of actors) {
    if (actor.hp <= 0) continue;
    const key = `${actor.team}:${actor.class}`, count = admitted.get(key) ?? 0;
    if (count >= 224) continue;
    admitted.set(key, count + 1);
    const position = new Vector3(actor.position.x, actor.position.y, actor.position.z);
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-actor.velocity.x, -actor.velocity.z));
    const matrix = new Matrix4().compose(position, rotation, new Vector3(1, 1, 1));
    // Fixture's positive-Z actors are fully behind the camera; negative-Z actors
    // are fully inside it. This oracle does not call the rejection helper.
    if (actor.position.z < 0) {
      const matrices = expected.get(key) ?? []; matrices.push(Array.from(Float32Array.from(matrix.elements))); expected.set(key, matrices);
    }
    position.y = heightAt(position.x, position.z) + .14;
    matrix.compose(position, rotation, new Vector3(.82, 1, .82));
    expectedShadows.push(Array.from(Float32Array.from(matrix.elements)));
  }
  try {
    scene.updateActors(state);
    assert.equal(JSON.stringify(state), before, 'rendering never rewrites the campaign or its actors');
    assert.equal(ground.get('friendly:sword')!.count, 24, 'later visible actors beyond the original 224 limit stay excluded');
    const matrix = new Matrix4();
    for (const [key, mesh] of ground) {
      const matrices = expected.get(key)!; assert.equal(mesh.count, matrices.length);
      for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, matrix); assert.deepEqual(matrix.elements, matrices[i], 'unchanged retained matrix/order'); }
    }
    assert.equal(shadows.count, expectedShadows.length, 'offscreen bodies retain every originally admitted shadow');
    assert.equal(shadows.count, 227);
    for (let i = 0; i < shadows.count; i++) { shadows.getMatrixAt(i, matrix); assert.deepEqual(matrix.elements, expectedShadows[i], 'unchanged shadow matrix/order'); }
  } finally {
    for (const mesh of ground.values()) mesh.dispose(); shadows.dispose(); geometry.dispose(); material.dispose();
  }
});

test('bomb-label diagnostics match drawing and clear for inactive, dead, offscreen or absent predictions', () => {
  const scene = Object.create(CampaignScene.prototype) as any;
  const rectangles: number[][] = [], text: Array<{ value: string; x: number; y: number; font: string }> = [];
  scene.ctx = { font: '', save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
    measureText() { return { width: 109.5 }; }, fillRect(...args: number[]) { rectangles.push(args); },
    fillText(value: string, x: number, y: number) { text.push({ value, x, y, font: this.font }); } };
  scene.width = 568; scene.height = 320;
  scene.projection = () => ({ depth: 1, z: 0, nx: 0, ny: 0, x: 284, y: 196 });
  const player = { bombs: 1, hp: 100, position: { x: 0, y: 300, z: 0 }, velocity: { x: 0, y: 0, z: -100 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  const state = { player, actors: [], mode: 'normal' }, before = JSON.stringify(state);
  const layout = { status: 'placed', canvas: { x: 0, y: 0, width: 568, height: 320 }, bounds: { x: 8, y: 8, width: 552, height: 304 },
    radar: { status: 'placed', rect: { x: 341.84375, y: 101.875, width: 100, height: 116 }, radius: 49, center: { x: 391.84375, y: 151.875 } },
    obstacles: [], panels: [], threat: null };
  scene.hudLayout = { placeCanvasLabel(id: string, preferred: HudRect) {
    assert.equal(id, 'bomb-guide'); return layoutCampaignCanvasLabel(layout as HudLayout, preferred);
  } };
  scene.drawBombGuide(state);
  const drawn = scene.bombGuideLabel;
  assert.equal(drawn.status, 'placed');
  assert.deepEqual(rectangles, [[drawn.rect.x, drawn.rect.y, 121.5, 20]], 'diagnostics match the actual full-size background draw');
  assert.deepEqual(text, [{ value: drawn.text, x: drawn.rect.x + 6, y: drawn.rect.y + 14, font: '600 10px system-ui' }]);
  assert.equal(JSON.stringify(state), before, 'presentation does not alter bomb state');
  scene.projection = () => ({ depth: -1, z: 0, nx: 0, ny: 0, x: 0, y: 0 });
  for (const state of [{ player: { ...player, bombs: 0 } }, { player: { ...player, hp: 0 } }, { player },
    { player: { ...player, position: { x: 0, y: 100000, z: 0 } } }]) {
    scene.bombGuideLabel = { id: 'bomb-guide', status: 'placed', text: 'previous label', rect: { x: 20, y: 20, width: 120, height: 20 } };
    scene.drawBombGuide(state);
    assert.equal(scene.bombGuideLabel, null, 'do not retain an earlier drawn box after any early return');
  }
});
