import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry,
  CylinderGeometry, OctahedronGeometry, SphereGeometry, TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeometryBuilder } from '../src/campaign-scene';

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
